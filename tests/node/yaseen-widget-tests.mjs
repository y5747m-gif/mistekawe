/* ============================================================
 * yaseen-widget-tests.mjs — اختبارات ظهور رحيق في المتصفح (بلا متصفح)
 *   node tests/node/yaseen-widget-tests.mjs
 * تغطي: ظهور الشخصية فورًا بلا خادم (لا تختفي أبدًا)، احترام مفتاح
 *        الإيقاف، استبدال إعداد الخادم للشكل الأساسي، تطابق BASE مع
 *        افتراضيات الخادم، ورسالة واتساب عند تعذّر الوصول للخادم.
 * ============================================================ */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadWidget, readBase, flushPromises } from './dom-lite.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const system = require(path.join(ROOT, 'api/_yaseen/yaseen-system.js'));

let passed = 0, failed = 0;
function ok(cond, name) { if (cond) passed += 1; else { failed += 1; console.error('  ✗ ' + name); } }
function eq(a, b, name) { ok(a === b, name + ' — got: ' + JSON.stringify(a)); }

const META = { 'raheeq-whatsapp': '201151947735' };

function widget(env) { return env.body.querySelector('#yaseenAssistant'); }
function quickLabels(env) {
  const box = widget(env);
  if (!box) return [];
  return box.querySelectorAll('.ysn-quick button').map(b => b.textContent);
}
async function settle(env) {
  await flushPromises(4);
  env.flushTimers(40);
  await flushPromises(4);
}

/* ---------- 1) الخادم غير متاح تمامًا: رحيق تظهر بشكلها الأساسي ---------- */
{
  const env = loadWidget({ fetch: () => Promise.reject(new Error('offline')), meta: META });
  await settle(env);

  const root = widget(env);
  ok(!!root, 'بلا خادم: عنصر رحيق موجود في الصفحة');
  eq(root.querySelectorAll('#yaseenAssistant .ysn-f').length, 8, 'بلا خادم: ثمانية إطارات للشخصية');
  eq(root.querySelector('.ysn-name').textContent, 'رحيق', 'بلا خادم: الاسم الأساسي');
  eq(quickLabels(env).length, 4, 'بلا خادم: أربعة أزرار سريعة');
  ok(env.calls.includes('/api/yaseen-config'), 'بلا خادم: حاول تحميل الإعدادات من الخادم');
}

/* ---------- 2) عطل مؤقت في الخادم (503) — لا تُخفى الشخصية ---------- */
{
  const env = loadWidget({ fetch: () => Promise.resolve({ status: 503, body: { ok: false, error: 'yaseen-unavailable' } }), meta: META });
  await settle(env);
  ok(!!widget(env), 'عطل 503: رحيق تبقى ظاهرة');
}

/* ---------- 2ب) خادم لا يرد: الشخصية لا تبقى مستورة ---------- */
{
  const env = loadWidget({ fetch: () => new Promise(() => {}), meta: META });   // بلا رد إطلاقًا
  const root = widget(env);
  ok(!!root, 'خادم صامت: الشخصية مبنية منذ أول تحميل');
  ok(root.classList.contains('is-pending'), 'خادم صامت: مستورة قبل تأكيد الإعداد (لا وميض)');
  env.flushTimers(10);
  ok(!root.classList.contains('is-pending'), 'خادم صامت: ظاهرة بعد المهلة القصيرة');
}

/* ---------- 3) مفتاح إيقاف المدير يُحترم: لا تظهر رحيق ---------- */
{
  const env = loadWidget({ fetch: () => Promise.resolve({ status: 200, body: { ok: false, disabled: true } }), meta: META });
  await settle(env);
  ok(!widget(env), 'إيقاف المدير: رحيق لا تظهر إطلاقًا');
}

/* ---------- 3ب) الإيقاف يسبق الإظهار: لا وميض للشخصية ---------- */
{
  const env = loadWidget({ fetch: () => Promise.resolve({ status: 200, body: { ok: true, enabled: false } }), meta: META });
  await flushPromises(4);                       // رد الخادم قبل مهلة الإظهار
  ok(!widget(env), 'إيقاف سريع: لا أثر للشخصية قبل المهلة');
}

/* ---------- 4) إعداد الخادم يستبدل الشكل الأساسي ---------- */
{
  const server = system.publicConfig(system.defaultConfig(), new Date());
  const custom = Object.assign({}, server, {
    name: 'رحيق الأكاديمية',
    greeting: 'ترحيب من إعداد المدير',
    quickReplies: [{ id: 'human', label: 'أكلم موظف' }]
  });
  const env = loadWidget({ fetch: () => Promise.resolve({ status: 200, body: custom }), meta: META });
  await settle(env);

  const root = widget(env);
  eq(root.querySelector('.ysn-name').textContent, 'رحيق الأكاديمية', 'إعداد الخادم: الاسم يُطبَّق');
  eq(quickLabels(env).join('|'), 'أكلم موظف', 'إعداد الخادم: الأزرار السريعة تُطبَّق');
  eq(root.querySelector('.ysn-log').textContent, '', 'إعداد الخادم: لا رسائل قبل فتح المحادثة');
}

/* ---------- 5) BASE مطابق لافتراضيات الخادم (لا انحراف بين النسختين) ---------- */
{
  const base = readBase();
  const pub = system.publicConfig(system.defaultConfig(), new Date());

  eq(base.name, pub.name, 'BASE: الاسم يطابق الخادم');
  eq(base.greeting, pub.greeting, 'BASE: الترحيب يطابق الخادم');
  eq(base.chatIntro, pub.chatIntro, 'BASE: مقدمة المحادثة تطابق الخادم');
  eq(base.quickReplies.map(q => q.id + ':' + q.label).join('|'),
    pub.quickReplies.map(q => q.id + ':' + q.label).join('|'), 'BASE: الأزرار السريعة تطابق الخادم');
  eq(Object.keys(base.steps).join(','), Object.keys(pub.steps).join(','), 'BASE: خطوات التسجيل');
  ok(Object.keys(base.steps).every(k => base.steps[k] === pub.steps[k]), 'BASE: نصوص الخطوات مطابقة');
  eq(Object.keys(base.guide).join(','), Object.keys(pub.guide).join(','), 'BASE: قائمة الخانات المرشدة');
  ok(Object.keys(base.guide).every(k => base.guide[k] === pub.guide[k]), 'BASE: نصوص الإرشاد مطابقة');
  eq(JSON.stringify(base.lines), JSON.stringify(pub.lines), 'BASE: النصوص الثابتة مطابقة');
  eq(JSON.stringify(base.limits), JSON.stringify(pub.limits), 'BASE: الحدود مطابقة');
  eq(JSON.stringify(base.animations), JSON.stringify(pub.animations), 'BASE: الحركات مطابقة');
  eq(JSON.stringify(base.sounds), JSON.stringify(pub.sounds), 'BASE: الصوت مطابق');
  ok(!/keywords|answers|blockedWords|handoff/i.test(JSON.stringify(base)), 'BASE: لا قواعد ولا كلمات مفتاحية في المتصفح');
}

/* ---------- 6) بلا خادم: المحادثة ترشد إلى واتساب الأكاديمية ---------- */
{
  const env = loadWidget({
    fetch: url => (String(url).indexOf('yaseen-config') >= 0
      ? Promise.reject(new Error('offline'))
      : Promise.reject(new Error('offline'))),
    meta: META
  });
  await settle(env);
  const root = widget(env);
  root.querySelector('.ysn-char').dispatch('click');       // فتح المحادثة
  await settle(env);
  const quick = root.querySelector('.ysn-quick button');
  ok(!!quick, 'بلا خادم: زر سريع متاح داخل المحادثة');
  quick.dispatch('click');
  await settle(env);

  const log = root.querySelector('.ysn-log');
  ok(/مش قادر أوصل/.test(log.textContent), 'بلا خادم: رسالة توضّح تعذّر الاتصال');
  const wa = log.querySelectorAll('a.ysn-wa')[0];
  ok(!!wa, 'بلا خادم: رابط واتساب الأكاديمية ظاهر');
  eq(wa && wa.href, 'https://wa.me/201151947735', 'بلا خادم: الرقم الرسمي من meta');
}

/* ---------- 7) أزرار المتابعة التفاعلية (followUps) وحفظ ctxToken ---------- */
{
  const server = Object.assign({}, system.publicConfig(system.defaultConfig(), new Date()), { ai: true });
  let sentPayloads = [];
  const env = loadWidget({
    fetch: (url, opts) => {
      if (String(url).indexOf('yaseen-config') >= 0) return Promise.resolve({ status: 200, body: server });
      sentPayloads.push(opts && opts.body ? JSON.parse(opts.body) : {});
      return Promise.resolve({
        status: 200,
        body: {
          ok: true,
          sid: '0123456789abcdef0123456789abcdef',
          ctxToken: 'tok.sig',
          remaining: 39,
          reply: 'أهلًا يا بطل! تحب نذاكر أي مادة النهاردة؟',
          expression: 'happy',
          followUps: ['رياضيات', 'لغة إنجليزية']
        }
      });
    },
    meta: META
  });
  await settle(env);
  const root = widget(env);
  root.querySelector('.ysn-char').dispatch('click');
  await settle(env);

  const input = root.querySelector('.ysn-form input');
  input.value = 'محتاج مساعدة في المذاكرة';
  root.querySelector('.ysn-form').dispatch('submit');
  await settle(env);

  const chips = root.querySelectorAll('.ysn-chip');
  eq(chips.length, 2, 'ظهور اقتراحات المتابعة الذكية كأزرار قابلة للضغط');
  eq(chips[0].textContent, 'رياضيات', 'نص اقتراح المتابعة الأول');
  chips[0].dispatch('click');
  await settle(env);
  eq(sentPayloads.length, 2, 'الضغط على اقتراح المتابعة يرسل السؤال مباشرة');
  eq(sentPayloads[1].message, 'رياضيات', 'السؤال المرسل يطابق الاقتراح');
  eq(sentPayloads[1].ctxToken, 'tok.sig', 'الواجهة تعيد إرسال ctxToken لحفظ ذاكرة المحادثة');
}

/* ---------- 8) التعافي التلقائي في المتصفح إذا رُفض ctxToken بـ 413 ---------- */
{
  const server = Object.assign({}, system.publicConfig(system.defaultConfig(), new Date()), { ai: true });
  const chatBodies = [];
  const env = loadWidget({
    fetch: (url, opts) => {
      if (String(url).indexOf('yaseen-config') >= 0) return Promise.resolve({ status: 200, body: server });
      const b = opts && opts.body ? JSON.parse(opts.body) : {};
      chatBodies.push(b);
      if (b.ctxToken === 'stale.ctx') {
        return Promise.resolve({ status: 413, body: { ok: false, error: 'too-large' } });
      }
      return Promise.resolve({
        status: 200,
        body: {
          ok: true,
          sid: 'fedcba9876543210fedcba9876543210',
          ctxToken: chatBodies.length === 1 ? 'stale.ctx' : 'fresh.ctx',
          remaining: 38,
          reply: chatBodies.length === 1 ? 'رد الجولة الأولى' : 'تمت إعادة المحاولة تلقائيًا بلا ctxToken التالف!',
          expression: 'happy'
        }
      });
    },
    meta: META
  });
  await settle(env);
  const root = widget(env);
  root.querySelector('.ysn-char').dispatch('click');
  await settle(env);

  const input = root.querySelector('.ysn-form input');
  input.value = 'أول رسالة';
  root.querySelector('.ysn-form').dispatch('submit');
  await settle(env);

  input.value = 'تاني رسالة بعد امتلاء الرمز';
  root.querySelector('.ysn-form').dispatch('submit');
  await settle(env);

  eq(chatBodies.length, 3, 'الواجهة أعادت إرسال الطلب تلقائيًا فور تلقي 413');
  eq(chatBodies[1].ctxToken, 'stale.ctx', 'المحاولة المرفوضة كانت تحمل الرمز القديم');
  eq(chatBodies[2].ctxToken, undefined, 'إعادة المحاولة حذفت ctxToken التالف ووصلت للرد السليم');
  const botMsgs = root.querySelectorAll('.ysn-msg.is-bot').map(m => m.textContent);
  ok(botMsgs.some(t => /تمت إعادة المحاولة تلقائيًا/.test(t)), 'المستخدم يرى الرد الذكي الفعلي بدل رسالة ضعف الاتصال');
}

/* الإملاء يطلب المايك عند الضغط فقط؛ عيّنة الصوت لا تُرسل لخادم الدردشة. */
{
  const requests = [], utterances = [];
  let lastRecognition;
  class MockRecognition {
    constructor() { lastRecognition = this; }
    start() { this.started = true; }
    abort() { this.aborted = true; }
  }
  class MockUtterance { constructor(text) { this.text = text; } }
  const pub = { ...system.publicConfig(system.defaultConfig(), new Date()), online: true, ai: true };
  const env = loadWidget({
    browser: {
      SpeechRecognition: MockRecognition,
      SpeechSynthesisUtterance: MockUtterance,
      speechSynthesis: { cancel() {}, getVoices: () => [{ lang: 'ar-EG' }], speak: u => utterances.push(u) }
    },
    fetch: (url, opts) => {
      if (url.endsWith('-config')) return { status: 200, body: pub };
      requests.push(JSON.parse(opts.body));
      return { status: 200, body: { reply: 'أهلا بيك في رحيق', ai: true } };
    }
  });
  await settle(env);
  const root = widget(env);
  root.querySelector('.ysn-char').dispatch('click');
  eq(lastRecognition, undefined, 'فتح المحادثة لا يبدأ التسجيل');
  const mic = root.querySelector('.ysn-mic');
  mic.dispatch('click');
  eq(lastRecognition.lang, 'ar-EG', 'إملاء باللهجة المصرية');
  ok(lastRecognition.started, 'الضغط على المايك يبدأ التعرّف على الكلام');
  lastRecognition.onresult({ results: [[{ transcript: 'إزاي أسجل؟' }]] });
  eq(root.querySelector('.ysn-form input').value, 'إزاي أسجل؟', 'نتيجة الإملاء تُعرض للمراجعة');
  eq(requests.length, 0, 'لا إرسال قبل موافقة المستخدم');
  root.querySelector('.ysn-form').dispatch('submit');
  await settle(env);
  eq(requests[0]?.message, 'إزاي أسجل؟', 'نفس مسار الدردشة يستقبل النص فقط');
  eq(utterances[0]?.text, 'أهلا بيك في رحيق', 'رد السؤال المملى يُقرأ آليًا');
  ok(!!root.querySelector('.ysn-ai-label'), 'الواجهة تعرض وسم إجابة الموديل');
  root.querySelector('.ysn-retry').dispatch('click');
  eq(utterances.length, 2, 'زر الاستماع يشغّل الرد مرة تانية');
  mic.dispatch('click');
  lastRecognition.onerror({ error: 'not-allowed' });
  ok(root.querySelector('.ysn-voice-note').textContent.includes('مرفوض'), 'رفض المايك يظهر بوضوح');
  ok(!root.querySelector('.ysn-form input').disabled, 'الكتابة تعمل بعد رفض الإذن');
  mic.dispatch('click');
  env.document.hidden = true;
  env.document.dispatch('visibilitychange');
  ok(lastRecognition.aborted, 'إخفاء الصفحة يوقف الإملاء');
  lastRecognition.onresult({ results: [[{ transcript: 'نتيجة متأخرة' }]] });
  eq(root.querySelector('.ysn-form input').value, '', 'نتيجة جلسة الإملاء الملغاة تُتجاهل');
}

/* بديل APK يستخدم جسر أندرويد بدل الاعتماد على Web Speech داخل WebView. */
{
  const sent = [];
  const bridge = { postMessage: text => sent.push(JSON.parse(text)) };
  const pub = { ...system.publicConfig(system.defaultConfig(), new Date()), online: true };
  const env = loadWidget({ browser: { MajlisVoice: bridge }, fetch: () => ({ status: 200, body: pub }) });
  await settle(env);
  const root = widget(env);
  root.querySelector('.ysn-char').dispatch('click');
  root.querySelector('.ysn-mic').dispatch('click');
  const last = sent.find(x => x.action === 'listen');
  ok(!!last, 'زر المايك يوجّه الطلب لأندرويد');
  bridge.onmessage({ data: JSON.stringify({ action: 'result', id: last.id, text: 'صوت من أندرويد' }) });
  eq(root.querySelector('.ysn-form input').value, 'صوت من أندرويد', 'الإملاء من أندرويد يدخل نفس حقل المراجعة');
}

/* إملاء حقيقي على مستوى الواجهات: من منفذ المايك إلى محول Groq ثم النطق.
   حدود الجهاز ومزود الشبكة فقط تُحاكى؛ معالج المحادثة ومحول Groq الفعليان يعملان. */
for (const native of [false, true]) {
  const { createHandler } = require(path.join(ROOT, 'api/_yaseen/handler.js'));
  const key = 'gsk_fake_0123456789abcdef0123456789abcdef01234567';
  const question = 'إيه الأوراق المطلوبة للتسجيل؟';
  const reply = 'أهلًا، للتسجيل نحتاج شهادة ميلاد وصورة شخصية.';
  const providerCalls = [], posted = [], spoken = [], bridgeMessages = [];
  let recognition;
  class SpeechRecognition {
    start() { recognition = this; }
    abort() {}
  }
  class Utterance { constructor(text) { this.text = text; } }
  const bridge = { postMessage: raw => {
    const msg = JSON.parse(raw);
    bridgeMessages.push(msg);
    if (msg.action === 'speak') spoken.push(msg.text);
  } };
  const browser = native ? { MajlisVoice: bridge } : {
    SpeechRecognition,
    SpeechSynthesisUtterance: Utterance,
    speechSynthesis: { cancel() {}, getVoices: () => [{ lang: 'ar-EG' }], speak: u => spoken.push(u.text) }
  };
  const api = createHandler({
    env: { VERCEL: '1', GROQ_API_KEY: key },
    now: () => Date.parse('2026-11-19T10:00:00Z'),
    fetchImpl: async (url, opts) => {
      providerCalls.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({
        reply, expression: 'happy', pointTo: null, handoff: false, remember: null, followUps: []
      }) } }] }) };
    }
  });
  const ui = loadWidget({ browser, fetch: (url, opts) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    return api.handle({ path: url, method: opts.method, body, headers: {}, ip: '127.0.0.1' }).then(res => {
      posted.push({ body, res });
      return res;
    });
  } });
  const label = native ? 'APK' : 'ويب';
  await settle(ui);
  const root = widget(ui);
  root.querySelector('.ysn-char').dispatch('click');
  root.querySelector('.ysn-mic').dispatch('click');
  if (native) {
    const request = bridgeMessages.find(x => x.action === 'listen');
    bridge.onmessage({ data: JSON.stringify({ action: 'result', id: request.id, text: question }) });
  } else recognition.onresult({ results: [[{ transcript: question }]] });
  eq(providerCalls.length, 0, label + ': الكلام لا يصل إلى Groq قبل مراجعة النص');
  root.querySelector('.ysn-form').dispatch('submit');
  await settle(ui);
  const provider = providerCalls[0];
  eq(provider?.url, 'https://api.groq.com/openai/v1/chat/completions', label + ': المتغير يوجّه إلى Groq');
  ok((provider?.opts.headers.Authorization || provider?.opts.headers.authorization) === 'Bearer ' + key, label + ': المفتاح يرسل من السيرفر إلى Groq فقط');
  eq(JSON.parse(provider.opts.body).messages.at(-1).content, question, label + ': Groq يستقبل نفس السؤال المملى');
  eq(posted.at(-1).body.message, question, label + ': الدردشة تستقبل نص السؤال فقط');
  ok(!JSON.stringify(posted).includes(key), label + ': المفتاح غائب تمامًا عن طلبات ونتائج واجهة المستخدم');
  ok(root.querySelector('.ysn-ai-label').textContent.includes('Groq'), label + ': الواجهة تقول إن الرد جاء فعلًا من Groq');
  eq(spoken[0], reply, label + ': نفس رد Groq يُنطق بالعربي');
}

console.log('\nYaseen widget tests: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
