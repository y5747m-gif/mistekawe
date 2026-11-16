'use strict';
/* ============================================================
   رحيق — مزودو الذكاء الاصطناعي (على الخادم فقط)
   ------------------------------------------------------------
   كل ما يخص «الاتصال» بالنموذج — منفصل عن البرومبت والتحليل في ai.js:

   1) المفتاح: يُقرأ من أي اسم شائع (XAI_API_KEY / GROK_API_KEY /
      GROQ_API_KEY / AI_API_KEY ...) بل ومن أي متغير بيئة قيمته مفتاح
      صريح يبدأ بـ xai- أو gsk_ — فلا يضيع المفتاح بسبب اسم المتغير.
      وتُزال علامات التنصيص و«Bearer» والمحارف الخفية الناتجة عن اللصق.
   2) المزود من بادئة المفتاح:
         xai-   => xAI Grok   (api.x.ai)
         gsk_   => Groq       (api.groq.com)
         sk-or- => OpenRouter · AIza => Gemini · sk- => OpenAI (OPENAI_API_KEY)
   3) الموديلات: قائمة حالية لكل مزود (نوفمبر 2026). الموديلات المتقاعدة
      (grok-beta / grok-2 / llama-3.3-70b-versatile ...) لا تُجرَّب أولًا أبدًا،
      وأي موديل يرد «غير موجود/متقاعد» يُعلَّم ميتًا ويُتخطّى، ثم تُكتشف
      الموديلات المتاحة فعلًا للمفتاح من GET /models وتُرتَّب وتُجرَّب —
      فلا يتعطل الذكاء الاصطناعي مرة أخرى عند تقاعد موديل جديد.
   4) معاملات كل موديل: reasoning_effort المناسب (none لـ grok-4.3،
      low لموديلات التفكير)، max_completion_tokens، وJSON mode — ولو رفض
      المزود معاملًا (400) يُعاد الطلب بمعاملات أقل تلقائيًا.
   5) تصنيف الأخطاء: مفتاح مرفوض / لا رصيد / موديل متقاعد / ضغط / مهلة /
      شبكة — مع ميزانية زمنية إجمالية حتى يرد الخادم قبل مهلة المتصفح (20 ث).
   6) تشخيص آمن (diagnose) لمسار /api/yaseen-ai-status لا يكشف المفتاح أبدًا.
   ============================================================ */
const crypto = require('crypto');

/* أسماء متغيرات البيئة المقروءة بالترتيب (الأقدم أولًا للحفاظ على التوافق) */
const KEY_ENV_NAMES = [
  'GROQ_API_KEY', 'GROQ_API_KEYS', 'GROQ_KEY',
  'GROK_API_KEY', 'GROK_KEY', 'XAI_API_KEY',
  'AI_API_KEY', 'AI_KEY',
  'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY',
  'NEXT_PUBLIC_GROQ_API_KEY', 'VITE_GROQ_API_KEY', 'API_KEY',
  /* أسماء إضافية شائعة لمفتاح Grok */
  'XAI_KEY', 'XAI_TOKEN', 'XAI_API_TOKEN', 'GROK_API_TOKEN', 'GROK_TOKEN', 'GROK_SECRET',
  'GROQ_TOKEN', 'NEXT_PUBLIC_GROK_API_KEY', 'VITE_GROK_API_KEY', 'NEXT_PUBLIC_XAI_API_KEY', 'VITE_XAI_API_KEY'
];
const URL_ENV_NAMES = ['GROQ_BASE_URL', 'AI_BASE_URL', 'OPENAI_BASE_URL', 'XAI_BASE_URL', 'GROK_BASE_URL'];
const GENERIC_MODEL_ENV = ['AI_MODEL', 'GROQ_MODEL', 'GROK_MODEL', 'XAI_MODEL', 'OPENAI_MODEL', 'OPENROUTER_MODEL', 'GEMINI_MODEL'];

const DEFAULT_BUDGET_MS = 16000;   // إجمالي وقت المحاولات (المتصفح يقطع عند 20 ث)
const DEFAULT_TRY_MS = 12000;      // أقصى وقت لمحاولة واحدة
const MIN_TRY_MS = 1500;           // لا نبدأ محاولة جديدة لو الباقي أقل من كده
const DEAD_MODEL_MS = 30 * 60 * 1000;
const DEAD_KEY_MS = 5 * 60 * 1000;
const DISCOVERY_TTL_MS = 30 * 60 * 1000;

/* ---------------- المزودون والموديلات الحالية (نوفمبر 2026) ---------------- */
const PROVIDERS = {
  'xai-grok': {
    name: 'xai-grok',
    label: 'xAI Grok',
    url: 'https://api.x.ai/v1/chat/completions',
    modelEnv: ['GROK_MODEL', 'XAI_MODEL'],
    /* grok-4.3 بدون تفكير = الأسرع والأرخص ($1.25/$2.50) وهو بديل xAI الرسمي للموديلات المتقاعدة */
    defaults: ['grok-4.3', 'grok-4.20-0309-non-reasoning', 'grok-4.7'],
    tokenParam: 'max_completion_tokens',
    fits: m => /^grok/i.test(m),
    chat: m => /^grok/i.test(m) && !/imagine|image|video|voice|tts|stt|transcri|embed|multi-agent|build|vision|beta/i.test(m),
    rank: [/^grok-4\.3(-latest)?$/i, /^grok-4\.20.*non-reasoning/i, /^grok-4\.\d+(-latest)?$/i, /^grok-[5-9]/i, /^grok-4\.20/i, /^grok/i],
    console: 'console.x.ai'
  },
  groq: {
    name: 'groq',
    label: 'Groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    modelEnv: ['GROQ_MODEL'],
    /* Llama 3.x أُوقفت لحسابات Free/Developer في أغسطس 2026 — البديل الرسمي GPT-OSS */
    defaults: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'],
    tokenParam: 'max_completion_tokens',
    fits: m => !/^(grok|gemini|claude|gpt-|o\d|chatgpt|models\/)/i.test(m),
    chat: m => !/whisper|tts|orpheus|guard|safeguard|playai|compound|embed|distil/i.test(m),
    rank: [/gpt-oss-120b/i, /gpt-oss-20b/i, /qwen/i, /kimi|moonshot/i, /llama/i],
    console: 'console.groq.com'
  },
  openrouter: {
    name: 'openrouter',
    label: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    modelEnv: ['OPENROUTER_MODEL'],
    defaults: ['openai/gpt-oss-120b', 'x-ai/grok-4.3', 'meta-llama/llama-3.3-70b-instruct'],
    tokenParam: 'max_tokens',
    fits: m => m.indexOf('/') > 0,
    chat: m => m.indexOf('/') > 0 && !/image|audio|embed|tts|whisper|guard|vision|search|online/i.test(m),
    rank: [/gpt-oss-120b/i, /grok-4\.3/i, /gemini-[\d.]+-flash(?!-lite)/i, /llama-3\.3-70b/i, /qwen/i],
    console: 'openrouter.ai/keys'
  },
  gemini: {
    name: 'gemini',
    label: 'Google Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    modelEnv: ['GEMINI_MODEL'],
    defaults: ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-3.5-flash-lite'],
    tokenParam: 'max_tokens',
    noSampling: true,           // Gemini 3.x يتجاهل/يرفض temperature
    fits: m => /^(models\/)?(gemini|gemma)/i.test(m),
    chat: m => /gemini/i.test(m) && !/embed|image|imagen|veo|tts|audio|live|aqa|learnlm|robotics|computer-use/i.test(m),
    rank: [/flash(?!-lite)/i, /flash-lite/i, /pro/i],
    console: 'aistudio.google.com'
  },
  openai: {
    name: 'openai',
    label: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    modelEnv: ['OPENAI_MODEL'],
    defaults: ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-5-mini'],
    tokenParam: 'max_completion_tokens',
    fits: m => /^(gpt|o\d|chatgpt)/i.test(m),
    chat: m => /^(gpt-4|gpt-5|o\d)/i.test(m) && !/audio|realtime|transcribe|tts|image|search|embed|instruct|codex/i.test(m),
    rank: [/^gpt-4\.1-mini$/i, /^gpt-4o-mini$/i, /^gpt-5(\.\d+)?-mini$/i, /mini/i],
    console: 'platform.openai.com'
  },
  custom: {
    name: 'custom',
    label: 'Custom (AI_BASE_URL)',
    url: '',
    modelEnv: ['AI_MODEL', 'GROQ_MODEL', 'OPENAI_MODEL', 'GROK_MODEL', 'XAI_MODEL'],
    defaults: [],
    tokenParam: 'max_tokens',
    fits: () => true,
    chat: m => !/embed|whisper|tts|image|audio|guard/i.test(m),
    rank: [],
    console: ''
  }
};

/* موديلات متقاعدة معروفة: لو كانت مضبوطة يدويًا (GROQ_MODEL=...) تُجرَّب في الآخر بدل الأول */
const RETIRED = new Set([
  /* Groq — console.groq.com/docs/deprecations (أُوقفت لحسابات Free/Developer) */
  'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama-3.1-70b-versatile',
  'meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct',
  'qwen/qwen3-32b', 'qwen/qwen3.6-27b', 'qwen-qwq-32b',
  'moonshotai/kimi-k2-instruct', 'moonshotai/kimi-k2-instruct-0905',
  'groq/compound', 'groq/compound-mini', 'gemma2-9b-it', 'llama3-70b-8192', 'llama3-8b-8192',
  'mixtral-8x7b-32768', 'deepseek-r1-distill-llama-70b', 'mistral-saba-24b',
  /* xAI — موديلات Grok القديمة أُزيلت من الـ API */
  'grok-beta', 'grok-vision-beta', 'grok-2', 'grok-2-latest', 'grok-2-1212', 'grok-2-mini',
  'grok-2-vision-1212', 'grok-2-vision-latest', 'grok-3-mini', 'grok-3-mini-latest',
  'grok-3-mini-fast', 'grok-3-fast', 'grok-3-fast-latest',
  /* Gemini */
  'gemini-pro', 'gemini-1.0-pro', 'gemini-1.5-flash', 'gemini-1.5-pro',
  'gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-2.0-flash-lite'
]);

/* ---------------- حالة على مستوى العملية (تُعاد مع كل بدء بارد) ---------------- */
const state = {
  deadModels: new Map(),   // provider|model => until
  deadKeys: new Map(),     // بصمة المفتاح => until
  discovered: new Map(),   // بصمة المزود+المفتاح => { at, result }
  last: null               // آخر نتيجة اتصال (للوحة المدير والتشخيص)
};

/* ---------------- أدوات عامة ---------------- */
function stripQuotes(val) {
  let s = String(val == null ? '' : val).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim();
  if (/^bearer\s+/i.test(s)) s = s.replace(/^bearer\s+/i, '').trim();
  return s;
}

function cleanKeyValue(raw) {
  let s = String(raw == null ? '' : raw).replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u00A0]/g, '').trim();
  s = s.replace(/^[A-Z][A-Z0-9_]*\s*=\s*/, '');      // لصق «GROK_API_KEY=xai-...» كقيمة كاملة
  return stripQuotes(s);
}

function uniqueList(arr) {
  const out = [];
  const seen = new Set();
  arr.forEach(x => { const k = String(x || '').toLowerCase(); if (x && !seen.has(k)) { seen.add(k); out.push(x); } });
  return out;
}

function clampInt(v, def, min, max) {
  const n = parseInt(v, 10);
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : def));
}

function fingerprint(s) { return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 20); }

function tagged(kind, message, extra) { return Object.assign(new Error(message), { kind }, extra || {}); }

function isRetired(model) { return RETIRED.has(String(model || '').toLowerCase().replace(/^models\//, '')); }

function isDisabled(env) {
  const e = env || {};
  return /^(0|false|off|no)$/i.test(stripQuotes(e.GROQ_AI || e.AI_ENABLED || ''));
}

/* ---------------- المفاتيح ---------------- */
function resolveKeyEntries(env) {
  const e = env || {};
  const out = [];
  const seen = new Set();
  const push = (raw, source) => {
    String(raw).split(/[,;\n\r]+/).forEach(part => {
      const k = cleanKeyValue(part);
      if (k.length >= 20 && k.length <= 400 && !/\s/.test(k) && !seen.has(k)) { seen.add(k); out.push({ key: k, source }); }
    });
  };
  KEY_ENV_NAMES.forEach(name => { if (e[name]) push(e[name], name); });
  /* أسماء غير متوقعة: أي متغير قيمته مفتاح xAI/Groq صريح، أو اسمه يدل على Grok/Groq/xAI ومفتاح */
  Object.keys(e).forEach(name => {
    if (KEY_ENV_NAMES.indexOf(name) >= 0) return;
    const val = e[name];
    if (typeof val !== 'string' || !val || val.length > 2000) return;
    const looksKey = /(^|[\s,;"'=])(xai-|gsk_)[A-Za-z0-9_-]{20,}/.test(val);
    const hinted = /(GROK|GROQ|XAI)/i.test(name) && /(KEY|TOKEN|SECRET)/i.test(name) && !/(MODEL|URL|TIMEOUT|_MS$|ENABLED)/i.test(name);
    if (looksKey || hinted) push(val, name);
  });
  return out;
}

function resolveKeys(env) { return resolveKeyEntries(env).map(x => x.key); }

function enabled(env) {
  if (isDisabled(env)) return false;
  return resolveKeyEntries(env).length > 0;
}

function keyType(key) {
  const k = String(key || '');
  if (/^xai-/i.test(k)) return 'xai-…';
  if (/^gsk_/.test(k)) return 'gsk_…';
  if (/^sk-or-/.test(k)) return 'sk-or-…';
  if (/^AIza/.test(k)) return 'AIza…';
  if (/^sk-/.test(k)) return 'sk-…';
  return 'غير معروف';
}

function isKeyDead(key) {
  const until = state.deadKeys.get(fingerprint(key));
  return !!until && until > Date.now();
}
function markKeyDead(key) { state.deadKeys.set(fingerprint(key), Date.now() + DEAD_KEY_MS); }
function isModelDead(provider, model) {
  const until = state.deadModels.get(provider + '|' + String(model).toLowerCase());
  return !!until && until > Date.now();
}
function markModelDead(provider, model) { state.deadModels.set(provider + '|' + String(model).toLowerCase(), Date.now() + DEAD_MODEL_MS); }

/* ---------------- المزود والموديلات ---------------- */
function providerNameForKey(key, source) {
  const k = String(key || '');
  const src = String(source || '').toUpperCase();
  if (/^xai-/i.test(k)) return 'xai-grok';
  if (/^gsk_/.test(k)) return 'groq';
  if (/^sk-or-/.test(k)) return 'openrouter';
  if (/^AIza/.test(k)) return 'gemini';
  if (/^sk-/.test(k) && /OPENAI/.test(src)) return 'openai';
  if (/XAI|GROK/.test(src)) return 'xai-grok';
  if (/OPENROUTER/.test(src)) return 'openrouter';
  if (/GEMINI/.test(src)) return 'gemini';
  if (/OPENAI/.test(src)) return 'openai';
  return 'groq';
}

function hostProvider(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch (e) { return 'custom'; }
  if (/(^|\.)x\.ai$/.test(host)) return 'xai-grok';
  if (/(^|\.)groq\.com$/.test(host)) return 'groq';
  if (/(^|\.)openrouter\.ai$/.test(host)) return 'openrouter';
  if (/(^|\.)googleapis\.com$/.test(host)) return 'gemini';
  if (/(^|\.)openai\.com$/.test(host)) return 'openai';
  return 'custom';
}

function normalizeEndpoint(u) {
  const trimmed = String(u || '').replace(/\/+$/, '');
  return /\/chat\/completions$/i.test(trimmed) ? trimmed : trimmed + '/chat/completions';
}

function firstEnv(e, names) {
  for (let i = 0; i < names.length; i++) if (e[names[i]]) return stripQuotes(e[names[i]]);
  return '';
}

/* الموديل المضبوط يدويًا يُقبل فقط لو يخص نفس المزود (GROQ_MODEL=llama... لا يُرسل إلى xAI أبدًا) */
function explicitModels(def, env) {
  const e = env || {};
  const out = [];
  uniqueList(def.modelEnv.concat(GENERIC_MODEL_ENV)).forEach(name => {
    if (!e[name]) return;
    String(e[name]).split(/[,;\n]+/).forEach(part => {
      const m = stripQuotes(part).slice(0, 100);
      if (m && /^[\w.:/@-]+$/.test(m) && def.fits(m)) out.push(m);
    });
  });
  return uniqueList(out);
}

function candidateModels(def, env) {
  const good = [];
  const retired = [];
  explicitModels(def, env).forEach(m => (isRetired(m) ? retired : good).push(m));
  return uniqueList(good.concat(def.defaults, retired));
}

function resolveProvider(key, env, source) {
  const e = env || {};
  if (source === undefined) {
    const hit = resolveKeyEntries(e).find(x => x.key === key);
    source = hit ? hit.source : '';
  }
  let name = providerNameForKey(key, source);
  let url = '';
  const base = firstEnv(e, URL_ENV_NAMES);
  if (base && /^https?:\/\//i.test(base)) {
    const hp = hostProvider(base);
    const knownPrefix = /^(xai-|gsk_|sk-or-|AIza)/.test(String(key || ''));
    if (hp === 'custom') {                       // بوابة/بروكسي أو خادم خاص
      if (!knownPrefix) name = 'custom';
      url = normalizeEndpoint(base);
    } else if (!knownPrefix || hp === name) {    // لا نرسل مفتاح xAI إلى رابط Groq بالخطأ
      name = hp;
      url = normalizeEndpoint(base);
    }
  }
  const def = PROVIDERS[name];
  url = url || def.url;
  return {
    name,
    label: def.label,
    url,
    modelsUrl: url.replace(/\/chat\/completions$/i, '/models'),
    models: candidateModels(def, e),
    source: source || '',
    def
  };
}

function providerInfo(env) {
  const entries = resolveKeyEntries(env);
  if (!enabled(env) || !entries.length) return { enabled: false, provider: null, model: null, keyCount: 0 };
  const p = resolveProvider(entries[0].key, env, entries[0].source);
  return {
    enabled: true,
    provider: p.name,
    providerLabel: p.label,
    model: p.models[0] || null,
    fallbackModels: p.models.slice(1),
    keyCount: entries.length,
    keySource: entries[0].source
  };
}

/* ---------------- بناء الطلب لكل موديل ---------------- */
function modelExtras(def, model, meta) {
  const id = String(model || '').toLowerCase();
  const out = {};
  if (def.name === 'xai-grok') {
    let effort = null;
    const efforts = meta && Array.isArray(meta.efforts) && meta.efforts.length ? meta.efforts : null;
    if (efforts) effort = efforts.indexOf('none') >= 0 ? 'none' : (efforts.indexOf('low') >= 0 ? 'low' : null);
    else if (/^grok-4\.3(-|$)/.test(id)) effort = 'none';                         // بلا تفكير = أسرع رد
    else if (/^grok-(4\.([5-9]|1\d)|[5-9])/.test(id) && !/non-reasoning/.test(id)) effort = 'low';
    if (effort) out.reasoning_effort = effort;
  } else if (def.name === 'groq') {
    if (/gpt-oss/.test(id)) out.reasoning_effort = 'low';
    else if (/qwen3/.test(id)) out.reasoning_effort = 'none';
  } else if (def.name === 'openai') {
    if (/^(gpt-5|o\d)/.test(id)) out.reasoning_effort = 'low';
  }
  return out;
}

/* حد رموز الرد — موديلات التفكير تحسب رموز التفكير ضمنه فتأخذ هامشًا أكبر */
function tokenLimit(def, model) {
  const id = String(model || '').toLowerCase();
  if (def.name === 'groq' && /gpt-oss|qwen3|minimax|muse/.test(id)) return 2000;
  if (def.name === 'xai-grok' && /^grok-(4\.([5-9]|1\d)|[5-9])/.test(id) && !/non-reasoning/.test(id)) return 2000;
  if (def.name === 'openai' && /^(gpt-5|o\d)/.test(id)) return 2400;
  return 1400;
}

/* opts: { json, extras, sampling } — كل واحد يمكن إسقاطه منفردًا لو رفضه المزود */
function buildPayload(def, model, messages, opts, meta) {
  const o = opts || {};
  const body = { model, messages };
  if (o.sampling !== false) {
    if (!def.noSampling && !(def.name === 'openai' && /^(gpt-5|o\d)/i.test(model))) body.temperature = 0.7;
    body[def.tokenParam || 'max_tokens'] = tokenLimit(def, model);
  }
  if (o.json) body.response_format = { type: 'json_object' };
  if (o.extras !== false) Object.assign(body, modelExtras(def, model, meta));
  return body;
}

/* بعد رفض 400: أسقط المعامل المذكور في رسالة الخطأ فقط (وإلا كل الاختياري) — false لو مفيش حاجة تتشال */
function relaxPayload(o, code, message) {
  const h = (String(code || '') + ' ' + String(message || '')).toLowerCase();
  if (o.json && /json|response_format|failed_generation/.test(h)) { o.json = false; return true; }
  if (o.extras !== false && /reasoning|effort/.test(h)) { o.extras = false; return true; }
  if (o.sampling !== false && /temperature|top_p|max_tokens|max_completion|sampling/.test(h)) { o.sampling = false; return true; }
  if (o.json || o.extras !== false || o.sampling !== false) { o.json = false; o.extras = false; o.sampling = false; return true; }
  return false;
}

/* ---------------- HTTP ---------------- */
async function readBody(res) {
  let text = '';
  let data = null;
  try {
    if (res && typeof res.text === 'function') {
      text = await res.text();
      try { data = JSON.parse(text); } catch (e) { data = null; }
    } else if (res && typeof res.json === 'function') {
      data = await res.json();
      try { text = JSON.stringify(data); } catch (e) { text = ''; }
    }
  } catch (e) { /* جسم غير مقروء */ }
  return { text: String(text || '').slice(0, 20000), data };
}

async function httpCall(fetchImpl, url, init, timeoutMs) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { if (ctrl) ctrl.abort(); } catch (e) { /* لا شيء */ }
      reject(tagged('timeout', 'timeout after ' + timeoutMs + 'ms'));
    }, Math.max(1, timeoutMs));
  });
  try {
    const res = await Promise.race([fetchImpl(url, Object.assign({}, init, ctrl ? { signal: ctrl.signal } : {})), timeout]);
    const body = await Promise.race([readBody(res), timeout]);
    return { status: res && res.status, ok: !!(res && res.ok), data: body.data, text: body.text };
  } catch (err) {
    if (err && err.kind) throw err;
    if (err && (err.name === 'AbortError' || /abort/i.test(String(err.message)))) throw tagged('timeout', 'aborted');
    throw tagged('network', (err && err.message) || 'network error');
  } finally {
    clearTimeout(timer);
  }
}

/* تصنيف رد الخطأ: auth | credits | model | request | rate | too-large | server | other
   (الحالة أولًا: رسائل 429/413 عند Groq فيها رابط billing ولا تعني نفاد الرصيد) */
const AUTH_RE = /incorrect api key|invalid api key|invalid_api_key|invalid x-api-key|api key (is )?(invalid|not valid|expired|revoked|disabled)|no api key|missing api key|unauthenticated|unauthorized|authentication/;
const CREDIT_RE = /credits?\b|insufficient_quota|exceeded your current quota|spending limit|no balance|top up|payment required|purchase/;
const PARAM_NAME_RE = /reasoning|effort|response_format|json|temperature|top_p|max_tokens|max_completion|logprobs|presence|frequency|\bstop\b|failed_generation/;
const MODEL_CODE_RE = /model_not_found|model_decommissioned|model_not_available|model_deprecated/;
const MODEL_GONE_RE = /not found|not_found|does not exist|decommission|deprecated|retired|no longer|unknown model|invalid model|not a valid model|not available|unavailable|access to (it|this model|the model|model)|not have access|no access|not supported/;

function classify(status, data, text) {
  let code = '';
  let msg = '';
  if (data && typeof data === 'object') {
    const err = data.error;
    if (err && typeof err === 'object') { code = String(err.code || err.type || err.status || ''); msg = String(err.message || ''); }
    else if (typeof err === 'string') { msg = err; code = String(data.code || ''); }
    else { msg = String(data.message || data.detail || ''); code = String(data.code || ''); }
  } else {
    msg = String(text || '');
  }
  const hay = (code + ' ' + msg).toLowerCase();
  const modelGone = /\bmodels?\b/.test(hay) && MODEL_GONE_RE.test(hay);
  const badReq = status === 400 || status === 422;
  let kind;
  if (status === 401 || AUTH_RE.test(hay)) kind = 'auth';
  else if (status === 402) kind = 'credits';
  else if (status === 429) kind = CREDIT_RE.test(hay) ? 'credits' : 'rate';
  else if (status === 413) kind = 'too-large';
  else if ((status === 403 || badReq) && CREDIT_RE.test(hay)) kind = 'credits';
  else if (MODEL_CODE_RE.test(hay)) kind = 'model';
  else if (badReq && PARAM_NAME_RE.test(hay)) kind = 'request';
  else if (status === 404 || modelGone) kind = 'model';
  else if (status === 403) kind = 'auth';
  else if (status >= 500 || status === 498) kind = 'server';
  else if (badReq) kind = 'request';
  else kind = 'other';
  return { kind, code: code.slice(0, 60), message: msg };
}

function extractContent(data) {
  const ch = data && Array.isArray(data.choices) ? data.choices[0] : null;
  let c = ch && ch.message ? ch.message.content : (ch && typeof ch.text === 'string' ? ch.text : '');
  if (Array.isArray(c)) c = c.map(part => (typeof part === 'string' ? part : (part && (part.text || part.content)) || '')).join('');
  return typeof c === 'string' ? c.trim() : '';
}

/* إخفاء أي أثر للمفتاح من رسائل الخطأ قبل عرضها أو تسجيلها */
function sanitizeDetail(msg, entries) {
  let s = String(msg == null ? '' : msg).replace(/\s+/g, ' ').trim();
  (entries || []).forEach(x => {
    const k = x && typeof x === 'object' ? x.key : x;
    if (k && String(k).length >= 8) s = s.split(String(k)).join('[key]');
  });
  s = s.replace(/(xai-|gsk_|sk-or-v1-|sk-or-|sk-proj-|sk-ant-|sk-|AIza)[A-Za-z0-9_-]{4,}/g, '$1***');
  s = s.replace(/[A-Za-z0-9]{1,8}\*{2,}[A-Za-z0-9]{0,8}/g, '***');
  return s.slice(0, 240);
}

/* ---------------- اكتشاف الموديلات المتاحة فعلًا للمفتاح ---------------- */
function normalizeModelEntry(m) {
  if (typeof m === 'string') return { id: m.replace(/^models\//, ''), efforts: null, created: 0 };
  if (!m || typeof m !== 'object') return null;
  const id = String(m.id || m.name || '').trim().replace(/^models\//, '');
  if (!id) return null;
  const caps = m.capabilities && typeof m.capabilities === 'object' ? m.capabilities : null;
  return {
    id,
    efforts: caps && Array.isArray(caps.reasoning_effort) ? caps.reasoning_effort.map(String) : null,
    active: m.active,
    created: Number(m.created) || 0,
    imageOnly: m.image_price != null && m.completion_text_token_price == null
  };
}

function rankOf(def, id) {
  for (let i = 0; i < def.rank.length; i++) if (def.rank[i].test(id)) return i;
  return def.rank.length;
}

async function discoverModels(p, key, fetchImpl, timeoutMs, fresh) {
  const fp = fingerprint(p.name + '|' + p.url + '|' + key);
  const cached = state.discovered.get(fp);
  if (!fresh && cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.result;
  let result;
  try {
    const r = await httpCall(fetchImpl, p.modelsUrl, { method: 'GET', headers: { Authorization: 'Bearer ' + key } }, Math.max(1500, timeoutMs || 5000));
    if (!r.ok) {
      const c = classify(r.status, r.data, r.text);
      result = { ok: false, status: r.status, kind: c.kind === 'model' ? 'other' : c.kind, detail: c.message, models: [], total: 0 };
    } else {
      const d = r.data;
      const list = Array.isArray(d && d.data) ? d.data : (Array.isArray(d && d.models) ? d.models : (Array.isArray(d) ? d : []));
      const all = list.map(normalizeModelEntry).filter(Boolean);
      const usable = all.filter(m => p.def.chat(m.id) && !isRetired(m.id) && m.active !== false && !m.imageOnly);
      usable.sort((a, b) => (rankOf(p.def, a.id) - rankOf(p.def, b.id)) || ((b.created || 0) - (a.created || 0)) || (a.id < b.id ? -1 : 1));
      result = { ok: true, status: r.status, kind: null, models: usable, total: all.length };
    }
  } catch (err) {
    result = { ok: false, status: null, kind: err.kind || 'network', detail: err.message, models: [], total: 0 };
  }
  if (result.ok) state.discovered.set(fp, { at: Date.now(), result });
  return result;
}

/* ---------------- محاولة موديل واحد (مع إسقاط المعاملات المرفوضة) ---------------- */
async function tryModel(ctx, p, key, model, meta) {
  const t0 = Date.now();
  const opts = { json: ctx.json, extras: true, sampling: true };
  let msgs = ctx.messages;
  let relaxed = 0;
  let shrunk = false;
  let last = null;
  for (;;) {
    const left = ctx.deadline - Date.now();
    if (left < MIN_TRY_MS) {
      return { ok: false, kind: last ? last.kind : 'timeout', status: last ? last.status : null, detail: 'time budget exhausted', model, ms: Date.now() - t0 };
    }
    let r;
    try {
      r = await httpCall(ctx.fetchImpl, p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify(buildPayload(p.def, model, msgs, opts, meta))
      }, Math.min(ctx.perTry, left - 250));
    } catch (err) {
      return { ok: false, kind: err.kind || 'network', status: null, detail: err.message, model, ms: Date.now() - t0 };
    }
    if (r.ok) {
      const content = extractContent(r.data);
      if (!content) return { ok: false, kind: 'empty', status: r.status, detail: 'empty completion', model, ms: Date.now() - t0 };
      if (ctx.validate) {
        try {
          return { ok: true, content, parsed: ctx.validate(content), model, status: r.status, ms: Date.now() - t0 };
        } catch (err) {
          return { ok: false, kind: 'bad-output', status: r.status, detail: err && err.message, model, ms: Date.now() - t0 };
        }
      }
      return { ok: true, content, model, status: r.status, ms: Date.now() - t0 };
    }
    const c = classify(r.status, r.data, r.text);
    last = { kind: c.kind, status: r.status };
    if (c.kind === 'request' && relaxed < 3 && relaxPayload(opts, c.code, c.message)) { relaxed += 1; continue; }
    if (c.kind === 'too-large' && !shrunk && msgs.length > 2) {                       // حد الحساب المجاني => بدون السجل
      shrunk = true;
      msgs = [msgs[0], msgs[msgs.length - 1]];
      continue;
    }
    return { ok: false, kind: c.kind, status: r.status, code: c.code, detail: c.message, model, ms: Date.now() - t0 };
  }
}

function record(entry) { state.last = Object.assign({ at: new Date().toISOString() }, entry); }
function lastOutcome() { return state.last ? Object.assign({}, state.last) : null; }

/* ---------------- الاستدعاء الكامل: مفاتيح × موديلات × اكتشاف ---------------- */
async function complete(env, opts) {
  const e = env || {};
  const o = opts || {};
  const started = Date.now();
  const fetchImpl = o.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const entries = o.keyEntries || resolveKeyEntries(e);
  if (!entries.length) throw tagged('no-key', 'missing-api-key');
  if (!fetchImpl) throw tagged('network', 'fetch-unavailable');
  if (!Array.isArray(o.messages) || !o.messages.length) throw tagged('request', 'no-messages');

  const ctx = {
    fetchImpl,
    messages: o.messages,
    json: o.json !== false,
    validate: o.validate,
    deadline: started + (o.budgetMs || clampInt(e.AI_BUDGET_MS, DEFAULT_BUDGET_MS, 4000, 25000)),
    perTry: clampInt(e.GROQ_TIMEOUT_MS || e.AI_TIMEOUT_MS, DEFAULT_TRY_MS, 2500, 20000)
  };
  const attempts = [];
  let lastFail = null;
  /* المفاتيح المرفوضة مؤخرًا تتأخر للنهاية (لا تُحذف: ربما اتشحن الرصيد) */
  const ordered = o.ignoreMemo ? entries : entries.slice().sort((a, b) => (isKeyDead(a.key) ? 1 : 0) - (isKeyDead(b.key) ? 1 : 0));

  for (const entry of ordered) {
    if (ctx.deadline - Date.now() < MIN_TRY_MS) break;
    const p = resolveProvider(entry.key, e, entry.source);
    const tried = new Set();
    let keyFail = null;
    let sawGone = false;

    const attempt = async (model, meta) => {
      tried.add(String(model).toLowerCase());
      const r = await tryModel(ctx, p, entry.key, model, meta);
      attempts.push({ provider: p.name, model, ok: !!r.ok, kind: r.kind || null, status: r.status || null, ms: r.ms || 0 });
      if (r.ok) return r;
      lastFail = Object.assign({ provider: p.name, source: entry.source }, r);
      if (r.kind === 'model') { markModelDead(p.name, model); sawGone = true; }
      if (r.kind === 'auth' || r.kind === 'credits') keyFail = r;
      return null;
    };
    const done = r => {
      const out = { content: r.content, parsed: r.parsed, provider: p.name, providerLabel: p.label, model: r.model, source: entry.source, ms: Date.now() - started, attempts };
      record({ ok: true, provider: p.name, model: r.model, source: entry.source, ms: out.ms });
      return out;
    };

    const live = p.models.filter(m => o.ignoreMemo || !isModelDead(p.name, m));
    const candidates = live.length ? live : p.models;              // الذاكرة لا تمنع المحاولة نهائيًا
    if (live.length < p.models.length) sawGone = true;
    for (const m of candidates) {
      if (keyFail || ctx.deadline - Date.now() < MIN_TRY_MS) break;
      const r = await attempt(m, null);
      if (r) return done(r);
    }

    /* كل الموديلات المعروفة متقاعدة/غير متاحة => نسأل المزود عن المتاح فعلًا */
    if (!keyFail && (sawGone || !candidates.length) && ctx.deadline - Date.now() >= MIN_TRY_MS + 1000) {
      const disc = await discoverModels(p, entry.key, fetchImpl, Math.min(6000, ctx.deadline - Date.now() - MIN_TRY_MS), !!o.ignoreMemo);
      if (disc.kind === 'auth' || disc.kind === 'credits') {
        keyFail = disc;
        lastFail = Object.assign({ provider: p.name, source: entry.source, model: null }, disc);
      } else {
        let n = 0;
        for (const m of disc.models) {
          if (n >= 3 || keyFail || ctx.deadline - Date.now() < MIN_TRY_MS) break;
          if (tried.has(m.id.toLowerCase()) || (!o.ignoreMemo && isModelDead(p.name, m.id))) continue;
          n += 1;
          const r = await attempt(m.id, m);
          if (r) return done(r);
        }
      }
    }
    if (keyFail) markKeyDead(entry.key);
  }

  const fail = lastFail || { kind: 'timeout', detail: 'time budget exhausted' };
  const detail = sanitizeDetail(fail.detail, entries);
  record({ ok: false, provider: fail.provider || null, model: fail.model || null, source: fail.source || null, kind: fail.kind, status: fail.status || null, detail });
  throw tagged(fail.kind || 'other',
    'ai-failed:' + (fail.kind || 'other') + ' [' + (fail.provider || '?') + '/' + (fail.model || '?') + (fail.status ? ' http ' + fail.status : '') + ']',
    { status: fail.status || null, provider: fail.provider || null, model: fail.model || null, source: fail.source || null, detail, attempts });
}

/* ---------------- التشخيص الآمن (/api/yaseen-ai-status) ---------------- */
const KIND_AR = {
  auth: 'المفتاح مرفوض (غلط أو اتلغى أو الحساب موقوف)',
  credits: 'الحساب مفيهوش رصيد أو وصل لحد الإنفاق',
  model: 'مفيش موديل متاح لهذا المفتاح',
  rate: 'ضغط مؤقت على المزود (Rate limit) — جرّب بعد دقيقة',
  'too-large': 'الطلب أكبر من حد الحساب المجاني',
  server: 'عطل مؤقت عند المزود',
  timeout: 'المزود اتأخر في الرد',
  network: 'تعذّر الوصول للمزود من الخادم',
  request: 'المزود رفض صيغة الطلب',
  empty: 'المزود رجّع رد فاضي',
  'bad-output': 'رد المزود مش مفهوم',
  other: 'خطأ غير معروف'
};

const PROBE_MESSAGES = [
  { role: 'system', content: 'You are a connectivity health check for the Raheeq academy assistant. Reply with a JSON object only, exactly: {"reply":"تمام"}' },
  { role: 'user', content: 'ping' }
];
function probeValidate(content) {
  const s = String(content || '').trim();
  if (s.length < 2) throw new Error('empty');
  return { reply: s.slice(0, 80) };
}

const HOW_TO = [
  '1) افتح console.x.ai ← API Keys واعمل مفتاح جديد (بيبدأ بـ xai-) — أو مفتاح Groq من console.groq.com (بيبدأ بـ gsk_).',
  '2) في Vercel: المشروع ← Settings ← Environment Variables ← أضف XAI_API_KEY (لمفتاح Grok) أو GROQ_API_KEY (لمفتاح Groq) والقيمة هي المفتاح بدون مسافات أو علامات تنصيص، وعلّم Production و Preview.',
  '3) Deployments ← آخر نشر ← Redeploy (المتغيرات الجديدة لا تُطبق إلا بعد إعادة النشر).',
  '4) افتح /api/yaseen-ai-status للتأكد إن الحالة working.'
];

function messageFor(k) {
  const where = 'Vercel ← Settings ← Environment Variables';
  const consoleUrl = (PROVIDERS[k.provider] && PROVIDERS[k.provider].console) || 'لوحة المزود';
  if (k.status === 'working') {
    return 'الذكاء الاصطناعي شغال ✅ — المزود: ' + k.providerLabel + '، الموديل: ' + (k.chat && k.chat.model) + ' (المفتاح من المتغير ' + k.source + ').';
  }
  if (k.status === 'invalid-key') {
    return 'المفتاح الموجود في المتغير ' + k.source + ' مرفوض من ' + k.providerLabel + ' ❌ — غالبًا المفتاح غلط أو اتلغى. اعمل مفتاح جديد من ' + consoleUrl + ' وحطه مكانه في ' + where + ' ثم Redeploy.';
  }
  if (k.status === 'no-credits') {
    return 'المفتاح صحيح لكن حساب ' + k.providerLabel + ' مفيهوش رصيد أو وصل لحد الإنفاق 💳 — اشحن رصيد من ' + consoleUrl + ' وبعدها هيشتغل تلقائيًا من غير أي تعديل في الموقع.';
  }
  if (k.status === 'reachable') {
    return 'المفتاح مقبول عند ' + k.providerLabel + ' (المتغير ' + k.source + ') — لم يُجرَ اختبار محادثة.';
  }
  const kind = (k.chat && k.chat.kind) || (k.modelList && k.modelList.kind) || 'other';
  return 'المفتاح موجود (' + k.source + ') لكن الاتصال بـ ' + k.providerLabel + ' فشل: ' + (KIND_AR[kind] || KIND_AR.other) + '.';
}

async function diagnose(env, opts) {
  const e = env || {};
  const o = opts || {};
  const fetchImpl = o.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const entries = resolveKeyEntries(e);
  const report = { checkedAt: new Date().toISOString(), keyCount: entries.length, keys: [] };

  if (!entries.length) {
    return Object.assign(report, {
      status: 'no-key',
      working: false,
      message: 'مفيش مفتاح ذكاء اصطناعي على الخادم ❌ — لازم تضيف مفتاح Grok (بيبدأ بـ xai-) في Vercel باسم XAI_API_KEY ثم تعمل Redeploy.',
      howTo: HOW_TO
    });
  }
  if (isDisabled(e)) {
    return Object.assign(report, {
      status: 'disabled',
      working: false,
      message: 'الذكاء الاصطناعي متوقف عمدًا بالمتغير GROQ_AI=0 (أو AI_ENABLED=0) — احذفه أو خليه 1 ثم Redeploy.'
    });
  }
  if (!fetchImpl) {
    return Object.assign(report, { status: 'failing', working: false, message: 'الخادم لا يدعم fetch (يلزم Node 18 أو أحدث).' });
  }

  for (const entry of entries.slice(0, 3)) {
    const p = resolveProvider(entry.key, e, entry.source);
    const k = { source: entry.source, keyType: keyType(entry.key), provider: p.name, providerLabel: p.label, models: p.models.slice(0, 4) };
    const disc = await discoverModels(p, entry.key, fetchImpl, 6000, true);
    k.modelList = disc.ok
      ? { ok: true, available: disc.total, usable: disc.models.slice(0, 6).map(m => m.id) }
      : { ok: false, kind: disc.kind, status: disc.status, detail: sanitizeDetail(disc.detail, entries) };
    if (!disc.ok && (disc.kind === 'auth' || disc.kind === 'credits')) {
      k.status = disc.kind === 'auth' ? 'invalid-key' : 'no-credits';
    } else if (o.live !== false) {
      try {
        const out = await complete(e, { fetchImpl, keyEntries: [entry], messages: PROBE_MESSAGES, json: true, validate: probeValidate, budgetMs: 14000, ignoreMemo: true });
        k.status = 'working';
        k.chat = { ok: true, model: out.model, ms: out.ms };
      } catch (err) {
        k.status = err.kind === 'auth' ? 'invalid-key' : (err.kind === 'credits' ? 'no-credits' : 'failing');
        k.chat = { ok: false, kind: err.kind || 'other', status: err.status || null, model: err.model || null, detail: sanitizeDetail(err.detail || err.message, entries) };
      }
    } else {
      k.status = disc.ok ? 'reachable' : 'failing';
    }
    k.message = messageFor(k);
    report.keys.push(k);
    if (k.status === 'working') break;
  }

  const best = report.keys.find(k => k.status === 'working') || report.keys[0];
  return Object.assign(report, {
    status: best.status,
    working: best.status === 'working',
    provider: best.provider,
    providerLabel: best.providerLabel,
    keySource: best.source,
    model: (best.chat && best.chat.model) || best.models[0] || null,
    message: best.message,
    howTo: best.status === 'working' ? undefined : HOW_TO
  });
}

/* للاختبارات فقط: تصفير الذاكرة المؤقتة للعملية */
function _resetForTests() {
  state.deadModels.clear();
  state.deadKeys.clear();
  state.discovered.clear();
  state.last = null;
}

module.exports = {
  KEY_ENV_NAMES,
  PROVIDERS,
  RETIRED,
  stripQuotes,
  resolveKeyEntries,
  resolveKeys,
  resolveProvider,
  providerInfo,
  candidateModels,
  enabled,
  isRetired,
  buildPayload,
  relaxPayload,
  classify,
  sanitizeDetail,
  discoverModels,
  complete,
  diagnose,
  lastOutcome,
  keyType,
  _resetForTests
};
