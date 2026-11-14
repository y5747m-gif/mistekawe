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

console.log('\nYaseen widget tests: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
