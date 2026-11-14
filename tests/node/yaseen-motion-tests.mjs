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

const motion = read('js/yaseen-motion.js'), scene = read('js/yaseen-3d.js'), css = read('css/yaseen-motion.css');
for (const code of [motion, read('js/yaseen.js'), read('admin-yaseen/admin.js')]) {
  try { new vm.Script(code); ok(true, 'صياغة JavaScript سليمة'); } catch (e) { ok(false, e.message); }
}
for (const name of ['idle', 'walk', 'run', 'jump', 'wave', 'dance', 'spin', 'thinking', 'point', 'celebrate', 'stretch', 'float']) {
  ok(motion.includes("['" + name + "'") && scene.includes("'" + name + "'"), 'حركة متاحة في اللوحة والمجسم: ' + name);
}
ok(motion.includes('prefers-reduced-motion: reduce') && css.includes('prefers-reduced-motion:reduce'), 'احترام تقليل الحركة');
ok(motion.includes('yaseen_motion_paused') && motion.includes('setPointerCapture'), 'إيقاف الحركة والسحب متاحان');
ok(motion.includes("import('./yaseen-3d.js')") && scene.includes("./vendor/three.module.min.js"), 'المحرك محلي بلا CDN أو API خارجي');
ok(fs.existsSync(path.join(ROOT, 'js/vendor/THREE-LICENSE.txt')), 'ترخيص المحرك مضمّن');
ok(motion.includes('webglcontextlost') === false && scene.includes('webglcontextlost'), 'فقدان WebGL يعيد الشخصية الأصلية');
ok(read('js/yaseen.js').includes('motion.destroy()'), 'إيقاف المدير يزيل طبقة الحركة أيضًا');
ok(read('js/yaseen.js').includes("frames[name] = img"), 'الصور الأصلية تبقى بديلًا');
const pub = system.publicConfig(system.defaultConfig(), new Date());
ok(JSON.stringify(readBase().animations) === JSON.stringify(pub.animations), 'إعدادات الحركة المحلية تطابق الخادم');
const validated = system.validateConfig({ animations: { run: false, roam: false, threeD: false } });
ok(validated.animations.run === false && validated.animations.roam === false && validated.animations.threeD === false, 'مفاتيح المدير للحركات الجديدة محفوظة');
ok(validated.animations.walk === true && validated.animations.idle === true, 'الإعدادات القديمة تحصل على قيم آمنة');
ok(read('sw.js').includes('v10-raheeq-motion'), 'نسخة الكاش محدثة');
console.log('\nRaheeq channels + motion tests: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
