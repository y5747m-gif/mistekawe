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
const uploads = read('js/uploads.js');
const apiSrc = read('js/api.js');

console.log('\n1) بنية الموقع (أساس متعدد الملفات وليس ملف HTML واحدًا)');
for (const f of ['index.html', 'css/raheeq.css', 'js/sounds.js', 'js/confetti.js',
                 'js/validation.js', 'js/uploads.js', 'js/api.js', 'js/app.js',
                 'js/settings.js', 'js/i18n.js', 'js/whatsapp.js',
                 'raheeq.webmanifest', 'assets/brand/raheeq-mark.svg',
                 'assets/brand/raheeq-mark-vector.svg', 'assets/brand/raheeq-mark-vector-white.svg',
                 'server/api.py', 'server/serve.py', 'tests/python/test_api.py']) {
  ok(exists(f), 'الملف موجود: ' + f);
}
ok(/<html[^>]*lang="ar"[^>]*dir="rtl"/.test(html), 'الصفحة الأساس عربية RTL');
{
  // التنسيق في ملفات خارجية؛ مُسموح فقط كتلة <style> حرجة صغيرة لأنيميشن البداية
  ok(html.includes('href="css/raheeq.css"'), 'التنسيق الأساسي في ملف خارجي css/raheeq.css');
  const inlineStyles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]);
  const inlineBytes = inlineStyles.reduce((n, cssBlock) => n + cssBlock.length, 0);
  ok(inlineBytes <= 700, 'لا توجد كتل CSS كبيرة مضمّنة (حجم المضمّن ' + inlineBytes + ' بايت)');
}
['js/sounds.js', 'js/confetti.js', 'js/validation.js', 'js/uploads.js', 'js/api.js', 'js/settings.js', 'js/i18n.js', 'js/whatsapp.js', 'js/app.js'].forEach(f =>
  ok(html.includes('src="' + f + '"'), 'السكربت خارجي: ' + f));
ok(html.includes('family=Cairo') && css.includes("font-family:'Cairo Local'"), 'خط Cairo من Google Fonts مع نسخة محلية احتياطية');
ok(read('raheeq.html').includes('location.replace'), 'الرابط القديم raheeq.html يحوّل إلى أساس الموقع');
ok(exists('majlis.html') && read('majlis.html').includes('مجلس الصوت'), 'صفحة مجلس الصوت القديمة محفوظة');

console.log('\n1.1) انيميشن البداية (Intro) + منظومة الخطوط متعددة العائلات');
for (const f of ['css/intro.css', 'js/intro.js'])
  ok(exists(f), 'ملف الانميشن موجود: ' + f);
ok(html.includes('href="css/intro.css"'), 'intro.css محمّل في <head>');
ok(html.includes('src="js/intro.js"'), 'js/intro.js محمّل');
ok(html.includes('id="raheeqIntro"'), 'غطاء الانميشن موجود في الصفحة');
ok(html.includes('intro-skip'), 'زر تخطي الانميشن موجود');
for (const fam of ['Amiri', 'Cinzel', 'Reem+Kufi', 'IBM+Plex+Mono', 'Cairo'])
  ok(html.includes('family=' + fam) || html.includes('family=' + fam.split(':')[0]), 'عائلة الخط محمّلة: ' + fam);
for (const token of ['--font-body', '--font-display', '--font-kufi', '--font-brand', '--font-mono'])
  ok(css.includes(token), 'رمز الخط معرّف في raheeq.css: ' + token);
ok(css.includes('var(--font-display)') && css.includes('var(--font-kufi)'), 'العناوين والملصقات تستخدم خطوطها المميزة');
ok(css.includes('var(--font-mono)'), 'حقول الأرقام/المعرفات تستخدم IBM Plex Mono');
const introCss = read('css/intro.css');
ok(introCss.includes('preserve-3d') && introCss.includes('clip-path'), 'الأعمدة 3D والشظايا مقصوصة بـ clip-path');
ok(introCss.includes('prefers-reduced-motion'), 'يحترم تفضيل تقليل الحركة');
ok(html.includes('intro-bar--apex') && html.includes('intro-mark-stage'), 'أعمدة تتصاعد وقمة للشعار');

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
ok(/box-shadow:0 0 0 4px rgba\((?:var\(--maroon-rgb\)|136,18,52),?\.?1?4?\)/.test(css) ||
   /box-shadow:0 0 0 4px rgba\(var\(--maroon-rgb\),\.14\)/.test(css),
  'توهج حدود الحقول عند التركيز (من لون الثيم)');
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
ok(html.includes('تأسيس للصغار') && html.includes('تأسيس للكبار') && html.includes('name="foundationSubjects"'), 'خيارات التأسيس ومواده في التسجيل');
ok(html.includes('KG1') && html.includes('3 ثانوي'), 'الصفوف من KG1 إلى 3 ثانوي');
ok(html.includes('id="programType"') && html.includes('value="تأسيس"') && html.includes('value="منهج دراسي"'), 'قائمة اختيار نوع البرنامج (تأسيس / منهج دراسي)');
ok(html.includes('id="curriculumBranch"') && html.includes('id="foundationBranch"'), 'فرعا القائمتين: منهج دراسي (السنة الدراسية) وتأسيس (المواد)');
ok(html.includes('id="foundationLevel"'), 'قائمة مستوى التأسيس');
ok(!/value="تأسيس للصغار"[\s\S]{0,400}<select id="grade"|id="grade"[\s\S]{0,600}value="تأسيس/.test(html), 'قائمة الصف الدراسي لم تعد مختلطة مع التأسيس');
ok(html.includes('src="js/crypto.js"') && html.indexOf('src="js/crypto.js"') < html.indexOf('src="js/app.js"'), 'js/crypto.js محمّل قبل app.js لتشفير كلمة السر');
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
                            ['js/validation.js', validation], ['js/app.js', app],
                            ['js/settings.js', read('js/settings.js')], ['js/i18n.js', read('js/i18n.js')],
                            ['js/whatsapp.js', read('js/whatsapp.js')]]) {
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
      },
      querySelectorAll(sel) {
        if (String(sel).indexOf('foundationSubjects') >= 0) return (fields.__subjects || []).map(v => ({ value: v }));
        return [];
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
const good2 = { studentName: 'عمر محمد أحمد علي', dob: '2015-05-10', programType: 'منهج دراسي', grade: 'KG1', address: 'القاهرة مدينة نصر' };
t = runValidation({ ...good1, ...good2 }, true, { birthCert: true, photo: true, parentCard: true });
ok(Object.keys(t.step2()).length === 0 && Object.keys(t.step3()).length === 0, 'بيانات الطالب والمستندات الصحيحة مقبولة');
ok(!!runValidation({ ...good1, ...good2, programType: '' }, true, {}).step2().programType, 'غياب نوع البرنامج مرفوض');
ok(!!runValidation({ ...good1, ...good2, programType: 'تأسيس', __subjects: [] }, true, {}).step2().foundationSubjects, 'التأسيس بدون مادة من القائمة مرفوض');
{
  const f = runValidation({ ...good1, ...good2, programType: 'تأسيس', foundationLevel: 'تأسيس للكبار', __subjects: ['الرياضيات', 'اللغة العربية', '<script>'] }, true, {}).step2();
  ok(Object.keys(f).length === 0, 'التأسيس مع مواد من القائمة مقبول');
  ok(JSON.stringify(sandbox2less(f)) === '{}', 'لا أخطاء إضافية');
  function sandbox2less(o) { return o; }
}
ok(!!runValidation({ ...good1, ...good2, programType: 'منهج دراسي', grade: '' }, true, {}).step2().grade, 'منهج دراسي بدون سنة دراسية مرفوض');
ok(!!runValidation({ ...good1, ...good2, programType: 'منهج دراسي', grade: 'KG9' }, true, {}).step2().grade, 'سنة دراسية خارج القائمة مرفوضة');
ok(!!runValidation(good1, false, { birthCert: true, photo: true, parentCard: true }).step3().agree, 'عدم الموافقة على الشروط مرفوض');
ok(!!runValidation(good1, true, { photo: true, parentCard: true }).step3().birthCert, 'شهادة الميلاد إلزامية');
ok(app.includes("localStorage.setItem(LS_USERS") && app.includes('makeOrderNumber'), 'الحفظ في LocalStorage ورقم الطلب RHQ');
ok(app.includes('RHQ-') && app.includes('Math.random() * 9000'), 'توليد رقم طلب بصيغة RHQ-1234');

console.log('\n6) رفع الصور الفعلية: قراءة المحتوى وحفظه وعرضه (وليس الاسم فقط)');
ok(exists('js/uploads.js'), 'محرك المستندات js/uploads.js موجود');
ok(html.indexOf('src="js/uploads.js"') > -1 && html.indexOf('src="js/uploads.js"') < html.indexOf('src="js/app.js"'),
  'uploads.js محمّل قبل app.js');
ok(app.includes('var U = window.RaheeqUploads'), 'app.js يعتمد محرك المستندات');
ok(app.includes('function readyFiles()') && /docs: readyFiles\(\)/.test(app), 'collectData يحفظ سجلات المستندات الفعلية');
ok(!/birthCert:\s*uploadedFiles\.birthCert\s*\?\s*uploadedFiles\.birthCert\.name/.test(app), 'لم يعد يحفظ أسماء الملفات فقط');
ok(app.includes('U.readDocument(file)') && app.includes('safeDataUrl(d.dataUrl)'), 'الرفع يقرأ محتوى الملف ويتحقق من بياناته');
ok(html.includes('id="successDocs"') && html.includes('id="welcomeDocs"') && html.includes('id="docModalImg"'),
  'أماكن عرض الصور المحفوظة بعد الإرسال وبعد الدخول + نافذة عرض');
ok(css.includes('.docs-gallery') && css.includes('.doc-thumb img') && css.includes('.doc-modal'), 'تنسيق معرض الصور المحفوظة');

function makeUploadEnv() {
  const dims = new Map();
  const pad = (bytes, n) => {
    if (bytes.length >= n) return bytes.subarray(0, n);
    const out = new Uint8Array(n); out.set(bytes); return out;
  };
  function makeCanvas() {
    const canvas = { width: 0, height: 0, _src: '' };
    canvas.getContext = () => ({
      fillStyle: '', fillRect() {},
      drawImage(img) { canvas._src = img._src || img.src || ''; }
    });
    canvas.toDataURL = () => {
      const m = /^data:[^;]+;base64,(.*)$/.exec(canvas._src);
      const orig = m ? Uint8Array.from(Buffer.from(m[1], 'base64')) : new Uint8Array(64);
      const target = Math.max(64, Math.round(canvas.width * canvas.height / 50));
      return 'data:image/jpeg;base64,' + Buffer.from(pad(orig, target)).toString('base64');
    };
    return canvas;
  }
  class FakeFileReader {
    readAsDataURL(file) {
      const mime = file.type || 'application/octet-stream';
      this.result = 'data:' + mime + ';base64,' + Buffer.from(file._bytes || []).toString('base64');
      setTimeout(() => { if (this.onload) this.onload(); }, 0);
    }
  }
  class FakeImage {
    constructor() { this.onload = null; this.onerror = null; this._src = ''; }
    set src(v) {
      this._src = v;
      const d = dims.get(v) || { w: 2000, h: 1500 };
      this.naturalWidth = d.w; this.naturalHeight = d.h;
      setTimeout(() => { if (this.onload) this.onload(); }, 0);
    }
    get src() { return this._src; }
  }
  const sandbox = {
    document: { createElement: () => makeCanvas() },
    FileReader: FakeFileReader,
    Image: FakeImage,
    atob: (v) => Buffer.from(v, 'base64').toString('binary'),
    Blob: class { constructor(parts, opts) { this.parts = parts; this.type = (opts || {}).type || ''; this.size = parts[0] ? parts[0].length : 0; } },
    Date, Math, JSON, String, RegExp, Array, Object, Number, Promise, Uint8Array, isFinite,
    setTimeout, console
  };
  sandbox.window = sandbox;
  vm.runInNewContext(uploads, sandbox, { filename: 'js/uploads.js' });
  return { U: sandbox.RaheeqUploads, sandbox, dims };
}

const { U, sandbox } = makeUploadEnv();
const bytesOf = (n, seed = 7) => Uint8Array.from({ length: n }, (_, i) => (i * seed + 13) % 251);
function fakeFile(name, type, bytes) {
  return { name, type, size: bytes.length, _bytes: bytes };
}
const imgBytes = bytesOf(6000);
const imgFile = fakeFile('birth.jpg', 'image/jpeg', imgBytes);
const imgDoc = await U.readDocument(imgFile);
ok(imgDoc.name === 'birth.jpg' && imgDoc.kind === 'image' && imgDoc.type === 'image/jpeg', 'ملف الصورة يُقرأ كسجل صورة حقيقي');
ok(typeof imgDoc.dataUrl === 'string' && imgDoc.dataUrl.startsWith('data:image/jpeg;base64,'), 'السجل يحتوي Data URL للصورة الفعلية');
ok(imgDoc.dataUrl.length > 100 && imgDoc.dataUrl !== imgDoc.name, 'المحفوظ هو محتوى الصورة وليس الاسم');
const savedBytes = Uint8Array.from(Buffer.from(imgDoc.dataUrl.split(',')[1], 'base64'));
ok(savedBytes.length >= imgBytes.length && savedBytes.subarray(0, imgBytes.length).every((b, i) => b === imgBytes[i]),
  'بايتات الصورة المحفوظة مطابقة للملف الأصلي');
ok(imgDoc.storedSize === imgDoc.dataUrl.length && imgDoc.uploadedAt && imgDoc.width === 1400 && imgDoc.height === 1050,
  'السجل يحفظ الحجم والأبعاد وتاريخ الرفع (مضغوطة إلى 1400px)');
const roundTrip = U.normalizeDoc(JSON.parse(JSON.stringify(imgDoc)));
ok(roundTrip.dataUrl === imgDoc.dataUrl && roundTrip.kind === 'image', 'الصورة تبقى سليمة بعد JSON/LocalStorage وإعادة القراءة');

const legacy = U.normalizeDoc('birth.jpg');
ok(legacy && legacy.legacy === true && legacy.dataUrl === '' && legacy.kind === 'legacy', 'السجل القديم (اسم فقط) يُكتشف ولا يُعرض كصورة');
ok(U.normalizeDoc('data:image/jpeg;base64,') === null || U.normalizeDoc('data:image/jpeg;base64,').legacy === true,
  'بيانات صورة ناقصة لا تُقبل كصورة محفوظة');
ok(U.safeDataUrl('birth.jpg') === false && U.safeDataUrl('data:text/html;base64,PHNjcmlwdD4=') === false,
  'اسم الملف أو نوع غير آمن لا يُعد صورة محفوظة');

let rejected = '';
try { await U.readDocument(fakeFile('x.html', 'text/html', bytesOf(200))); } catch (e) { rejected = e.message; }
ok(/غير مدعومة/.test(rejected), 'الملفات غير المدعومة (HTML) مرفوضة');
rejected = '';
try { await U.readDocument(fakeFile('x.svg', 'image/svg+xml', bytesOf(200))); } catch (e) { rejected = e.message; }
ok(/غير مدعومة/.test(rejected), 'صور SVG مرفوضة لأسباب أمنية');
rejected = '';
try { await U.readDocument(fakeFile('big.jpg', 'image/jpeg', bytesOf(13 * 1024 * 1024))); } catch (e) { rejected = e.message; }
ok(/12 ميجابايت/.test(rejected), 'الملف الأكبر من 12 ميجابايت مرفوض قبل القراءة');

const pdfBytes = bytesOf(900, 3);
const pdfDoc = await U.readDocument(fakeFile('cert.pdf', 'application/pdf', pdfBytes));
ok(pdfDoc.kind === 'pdf' && pdfDoc.dataUrl.startsWith('data:application/pdf;base64,'), 'ملف PDF يُحفظ بمحتواه الفعلي');
const pdfSaved = Uint8Array.from(Buffer.from(pdfDoc.dataUrl.split(',')[1], 'base64'));
ok(pdfSaved.length === pdfBytes.length && pdfSaved.every((b, i) => b === pdfBytes[i]), 'بايتات PDF المحفوظة مطابقة للملف');
rejected = '';
try { await U.readDocument(fakeFile('big.pdf', 'application/pdf', bytesOf(800 * 1024))); } catch (e) { rejected = e.message; }
ok(/700 كيلوبايت/.test(rejected), 'ملفات PDF الأكبر من 700 كيلوبايت مرفوضة مع رسالة واضحة');

const bigDoc = await U.readDocument(fakeFile('large.jpg', 'image/png', bytesOf(40000, 5)), { budgetChars: 8000 });
ok(bigDoc.storedSize <= 8000, 'الضغط التلقائي ينزل بالصورة حتى تناسب مساحة التخزين');
ok(bigDoc.width < 1400, 'الضغط يقلّل الأبعاد عند الحاجة (بدل رفض الصورة)');

const small = await U.readDocument(fakeFile('photo.jpg', 'image/jpeg', bytesOf(3000)), { budgetChars: 600000 });
const shrunk = await U.shrinkDocs({ birthCert: imgDoc, photo: small, parentCard: null, reportCard: null }, 5000);
ok(shrunk.birthCert.storedSize <= 5000 && U.safeDataUrl(shrunk.birthCert.dataUrl), 'إعادة الضغط عند امتلاء التخزين تحافظ على صورة صالحة');
const untouched = await U.shrinkDocs({ photo: small }, 200000);
ok(untouched.photo.dataUrl === small.dataUrl, 'الصور الصغيرة لا تُعاد معالجتها بلا داعٍ');
const fitted = await U.fitDocs({ birthCert: imgDoc, photo: small }, 50000);
ok(U.docsChars(fitted) <= U.docsChars({ birthCert: imgDoc, photo: small }) || fitted.birthCert.width <= imgDoc.width,
  'fitDocs يضغط المستندات عند تجاوز الميزانية');

const blob = U.dataUrlToBlob(pdfDoc.dataUrl);
ok(blob && blob.type === 'application/pdf' && blob.parts[0].length === pdfBytes.length, 'فتح PDF محفوظ يتم عبر Blob آمن');
ok(U.estimateBytes(4000) === 3000, 'تقدير الحجم المحفوظ صحيح');

console.log('\n7) تدفق تسجيل كامل: الصورة تُحفظ في LocalStorage وتُعرض بعد الإرسال والدخول');
function makeDomEnv() {
  const byId = new Map();
  const dataMap = new Map();
  const boxes = {};
  const makeEl = (tag = 'div') => {
    const e = {
      tagName: String(tag).toUpperCase(), _classes: new Set(), style: {}, dataset: {}, attrs: {},
      hidden: false, value: '', textContent: '', _html: '', checked: false, files: null,
      disabled: false, offsetWidth: 1, listeners: {}, _kids: new Map()
    };
    e.classList = {
      add: (...n) => n.forEach(x => e._classes.add(x)),
      remove: (...n) => n.forEach(x => e._classes.delete(x)),
      contains: n => e._classes.has(n),
      toggle: (n, f) => { const on = f === undefined ? !e._classes.has(n) : !!f; on ? e._classes.add(n) : e._classes.delete(n); return on; }
    };
    Object.defineProperty(e, 'className', {
      get: () => [...e._classes].join(' '),
      set: v => { e._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
    });
    Object.defineProperty(e, 'innerHTML', { get: () => e._html, set: v => { e._html = String(v); } });
    e.addEventListener = (t, fn) => { (e.listeners[t] = e.listeners[t] || []).push(fn); };
    e.emit = (t, ev = {}) => (e.listeners[t] || []).forEach(fn =>
      fn(Object.assign({ target: e, preventDefault() {}, stopPropagation() {} }, ev)));
    e.setAttribute = (k, v) => { e.attrs[k] = String(v); };
    e.getAttribute = k => (k in e.attrs ? e.attrs[k] : (k === 'data-upload' ? e._dataUpload : null));
    e.removeAttribute = k => { delete e.attrs[k]; if (k === 'src') e.src = ''; };
    e.querySelector = sel => {
      if (!e._kids.has(sel)) e._kids.set(sel, makeEl(sel === '.dot' ? 'span' : 'div'));
      return e._kids.get(sel);
    };
    e.querySelectorAll = () => [];
    e.closest = () => null;
    e.focus = () => {};
    e.scrollIntoView = () => {};
    e.reset = () => { byId.forEach(x => { if (x && typeof x.value === 'string') x.value = ''; }); };
    e.click = () => e.emit('click');
    return e;
  };
  ['birthCert', 'photo', 'parentCard', 'reportCard'].forEach(key => {
    const box = makeEl('label');
    const prev = makeEl('span'), thumb = makeEl('img'), name = makeEl('span'),
          badge = makeEl('span'), input = makeEl('input'), remove = makeEl('button'),
          field = makeEl('div');
    badge.textContent = '📄 مستند مرفق';
    box._dataUpload = key;
    box._kids.set('.upload-preview', prev); box._kids.set('.thumb', thumb);
    box._kids.set('.file-name', name); box._kids.set('.file-badge', badge);
    input.setAttribute('data-file-input', key);
    remove.setAttribute('data-remove', key);
    boxes[key] = { box, prev, thumb, name, badge, input, remove, field };
    dataMap.set('data-upload="' + key + '"', box);
    dataMap.set('data-file-input="' + key + '"', input);
    dataMap.set('data-remove="' + key + '"', remove);
    dataMap.set('data-field="' + key + '"', field);
  });
  const fields = ['parentName', 'nationalId', 'relation', 'mobile', 'whatsapp', 'email', 'password',
    'studentName', 'dob', 'gender', 'programType', 'grade', 'foundationLevel', 'prevSchool', 'address', 'healthNotes', 'confirmPassword',
    'loginMobile', 'loginPassword'];
  fields.forEach(id => byId.set(id, makeEl('input')));
  ['agreeTerms'].forEach(id => byId.set(id, makeEl('input')));
  ['regForm', 'loginForm', 'registerCard', 'formAlert', 'loginAlert', 'toast', 'uploadStatus',
   'prevStepBtn', 'nextStepBtn', 'submitBtn', 'progressFill', 'tabRegister', 'tabLogin',
   'registerView', 'loginView', 'successView', 'welcomeBox', 'welcomeName', 'welcomeDetails',
   'welcomeDocs', 'successDocs', 'successBox', 'orderNumber', 'newRegBtn', 'copyOrderBtn',
   'successLoginBtn', 'logoutBtn', 'soundToggle', 'headerLoginBtn', 'goRegisterBtn',
   'siteHeader', 'cardTitle', 'cardSub', 'docModal', 'docModalTitle', 'docModalImg',
   'docModalDownload', 'syncStatus', 'retryUploadBtn', 'syncHint'].forEach(id => { if (!byId.has(id)) byId.set(id, makeEl('div')); });
  const loginBox = makeEl('div');
  const panels = [1, 2, 3].map(n => { const p = makeEl('section'); p.setAttribute('data-step-panel', String(n)); return p; });
  const steps = [1, 2, 3].map(n => { const p = makeEl('div'); p.setAttribute('data-step', String(n)); return p; });
  const document = {
    getElementById: id => byId.get(id) || null,
    createElement: tag => (tag === 'canvas' ? undefined : makeEl(tag)),
    querySelector(sel) {
      let m = /^\[data-([\w-]+)="([\w-]+)"\]$/.exec(sel);
      if (m) return dataMap.get('data-' + m[1] + '="' + m[2] + '"') || null;
      if (sel === '.login-box') return loginBox;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '.form-step') return panels;
      if (sel === '.pstep') return steps;
      if (String(sel).indexOf('foundationSubjects') >= 0) return [];
      if (sel === '[data-file-input]') return Object.values(boxes).map(b => b.input);
      if (sel === '[data-remove]') return Object.values(boxes).map(b => b.remove);
      if (sel === '.upload-box') return Object.values(boxes).map(b => b.box);
      return [];
    },
    body: makeEl('body'),
    addEventListener() {}
  };
  return { document, boxes, byId, loginBox, makeEl };
}

const dom = makeDomEnv();
const store = new Map();
const sandbox2 = {
  document: dom.document,
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); }
  },
  navigator: { clipboard: null },
  matchMedia: () => ({ matches: false }),
  addEventListener() {}, setTimeout, clearTimeout, console, Date, Math, JSON, String, RegExp,
  Array, Object, Number, Promise, Uint8Array, isFinite, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  atob: v => Buffer.from(v, 'base64').toString('binary'),
  Blob: class { constructor(parts, opts) { this.parts = parts; this.type = (opts || {}).type || ''; this.size = parts[0] ? parts[0].length : 0; } },
  FileReader: class {
    readAsDataURL(file) {
      this.result = 'data:' + (file.type || 'application/octet-stream') + ';base64,' + Buffer.from(file._bytes || []).toString('base64');
      setTimeout(() => { if (this.onload) this.onload(); }, 0);
    }
  },
  Image: class {
    constructor() { this.onload = null; this.onerror = null; this._src = ''; }
    set src(v) {
      this._src = v; this.naturalWidth = 1200; this.naturalHeight = 900;
      setTimeout(() => { if (this.onload) this.onload(); }, 0);
    }
    get src() { return this._src; }
  },
  open() { return true; }
};
sandbox2.window = sandbox2;
sandbox2.document.createElement = tag => {
  if (tag !== 'canvas') return dom.makeEl(tag);
  const canvas = { width: 0, height: 0, _src: '' };
  canvas.getContext = () => ({ fillStyle: '', fillRect() {}, drawImage(img) { canvas._src = img._src || img.src || ''; } });
  canvas.toDataURL = () => {
    const m = /^data:[^;]+;base64,(.*)$/.exec(canvas._src);
    const orig = m ? Uint8Array.from(Buffer.from(m[1], 'base64')) : new Uint8Array(64);
    const target = Math.max(64, Math.round(canvas.width * canvas.height / 60));
    const out = new Uint8Array(Math.min(target, 9000)); out.set(orig.subarray(0, out.length));
    return 'data:image/jpeg;base64,' + Buffer.from(out).toString('base64');
  };
  return canvas;
};
sandbox2.RaheeqSound = { play() {}, vibrate() {}, preload() {}, bindToggle() {} };
sandbox2.RaheeqConfetti = { launch() {} };
vm.runInNewContext(validation, sandbox2, { filename: 'js/validation.js' });
vm.runInNewContext(read('js/crypto.js'), sandbox2, { filename: 'js/crypto.js' });
vm.runInNewContext(uploads, sandbox2, { filename: 'js/uploads.js' });
vm.runInNewContext(app, sandbox2, { filename: 'js/app.js' });

const setVal = (id, v) => { dom.byId.get(id).value = v; };
Object.entries({ parentName: 'محمد أحمد علي حسن', nationalId: '12345678901234',
  relation: 'الأب', mobile: '01000000000', whatsapp: '01000000000', email: 'waly@raheeq.edu',
  password: 'secret1', confirmPassword: 'secret1', studentName: 'عمر محمد أحمد علي', dob: '2015-05-10',
  gender: 'ذكر', programType: 'منهج دراسي', grade: 'KG1', address: 'القاهرة مدينة نصر' }).forEach(([k, v]) => setVal(k, v));
dom.byId.get('agreeTerms').checked = true;

const photoBytes = bytesOf(4200, 11);
dom.boxes.photo.input.files = [fakeFile('student.png', 'image/png', photoBytes)];
dom.boxes.photo.input.emit('change');
dom.boxes.birthCert.input.files = [fakeFile('birth.jpg', 'image/jpeg', bytesOf(3100, 3))];
dom.boxes.birthCert.input.emit('change');
dom.boxes.parentCard.input.files = [fakeFile('card.jpg', 'image/jpeg', bytesOf(2800, 9))];
dom.boxes.parentCard.input.emit('change');
await new Promise(r => setTimeout(r, 60));
ok(dom.boxes.photo.thumb.src.startsWith('data:image/jpeg;base64,'), 'المعاينة تعرض بيانات الصورة المرفوعة');
ok(/محفوظ/.test(dom.boxes.photo.name.textContent), ' الحقل يوضح أن الصورة حُفظت فعلًا مع حجمها');
ok(dom.boxes.photo.box.classList.contains('has-file') && !dom.boxes.photo.box.classList.contains('is-loading'), 'حالة الرفع تنتهي بعد الحفظ');

dom.byId.get('regForm').emit('submit');
await new Promise(r => setTimeout(r, 120));
const savedRaw = store.get('raheeq_users') || '';
const savedUsers = savedRaw ? JSON.parse(savedRaw) : [];
ok(savedUsers.length === 1, 'الطلب حُفظ في LocalStorage بعد الإرسال');
const savedDocs = savedUsers[0] && savedUsers[0].docs ? savedUsers[0].docs : {};
['birthCert', 'photo', 'parentCard'].forEach(k => {
  const d = savedDocs[k];
  ok(d && typeof d === 'object' && typeof d.dataUrl === 'string' && d.dataUrl.startsWith('data:image/jpeg;base64,'),
    'المستند المحفوظ ' + k + ' يحتوي بيانات صورة فعلية');
});
ok(!Object.values(savedDocs).some(d => typeof d === 'string' && !String(d).startsWith('data:')), 'لا توجد مستندات محفوظة كاسم ملف فقط');
const storedBytes = Uint8Array.from(Buffer.from(savedDocs.photo.dataUrl.split(',')[1], 'base64'));
ok(storedBytes.subarray(0, photoBytes.length).every((b, i) => b === photoBytes[i]), 'بايتات الصورة المحفوظة في LocalStorage هي نفس بايتات الملف');
ok(savedDocs.photo.name === 'student.png' && savedDocs.photo.kind === 'image' && savedDocs.photo.size === photoBytes.length,
  'السجل يحفظ الاسم والحجم والنوع مع الصورة');
ok(/<img src="data:image\/jpeg;base64,/.test(dom.byId.get('successDocs').innerHTML),
  'شاشة النجاح تعرض صورة المستند المحفوظة (وليس الاسم)');
ok(!dom.byId.get('successView').hidden && dom.byId.get('orderNumber').textContent.startsWith('RHQ-'), 'شاشة النجاح ورقم الطلب يظهران بعد الحفظ');

dom.byId.get('loginMobile').value = '01000000000';
dom.byId.get('loginPassword').value = 'secret1';
dom.byId.get('loginForm').emit('submit');
await new Promise(r => setTimeout(r, 30));
const welcomeHtml = dom.byId.get('welcomeDocs').innerHTML;
ok(/<img src="data:image\/jpeg;base64,/.test(welcomeHtml), 'بعد تسجيل الدخول تظهر الصور الفعلية المحفوظة');
ok(welcomeHtml.includes('المستندات المرفوعة') && welcomeHtml.includes('data-doc-view'), 'المعرض يوفّر عرضًا وتنزيلًا للصور المحفوظة');
ok(!dom.byId.get('welcomeBox').hidden, 'صندوق الترحيب يظهر بعد الدخول');

console.log('\n7.1) إرسال الطلب إلى واتساب أكاديمية رحيق (بدل خطأ 404)');
const waSrc = read('js/whatsapp.js');
ok(exists('js/whatsapp.js'), 'وحدة واتساب js/whatsapp.js موجودة');
ok(html.includes('src="js/whatsapp.js"') && html.indexOf('src="js/whatsapp.js"') < html.indexOf('src="js/app.js"'),
  'whatsapp.js محمّل قبل app.js');
{
  const waBox = { document: { querySelector: () => null, createElement: () => ({ style: {}, setAttribute() {}, select() {} }), body: { appendChild() {}, removeChild() {} } },
    localStorage: { getItem: () => null, setItem() {} }, navigator: {}, atob: v => Buffer.from(v, 'base64').toString('binary'),
    Uint8Array, Promise, setTimeout, clearTimeout, JSON, Object, Array, String, RegExp, Math, Date,
    encodeURIComponent, decodeURIComponent };
  waBox.window = waBox;
  vm.runInNewContext(waSrc, waBox, { filename: 'js/whatsapp.js' });
  const wa = waBox.RaheeqWhatsApp;
  ok(!!wa, 'واتساب يسجّل نفسه على window.RaheeqWhatsApp');
  ok(wa.DEFAULT_NUMBER === '201151947735', 'رقم أكاديمية رحيق الافتراضي 201151947735');
  const sample = { orderNumber: 'RHQ-4444', createdAt: '2026-11-13T09:00:00Z', parentName: 'محمد أحمد علي حسن',
    nationalId: '12345678901234', relation: 'أب', mobile: '01000000000', whatsapp: '01000000000',
    email: 'waly@raheeq.edu', studentName: 'عمر محمد أحمد علي', dob: '2015-05-10', gender: 'ذكر',
    grade: 'KG1', address: 'القاهرة مدينة نصر', docs: {} };
  const msg = wa.buildMessage(sample);
  ok(msg.includes('RHQ-4444') && msg.includes('محمد أحمد علي حسن') && msg.includes('عمر محمد أحمد علي'),
    'رسالة الواتساب تحوي رقم الطلب وولي الأمر والطالب');
  ok(msg.includes('المستندات') || /docs|documents/i.test(msg), 'الرسالة تذكّر بإرفاق المستندات');
  const link = wa.buildLink(sample);
  ok(link.indexOf('https://wa.me/201151947735?text=') === 0, 'رابط واتساب يفتح محادثة رقم أكاديمية رحيق');
  ok(decodeURIComponent(link.split('?text=')[1]).includes('RHQ-4444'), 'الرابط يحمل الرسالة كاملة (نص مُرمّز)');
  ok(link.indexOf('/api/') === -1 && !/http(s)?:\/\/[^/]*mistekawe[^?]*\/api/.test(link),
    'لا يوجد أي نداء لمسار API قد يعطي 404 — فقط رابط wa.me الرسمي');
  ok(/navigator\.share/.test(waSrc) && /canShare/.test(waSrc), 'مسار مشاركة الصور عبر Web Share موجود كتحسين');
  ok(/waSent/.test(app), 'الواجهة تتذكر أن واتساب فُتح');
  ok(html.includes('id="whatsappSendBtn"') && html.includes('id="whatsappShareBtn"') && html.includes('id="waFallback"'),
    'شاشة النجاح تضم زر واتساب + مشاركة الصور + رابط بديل');
  ok(html.includes('id="manualModal"') && html.includes('id="manualWhatsappBtn"'), 'نافذة بديلة بدل رسالة 404');
  ok(!/رسالة توضيحية فقط؛ التواصل غير مفعّل/.test(html), 'أُزيلت عبارة «التواصل غير مفعّل»');
  ok(/missingServer = true/.test(app) && /openManualModal\(\)/.test(app), 'فشل الخادم ينقل لخيار الإرسال اليدوي بدل خطأ جاف');
}

console.log('\n7.2) دعماللغتين: العربية والإنجليزية (i18n)');
{
  ok(exists('js/i18n.js'), 'قاموس الترجمة js/i18n.js موجود');
  ok(html.includes('src="js/i18n.js"') && html.indexOf('src="js/i18n.js"') < html.indexOf('src="js/app.js"'),
    'i18n.js محمّل قبل app.js');
  ok(html.includes('id="langToggle"'), 'زر تبديل اللغة في الهيدر');
  const i18nSrc = read('js/i18n.js');
  const box = { document: { body: null }, addEventListener() {}, MutationObserver: null };
  box.window = box;
  vm.runInNewContext(i18nSrc, box, { filename: 'js/i18n.js' });
  const I = box.RaheeqI18n;
  ok(!!I && typeof I.t === 'function', 'واجهة الترجمة RaheeqI18n متاحة');
  ok(Object.keys(I.DICT).length > 150, 'القاموس يحوي أكثر من 150 نصًا (' + Object.keys(I.DICT).length + ')');
  ok(I.t('رحيق') === 'رحيق', 'العربية هي الافتراضي');
  const required = ['تسجيل ولي الأمر', 'اسم ولي الأمر', 'رقم الطلب', 'الصف الدراسي', 'شهادة الميلاد',
    'تم استلام طلبك بنجاح', 'تسجيل طالب آخر', 'مشاركة', 'حجم الخط', 'اللغة', 'واتساب', 'المستندات المطلوبة'];
  ok(required.filter(k => !I.DICT[k]).length <= 2, 'النصوص الأساسية مغطاة في القاموس');
}
ok(read('css/raheeq.css').includes('html[dir="ltr"]') && read('css/raheeq.css').includes('html[lang="en"]'),
  'تنسيقات LTR للإنجليزية موجودة في CSS');
ok(/RaheeqI18n\.t|function T\(/.test(app), 'app.js يترجم الرسائل الديناميكية');
ok(/refreshMessages/.test(read('js/validation.js')), 'رسائل التحقق تتبدّل مع اللغة');

console.log('\n7.3) شخصنة الألوان والخط: ثيمات جاهزة + لون حر + حجم الخط');
{
  ok(exists('js/settings.js'), 'وحدة الإعدادات js/settings.js موجودة');
  ok(html.indexOf('src="js/settings.js"') < html.indexOf('src="js/app.js"'), 'settings.js محمّل قبل app.js (تطبيق الثيم مبكرًا)');
  ok(html.includes('id="settingsPanel"') && html.includes('id="settingsBtn"'), 'لوحة الإعدادات وزرها موجودان');
  ok(html.includes('id="themeGrid"') && html.includes('id="customBrand"') && html.includes('id="customGold"') && html.includes('id="customCream"'),
    'الثيمات الجاهزة + ثلاثة منتقي ألوان حرّة');
  ok(html.includes('id="scaleRange"') && html.includes('id="scaleValue"'), 'منزلق حجم الخط موجود');
  const settingsSrc = read('js/settings.js');
  const store = new Map();
  const root = { style: { _v: {}, setProperty(k, v) { this._v[k] = v; }, getPropertyValue(k) { return this._v[k] || ''; } }, setAttribute(k, v) { this['attr_' + k] = v; } };
  const box = { document: { documentElement: root, body: { classList: { toggle() {} } }, querySelector: () => null, readyState: 'complete', addEventListener() {} },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = (o || {}).detail; } },
    dispatchEvent() {}, addEventListener() {} };
  box.window = box;
  vm.runInNewContext(settingsSrc, box, { filename: 'js/settings.js' });
  const S = box.RaheeqSettings;
  ok(!!S, 'واجهة الإعدادات RaheeqSettings متاحة');
  ok(S.THEMES.length >= 6, 'عدد الثيمات الجاهزة ' + S.THEMES.length);
  ok(S.THEMES[0].maroon === '#881234', 'ثيم رحيق الافتراضي أولًا');
  ok(root.style.getPropertyValue('--brand-maroon') === '#881234', 'الثيم الافتراضي مطبّق عند التحميل');
  S.setTheme('royal');
  ok(root.style.getPropertyValue('--brand-maroon') === '#1D3E8C', 'تغيير الثيم يغيّر متغيرات الهوية فورًا');
  ok(root.style.getPropertyValue('--brand-maroon-rgb') === '29,62,140', 'ألوان rgba تُشتق من الثيم (خلفيات شفافة)');
  S.setCustom({ maroon: '#0f5e6e' });
  ok(root.style.getPropertyValue('--brand-maroon') === '#0f5e6e', 'اللون الحر يتقدّم على الثيم');
  ok(/^#[0-9a-f]{6}$/.test(root.style.getPropertyValue('--brand-maroon-dark')) &&
     root.style.getPropertyValue('--brand-maroon-dark') !== '#0f5e6e', 'الدرجة الغامقة تُشتق تلقائيًا للون الحر');
  S.setScale(1.3);
  ok(root.style.getPropertyValue('--ui-scale') === '1.3' && root['attr_data-scale'] === '1.3', 'منزلق الحجم يضبط --ui-scale');
  S.setScale(9);
  ok(Number(root.style.getPropertyValue('--ui-scale')) === 1.35, 'الحجم محدود بحد أقصى 135%');
  S.setScale(0.1);
  ok(Number(root.style.getPropertyValue('--ui-scale')) === 0.9, 'الحجم محدود بحد أدنى 90%');
  S.reset();
  ok(root.style.getPropertyValue('--brand-maroon') === '#881234', 'استعادة الافتراضي تعمل');
  ok(JSON.parse(store.get('raheeq_settings')).theme === 'raheeq', 'الإعدادات تُحفظ في LocalStorage');
}
const cssAll = read('css/raheeq.css');
ok(/--brand-maroon:/.test(cssAll) && /--ui-scale/.test(cssAll), 'CSS مبني على متغيرات ثيم + مقياس خط');
ok(!/rgba\(136,18,52,\.?\d*\)?\s*[,;}]/.test(cssAll.replace(/\/\*[^*]*\*\//g, '')),
  'لا توجد ألوان ماروني مثبتة في الشفافيات (كلها من متغيرات الثيم)');
ok((cssAll.match(/var\(--ui-scale/g) || []).length > 60, 'كل مقاسات الخطوط تتغير مع منزلق الحجم');
ok(/--font-ui:var\(--font-body\)/.test(cssAll) && /#nationalId,#mobile,#whatsapp,#loginMobile\{font-family:var\(--font-nums\)/.test(cssAll),
  'خط Cairo موحّد لكل الواجهة (بدل 5 عائلات متفرقة)');
ok(/body\{font-weight:400\}/.test(cssAll), 'وزن نص مريح للقراءة (400) بدل 700/900');

console.log('\n7.4) خطأ 404 على النسخة الثابتة: لا رسالة مخيفة + توجيه للواتساب');
{
  const apiBox = { fetch: () => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Not Found') }),
    setTimeout, clearTimeout, Promise, JSON, Object, Date, Math, String, Error, AbortController: undefined };
  apiBox.window = apiBox;
  vm.runInNewContext(apiSrc, apiBox, { filename: 'js/api.js (404)' });
  const unit = apiBox.RaheeqApi;
  const available = await unit.probe();
  ok(available === false, 'فحص الصحة عند 404 يعتبر الخادم غير مفعّل (بلا استثناء)');
  const msg404 = unit.errorMessage({ status: 404, code: 'http', message: 'فشل الاتصال بالخادم (HTTP 404)' });
  ok(msg404.indexOf('404') === -1, 'رسالة الخطأ لا تعرض رقم 404 لولي الأمر: ' + msg404);
  ok(/واتساب/.test(msg404), 'الرسالة توجّه إلى واتساب أكاديمية رحيق');
  const msg405 = unit.errorMessage({ status: 405, code: 'http', message: 'x' });
  ok(msg405 === msg404, '405 يُعامل مثل 404 (نسخة ثابتة)');
  ok(/syncStatusUI\('info'/.test(app) && /staticHost/.test(app), 'الواجهة تعرض حالة معلومات هادئة بدل تحذير أحمر عند 404');
}
ok(read('css/raheeq.css').includes('.sync-status.is-info'), 'تنسيق حالة «معلومات» موجود');

console.log('\n7.5) لغة الموقع: أكاديمية رحيق بلا نصوص «تجريبية» أو «على جهازك» أو «مدرسة»');
{
  const uiFiles = ['index.html', 'js/app.js', 'js/i18n.js', 'js/api.js', 'js/whatsapp.js', 'js/settings.js'];
  const banned = [
    { re: /تجريب(ية|ي)?\s+(نسخة|على جهازك)?/g, why: 'صيغة «نسخة تجريبية»' },
    { re: /نسخة تجريبية/g, why: 'عبارة «نسخة تجريبية»' },
    { re: /لا تدخل بيانات حقيقية/g, why: 'تحذير «لا تدخل بيانات حقيقية»' },
    { re: /جهاز(ك|ًا)? مشترك/g, why: 'تحذير «جهاز مشترك»' },
    { re: /بيانات حساسة/g, why: 'عبارة «بيانات حساسة»' },
    { re: /محفوظ(ة|)? على (هذا ال)?جهاز/g, why: '«محفوظ على جهازك»' },
    { re: /على هذا الجهاز فقط|على جهازك فقط|على هذا الجهاز،/g, why: '«على هذا الجهاز فقط»' },
    { re: /غير مفعّل في النسخة التجريبية|التواصل غير مفعّل/g, why: '«التواصل غير مفعّل»' }
  ];
  uiFiles.forEach(f => {
    const text = f.endsWith('.html') ? read(f).replace(/<!--[\s\S]*?-->/g, '') : read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    banned.forEach(b => {
      const hits = text.match(b.re);
      ok(!hits, f + ': لا توجد ' + b.why + (hits ? ' (' + hits.length + ')' : ''));
    });
  });
  /* «مدرسة» ممنوعة في واجهة رحيق — المكان الصحيح «أكاديمية» */
  uiFiles.forEach(f => {
    const text = f.endsWith('.html') ? read(f).replace(/<!--[\s\S]*?-->/g, '') : read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    ok(!/مدرسة/.test(text), f + ': لا توجد كلمة «مدرسة» (المصطلح المعتمد: أكاديمية)');
  });
  ok(/أكاديمية رحيق على واتساب|واتساب أكاديمية رحيق/.test(html), 'النصوص تستخدم «أكاديمية رحيق» مع واتساب');
  ok(/الأكاديمية السابقة/.test(html), 'حقل «الأكاديمية السابقة» بدل «المدرسة السابقة»');
  /* نصوص بديلة إيجابية في نفس المواضع */
  ok(/سجّل بياناتك في دقائق/.test(html) && /متابعة القبول مع فريق أكاديمية رحيق/.test(html), 'نص تعريفي إيجابي بدل «نسخة تجريبية»');
  ok(/طلبك جاهز للإرسال/.test(html), 'نافذة الإرسال اليدوي بصياغة إيجابية');
  ok(/احتفظ برقم طلبك لمتابعة حالة التسجيل/.test(html), 'نص الختام يشجع على المتابعة بدل «محفوظ على جهازك»');
  ok(/صور مستنداتك محفوظة في حسابك/.test(app), 'معرض المستندات بلا ذكر «على جهازك فقط»');
}

console.log('\n8) واجهة الرفع (API): الخادم + ربط الواجهة + الرفع الفعلي');
const serverSrc = read('server/serve.py');
const apiSrcPy = read('server/api.py');
ok(exists('server/api.py'), 'وحدة الرفع server/api.py موجودة');
ok(serverSrc.includes('"/api/registrations"') && serverSrc.includes('save_registration'), 'الخادم يعرّف POST /api/registrations');
ok(serverSrc.includes('"/api/health"') && apiSrcPy.includes('def health'), 'مسار فحص /api/health موجود');
ok(serverSrc.includes('_admin_authorized') && serverSrc.includes('X-Admin-Token'), 'قراءة الطلبات محمية برمز إدارة');
ok(serverSrc.includes('BLOCKED_PREFIXES') && serverSrc.includes('"/data/"'), 'ملفات المستندات المحفوظة غير مكشوفة كملفات ثابتة');
ok(apiSrcPy.includes('def parse_data_url') && apiSrcPy.includes('def hash_password'), 'الخادم يتحقق من الصور ويشفّر كلمة السر');
ok(html.includes('src="js/api.js"') && html.indexOf('src="js/api.js"') < html.indexOf('src="js/app.js"'),
  'js/api.js محمّل قبل app.js');
ok(app.includes('window.RaheeqApi') && app.includes('API.submit(data)') && app.includes('function syncToServer'),
  'app.js يرفع الطلب فعليًا عبر الواجهة');
ok(html.includes('id="syncStatus"') && html.includes('id="retryUploadBtn"') && html.includes('id="syncHint"'),
  'واجهة توضّح حالة الرفع وتتيح إعادة المحاولة');
ok(app.includes("'/api/registrations'") === false && apiSrc.includes("'/api/registrations'"),
  'مسار الرفع معرّف في api.js');
ok(read('.gitignore').includes('data/'), 'مجلد data/ مستثنى من Git (بيانات شخصية)');

/* الرفع الفعلي داخل تدفق التسجيل: يرسل بايتات الصور ثم ينجح بعد إعادة المحاولة */
const fetchCalls = [];
function fakeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body))
  };
}
let failNextUpload = true;
sandbox2.fetch = (url, opts) => {
  fetchCalls.push({ url, opts });
  if (String(url).indexOf('/api/health') === 0) {
    return Promise.resolve(fakeResponse({ ok: true, service: 'raheeq-api', adminReadEnabled: false }));
  }
  if (String(url).indexOf('/api/registrations') === 0) {
    if (failNextUpload) {
      failNextUpload = false;
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    return Promise.resolve(fakeResponse({ ok: true, orderNumber: 'RHQ-7777', savedAt: '2026-05-01T10:00:00Z', files: {} }, 201));
  }
  return Promise.reject(new TypeError('unexpected url'));
};
vm.runInNewContext(apiSrc, sandbox2, { filename: 'js/api.js' });
vm.runInNewContext(app, sandbox2, { filename: 'js/app.js' });

const apiSandbox = { fetch: sandbox2.fetch, AbortController: undefined, setTimeout, clearTimeout, Promise, JSON, Object, Date, Math, String, Error };
apiSandbox.window = apiSandbox;
vm.runInNewContext(apiSrc, apiSandbox, { filename: 'js/api.js (unit)' });
const apiUnit = apiSandbox.RaheeqApi;
ok(!!apiUnit, 'محرك API يُسجّل نفسه على window.RaheeqApi');
const healthOk = await apiUnit.probe();
ok(healthOk === true, 'probe يكتشف الخادم من /api/health');

/* نفس التدفق السابق لكن مع الواجهة: */
const domApi = makeDomEnv();
const storeApi = new Map();
const sandboxApi = Object.assign({}, sandbox2, {
  document: domApi.document,
  localStorage: {
    getItem: k => (storeApi.has(k) ? storeApi.get(k) : null),
    setItem: (k, v) => { storeApi.set(k, String(v)); },
    removeItem: k => { storeApi.delete(k); }
  },
  navigator: { clipboard: null },
  matchMedia: () => ({ matches: false }),
  addEventListener() {},
  fetch: sandbox2.fetch
});
sandboxApi.window = sandboxApi;
sandboxApi.document.createElement = sandbox2.document.createElement;
vm.runInNewContext(validation, sandboxApi, { filename: 'js/validation.js' });
vm.runInNewContext(read('js/crypto.js'), sandboxApi, { filename: 'js/crypto.js' });
vm.runInNewContext(uploads, sandboxApi, { filename: 'js/uploads.js' });
vm.runInNewContext(apiSrc, sandboxApi, { filename: 'js/api.js' });
vm.runInNewContext(app, sandboxApi, { filename: 'js/app.js' });

const setA = (id, v) => { domApi.byId.get(id).value = v; };
Object.entries({ parentName: 'محمد أحمد علي حسن', nationalId: '12345678901234', relation: 'الأب',
  mobile: '01000000000', whatsapp: '01000000000', email: 'waly@raheeq.edu', password: 'secret1',
  confirmPassword: 'secret1', studentName: 'عمر محمد أحمد علي', dob: '2015-05-10', gender: 'ذكر',
  programType: 'منهج دراسي', grade: 'KG1', address: 'القاهرة مدينة نصر' }).forEach(([k, v]) => setA(k, v));
domApi.byId.get('agreeTerms').checked = true;
const apiDocBytes = bytesOf(2600, 17);
['birthCert', 'photo', 'parentCard'].forEach((key, i) => {
  domApi.boxes[key].input.files = [fakeFile(key + '.png', 'image/png', bytesOf(2000 + i * 300, 5 + i))];
  domApi.boxes[key].input.emit('change');
});
await new Promise(r => setTimeout(r, 80));
domApi.byId.get('regForm').emit('submit');
await new Promise(r => setTimeout(r, 150));

const uploadCall = fetchCalls.filter(c => String(c.url).indexOf('/api/registrations') === 0 && c.opts && c.opts.method === 'POST')[0];
ok(!!uploadCall, 'الواجهة ترسل POST إلى /api/registrations');
const sentPayload = uploadCall ? JSON.parse(uploadCall.opts.body) : {};
ok(sentPayload.docs && Object.keys(sentPayload.docs).length === 3, 'الحمولة تحوي المستندات الثلاثة');
ok(['birthCert', 'photo', 'parentCard'].every(k => String((sentPayload.docs[k] || {}).dataUrl || '').startsWith('data:image/jpeg;base64,')),
  'الحمولة تحوي بيانات الصور الفعلية (Data URL) لا أسماءها');
ok(sentPayload.mobile === '01000000000' && !!sentPayload.orderNumber, 'الحمولة تحوي بيانات الحساب ورقم الطلب');
ok(sentPayload.password === undefined, 'كلمة السر النصية لا تُرسل أبدًا للخادم');
ok(/^sha256\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(sentPayload.passwordHash || ''), 'الخادم يستقبل hash العميل (sha256$salt$hex) فقط');
ok(sentPayload.programType === 'منهج دراسي' && sentPayload.grade === 'KG1', 'الحمولة تحمل نوع البرنامج والسنة الدراسية');
const storedUser0 = JSON.parse(storeApi.get('raheeq_users'))[0];
ok(storedUser0 && storedUser0.password === undefined && !!storedUser0.passwordHash && !!storedUser0.passwordSalt, 'LocalStorage لا يخزن كلمة السر نصًا — hash فقط');
ok(storedUser0.programType === 'منهج دراسي' && storedUser0.grade === 'KG1' && Array.isArray(storedUser0.foundationSubjects), 'السجل المحلي يحفظ نوع البرنامج والقائمة المختارة');
ok(storeApi.get('raheeq_users') && JSON.parse(storeApi.get('raheeq_users')).length === 1, 'الحفظ المحلي يبقى يعمل كنسخة احتياطية');
ok(/is-warn/.test(domApi.byId.get('syncStatus').className) && /تعذّر|فشل|انتهت|خطأ/.test(domApi.byId.get('syncStatus').innerHTML),
  'فشل الاتصال يظهر كتحذير مع بقاء الطلب محفوظًا محليًا');
ok(domApi.byId.get('retryUploadBtn').hidden === false, 'زر إعادة المحاولة يظهر عند فشل الرفع');
domApi.byId.get('retryUploadBtn').emit('click');
await new Promise(r => setTimeout(r, 120));
ok(/is-ok/.test(domApi.byId.get('syncStatus').className) && domApi.byId.get('syncStatus').innerHTML.includes('RHQ-7777'),
  'إعادة المحاولة تنجح وتؤكد رقم الطلب القادم من الخادم');
const storedAfterSync = JSON.parse(storeApi.get('raheeq_users'))[0];
ok(storedAfterSync.server && storedAfterSync.server.orderNumber === 'RHQ-7777',
  'تأكيد الرفع يُسجّل في بيانات الحساب المحلية');


console.log('\n9) تدقيق أمني (Hacker pass): هروب HTML + رؤوس أمان + عدم تخزين كلمة السر نصًا');
{
  const cart = read('cart.html'), shop = read('shop.html'), product = read('product.html'), scriptSrc = read('script.js'), prodJs = read('products.js');
  ok(/const e = escHtml/.test(cart) && cart.includes('${e(item.name)}') && cart.includes('${e(item.id)}') && cart.includes('${e(formatPrice(item.price * item.qty))}'),
    'cart.html يهرب كل حقول السلة قبل innerHTML (لا XSS مخزّن من localStorage)');
  ok(scriptSrc.includes('function escHtml') && scriptSrc.includes('sanitizeCartItem'), 'script.js يعرّف escHtml ويطهّر عناصر السلة عند القراءة');
  ok(shop.includes('${escHtml(cat)}') && product.includes('${escHtml(product.name)}') && product.includes('${escHtml(product.desc)}') && prodJs.includes('e(p.name)'),
    'shop/product/products.js يهربون interpolations قبل innerHTML');
  ok(!/\$\{item\.(name|id|icon|category)\}/.test(cart), 'لا توجد أي قيمة سلة بدون هروب في cart.html');
  const studio = read('ai3d/app/studio.js');
  ok(studio.includes('data:image\\/(jpeg|png|webp|gif);base64') && !/src=\\?\"' \+ \(p\.thumb/.test(studio), 'ai3d studio لا يضع thumb عشوائيًا في src');
  ok(!/password: V\.val\('password'\)/.test(app) && app.includes('RaheeqCrypto') && app.includes('hashPassword'), 'app.js لا يخزن كلمة السر نصًا — hash فقط عبر RaheeqCrypto');
  ok(!/password: data\.password/.test(apiSrc) && apiSrc.includes('passwordHash'), 'js/api.js يرسل passwordHash فقط — لا كلمة سر نصية');
  ok(app.includes("delete data.password"), 'app.js يحذف كلمة السر من البيانات قبل الحفظ');
  ok(/hash_password\(secret/.test(apiSrcPy) && apiSrcPy.includes('CLIENT_HASH_RE'), 'api.py يقبل hash العميل أو النص القديم ويخزن PBKDF2 فقط');
  ok(serverSrc.includes('X-Content-Type-Options') && serverSrc.includes('X-Frame-Options') && serverSrc.includes('Referrer-Policy') && serverSrc.includes('Content-Security-Policy'), 'serve.py يرسل رؤوس أمان لكل استجابة');
  ok(serverSrc.includes('BLOCKED_PREFIXES') && serverSrc.includes('"/tests/"') && serverSrc.includes('"/api/_yaseen/"') && serverSrc.includes('startswith(".")'), 'serve.py يحجب /tests و /api/_yaseen و dotfiles كملفات ثابتة');
  const vercel = JSON.parse(read('vercel.json'));
  const globalHdr = (vercel.headers || []).find(h => h.source === '/(.*)');
  ok(!!globalHdr && globalHdr.headers.some(h => h.key === 'Content-Security-Policy') && globalHdr.headers.some(h => h.key === 'X-Frame-Options') && globalHdr.headers.some(h => h.key === 'X-Content-Type-Options'),
    'vercel.json يضيف CSP + X-Frame-Options + nosniff لكل المسارات');
  ok((vercel.redirects || []).some(r => r.source === '/.git/:path*'), 'vercel.json يعيد توجيه dotfiles إلى الجذر');
  ok(read('sw.js').includes('v11'), 'sw.js: ترقية نسخة الكاش بعد التعديلات');
}

console.log('\n10) المؤثرات الصوتية لعرض البداية + القائمتان الجديدتان');
{
  ok(exists('sounds/intro.wav') && exists('sounds/chime.wav'), 'ملفا صوتا العرض (intro.wav + chime.wav) موجودان');
  const introSrc = read('js/intro.js');
  ok(introSrc.includes("playSfx('intro'") && introSrc.includes("'chime'") && /scheduleSfx\(\)/.test(introSrc) && introSrc.includes('catchUpSfx'), 'js/intro.js يجدول المؤثرات الصوتية مع الانيميشن + تعويض عند أول تفاعل');
  ok(sounds.includes("file: 'sounds/intro.wav'") && sounds.includes("file: 'sounds/chime.wav'"), 'js/sounds.js يعرّف intro/chime للتحميل المسبق');
  ok(sounds.includes("name === 'intro'") && sounds.includes("name === 'chime'"), 'مولّد Web Audio احتياطي للصوتين');
  ok(validation.includes('PROGRAM_TYPES') && validation.includes('CURRICULUM_GRADES') && validation.includes('FOUNDATION_SUBJECTS') && validation.includes('checkedFoundationSubjects'), 'validation.js يعرّف القائمتين وقوائم مواد التأسيس والسنوات');
  ok(app.includes('syncProgramBranch') && app.includes('foundationBranch') && app.includes('curriculumBranch') && app.includes('programRows'), 'app.js يبدّل بين القائمتين ويعرض الصفوف الصحيحة');
  ok(read('js/whatsapp.js').includes('نوع البرنامج') && read('js/whatsapp.js').includes('السنة الدراسية'), 'رسالة واتساب تحمل نوع البرنامج والسنة/المواد');
}

if (failed) {
  console.error(`\n❌ فشل ${failed} اختبار في raheeq-tests.mjs`);
  process.exit(1);
}
console.log('\n✅ كل اختبارات موقع رحيق نجحت');
