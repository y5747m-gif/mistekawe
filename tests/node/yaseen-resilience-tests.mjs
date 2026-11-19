/* ============================================================
 * yaseen-resilience-tests.mjs — صمود رحيق ضد التعليق والانقطاع + تخطيط الجوال
 *   node tests/node/yaseen-resilience-tests.mjs
 *
 * تغطي الانحدارات التي ظهرت في الاستخدام الحقيقي على الجوال:
 *   1) طلب المحادثة يرسل الكوكيز (same-origin) ولا يقطع اتصال VPN/WAF.
 *   2) إعادة محاولة تلقائية واحدة عند 503/429/شبكة، ثم نجاح بلا تدخل.
 *   3) زر «إعادة المحاولة» + واتساب عند الفشل، ولا رسالة نهاية مسدودة
 *      («الاتصال ضعيف دلوقتي…») مرة أخرى.
 *   4) تحرير حالة الانتظار (busy) دائمًا حتى لا تتجمد الواجهة.
 *   5) الخادم: هدوء 429 لكل موديل، تباعد الطلب الكبير، الآلة الحاسبة عند
 *      تعطل الذكاء الاصطناعي، وردود عربية مهذبة بدل 400/413 جافة.
 *   6) CSS: قصّ التمرير الأفقي، تمرير المحادثة داخل العرض المرئي، وإخفاء
 *      شريط الاتصال العائم أثناء المحادثة.
 *   7) حماية من الترجمة التلقائية لكوروم في كل صفحات الموقع.
 * ============================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadWidget, flushPromises } from './dom-lite.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const system = require(path.join(ROOT, 'api/_yaseen/yaseen-system.js'));
const ai = require(path.join(ROOT, 'api/_yaseen/ai.js'));
const providers = require(path.join(ROOT, 'api/_yaseen/providers.js'));
const { createHandler } = require(path.join(ROOT, 'api/_yaseen/handler.js'));

let passed = 0, failed = 0;
function ok(cond, name) { if (cond) passed += 1; else { failed += 1; console.error('  ✗ ' + name); } }
function eq(a, b, name) { ok(a === b, name + ' — got: ' + JSON.stringify(a)); }

const GSK = 'gsk_T3stKey0123456789abcdefABCDEF0123456789abcdef';
const CFG = system.defaultConfig();
const META = { 'raheeq-whatsapp': '201151947735' };
const PUB = Object.assign({}, system.publicConfig(CFG, new Date()), { ai: true });

function widget(env) { return env.body.querySelector('#yaseenAssistant'); }
async function settle(env) {
  await flushPromises(4);
  env.flushTimers(60);
  await flushPromises(6);
  env.flushTimers(60);
  await flushPromises(4);
}
function completion(content) {
  return {
    ok: true, status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] })
  };
}

/* ---------- 1) العميل: كوكيز الطلب + الإعادة التلقائية + زر إعادة المحاولة ---------- */
{
  const seenOptions = [];
  let chatAttempts = 0;
  const env = loadWidget({
    fetch: (url, opts) => {
      if (String(url).indexOf('yaseen-config') >= 0) return Promise.resolve({ status: 200, body: PUB });
      seenOptions.push(opts || {});
      chatAttempts += 1;
      if (chatAttempts === 1) return Promise.resolve({ status: 503, body: {} });     // عطل عابر أول مرة
      return Promise.resolve({
        status: 200,
        body: { ok: true, sid: '0123456789abcdef0123456789abcdef', reply: 'رد بعد التعافي التلقائي', expression: 'happy' }
      });
    },
    meta: META
  });
  await settle(env);
  const root = widget(env);
  root.querySelector('.ysn-char').dispatch('click');
  await settle(env);
  const input = root.querySelector('.ysn-form input');
  input.value = 'سؤال بعد عطل مؤقت';
  root.querySelector('.ysn-form').dispatch('submit');
  await settle(env);

  eq(seenOptions[0].credentials, 'same-origin', 'طلب المحادثة يرسل الكوكيز (same-origin) لا omit');
  ok(chatAttempts >= 2, 'عطل 503 عابر => محاولة تلقائية ثانية (' + chatAttempts + ' محاولات)');
  ok(/التعافي التلقائي/.test(root.querySelector('.ysn-log').textContent), 'ولي الأمر يرى الرد السليم بلا تدخل');
}

/* ---------- 2) العميل: عند فشل كل المحاولات => إرشاد + واتساب + زر إعادة المحاولة ---------- */
{
  let chatCalls = 0;
  const env = loadWidget({
    fetch: (url) => {
      if (String(url).indexOf('yaseen-config') >= 0) return Promise.resolve({ status: 200, body: PUB });
      chatCalls += 1;
      return Promise.reject(new Error('offline'));
    },
    meta: META
  });
  await settle(env);
  const root = widget(env);
  root.querySelector('.ysn-char').dispatch('click');
  await settle(env);
  root.querySelector('.ysn-form input').value = 'سؤالي';
  root.querySelector('.ysn-form').dispatch('submit');
  await settle(env);

  const log = root.querySelector('.ysn-log');
  ok(!/الاتصال ضعيف دلوقتي/.test(log.textContent), 'لم تعد تظهر رسالة النهاية المسدودة «الاتصال ضعيف دلوقتي»');
  ok(!!log.querySelector('a.ysn-wa'), 'الفشل يعرض رابط واتساب الأكاديمية');
  const retry = log.querySelector('.ysn-retry');
  ok(!!retry, 'الفشل يعرض زر «إعادة المحاولة»');
  eq(retry && retry.textContent, 'إعادة المحاولة ↻', 'نص زر إعادة المحاولة واضح');
  ok(chatCalls >= 2, 'الفشل الشبكي الكامل يُعاد تلقائيًا مرة قبل عرض المخرج');

  /* الضغط على الزر يحرّر الانتظار ويعيد الإرسال فعلًا */
  const before = chatCalls;
  if (retry) retry.dispatch('click');
  await settle(env);
  ok(chatCalls > before, 'زر إعادة المحاولة يرسل الطلب من جديد');
}

/* ---------- 3) العميل: الأزرار السريعة لا تترك المحادثة معلقة ---------- */
{
  let chatCalls = 0;
  const env = loadWidget({
    fetch: (url) => {
      if (String(url).indexOf('yaseen-config') >= 0) return Promise.resolve({ status: 200, body: PUB });
      chatCalls += 1;
      return Promise.resolve({ status: 200, body: {} });             // رد بلا reply (بوابة/صفحة خطأ)
    },
    meta: META
  });
  await settle(env);
  const root = widget(env);
  root.querySelector('.ysn-char').dispatch('click');
  await settle(env);
  const quick = root.querySelectorAll('.ysn-quick button');
  ok(quick.length >= 2, 'أزرار سريعة ظاهرة في المحادثة');
  quick[2].dispatch('click');                                       // «نسيت كلمة السر»
  await settle(env);
  const log = root.querySelector('.ysn-log');
  ok(/نسيت كلمة السر|كلمة السر/.test(log.textContent), 'الزر السريع يعرض إرشادًا محليًا فوريًا عند غياب الرد');
  ok(!!log.querySelector('a.ysn-wa') && !!log.querySelector('.ysn-retry'), 'الزر السريع الفاشل يعرض واتساب + إعادة المحاولة');
  /* الواجهة غير مجمّدة: زر إرسال جديد مقبول */
  root.querySelector('.ysn-form input').value = 'رسالة بعد الفشل';
  const before = chatCalls;
  root.querySelector('.ysn-form').dispatch('submit');
  await settle(env);
  ok(chatCalls > before, 'الواجهة تُحرَّر بعد الفشل (busy يعود false) ويُقبل سؤال جديد');
}

/* ---------- 3ب) العميل: إخفاء الصفحة أثناء الانتظار يحرّر الحالة (لا تعليق عند العودة) ---------- */
{
  let chatCalls = 0;
  const env = loadWidget({
    fetch: (url) => {
      if (String(url).indexOf('yaseen-config') >= 0) return Promise.resolve({ status: 200, body: PUB });
      chatCalls += 1;
      return new Promise(() => {});                                    // الخادم لا يرد أبدًا
    },
    meta: META
  });
  await settle(env);
  const root = widget(env);
  root.querySelector('.ysn-char').dispatch('click');
  await settle(env);
  root.querySelector('.ysn-form input').value = 'سؤال والخادم صامت';
  root.querySelector('.ysn-form').dispatch('submit');
  await flushPromises(3);
  ok(!!root.querySelector('.ysn-typing'), 'أثناء الانتظار يظهر مؤشر الكتابة');
  env.document.hidden = true;
  env.document.dispatch('visibilitychange');                          // المستخدم غادر التطبيق
  eq(root.querySelectorAll('.ysn-typing').length, 0, 'إخفاء الصفحة يزيل مؤشر الانتظار');
  const before = chatCalls;
  env.document.hidden = false;
  env.document.dispatch('visibilitychange');
  root.querySelector('.ysn-form input').value = 'سؤال بعد العودة';
  root.querySelector('.ysn-form').dispatch('submit');
  await flushPromises(2);
  ok(chatCalls > before, 'بعد العودة تُقبل رسالة جديدة (الواجهة غير مجمّدة)');
}

/* ---------- 4) الخادم: هدوء 429 لكل موديل يمنع إعادة إحراق الوقت ---------- */
{
  providers._resetForTests();
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (body.model === 'openai/gpt-oss-120b') {
      return { ok: false, status: 429, text: async () => JSON.stringify({ error: { message: 'Rate limit reached for TPM. Please try again in 2m59.56s.', code: 'rate_limit_exceeded' } }) };
    }
    return completion({ reply: 'رد من الموديل الاحتياطي', expression: 'happy', pointTo: null, handoff: false });
  };
  const first = await ai.askAI({ GROQ_API_KEY: GSK }, { question: 'سؤال أول', config: CFG, fetchImpl });
  ok(/الاحتياطي/.test(first.reply), '429 على الموديل الأول => رد من الاحتياطي فورًا');
  const afterFirst = calls.length;
  const second = await ai.askAI({ GROQ_API_KEY: GSK }, { question: 'سؤال تاني', config: CFG, fetchImpl });
  ok(/الاحتياطي/.test(second.reply), 'الطلب التالي ينجح أيضًا');
  ok(calls.length - afterFirst === 1, 'الموديل المشبع (429) يُتخطّى في الطلب التالي بلا محاولة ضائعة (' + (calls.length - afterFirst) + ' نداء)');
  eq(calls[calls.length - 1].model, 'openai/gpt-oss-20b', 'الموديل التالي في الترتيب هو الذي يرد');
  ok(providers.parseRetryDelayMs('Please try again in 2m59.56s.') > 60000, 'صيغة «2m59.56s» تُفهم كدقائق وثوانٍ');
  ok(providers.parseRetryDelayMs('Please try again in 800ms.') === 800, 'صيغة «800ms» تُفهم صحيحة');
  eq(providers.buildPayload(providers.PROVIDERS.groq, 'qwen/qwen3.8-27b', [{ role: 'user', content: 'x' }], { json: true }).reasoning_format, 'hidden', 'qwen3 يخفي التفكير حتى لا يفسد JSON');
  ok(providers.PROVIDERS.groq.defaults.indexOf('allam-2-7b') >= 0, 'allam-2-7b موجود كخيار احتياطي رابع على Groq');
}

/* ---------- 5) الخادم: ردود عربية مهذبة بدل 400/413، والآلة الحاسبة عند التعطل ---------- */
{
  providers._resetForTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ysn-res-'));
  const app = createHandler({ dir, env: { GROQ_API_KEY: GSK }, fetchImpl: async () => { throw new Error('down'); } });
  const post = (body, extra) => app.handle(Object.assign({ method: 'POST', path: '/api/yaseen-chat', headers: {}, body, ip: '10.5.0.1' }, extra));

  let res = await post(undefined, { bodyError: 'bad-json' });
  eq(res.status, 200, 'جسم مشوّه لا يرجع 400 جافًا');
  ok(typeof res.body.reply === 'string' && res.body.reply.length > 20, 'جسم مشوّه => رسالة عربية مفهومة');
  ok(res.body.handoff && res.body.handoff.whatsapp === '201151947735', 'رسالة الخطأ تحمل تحويل واتساب');

  res = await post(undefined, { bodyError: 'too-large' });
  eq(res.status, 200, 'الطلب الكبير لا يرجع 413 جافًا');
  ok(/طويلة/.test(res.body.reply), 'الطلب الكبير يشرح السبب بلطف');

  res = await post({ message: 'احسبلي 1250 + 340 * 2' });
  ok(/1930/.test(res.body.reply), 'تعطل الذكاء الاصطناعي => الآلة الحاسبة تحل المسألة بدقة');

  /* content-type بمسافات/حالة أحرف مختلفة يُقبل عبر مهايئ Node */
  const httpMod = await import('node:http');
  const srv = httpMod.createServer((req, sres) => app.nodeHandler(req, sres));
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const payload = JSON.stringify({ message: 'سؤال بصيغة محتوى غريبة' });
  const httpRes = await new Promise((resolve, reject) => {
    const req = httpMod.request({
      hostname: '127.0.0.1', port, path: '/api/yaseen?__r=chat', method: 'POST',
      headers: { 'Content-Type': '  APPLICATION/JSON; charset=utf-8  ', 'Content-Length': Buffer.byteLength(payload) }
    }, out => {
      let data = '';
      out.on('data', c => { data += c; });
      out.on('end', () => resolve({ status: out.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.end(payload);
  });
  srv.close();
  eq(httpRes.status, 200, 'content-type غير قياسي لا يرفض الطلب');
  ok(typeof httpRes.body.reply === 'string' && httpRes.body.reply.length > 0, 'الطلب غير القياسي يحصل على رد مفهوم');

  fs.rmSync(dir, { recursive: true, force: true });
}

/* ---------- 6) CSS: تمركز المحادثة وقصّ التمرير وإخفاء شريط الاتصال ---------- */
{
  const yaseenCss = read('css/yaseen.css');
  ok(/100dvw/.test(yaseenCss) && /safe-area-inset/.test(yaseenCss), 'نافذة المحادثة محسوبة من العرض المرئي ومناطق الأمان');
  ok(/--ysn-chat-max/.test(yaseenCss), 'ارتفاع المحادثة يتبع المساحة المرئية (لوحة المفاتيح)');
  ok(/font-size:16px/.test(yaseenCss), 'حقول المحادثة 16px على الجوال (بلا تكبير iOS)');
  ok(/\.ysn-retry\{/.test(yaseenCss), 'تنسيق زر إعادة المحاولة موجود');
  ok(/\.ysn-form button\{[^}]*flex:none/.test(yaseenCss), 'زر الإرسال لا يتقلص ولا يُقطع');

  const bar = read('css/contact-bar.css');
  ok(/body\.ysn-chat-open \.floating-contact-bar/.test(bar), 'شريط الاتصال يختفي أثناء المحادثة (كان يغطي زر الإرسال)');
  ok(/body\.menu-open \.floating-contact-bar/.test(bar) && /body\.modal-open \.floating-contact-bar/.test(bar), 'شريط الاتصال يختفي مع القائمة والنوافذ');
  ok(/html\[dir="ltr"\] \.floating-contact-bar \{[\s\S]{0,200}?right: calc\(14px/.test(bar),
    'LTR على الجوال لا يعيد الشريط إلى 24px فوق المحادثة');

  const raheeq = read('css/raheeq.css');
  ok(/overflow-x:clip/.test(raheeq), 'html/body يقصّان التمرير الأفقي (clip)');
  ok(/\.site-header\{[^}]*overflow:clip|\.site-header\{[\s\S]{0,400}?overflow:clip/.test(raheeq), 'الهيدر نفسه يقصّ أي تجاوز');
  ok(/\.header-row\{[^}]*min-width:0/.test(raheeq), 'صف الهيدر يسمح بالتقلّص بلا خروج عن الشاشة');
  ok(/@media \(max-width:430px\)/.test(raheeq) && /@media \(max-width:360px\)/.test(raheeq), 'نقاط توقف 430px و360px للهيدر على الجوالات الصغيرة');
  ok(/html\[data-scale="1\.35"\]/.test(raheeq), 'مقياس 135% لا يكسر الهيدر');

  /* الهيدر على الجوال الصغير: صفّان بلا تجاوز حتى لو ترجم كوروم النصوص وطالت */
  const headerBlock = (raheeq.match(/@media \(max-width:430px\)\{[\s\S]*?\n\}/) || [''])[0];
  ok(/flex-wrap:wrap/.test(headerBlock), 'هيدر ≤430px يلفّ في صفّين بدل الخروج عن الشاشة');
  ok(/\.header-actions\{display:contents\}/.test(headerBlock), 'أزرار الهيدر تصبح عناصر مباشرة في الصف');
  ok(/order:6;flex:1 0 100%/.test(headerBlock), 'زر الدخول يأخذ صفًّا كاملًا على الجوال الصغير');

  /* لوحة المفاتيح على iOS: دالة ترفع النافذة بمقدار ما يغطيه المفتاح */
  const widget = read('js/yaseen.js');
  ok(/--ysn-chat-bottom/.test(widget) && /--ysn-chat-bottom/.test(yaseenCss),
    'إزاحة لوحة المفاتيح تُمرَّر من js/yaseen.js إلى css/yaseen.css');
  ok(/requestWithRetry/.test(widget) && /REQ_TIMEOUT_MS/.test(widget), 'العميل يقيّد مدة الطلب ويعيد المحاولة مرة واحدة');
  ok(/visibilitychange/.test(widget), 'إخفاء الصفحة أثناء الانتظار لا يترك المحادثة مجمّدة');

  const shared = read('style.css');
  ok(/overflow-x: clip/.test(shared), 'صفحات الدخول/المتجر تقصّ التمرير الأفقي');
  ok(/\.band-form input\{[\s\S]{0,300}?min-width: 0/.test(shared), 'حقل البريد لا يخرج عن شاشة 320px');
  ok(/\.pd-actions\{[^}]*flex-wrap: wrap/.test(shared), 'أزرار صفحة المنتج تلفّ على الجوال');
  ok(/\.cart-item\{ grid-template-columns: 90px minmax\(0,1fr\)/.test(shared), 'عناصر السلة لا تفرض عرضًا أكبر من الشاشة');
}

/* ---------- 7) حماية من الترجمة التلقائية + بصمات الكاش ---------- */
{
  const pages = fs.readdirSync(ROOT)
    .filter(f => f.endsWith('.html') && read(f).indexOf('<html') >= 0)      // ملف إثبات ملكية جوجل ليس صفحة
    .concat(['admin-yaseen/index.html']);
  pages.forEach(p => {
    const src = read(p);
    ok(src.indexOf('<meta name="google" content="notranslate">') >= 0, p + ': يحمل حماية من الترجمة التلقائية');
    ok(/<html[^>]*translate="no"/.test(src), p + ': عنصر html يحمل translate="no"');
  });
  const index = read('index.html');
  ok(!/v20261115-/.test(index), 'index.html: لا بصمات كاش قديمة');
  ok(/css\/yaseen\.css\?v=voice-1/.test(index) && /js\/yaseen\.js\?v=voice-1/.test(index), 'index.html: بصمة جديدة لكل ملفات رحيق');
  ['login.html', 'register.html', 'shop.html', 'cart.html', 'product.html', 'heritage.html', 'majlis.html', 'hall.html', 'studio.html'].forEach(p => {
    ok(read(p).indexOf('?v=v20261116-2') >= 0, p + ': بصمة كاش محدّثة');
  });
  ok(/majlis-shell-v17/.test(read('sw.js')), 'sw.js: نسخة كاش جديدة بعد التعديلات');
  ok(read('index.html').includes('family=Cairo'), 'خط Cairo لم يُحذف من index.html');
}

console.log('\n  صمود رحيق والتخطيط: ' + passed + ' ناجح، ' + failed + ' فاشل');
process.exit(failed ? 1 : 0);
