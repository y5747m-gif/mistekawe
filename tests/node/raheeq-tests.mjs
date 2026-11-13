/**
 * اختبارات موقع رحيق RAHEEQ (index.html + css/ + js/ + sounds/).
 * لا تحتاج أي اعتماد خارجي: بنية الملفات، الهوية، الأصوات، صياغة السكربتات،
 * ومنطق التحقق داخل بيئة DOM وهمية.
 *
 * التشغيل: node tests/node/raheeq-tests.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = p => fs.existsSync(path.join(ROOT, p));

let failed = 0;
function ok(cond, msg) {
  if (!cond) { failed++; console.error('  ✗ ' + msg); }
  else console.log('  ✓ ' + msg);
}

const html = read('index.html');
const css = read('css/raheeq.css');
const sounds = read('js/sounds.js');
const confetti = read('js/confetti.js');
const validation = read('js/validation.js');
const app = read('js/app.js');

console.log('\n1) بنية الموقع (أساس متعدد الملفات وليس ملف HTML واحدًا)');
for (const f of ['index.html', 'css/raheeq.css', 'js/sounds.js', 'js/confetti.js',
                 'js/validation.js', 'js/app.js', 'raheeq.webmanifest', 'assets/brand/raheeq-mark.svg']) {
  ok(exists(f), 'الملف موجود: ' + f);
}
ok(/<html[^>]*lang="ar"[^>]*dir="rtl"/.test(html), 'الصفحة الأساس عربية RTL');
ok(html.includes('href="css/raheeq.css"') && !html.includes('<style>'), 'التنسيق في ملف خارجي منفصل');
['js/sounds.js', 'js/confetti.js', 'js/validation.js', 'js/app.js'].forEach(f =>
  ok(html.includes('src="' + f + '"'), 'السكربت خارجي: ' + f));
ok(html.includes('family=Cairo') && css.includes("font-family:'Cairo Local'"), 'خط Cairo من Google Fonts مع نسخة محلية احتياطية');
ok(read('raheeq.html').includes('location.replace'), 'الرابط القديم raheeq.html يحوّل إلى أساس الموقع');
ok(exists('majlis.html') && read('majlis.html').includes('مجلس الصوت'), 'صفحة مجلس الصوت القديمة محفوظة');

console.log('\n2) الهوية البصرية والأقسام المطلوبة');
const colors = {
  '#881234': 'البرغندي الأساسي', '#5E0C24': 'البرغندي الغامق', '#A6193F': 'البرغندي الفاتح',
  '#F3E8D2': 'الكريمي', '#EADFC8': 'البيج', '#C9A86A': 'الذهبي',
  '#2B2B2B': 'النص', '#6B6B6B': 'النص الباهت', '#FFFFFF': 'الأبيض',
  '#1E8A49': 'الأخضر', '#D32F2F': 'الأحمر'
};
Object.entries(colors).forEach(([c, name]) => ok(css.includes(c), 'اللون ' + name + ' ' + c));
ok(/--radius-card:\s*20px/.test(css), 'زوايا البطاقات 20px');
ok(/--radius-btn:\s*14px/.test(css), 'زوايا الأزرار 14px');
ok(css.includes('scale(.97)'), 'الأزرار تتقلص 0.97 عند الضغط');
ok(css.includes('@keyframes fadeUp'), 'دخول البطاقات Fade-up');
ok(css.includes('@keyframes slideNext') && css.includes('@keyframes slideBack'), 'انزلاق الخطوات لليسار');
ok(css.includes('box-shadow:0 0 0 4px rgba(136,18,52,.14)'), 'توهج حدود الحقول عند التركيز');
ok(html.includes('class="site-header"') && css.includes('position:sticky'), 'هيدر ثابت');
[['id="soundToggle"', 'زر الصوت'], ['id="headerLoginBtn"', 'زر دخول ولي الأمر'],
 ['class="hero-badges"', 'شارات الهيرو'], ['id="registerCard"', 'بطاقة التسجيل'],
 ['id="loginView"', 'صندوق الدخول'], ['id="successView"', 'شاشة النجاح'],
 ['id="features"', 'قسم القيم'], ['id="footer"', 'الفوتر']].forEach(([k, n]) => ok(html.includes(k), n));
ok((html.match(/class="hbadge"/g) || []).length === 4, 'أربع شارات في الهيرو');
ok((html.match(/class="feature-card fade-up"/g) || []).length === 4, 'أربع بطاقات: ثقة، نمو، رعاية، تميز');
ok((html.match(/class="pstep/g) || []).length === 3, 'مؤشر تقدم بثلاث خطوات');
ok((html.match(/data-step-panel=/g) || []).length === 3, 'ثلاث خطوات للنموذج');
ok(html.includes('© 2026 رحيق RAHEEQ - <a href="mailto:info@raheeq.edu">info@raheeq.edu</a>'), 'نص الفوتر الدقيق');
ok(html.includes('هنتواصل معاك خلال 24-48 ساعة'), 'رسالة المتابعة 24-48 ساعة');
ok(html.includes('KG1') && html.includes('3 ثانوي'), 'الصفوف من KG1 إلى 3 ثانوي');
ok(html.includes('id="agreeTerms"'), 'الموافقة على الشروط');
ok(['birthCert', 'photo', 'parentCard', 'reportCard'].every(k => html.includes('data-file-input="' + k + '"')), 'مستندات الرفع الأربعة');

console.log('\n3) ملفات الأصوات الثمانية (MP3 حقيقية محمّلة مسبقًا)');
const names = ['click', 'hover', 'typing', 'success', 'error', 'step', 'upload', 'toggle'];
for (const n of names) {
  const p = 'sounds/' + n + '.mp3';
  let good = false;
  if (exists(p)) {
    const b = fs.readFileSync(path.join(ROOT, p));
    good = (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) || b.slice(0, 4).toString() === 'ID3';
  }
  ok(good, p + ' ملف MP3 صالح');
  ok(sounds.includes("file: 'sounds/" + n + ".mp3'"), 'التحميل المسبق لـ ' + n);
}
const vols = { click: '0.3', hover: '0.1', typing: '0.05', success: '0.6', error: '0.5' };
Object.entries(vols).forEach(([n, v]) =>
  ok(new RegExp(n + ":\\s*\\{\\s*file: 'sounds/" + n + "\\.mp3',\\s*vol: " + v.replace('.', '\\.')).test(sounds),
     'مستوى صوت ' + n + ' = ' + v));
ok(sounds.includes('navigator.vibrate') && app.includes('vibrate([100, 50, 100])') && app.includes('vibrate(100)'), 'الاهتزاز عند النجاح والخطأ');
ok(sounds.includes('localStorage.getItem(LS_KEY)') && sounds.includes("localStorage.setItem(LS_KEY"), 'تفضيل الصوت محفوظ في LocalStorage');
ok(confetti.includes('#881234') && confetti.includes('#C9A86A'), 'قصاصات ماروني + ذهبي');

console.log('\n4) صياغة السكربتات');
for (const [name, code] of [['js/sounds.js', sounds], ['js/confetti.js', confetti],
                            ['js/validation.js', validation], ['js/app.js', app]]) {
  try { new vm.Script(code, { filename: name }); ok(true, name + ' بلا أخطاء صياغة'); }
  catch (err) { ok(false, name + ': ' + err.message); }
}

console.log('\n5) منطق التحقق في بيئة DOM وهمية');
function runValidation(fields, agree, files) {
  const sandbox = {
    document: {
      getElementById(id) {
        if (id === 'agreeTerms') return { checked: !!agree };
        return { value: fields[id] == null ? '' : fields[id] };
      }
    },
    Date, Math, JSON, String, RegExp, Array, Object
  };
  sandbox.window = sandbox;
  vm.runInNewContext(validation, sandbox);
  return {
    V: sandbox.RaheeqValidation,
    step1: () => sandbox.RaheeqValidation.step1(),
    step2: () => sandbox.RaheeqValidation.step2(),
    step3: () => sandbox.RaheeqValidation.step3(files || {})
  };
}
const good1 = { parentName: 'محمد أحمد علي حسن', nationalId: '12345678901234',
  mobile: '01000000000', email: 'waly@raheeq.edu', password: 'secret1', confirmPassword: 'secret1' };
let t = runValidation(good1, true, { birthCert: true, photo: true, parentCard: true });
ok(Object.keys(t.step1()).length === 0, 'بيانات ولي الأمر الصحيحة مقبولة');
ok(!!runValidation({ ...good1, nationalId: '123' }).step1().nationalId, 'الرقم القومي أقل من 14 رقمًا مرفوض');
ok(!!runValidation({ ...good1, mobile: '010' }).step1().mobile, 'الموبايل أقل من 11 رقمًا مرفوض');
ok(!!runValidation({ ...good1, email: 'بريد-بدون-علامة' }).step1().email, 'الإيميل بدون @ مرفوض');
ok(!!runValidation({ ...good1, password: '123' }).step1().password, 'كلمة السر أقل من 6 مرفوضة');
ok(!!runValidation({ ...good1, confirmPassword: 'اخرى' }).step1().confirmPassword, 'عدم تطابق كلمتي السر مرفوض');
const good2 = { studentName: 'عمر محمد أحمد علي', dob: '2015-05-10', grade: 'KG1', address: 'القاهرة مدينة نصر' };
t = runValidation({ ...good1, ...good2 }, true, { birthCert: true, photo: true, parentCard: true });
ok(Object.keys(t.step2()).length === 0 && Object.keys(t.step3()).length === 0, 'بيانات الطالب والمستندات الصحيحة مقبولة');
ok(!!runValidation(good1, false, { birthCert: true, photo: true, parentCard: true }).step3().agree, 'عدم الموافقة على الشروط مرفوض');
ok(!!runValidation(good1, true, { photo: true, parentCard: true }).step3().birthCert, 'شهادة الميلاد إلزامية');
ok(app.includes("localStorage.setItem(LS_USERS") && app.includes('makeOrderNumber'), 'الحفظ في LocalStorage ورقم الطلب RHQ');
ok(app.includes('RHQ-') && app.includes('Math.random() * 9000'), 'توليد رقم طلب بصيغة RHQ-1234');

if (failed) {
  console.error(`\n❌ فشل ${failed} اختبار في raheeq-tests.mjs`);
  process.exit(1);
}
console.log('\n✅ كل اختبارات موقع رحيق نجحت');
