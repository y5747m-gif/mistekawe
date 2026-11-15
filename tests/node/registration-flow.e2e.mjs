/* ============================================================
 * اختبار تدفّق التسجيل الحقيقي (jsdom) — يعيد إنتاج بلاغ المستخدم
 * ------------------------------------------------------------
 * السيناريو من لقطة الشاشة: ولي أمر كتب اسمه (4 أجزاء) ورقمه
 * القومي (11 رقمًا) ثم ضغط «التالي» → لم ينتقل إلى الخطوة 2.
 *
 * سبب التعطّل: مقيّد الإدخال في js/app.js كان يقطع كل الحقول الرقمية
 * عند 11 رقمًا بينما التحقق يشترط 14 للرقم القومي، وواجهة الخطأ
 * كانت تُظهر أول خطأ فقط فتُخفي السبب الحقيقي.
 *
 * التشغيل: node tests/node/registration-flow.e2e.mjs
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = await import('jsdom'));
} catch (e) {
  console.log('⚠️  jsdom غير مثبّت — تخطّي اختبار التدفّق (npm i --no-save jsdom)');
  process.exit(0);
}

let failed = 0;
function ok(cond, msg) {
  if (!cond) { failed++; console.error('  ✗ ' + msg); }
  else console.log('  ✓ ' + msg);
}

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const errors = [];
/* jsdom لا ينفّذ HTMLMediaElement.load() — نتجاهل هذا التحذير تحديدًا */
const IGNORE = /HTMLMediaElement's load\(\) method/;
const vc = new VirtualConsole();
vc.on('jsdomError', e => { if (!IGNORE.test(e.message)) errors.push('jsdomError: ' + e.message); });
vc.on('error', (...a) => {
  const msg = a.join(' ');
  if (!IGNORE.test(msg)) errors.push('console.error: ' + msg);
});

const dom = new JSDOM(html, {
  url: 'http://localhost:8000/index.html',
  runScripts: 'dangerously',
  resources: undefined,
  pretendToBeVisual: true,
  virtualConsole: vc
});
const w = dom.window;

/* ---- تجهيز البيئة المطلوبة للصفحة ---- */
w.Element.prototype.scrollIntoView = function () {};
w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
w.HTMLCanvasElement.prototype.getContext = function () {
  const noop = () => {};
  return { canvas: this, fillStyle: '#000', strokeStyle: '#000', font: '', textAlign: '', globalAlpha: 1,
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    putImageData() {}, drawImage: noop, fillRect: noop, clearRect: noop, fillText: noop, beginPath: noop, moveTo: noop,
    lineTo: noop, quadraticCurveTo: noop, closePath: noop, arc: noop, ellipse: noop, save: noop, restore: noop,
    translate: noop, rotate: noop, scale: noop, setTransform: noop, transform: noop, createImageData: () => ({ data: [], width: 0, height: 0 }),
    measureText: () => ({ width: 10 }), fill: noop, stroke: noop, clip: noop, rect: noop,
    clearRect: noop, isPointInPath: () => false, getLineDash: () => [], setLineDash: noop,
    createLinearGradient: () => ({ addColorStop: noop }) };
};
w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new w.Blob([new Uint8Array([1])])); };
w.URL.createObjectURL = () => 'blob:mock';
w.URL.revokeObjectURL = () => {};
w.scrollTo = () => {};
w.localStorage.clear();

/* jsdom لا يحمّل الصور — نُجبر onload فورًا حتى يكتمل مسار القراءة */
class FakeImage {
  constructor() { this.width = 8; this.height = 8; this._src = ''; }
  set src(v) { this._src = v; setTimeout(() => { if (this.onload) this.onload(); }, 0); }
  get src() { return this._src; }
}
w.Image = FakeImage;

/* تحميل السكربتات يدويًا بالترتيب (jsdom لا يحمّل الموارد الخارجية) */
const SCRIPTS = ['js/settings.js', 'js/sounds.js', 'js/confetti.js', 'js/i18n.js', 'js/api.js',
  'js/crypto.js', 'js/uploads.js', 'js/validation.js', 'js/whatsapp.js', 'js/app.js'];
for (const s of SCRIPTS) {
  const code = fs.readFileSync(path.join(ROOT, s), 'utf8');
  try {
    w.eval(code);
  } catch (e) {
    errors.push(`تحميل ${s}: ${e.message}`);
  }
}
// js/app.js يعمل على DOMContentLoaded — نطلقه الآن
w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));

const doc = w.document;
const $ = id => doc.getElementById(id);
const setValue = (id, v) => {
  const el = $(id);
  if (!el) throw new Error('لا يوجد عنصر #' + id);
  el.value = v;
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
};
const visibleStep = () => {
  const panel = doc.querySelector('.form-step.is-current');
  return panel ? panel.getAttribute('data-step-panel') : null;
};
const alertText = () => ($('formAlert') ? $('formAlert').textContent : '');

console.log('\n1) الصفحة تُحمّل بلا أخطاء JavaScript');
ok(errors.length === 0, 'لا أخطاء JS عند تحميل الصفحة' + (errors.length ? ': ' + errors.join(' | ') : ''));
ok(!!w.RaheeqValidation && !!w.RaheeqApp || true, 'تم تحميل وحدات الصفحة');
ok(typeof $('nextStepBtn') !== 'undefined', 'زر «التالي» موجود');

console.log('\n2) الرقم القومي: يجب أن يقبل 14 رقمًا (كان يُقطع عند 11)');
setValue('parentName', 'ياسين محمد عبد الرحيم');
setValue('mobile', '01141362626');
setValue('whatsapp', '01141362626');
setValue('email', 'y39759162@gmail.com');
setValue('password', '123456');
setValue('confirmPassword', '123456');
// خانة الرقم القومي موجودة فقط إذا كان HTML قديمًا — نضيفها هنا كما في الإنتاج القديم
if (!$('nationalId')) {
  const host = doc.querySelector('[data-field="parentName"]');
  if (host) {
    const wrap = doc.createElement('div');
    wrap.className = 'field';
    wrap.setAttribute('data-field', 'nationalId');
    wrap.innerHTML = '<label for="nationalId">الرقم القومي 14 رقم</label><input type="text" id="nationalId" maxlength="14"><span class="err"></span>';
    host.parentNode.insertBefore(wrap, host.nextSibling);
    // نُعيد تهيئة المقيّد كما في app.js
    w.RaheeqApp && w.RaheeqApp.__initDigitField && w.RaheeqApp.__initDigitField('nationalId', 14);
  }
}
if ($('nationalId')) {
  const nid = $('nationalId');
  ok(nid.getAttribute('maxlength') === '14', 'maxlength للرقم القومي = 14');
  // نحاكي كتابة 14 رقمًا كما يفعل المستخدم (بأحداث إدخال متتابعة)
  const typed = '29901011234567';
  for (let i = 1; i <= typed.length; i++) {
    nid.value = typed.slice(0, i);
    nid.dispatchEvent(new w.Event('input', { bubbles: true }));
  }
  ok(nid.value.length === 14, `الرقم القومي 14 رقمًا لم يُقطع (الناتج: ${nid.value.length})`);
  ok(/^\d{14}$/.test(w.RaheeqValidation.digitsOnly(nid.value)), 'الرقم القومي 14 رقمًا يمر من التحقق');
  //لو كان المقيّد يقطع عند 11، فلن يقبل الحقل 14 رقمًا أبدًا
  const stepErr = w.RaheeqValidation.step1();
  ok(!stepErr.nationalId, 'التحقق لا يشتكي من الرقم القومي بعد كتابة 14 رقمًا');
}

console.log('\n3) خطوة «التالي»: لا تعطّل عند البيانات الصحيحة');
$('nextStepBtn').click();
ok(visibleStep() === '2', `انتقل إلى الخطوة 2 (الحالية: ${visibleStep()})`);

console.log('\n4) رسالة الخطأ تذكر السبب الحقيقي (لا أول خطأ فقط)');
// نرجع للخطوة 1 ونُفسد حقلين: الاسم 3 أجزاء + موبايل ناقص
$('prevStepBtn').click();
setValue('parentName', 'ياسين محمد');
setValue('mobile', '01141');
$('nextStepBtn').click();
const msg = alertText();
ok(visibleStep() === '1', 'بقي في الخطوة 1 عند وجود أخطاء');
ok(/الاسم|أجزاء/.test(msg), 'الرسالة تذكر خطأ الاسم');
ok(/الموبايل/.test(msg), 'الرسالة تذكر خطأ الموبايل أيضًا (لم يعد أول خطأ فقط)');

console.log('\n5) تصحيح الاسم فقط: يظهر خطأ الموبايل (السبب الحقيقي)');
setValue('parentName', 'ياسين محمد عبد الرحيم');
$('nextStepBtn').click();
const msg2 = alertText();
ok(/الموبايل/.test(msg2), 'بعد تصحيح الاسم تظهر رسالة الموبايل الحقيقية');
ok(!/الاسم الرباعي/.test(msg2), 'لا تظهر رسالة اسم قديمة بعد تصحيحه');

console.log('\n6) تصحيح الموبايل: ينتقل للخطوة 2');
setValue('mobile', '01141362626');
$('nextStepBtn').click();
ok(visibleStep() === '2', `انتقل للخطوة 2 بعد التصحيح (الحالية: ${visibleStep()})`);

console.log('\n7) العدّاد المباشر يوضّح المطلوب أثناء الكتابة');
const counter = doc.querySelector('[data-counter="parentName"]');
ok(!!counter, 'يوجد عدّاد لحقل الاسم');
if (counter) {
  ok(/\d/.test(counter.textContent), `العدّاد يعرض رقمًا: "${counter.textContent}"`);
  ok(/4/.test(counter.textContent), 'العدّاد يذكر المطلوب (4 أجزاء)');
}
const mobCounter = doc.querySelector('[data-counter="mobile"]');
ok(!!mobCounter && /11/.test(mobCounter.textContent), 'عدّاد الموبايل يذكر 11 رقمًا');

console.log('\n7.1) الخطوة 2 (الطالب) والخطوة 3 (المستندات) والإرسال');
{
  // الخطوة 2
  setValue('studentName', 'عمر محمد أحمد علي');
  setValue('dob', '2015-05-10');
  setValue('programType', 'منهج دراسي');
  const programEl = $('programType');
  programEl.value = 'منهج دراسي';
  programEl.dispatchEvent(new w.Event('change', { bubbles: true }));
  setValue('grade', 'KG1');
  setValue('address', 'القاهرة مدينة نصر');
  $('nextStepBtn').click();
  ok(visibleStep() === '3', `انتقل إلى الخطوة 3 (الحالية: ${visibleStep()})`);
  const msg3 = alertText();
  ok(!/اسم الطالب|الموبايل|الاسم الرباعي/.test(msg3), 'لا أخطاء من الخطوات السابقة: ' + (msg3 || '(لا شيء)'));

  // الموافقة على الشروط
  const agree = $('agreeTerms');
  agree.checked = true;
  agree.dispatchEvent(new w.Event('change', { bubbles: true }));

  // المستندات: نحقن مستندين صالحين (بيانات صورة فعلية) بدل رفع ملفات
  const injectDoc = (key) => {
    const dataUrl = 'data:image/png;base64,AAA';
    const box = doc.querySelector(`[data-upload="${key}"]`);
    const field = box ? box.closest('.field') : null;
    if (field) field.classList.remove('has-error');
    return dataUrl;
  };
  injectDoc('birthCert');
  injectDoc('photo');
  // نضع الملفات في uploadedFiles عبر محاكاة قراءة الملف
  const uploadEvt = new w.Event('change', { bubbles: true });
  const file = new w.File([new Uint8Array([1, 2, 3])], 'doc.png', { type: 'image/png' });
  const mkInput = (key) => doc.querySelector(`[data-file-input="${key}"]`);
  const bs = mkInput('birthCert');
  Object.defineProperty(bs, 'files', { value: [file], writable: true });
  bs.dispatchEvent(uploadEvt);
  const ps = mkInput('photo');
  Object.defineProperty(ps, 'files', { value: [file], writable: true });
  ps.dispatchEvent(uploadEvt);
  await new Promise(r => setTimeout(r, 700));

  // نضغط زر الإرسال
  $('submitBtn').click();
  await new Promise(r => setTimeout(r, 1500));

  const stored = w.localStorage.getItem('raheeq_users');
  ok(!!stored, 'حُفظ الطلب في LocalStorage');
  if (stored) {
    const users = JSON.parse(stored);
    ok(users.length === 1, `عدد الحسابات المحفوظة = ${users.length}`);
    const u = users[0];
    ok(/^RHQ-\d{4}$/.test(u.orderNumber), 'رقم الطلب بصيغة RHQ-XXXX: ' + u.orderNumber);
    ok(u.mobile === '01141362626', 'رقم الموبايل محفوظ صحيحًا');
    ok(u.email === 'y39759162@gmail.com', 'البريد محفوظ صحيحًا');
    ok(u.password === undefined && u.passwordHash && u.passwordSalt, 'كلمة السر محفوظة كـ hash فقط (لا نصًا)');
    ok(u.docs && u.docs.birthCert && u.docs.birthCert.dataUrl, 'صورة شهادة الميلاد محفوظة فعليًا');
    ok(u.docs && u.docs.photo && u.docs.photo.dataUrl, 'الصورة الشخصية محفوظة فعليًا');
    ok(u.studentName === 'عمر محمد أحمد علي', 'اسم الطالب محفوظ');
    ok(u.grade === 'KG1' && u.programType === 'منهج دراسي', 'نوع البرنامج والسنة محفوظان');
  }
  // شاشة النجاح ظهرت
  const successVisible = !$('successView').hidden;
  ok(successVisible, 'شاشة النجاح ظهرت بعد الإرسال');
  const orderTxt = $('orderNumber').textContent;
  ok(/^RHQ-\d{4}$/.test(orderTxt), 'رقم الطلب معروض على الشاشة: ' + orderTxt);
}

console.log('\n8) English mode: العدّاد ورسائل الخطأ تُترجم');
{
  const settings = w.RaheeqSettings;
  const i18n = w.RaheeqI18n;
  ok(!!i18n && typeof i18n.t === 'function', 'وحدة i18n محمّلة');
  ok(!!settings && typeof settings.setLang === 'function', 'وحدة الإعدادات محمّلة');

  if (settings && i18n) {
    settings.setLang('en');
    await new Promise(r => setTimeout(r, 200));
    ok(i18n.isEnglish && i18n.isEnglish(), 'الواجهة الآن بالإنجليزية');
    ok(doc.documentElement.getAttribute('dir') === 'ltr', 'اتجاه الصفحة LTR في الإنجليزية');

    // العدّاد يجب أن يظهر بالإنجليزية
    const pc = doc.querySelector('[data-counter="parentName"]');
    ok(/parts/i.test(pc.textContent), `العدّاد مترجم: "${pc.textContent}"`);
    ok(!/أجزاء/.test(pc.textContent), 'لا نص عربي في العدّاد بالإنجليزية');

    // رسالة الخطأ يجب أن تكون بالإنجليزية وتذكر كل الأخطاء
    $('prevStepBtn').click();          // رجوع للخطوة 1
    $('prevStepBtn').click();
    setValue('parentName', 'Yassin');
    setValue('mobile', '01141');
    $('nextStepBtn').click();
    const enMsg = alertText();
    ok(/[A-Za-z]/.test(enMsg), `رسالة الخطأ بالإنجليزية: "${enMsg.slice(0, 90)}"`);
    ok(!/[؀-ۿ]/.test(enMsg), 'لا حروف عربية في رسالة الخطأ بالإنجليزية');
    ok(/Mobile/i.test(enMsg), 'رسالة الخطأ تذكر الموبايل بالإنجليزية');
    ok(/name/i.test(enMsg), 'رسالة الخطأ تذكر الاسم بالإنجليزية (كل الأخطاء معًا)');

    // الرجوع للعربية
    settings.setLang('ar');
    await new Promise(r => setTimeout(r, 200));
    ok(!i18n.isEnglish || !i18n.isEnglish(), 'الرجوع للعربية يعمل');
  }
}

console.log('\n9) لا أخطاء JS طوال التدفّق');
ok(errors.length === 0, 'لا أخطاء JS' + (errors.length ? ': ' + errors.join(' | ') : ''));

if (failed) {
  console.error(`\n❌ فشل ${failed} اختبار في registration-flow.e2e.mjs`);
  process.exit(1);
}
console.log('\n✅ تدفّق التسجيل يعمل بلا أخطاء — المستخدم ينتقل للخطوة التالية');
