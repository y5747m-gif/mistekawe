/* حراسة روابط القنوات وطبقة الحركة: لا تعتمد على متصفح أو شبكة. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readBase } from './dom-lite.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const system = require(path.join(ROOT, 'api/_yaseen/yaseen-system.js'));
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let passed = 0, failed = 0;
function ok(value, name) { if (value) passed++; else { failed++; console.error('  ✗ ' + name); } }

/* ---------- قنوات الأكاديمية في الفوتر ---------- */
const html = read('index.html');
const channels = html.slice(html.indexOf('id="raheeqChannels"'), html.indexOf('</section>', html.indexOf('id="raheeqChannels"')));
const expected = {
  youtube: 'https://youtube.com/@raheeq.foundati?si=yvSJSrTjSsgAFn7k',
  facebook: 'https://www.facebook.com/share/1D5b2pqYVv/',
  instagram: 'https://www.instagram.com/ltrykh.nbd',
  tiktok: 'https://www.tiktok.com/@shahdadeel..952008'
};
for (const [id, url] of Object.entries(expected)) {
  ok(channels.includes('social-' + id) && channels.includes('href="' + url + '"'), 'الرابط الأصلي محفوظ: ' + id);
  ok(read('script.js').includes(url), 'مصدر الروابط المشترك لم يتغير: ' + id);
}
ok((channels.match(/target="_blank" rel="noopener noreferrer"/g) || []).length === 5, 'روابط القنوات وواتساب آمنة وتفتح في تبويب جديد');
ok(channels.includes('https://wa.me/201151947735'), 'واتساب الأكاديمية محفوظ أيضًا');
ok(html.includes('href="#raheeqChannels"'), 'رابط قنواتنا في الهيدر');
ok(html.includes('id="regForm"') && html.includes('id="settingsPanel"') && html.includes('js/app.js'), 'التسجيل والإعدادات الحديثة لم تُزل');

/* ---------- طبقة الحركة: الشكل القديم (صور ثنائية الأبعاد) + حركات كثيرة ---------- */
const motion = read('js/yaseen-motion.js'), css = read('css/yaseen-motion.css');
for (const code of [motion, read('js/yaseen.js'), read('admin-yaseen/admin.js')]) {
  try { new vm.Script(code); ok(true, 'صياغة JavaScript سليمة'); } catch (e) { ok(false, e.message); }
}
ok(!fs.existsSync(path.join(ROOT, 'js/yaseen-3d.js')) && !motion.includes('yaseen-3d') && !motion.includes('three.module'),
  'الشكل القديم رجع: لا مجسم WebGL ولا ثلاثي الأبعاد');
ok(read('js/yaseen.js').includes('frames[name] = img'), 'الصور الأصلية هي الشخصية نفسها');
ok(html.includes('js/yaseen-motion.js') && !html.includes('yaseen-3d'), 'الصفحة تحمّل طبقة الحركة فقط');

for (const name of ['idle', 'walk', 'run', 'jump', 'dance', 'spin', 'flip', 'bounce', 'swing', 'stretch', 'float', 'dizzy', 'nod', 'shake', 'wave', 'point', 'thinking', 'worried', 'celebrate']) {
  ok(motion.includes("['" + name + "'"), 'الحركة موجودة في لوحة الحركات: ' + name);
}
for (const cls of ['m-jump', 'm-dance', 'm-spin', 'm-flip', 'm-bounce', 'm-swing', 'm-stretch', 'm-float', 'm-dizzy', 'm-nod', 'm-shake', 'm-hop', 'm-lean', 'm-shiver', 'm-drag', 'is-walking', 'is-running']) {
  ok(css.includes('.' + cls), 'كلاس الحركة مُنسّق في CSS: ' + cls);
}
ok(motion.includes('AUTO_POOL') && motion.includes('AUTO_EVERY_MS'), 'العجلة التلقائية للحركات الكثيرة موجودة');
ok(motion.includes('yaseen_motion_paused') && motion.includes('setPointerCapture'), 'إيقاف الحركة والسحب متاحان');
ok(motion.includes('prefers-reduced-motion: reduce') && css.includes('prefers-reduced-motion'), 'احترام تقليل الحركة');
ok(read('js/yaseen.js').includes('motion.destroy()'), 'إيقاف المدير يزيل طبقة الحركة أيضًا');

/* ---------- تطابق إعدادات الحركات محليًا وعلى الخادم ---------- */
const pub = system.publicConfig(system.defaultConfig(), new Date());
ok(JSON.stringify(readBase().animations) === JSON.stringify(pub.animations), 'إعدادات الحركة المحلية تطابق الخادم');
const validated = system.validateConfig({ animations: { run: false, roam: false, dizzy: false, threeD: false } });
ok(validated.animations.run === false && validated.animations.roam === false && validated.animations.dizzy === false, 'مفاتيح المدير للحركات الكثيرة محفوظة');
ok(validated.animations.walk === true && validated.animations.idle === true && validated.animations.flip === true, 'الإعدادات الأخرى تحصل على قيم آمنة');
ok(!('threeD' in validated.animations), 'مفتاح ثلاثي الأبعاد سقط من مخطط التحقق');
ok(read('sw.js').includes('v11-raheeq-sprite-motion') && !read('sw.js').includes('yaseen-3d'), 'نسخة الكاش محدثة وبلا ملفات المجسم');

/* ---------- الاتصال والواتساب على اليمين ورحيق على الشمال ---------- */
const bar = read('css/contact-bar.css');
ok(/\.floating-contact-bar\s*\{[^}]*right:\s*24px/.test(bar) && !/\.floating-contact-bar\s*\{[^}]*left:\s*24px/.test(bar),
  'شريط الاتصال والواتساب على يمين الشاشة');
ok(/\.ysn\{[^}]*position:fixed;left:14px;bottom:14px/.test(read('css/yaseen.css').replace(/\n/g, '')),
  'رحيق (البوت) في الجهة الشمال');
for (const page of fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))) {
  const src = fs.readFileSync(path.join(ROOT, page), 'utf8');
  if (src.indexOf('floating-contact-bar') < 0) continue;
  ok(src.includes('cdns') === false && src.includes('floating-btn--wa') && src.includes('floating-btn--call'),
    'زرّا الاتصال والواتساب موجودان في ' + page);
  ok(!/id="nationalId"|data-file-input="parentCard"|الرقم القومي 14/.test(src),
    'بلا خانة رقم قومي أو بطاقة ولي الأمر في ' + page);
}

/* ---------- حرية الحركة إلى أي مكان + تتبع الخطأ ---------- */
ok(motion.includes('minX: 8 - left') && motion.includes('innerHeight - 4 - homeTop - h') && !motion.includes('minY: 8 - (innerHeight - bottom - h), maxY: 0'),
  'حدود الحركة تخص الشاشة كلها لا صفًا سفليًا فقط');
ok(motion.includes('moveTo: function') && motion.includes('follow: function') && motion.includes('bringBack: function'),
  'واجهة التنقل الحر متاحة لطبقة البوت');
ok(read('js/yaseen.js').includes('motion.follow(pointing.el)') && read('js/yaseen.js').includes('motion.bringBack'),
  'رحيق تقفز إلى مكان الخطأ في أي موضع ثم تعود لمكانها');
ok(motion.includes("pointerType === 'mouse'") && motion.includes('lostpointercapture'),
  'سحب رحيق بالماوس واللمس يستمر خارج حدود الشخصية');
ok(!motion.includes('innerWidth < 640) pool = pool.filter'), 'المشي والركض متاحان على الجوال أيضًا');
ok(!/@keyframes ysn-enter\{[^}]*translate/.test(read('css/yaseen.css')) &&
   !/@keyframes ysn-enter\{[^}]*transform/.test(read('css/yaseen.css')),
  'انيميشن الدخول لا يلغي حركة رحيق الحرة (translate/transform)');
ok(read('css/yaseen.css').includes('touch-action:none'), 'سحب رحيق يعمل باللمس على الجوال');
ok(!motion.includes('&& !held && !reduced && !document.hidden') || motion.includes('function mayTravel()'),
  'الانتقال إلى الخطأ لا يُوقفه قفل الإشارة');

console.log('\nRaheeq channels + motion tests: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
