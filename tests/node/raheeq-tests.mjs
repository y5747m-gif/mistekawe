/**
 * اختبارات صفحة رحيق (raheeq.html):
 * التحقق من صحة HTML/JS، أنميشن البداية، دمج اللون الأبيض، وسحب الصور الفعلية لإرسالها عبر واتساب.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = fs.readFileSync(path.join(ROOT, 'raheeq.html'), 'utf8');

let failed = 0;
function ok(cond, msg) {
  if (!cond) {
    failed++;
    console.error('  ✗ ' + msg);
  } else {
    console.log('  ✓ ' + msg);
  }
}

console.log('\n1) التحقق من بنية HTML وسكربت raheeq.html');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
ok(!!scriptMatch, 'تم استخراج السكربت الداخلي');
if (scriptMatch) {
  try {
    new vm.Script(scriptMatch[1], { filename: 'raheeq-inline.js' });
    ok(true, 'السكربت خالٍ من أخطاء الصياغة (Syntax)');
  } catch (err) {
    ok(false, 'خطأ صياغة في السكربت: ' + err.message);
  }
}

console.log('\n2) التحقق من أنميشن البداية (الشعار يطوف ثم ينفجر)');
ok(html.includes('id="introSplash"'), 'عنصر شاشة البداية موجود');
ok(html.includes('id="introCanvas"'), 'لوحة انفجار الجزيئات موجودة');
ok(html.includes('id="introSkip"'), 'زر تخطي المقدمة موجود');
ok(html.includes('@keyframes introFloat'), 'حركة الطفو introFloat موجودة');
ok(html.includes('is-exploding') && html.includes('spawnExplosionParticles'), 'منطق انفجار اللوجو موجود');
ok(html.includes('prefers-reduced-motion'), 'مراعاة تقليل الحركة مفعّلة');

console.log('\n3) التحقق من دمج اللون الأبيض وبساطة التصميم');
ok(/\.reg-card\s*\{[^}]*background:\s*var\(--white\)/.test(html), 'بطاقة التسجيل باللون الأبيض النقي');
ok(/\.features\s*\{[^}]*background:\s*var\(--white\)/.test(html), 'قسم المزايا منطقة بيضاء مميزة');
ok(/\.raheeq-logo\s*\{[^}]*background:\s*var\(--white\)/.test(html), 'حاوية اللوجو باللون الأبيض النقي');

console.log('\n4) التحقق من سحب الصور الفعلية وإرسالها عبر واتساب');
const uploadBoxes = ['birthCert', 'photo', 'parentCard', 'reportCard'];
for (const key of uploadBoxes) {
  const boxRe = new RegExp(`data-upload="${key}"[\\s\\S]*?<img class="thumb"[\\s\\S]*?<span class="file-name"></span>`);
  ok(boxRe.test(html), `مربع رفع ${key} يحتوي معاينة صورة فعلية واسم ملف`);
}
ok(html.includes('readActualFile') && html.includes('FileReader'), 'قراءة الملف الفعلي عبر FileReader + Canvas');
ok(html.includes('buildDocumentsSheetBlob'), 'بناء بطاقة الصور المجمّعة الفعلية (PNG)');
ok(html.includes('navigator.share') && html.includes('files: shareFiles'), 'مشاركة ملفات الصور الفعلية عبر واتساب');
ok(html.includes('ClipboardItem') && html.includes('copySheetToClipboard'), 'نسخ الصور الفعلية للحافظة لواتساب ويب');
ok(html.includes('id="attachedPhotosGrid"'), 'عرض مصغرات الصور المسحوبة في شاشة النجاح');
ok(html.includes('201151947735'), 'رقم واتساب الأكاديمية الصحيح محفوظ');

console.log('\n5) اختبار دوال منطق رحيق في بيئة DOM وهمية');
function makeMockEl(id) {
  return {
    id, value: '', hidden: false, checked: false, href: '#', textContent: '', innerHTML: '',
    style: {}, dataset: {}, className: '',
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, f) { f === undefined ? (this._set.has(c) ? this._set.delete(c) : this._set.add(c)) : (f ? this._set.add(c) : this._set.delete(c)); },
      contains(c) { return this._set.has(c); }
    },
    setAttribute() {}, getAttribute() { return ''; },
    addEventListener() {}, removeEventListener() {},
    scrollIntoView() {}, focus() {}, click() {},
    closest() { return null; },
    querySelector() { return makeMockEl('q'); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 300, top: 200, width: 150, height: 150 }; },
    getContext() {
      return {
        setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, stroke() {},
        fill() {}, save() {}, restore() {}, translate() {}, rotate() {}, drawImage() {},
        fillText() {}, roundRect() {}, rect() {}
      };
    },
    toDataURL() { return 'data:image/jpeg;base64,MOCK'; },
    toBlob(cb) { cb(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })); }
  };
}
const mockDoc = {
  body: makeMockEl('body'),
  getElementById(id) { return makeMockEl(id); },
  querySelector() { return makeMockEl('q'); },
  querySelectorAll() { return []; },
  addEventListener() {},
  createElement() { return makeMockEl('el'); }
};
const sandbox = {
  window: {
    innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1,
    matchMedia: () => ({ matches: true }),
    AudioContext: null, webkitAudioContext: null
  },
  document: mockDoc,
  localStorage: { _m: {}, getItem(k) { return this._m[k] || null; }, setItem(k, v) { this._m[k] = String(v); } },
  navigator: { vibrate() {} },
  Audio: function() { return { load() {} }; },
  Blob, File,
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
  setTimeout: () => 0, clearTimeout() {},
  requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  Date, Math, JSON, Object, Array, String, Number, Promise, RegExp, Error, parseInt, encodeURIComponent
};
sandbox.window.window = sandbox.window;
let ranCleanly = true;
try {
  vm.runInNewContext(scriptMatch[1], sandbox);
} catch (err) {
  ranCleanly = false;
  console.error('  ✗ خطأ تشغيل في بيئة Node:', err);
}
ok(ranCleanly, 'تنفيذ سكربت raheeq.html في بيئة المعزولة بدون أخطاء');

if (failed) {
  console.error(`\n❌ فشل ${failed} اختبار في raheeq-tests.mjs`);
  process.exit(1);
}
console.log('\n✅ كل اختبارات raheeq.html نجحت');
