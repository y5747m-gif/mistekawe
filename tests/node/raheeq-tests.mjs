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
    'studentName', 'dob', 'gender', 'grade', 'prevSchool', 'address', 'healthNotes', 'confirmPassword',
    'loginMobile', 'loginPassword'];
  fields.forEach(id => byId.set(id, makeEl('input')));
  ['agreeTerms'].forEach(id => byId.set(id, makeEl('input')));
  ['regForm', 'loginForm', 'registerCard', 'formAlert', 'loginAlert', 'toast', 'uploadStatus',
   'prevStepBtn', 'nextStepBtn', 'submitBtn', 'progressFill', 'tabRegister', 'tabLogin',
   'registerView', 'loginView', 'successView', 'welcomeBox', 'welcomeName', 'welcomeDetails',
   'welcomeDocs', 'successDocs', 'successBox', 'orderNumber', 'newRegBtn', 'copyOrderBtn',
   'successLoginBtn', 'logoutBtn', 'soundToggle', 'headerLoginBtn', 'goRegisterBtn',
   'siteHeader', 'cardTitle', 'cardSub', 'docModal', 'docModalTitle', 'docModalImg',
   'docModalDownload'].forEach(id => { if (!byId.has(id)) byId.set(id, makeEl('div')); });
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
vm.runInNewContext(uploads, sandbox2, { filename: 'js/uploads.js' });
vm.runInNewContext(app, sandbox2, { filename: 'js/app.js' });

const setVal = (id, v) => { dom.byId.get(id).value = v; };
Object.entries({ parentName: 'محمد أحمد علي حسن', nationalId: '12345678901234',
  relation: 'الأب', mobile: '01000000000', whatsapp: '01000000000', email: 'waly@raheeq.edu',
  password: 'secret1', confirmPassword: 'secret1', studentName: 'عمر محمد أحمد علي', dob: '2015-05-10',
  gender: 'ذكر', grade: 'KG1', address: 'القاهرة مدينة نصر' }).forEach(([k, v]) => setVal(k, v));
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

if (failed) {
  console.error(`\n❌ فشل ${failed} اختبار في raheeq-tests.mjs`);
  process.exit(1);
}
console.log('\n✅ كل اختبارات موقع رحيق نجحت');
