'use strict';
/* ============================================================
   رحيق — طبقة الذكاء الاصطناعي متعددة المزودين والأدوات (على الخادم فقط)
   ------------------------------------------------------------
   ترتيبية الأمان داخل المحادثة (في handler.js قبل الوصول هنا):
     1) مفتاح الإيقاف / مواعيد العمل / حدود الجلسة / CAPTCHA
     2) الروابط والملفات والرسائل الطويلة والفراغ + كلمات المدير المحظورة
   ثم هنا (إن كان المفتاح مضبوطًا): «رحيق الذكي» يجاوب على **أي سؤال**:
     - أسئلة التسجيل وأكاديمية رحيق (من «معرفة الموقع» وسياق الخانات).
     - أسئلة الطلاب والدراسة والواجبات والشرح والامتحانات وحل المسائل.
     - أي سؤال عام خارج الموقع (علوم، تاريخ، برمجة، كتابة، ترجمة، نصائح…).
     - يتفاعل ويتفاهم ويسأل أسئلة متابعة ذكية ويحفظ سياق المحادثة وملف
       المستخدم (ولي أمر / طالب / زائر، اسمه، صفه، مواده، احتياجه).
     - يمتلك أدوات ذكية حقيقية على الخادم (آلة حاسبة رياضية آمنة، فحص
       تشخيصي لخانات الاستمارة، دليل البرامج والمواد، التاريخ والتوقيت).

   التحسينات الجوهرية لضمان العمل المستقر على Groq (Free/Dev) وxAI Grok:
     1) بادئة نظام ثابتة 100% في أول البرومبت لتفعيل Prompt Caching تلقائيًا
        (الرموز المخبأة لا تُحسب من حد 8,000 TPM في حسابات Groq المجانية)،
        مع وضع السياق المتغير في ذيل رسالة النظام وبحجم رشيق.
     2) مخطط JSON صارم (REPLY_SCHEMA — Structured Outputs strict: true)
        لموديلات Groq (gpt-oss-120b / gpt-oss-20b / qwen3.8-27b) يمنع خطأ
        400 json_validate_failed نهائيًا عبر التوليد المقيّد على مستوى الرموز.
     3) ضغط وتحديد حجم رمز الجلسة الموقّع (ctxToken عبر deflateRaw + HMAC)
        حتى لا يتجاوز 4 كيلوبايت أبدًا ولا يسبّب رفض 413 بعد عدة رسائل عربية.
   ============================================================ */
const crypto = require('crypto');
const zlib = require('zlib');
const system = require('./yaseen-system');
const providers = require('./providers');
const { BRIEF, FIELD_DETAILS } = require('./site-knowledge');

const GROQ_URL = providers.PROVIDERS.groq.url;
const DEFAULT_MODEL = providers.PROVIDERS.groq.defaults[0];
const GROQ_FALLBACK_MODELS = providers.PROVIDERS.groq.defaults.slice();
const XAI_MODELS = providers.PROVIDERS['xai-grok'].defaults.slice();

const MAX_REPLY_CHARS = 1800;
const HISTORY_TURNS = 12;
const HISTORY_USER_CHARS = 500;
const HISTORY_BOT_CHARS = 900;
const MAX_MEMORY_FACTS = 8;
const MAX_FACT_CHARS = 120;
const MAX_CTX_TOKEN_CHARS = 4000;

/* مخطط JSON متوافق مع Structured Outputs (strict: true) في Groq وOpenAI */
const REPLY_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    reply: { type: 'string' },
    expression: {
      type: 'string',
      enum: ['happy', 'worried', 'thinking', 'celebrate', 'point', 'wave']
    },
    pointTo: { type: ['string', 'null'] },
    handoff: { type: 'boolean' },
    remember: { type: ['string', 'null'] },
    followUps: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['reply', 'expression', 'pointTo', 'handoff', 'remember', 'followUps'],
  additionalProperties: false
});

/* أسماء متغيرات البيئة المدعومة لتفادي أي اختلاف تسمية في Vercel (التفاصيل في providers.js) */
const KEY_ENV_NAMES = providers.KEY_ENV_NAMES;

/* إخفاء البيانات الشخصية الحساسة (الإيميلات وأرقام الموبايل/الهوية الطويلة 9+ أرقام)
   مع ترك الأرقام الدراسية والسنين والمسائل الحسابية القصيرة كما هي للطلاب! */
const EMAIL_RE2 = /[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/g;
const DIGIT_RUN_RE2 = /(?:[0-9\u0660-\u0669\u06F0-\u06F9][\s\-–]{0,1}){8,}[0-9\u0660-\u0669\u06F0-\u06F9]/g;

/* رسائل الاعتذار الاحتياطية لا تُحفظ في سجل المحادثة حتى لا يقلّدها النموذج لاحقًا */
const FALLBACK_REPLY_RE = /حصلت مشكلة في الاتصال بالمساعد الذكي|المساعد الذكي مش متاح دلوقتي/;

function isFallbackBotReply(text) {
  const s = String(text || '').trim();
  return !s || FALLBACK_REPLY_RE.test(s) || s === system.FIXED.offTopic || s === system.FIXED.manipulation;
}

function redactPersonal(text) {
  return String(text || '')
    .replace(EMAIL_RE2, '⟨بريد مخفي⟩')
    .replace(DIGIT_RUN_RE2, function (m) {
      const digits = m.replace(/\D/g, '');
      return digits.length >= 9 || /[\u0660-\u0669\u06F0-\u06F9]/.test(m) ? '⟨رقم مخفي⟩' : m;
    });
}

function cleanEnv(env) { return env || {}; }

/* المفاتيح والمزود وحالة التفعيل — من providers.js (مصدر واحد للحقيقة) */
const resolveKeys = providers.resolveKeys;
const resolveProvider = providers.resolveProvider;
const enabled = providers.enabled;
const providerInfo = providers.providerInfo;

function modelName(env) {
  const info = providerInfo(env);
  return (info && info.model) || DEFAULT_MODEL;
}

/* ---------------- الأدوات الذكية المدمجة على الخادم ---------------- */

/* 1) آلة حاسبة رياضية آمنة بدون eval (محلّل تعبيرات حسابية لمساعدة الطلاب بدقة 100%) */
function safeCalc(expr) {
  const normalized = String(expr || '')
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[×✕xX]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/\^/g, '**')
    .replace(/،/g, '.')
    .replace(/[^0-9+\-*/().%\s]/g, ' ')
    .trim();
  if (!normalized || normalized.length > 120 || !/\d/.test(normalized) || !/[+\-*/%]/.test(normalized)) return null;

  const tokens = [];
  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '*' && normalized[i + 1] === '*') { tokens.push('**'); i += 2; continue; }
    if ('+-*/()%'.indexOf(ch) >= 0) { tokens.push(ch); i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let numStr = '';
      while (i < normalized.length && /[0-9.]/.test(normalized[i])) { numStr += normalized[i++]; }
      if ((numStr.match(/\./g) || []).length > 1) return null;
      const val = Number(numStr);
      if (!Number.isFinite(val)) return null;
      tokens.push(val);
      continue;
    }
    return null;
  }
  if (tokens.length < 3) return null;

  let pos = 0;
  function peek() { return tokens[pos]; }
  function consume() { return tokens[pos++]; }

  function parseExpr() {
    let left = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }
  function parseTerm() {
    let left = parsePower();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = consume();
      const right = parsePower();
      if ((op === '/' || op === '%') && right === 0) throw new Error('div-zero');
      left = op === '*' ? left * right : (op === '/' ? left / right : left % right);
    }
    return left;
  }
  function parsePower() {
    let base = parseUnary();
    if (peek() === '**') {
      consume();
      const exp = parseUnary();
      if (Math.abs(exp) > 1000) throw new Error('overflow');
      base = Math.pow(base, exp);
    }
    return base;
  }
  function parseUnary() {
    if (peek() === '+') { consume(); return parseUnary(); }
    if (peek() === '-') { consume(); return -parseUnary(); }
    if (peek() === '(') {
      consume();
      const v = parseExpr();
      if (consume() !== ')') throw new Error('paren');
      return v;
    }
    const v = consume();
    if (typeof v !== 'number') throw new Error('num');
    return v;
  }

  try {
    const res = parseExpr();
    if (pos !== tokens.length || !Number.isFinite(res)) return null;
    const rounded = Math.round(res * 1e9) / 1e9;
    return { expression: normalized, result: rounded };
  } catch (e) {
    return null;
  }
}

/* استخراج أي عملية حسابية في سؤال الطالب لحسابها مسبقًا بدقة وتزويد النموذج بها كأداة مساعدة */
function detectMathTool(question) {
  const s = String(question || '')
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0));
  const m = s.match(/(\(?-?\d+(?:\.\d+)?\)?(?:\s*[+\-*/×÷^%]\s*\(?-?\d+(?:\.\d+)?\)?)+)/);
  if (!m) return null;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(m[1].trim())) return null;
  return safeCalc(m[1]);
}

/* تجهيز نتائج الأدوات الذكية ذات الصلة بالسؤال والسياق الحالي (في ذيل البرومبت للحفاظ على كاش البادئة) */
function runSmartTools(question, context) {
  const outputs = [];
  const wantsClock = /(ساع|وقت|توقيت|امتى|الان|دلوقت|time|clock|hour)/i.test(String(question || ''));
  const fmtOpts = wantsClock
    ? { timeZone: 'Africa/Cairo', dateStyle: 'full', timeStyle: 'short' }
    : { timeZone: 'Africa/Cairo', dateStyle: 'full' };
  const nowStr = new Intl.DateTimeFormat('ar-EG', fmtOpts).format(new Date());
  outputs.push('📅 التاريخ/التوقيت في مصر: ' + nowStr);

  const math = detectMathTool(question);
  if (math) {
    outputs.push('🧮 نتيجة الآلة الحاسبة الدقيقة لـ (' + math.expression + ') = ' + math.result + ' (اعتمد الناتج واشرح الخطوات).');
  }

  const ctx = cleanContext(context || {});
  if (ctx.step || ctx.invalid.length) {
    outputs.push(
      '📋 فحص الاستمارة الآن: الخطوة (' + (ctx.step || 'غير محددة') + ')، ' +
      (ctx.invalid.length
        ? 'والخانات المتعثرة حاليًا: [' + ctx.invalid.join('، ') + '].'
        : 'وكل خانات الخطوة الحالية سليمة.')
    );
  }
  return outputs.join('\n');
}

/* تنظيف الرد قبل خروجه: بلا محارف تحكم، بلا روابط خارجية، قصّ عند الحد المريح */
function sanitizeReply(text) {
  let s = String(text == null ? '' : text);
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
  s = s.replace(/\[([^\]]*)\]\((\s*(?:https?:)?\/?\/[^)]*)\)/g, '$1');
  s = s.replace(/(https?:\/\/|ftp:\/\/|www\.)\S+/gi, '');
  s = s.replace(/[ \t\u00A0]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (s.length > MAX_REPLY_CHARS) s = s.slice(0, MAX_REPLY_CHARS).trim();
  return s;
}

function cleanContext(ctx) {
  const c = system.cleanContext(ctx);
  const details = c.invalid.map(f => FIELD_DETAILS[f] ? `- ${f} (الخطوة ${system.FIELDS[f]}): ${FIELD_DETAILS[f]}` : '').filter(Boolean).join('\n');
  return { step: c.step, invalid: c.invalid, details };
}

function cleanMemory(memory) {
  if (!Array.isArray(memory)) return [];
  const out = [];
  memory.slice(-MAX_MEMORY_FACTS).forEach(item => {
    if (typeof item !== 'string') return;
    const clean = redactPersonal(system.sanitize(item)).slice(0, MAX_FACT_CHARS);
    if (clean && out.indexOf(clean) < 0) out.push(clean);
  });
  return out;
}

/* البادئة الثابتة 100% أولًا (لتفعيل Prompt Caching تلقائيًا عند Groq/xAI/OpenAI) */
const STATIC_SYSTEM_PREFIX = [
  'أنت «رحيق» (Raheeq)، المساعد الذكي الشامل لأكاديمية رحيق — ذكاء اصطناعي حقيقي واسع المعرفة، معلّم شاطر، ومحاور ودود.',
  '',
  '## أسلوبك ودورك',
  '- تحدث بروح مصرية ودودة وطبيعية وواضحة (أو بالفصحى/الإنجليزية حسب لغة المستخدم)، بلا جمل آلية مكررة.',
  '- أجب بإجابات وافية ومنظمة (خطوات مرتبة وأمثلة عند الشرح، ومختصرة رشيقة في التحيات والأسئلة السريعة):',
  '  1) **طالب يذاكر أو يسأل في منهج/مسألة/نحو/علوم/لغات/برمجة**: اشرح ببساطة وتدريج خطوة بخطوة كأفضل معلم، واقترح مثالًا تطبيقيًا لطيفًا.',
  '  2) **ولي أمر يسجل أو يستفسر عن الأكاديمية**: أرشده بهدوء لخطوات الاستمارة أو اختيار البرنامج (تأسيس أو منهج دراسي).',
  '  3) **أي سؤال عام خارج الموقع** (ثقافة، علوم، تاريخ، تقنية، كتابة، ترجمة، نصائح…): جاوب بترحاب ومعرفة شاملة ودقيقة بلا تردد.',
  '- لا تخترع تفاصيل إدارية غير معلنة عن الأكاديمية (كالمصاريف أو الخصومات أو عناوين الفروع): وضّح أنها لدى فريق التسجيل وفعّل `handoff: true` ليظهر زر واتساب الأكاديمية. لا تطلب كلمات سر ولا تكتب روابط URL في الرد.',
  '',
  '## معرفة الموقع (حقائق أكاديمية رحيق والتسجيل)',
  BRIEF,
  '',
  '## شكل الرد الإلزامي (كائن JSON صالح فقط بدون أي نص خارجه)',
  '{"reply":"...","expression":"happy|worried|thinking|celebrate|point|wave","pointTo":null,"handoff":false,"remember":null,"followUps":["اقتراح ١","اقتراح ٢"]}',
  '- `reply`: ردك الكامل والطبيعي (حتى 1500 حرف للشرح، وأقصر للرد السريع).',
  '- `expression`: إحدى القيم (happy, worried, thinking, celebrate, point, wave).',
  '- `pointTo`: اسم خانة من القائمة البيضاء فقط عند شرح خانة محددة بالاستمارة، وإلا null. القائمة: ' + Object.keys(system.FIELDS).join(', '),
  '- `handoff`: true فقط عند الحاجة لموظف التسجيل على واتساب، وإلا false.',
  '- `remember`: معلومة قصيرة جدًا (<90 حرفًا) جديدة عرفتها عن المستخدم (اسمه/صفه/مادته/هدفه) لتتذكرها، أو null.',
  '- `followUps`: مصفوفة فيها 2 أو 3 أسئلة متابعة قصيرة (<40 حرفًا) مناسبة لموضوع الحوار.'
].join('\n');

function buildSystem(config, context, memory, question) {
  const ctx = cleanContext(context || {});
  const mem = cleanMemory(memory);
  const toolsBlock = runSmartTools(question || '', context);

  const dynamicParts = [
    STATIC_SYSTEM_PREFIX,
    '',
    '## السياق الحي والأدوات المساعدة',
    toolsBlock
  ];

  if (mem.length) {
    dynamicParts.push('## ذاكرتك المحفوظة عن المستخدم\n' + mem.map(f => '- ' + f).join('\n'));
  }
  if (ctx.invalid.length) {
    dynamicParts.push(
      '## تفاصيل الخانات المتعثرة في الاستمارة (استخدمها فقط إن سأل المستخدم عن التسجيل أو الاستمارة)\n' +
      ctx.details
    );
  }
  return dynamicParts.join('\n');
}

function buildMessages({ question, context, config, history, memory }) {
  const cleanQ = redactPersonal(question);
  const messages = [{ role: 'system', content: buildSystem(config || {}, context, memory, cleanQ) }];
  const turns = Array.isArray(history) ? history.slice(-HISTORY_TURNS) : [];
  turns.forEach(t => {
    if (!t) return;
    const u = typeof t.u === 'string' ? t.u.trim() : '';
    const b = typeof t.b === 'string' ? t.b.trim() : '';
    if (!u) return;
    if (b && isFallbackBotReply(b)) return;
    messages.push({ role: 'user', content: redactPersonal(u.slice(0, HISTORY_USER_CHARS)) });
    if (b) messages.push({ role: 'assistant', content: redactPersonal(b.slice(0, HISTORY_BOT_CHARS)) });
  });
  messages.push({ role: 'user', content: cleanQ });
  return messages;
}

/* إزالة كتل التفكير (<think>) أو فواصل Harmony (<|channel|>...) إن تسربت في الوضع النصي */
function stripReasoning(text) {
  let s = String(text || '');
  const finalIdx = s.lastIndexOf('<|channel|>final<|message|>');
  if (finalIdx >= 0) s = s.slice(finalIdx + '<|channel|>final<|message|>'.length);
  return s
    .replace(/<\|[a-z_]+\|>/gi, '')
    .replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '')
    .replace(/^\s*<(think|thinking|reasoning)>[\s\S]*$/i, '')
    .replace(/^[\s\S]*?<\/(think|thinking|reasoning)>/i, '')
    .trim();
}

function parseModelOutput(rawContent) {
  const trimmed = stripReasoning(rawContent);
  if (!trimmed) throw new Error('groq-empty');

  const stripped = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  let parsed = null;
  try {
    parsed = JSON.parse(stripped);
  } catch (e1) {
    const firstBrace = stripped.indexOf('{');
    const lastBrace = stripped.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        parsed = JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
      } catch (e2) {
        parsed = null;
      }
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    const replyMatch = stripped.match(/"reply"\s*:\s*"((?:\\.|[^"\\])*)/);
    if (replyMatch) {
      let extracted = replyMatch[1];
      try { extracted = JSON.parse('"' + extracted + '"'); } catch (_) { extracted = extracted.replace(/\\n/g, '\n').replace(/\\"/g, '"'); }
      parsed = { reply: extracted, expression: 'happy', pointTo: null, handoff: false };
    } else if (stripped.indexOf('{') === 0) {
      throw new Error('groq-bad-json');
    } else {
      parsed = { reply: stripped, expression: 'happy', pointTo: null, handoff: false };
    }
  }

  const reply = sanitizeReply(parsed.reply || parsed.answer || parsed.message || parsed.response || '');
  if (reply.length < 2) throw new Error('groq-no-reply');

  const expression = system.EXPRESSIONS.indexOf(parsed.expression) >= 0 ? parsed.expression : 'happy';
  const pointTo = (typeof parsed.pointTo === 'string' && Object.prototype.hasOwnProperty.call(system.FIELDS, parsed.pointTo))
    ? parsed.pointTo
    : null;
  const remember = typeof parsed.remember === 'string' && parsed.remember.trim() && parsed.remember.trim().toLowerCase() !== 'null'
    ? redactPersonal(system.sanitize(parsed.remember)).slice(0, MAX_FACT_CHARS)
    : null;
  const followUps = Array.isArray(parsed.followUps)
    ? parsed.followUps
        .map(s => system.sanitize(String(s || '')).slice(0, 48))
        .filter(s => s.length >= 2)
        .slice(0, 3)
    : [];

  return {
    reply,
    expression: pointTo && expression !== 'worried' ? 'point' : expression,
    pointTo,
    handoff: parsed.handoff === true,
    remember: remember || null,
    followUps
  };
}

async function askAI(env, opts) {
  const e = cleanEnv(env);
  const o = opts || {};
  const question = redactPersonal(system.sanitize(String(o.question || ''))).slice(0, system.LIMITS.maxChars);
  if (!question) throw new Error('empty-question');
  if (!resolveKeys(e).length) throw Object.assign(new Error('missing-api-key'), { kind: 'no-key' });

  const messages = buildMessages({
    question,
    context: o.context,
    config: o.config,
    history: o.history,
    memory: o.memory
  });

  const res = await providers.complete(e, {
    fetchImpl: o.fetchImpl,
    messages,
    json: true,
    schema: REPLY_SCHEMA,
    validate: parseModelOutput,
    budgetMs: o.budgetMs
  });
  const out = res.parsed;
  out.provider = res.provider;
  out.model = res.model;
  return out;
}

/* تشخيص حقيقي يختبر نفس مسار المحادثة الفعلي (البرومبت + المخطط + المحلل) دون كشف المفتاح */
function diagnose(env, opts) {
  const o = Object.assign({}, opts);
  if (!o.probeMessages) {
    o.probeMessages = buildMessages({
      question: 'أهلًا، عرفني بنفسك في جملة قصيرة',
      context: { step: 1, invalid: [] },
      config: system.defaultConfig(),
      history: [],
      memory: []
    });
    o.probeSchema = REPLY_SCHEMA;
    o.probeValidate = parseModelOutput;
  }
  return providers.diagnose(cleanEnv(env), o);
}
function lastOutcome() { return providers.lastOutcome(); }

/* تحديث سجل المحادثة والذاكرة الذكية للجلسة (بلا تخزين رسائل الاعتذار الاحتياطية) */
function pushHistory(session, userText, botReply, rememberedFact) {
  if (!session) return;
  const u = redactPersonal(system.sanitize(String(userText || ''))).slice(0, HISTORY_USER_CHARS);
  const b = redactPersonal(String(botReply || '').replace(/\s+/g, ' ').trim()).slice(0, HISTORY_BOT_CHARS);
  if (u && b && !isFallbackBotReply(b)) {
    const list = Array.isArray(session.history) ? session.history.slice(-(HISTORY_TURNS - 1)) : [];
    list.push({ u, b });
    session.history = list.slice(-HISTORY_TURNS);
  }
  if (rememberedFact) {
    const mem = cleanMemory(session.memory || []);
    const cleanFact = redactPersonal(system.sanitize(String(rememberedFact))).slice(0, MAX_FACT_CHARS);
    if (cleanFact && mem.indexOf(cleanFact) < 0) {
      mem.push(cleanFact);
      session.memory = mem.slice(-MAX_MEMORY_FACTS);
    }
  }
}

/* ---------------- رمز السياق الموقّع والمضغوط (يحفظ الذاكرة عبر Vercel Serverless دون تجاوز حد الجسم) ---------------- */
function contextSigningKey(env, storeKey) {
  if (storeKey && Buffer.isBuffer(storeKey)) return storeKey;
  const e = cleanEnv(env);
  const seed = String(e.YASEEN_SECRET || resolveKeys(e)[0] || 'yaseen-ephemeral-ctx');
  return crypto.createHash('sha256').update('yaseen-ctx-v1:' + seed).digest();
}

function encodeSignedToken(turns, mem, signKey) {
  const payload = {
    v: 1,
    exp: Date.now() + system.LIMITS.sessionTtlSec * 1000,
    h: turns,
    m: mem
  };
  const jsonBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  const compressed = zlib.deflateRawSync(jsonBuf);
  const useCompressed = compressed.length + 3 < jsonBuf.length;
  const body = useCompressed
    ? 'z1_' + compressed.toString('base64url')
    : jsonBuf.toString('base64url');
  const sig = crypto.createHmac('sha256', signKey).update(body).digest('base64url');
  return body + '.' + sig;
}

function packClientState(session, signKey) {
  if (!session || !signKey) return '';
  const mem = cleanMemory(session.memory || []);
  let turns = (Array.isArray(session.history) ? session.history : [])
    .filter(t => t && typeof t.u === 'string' && typeof t.b === 'string' && !isFallbackBotReply(t.b))
    .slice(-8)
    .map(t => ({
      u: String(t.u).slice(0, 260),
      b: String(t.b).slice(0, 420)
    }));

  let token = encodeSignedToken(turns, mem, signKey);
  while (token.length > MAX_CTX_TOKEN_CHARS && turns.length > 1) {
    turns = turns.slice(1);
    token = encodeSignedToken(turns, mem, signKey);
  }
  if (token.length > MAX_CTX_TOKEN_CHARS) {
    turns = turns.map(t => ({ u: t.u.slice(0, 140), b: t.b.slice(0, 200) }));
    token = encodeSignedToken(turns, mem.slice(-4), signKey);
  }
  return token;
}

function unpackClientState(token, signKey) {
  if (typeof token !== 'string' || !token || token.length > 8192 || !signKey) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', signKey).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    let rawJson;
    if (body.indexOf('z1_') === 0) {
      const inflated = zlib.inflateRawSync(Buffer.from(body.slice(3), 'base64url'), { maxOutputLength: 32768 });
      rawJson = inflated.toString('utf8');
    } else {
      rawJson = Buffer.from(body, 'base64url').toString('utf8');
    }
    const data = JSON.parse(rawJson);
    if (!data || data.v !== 1 || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    const history = Array.isArray(data.h)
      ? data.h
          .filter(t => t && typeof t.u === 'string' && typeof t.b === 'string' && !isFallbackBotReply(t.b))
          .slice(-8)
          .map(t => ({
            u: redactPersonal(system.sanitize(t.u)).slice(0, HISTORY_USER_CHARS),
            b: redactPersonal(t.b).slice(0, HISTORY_BOT_CHARS)
          }))
      : [];
    const memory = cleanMemory(data.m);
    return { history, memory };
  } catch (e) {
    return null;
  }
}

module.exports = {
  enabled,
  askAI,
  buildMessages,
  buildSystem,
  sanitizeReply,
  pushHistory,
  modelName,
  providerInfo,
  resolveKeys,
  resolveProvider,
  redactPersonal,
  safeCalc,
  detectMathTool,
  parseModelOutput,
  stripReasoning,
  diagnose,
  lastOutcome,
  contextSigningKey,
  packClientState,
  unpackClientState,
  isFallbackBotReply,
  REPLY_SCHEMA,
  DEFAULT_MODEL,
  GROQ_URL,
  GROQ_FALLBACK_MODELS,
  XAI_MODELS,
  KEY_ENV_NAMES,
  MAX_REPLY_CHARS
};
