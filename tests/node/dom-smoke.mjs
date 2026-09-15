/* اختبار دخان للواجهة داخل DOM وهمي (يتطلب: npm i --no-save jsdom)
 * التشغيل: node tests/node/dom-smoke.mjs
 * الغرض: التأكد أن الواجهة تُهيَّأ وأن المسار من الرفع إلى النتيجة يعمل دون أخطاء.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let JSDOM = null, VirtualConsole = null;
try {
  ({ JSDOM, VirtualConsole } = await import('jsdom'));
} catch (e) {
  console.log('⚠️  jsdom غير مثبّت — تخطّي اختبار الواجهة (npm i --no-save jsdom لتشغيله)');
  process.exit(0);
}

const html = fs.readFileSync(path.join(ROOT, 'studio.html'), 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
const dom = new JSDOM(html, { url:'http://localhost:8000/studio.html', runScripts:'outside-only', pretendToBeVisual:true, virtualConsole:vc });
const w = dom.window;

/* ---- Canvas2D stub ---- */
function makeCtx(canvas){
  let buf = new Uint8ClampedArray(Math.max(1, canvas.width*canvas.height*4));
  const noop=()=>{}; const grad={addColorStop:noop};
  return { canvas, fillStyle:'#000', strokeStyle:'#000', lineWidth:1, font:'', textAlign:'', globalAlpha:1,
    getImageData:()=>({data:new Uint8ClampedArray(buf),width:canvas.width,height:canvas.height}),
    putImageData:im=>{buf=new Uint8ClampedArray(im.data);},
    createImageData:(a,b)=>({data:new Uint8ClampedArray(a*b*4),width:a,height:b}),
    drawImage:noop, fillRect:noop, strokeRect:noop, clearRect:noop, fillText:noop, beginPath:noop, moveTo:noop,
    lineTo:noop, quadraticCurveTo:noop, closePath:noop, fill:noop, stroke:noop, arc:noop, ellipse:noop,
    save:noop, restore:noop, translate:noop, scale:noop, rotate:noop,
    createLinearGradient:()=>grad, createRadialGradient:()=>grad, measureText:()=>({width:10}) };
}
w.HTMLCanvasElement.prototype.getContext = function(type){
  if(type==='2d'){ return this.__ctx || (this.__ctx = makeCtx(this)); }
  if(type==='webgl'||type==='webgl2'){
    if(!this.__gl){
      const cache = {};
      this.__gl = new Proxy({}, { get(_, prop){
        if(typeof prop !== 'string') return undefined;
        if(/^[A-Z0-9_]+$/.test(prop)) return (cache[prop] = cache[prop] || (Object.keys(cache).length + 1));
        return function(){
          if(prop==='getAttribLocation') return 0;
          if(prop==='getUniformLocation') return {};
          if(/^create/.test(prop)) return {};
          if(/Parameter$/.test(prop)) return true;
          if(prop==='getExtension') return {};
          if(prop==='getShaderInfoLog'||prop==='getProgramInfoLog') return '';
          return undefined;
        };
      }});
    }
    return this.__gl;
  }
  return null;
};
w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAA';
w.HTMLCanvasElement.prototype.toBlob = function(cb){ cb(new w.Blob([new Uint8Array([1])])); };
w.createImageBitmap = async () => ({ width: 384, height: 288, close(){} });
w.Element.prototype.scrollIntoView = function(){};
w.confirm = () => true;   // jsdom لا يطبّق نوافذ الحوار
w.URL.createObjectURL = () => 'blob:mock';
w.URL.revokeObjectURL = () => {};
let downloads = 0;
const origCreate = w.document.createElement.bind(w.document);
w.document.createElement = function(tag){
  const el = origCreate(tag);
  if(tag === 'a'){ el.click = function(){ downloads++; }; }
  return el;
};
w.requestAnimationFrame = cb => setTimeout(()=>cb(Date.now()), 0);
w.cancelAnimationFrame = id => clearTimeout(id);
if(!w.performance) w.performance = { now: ()=>Date.now() };

const files = ['ai3d/engine/core.js','ai3d/engine/analysis.js','ai3d/engine/detection.js','ai3d/engine/segmentation.js',
  'ai3d/engine/depth.js','ai3d/engine/geometry.js','ai3d/engine/texture.js','ai3d/engine/exporters.js',
  'ai3d/engine/pipeline.js','ai3d/engine/backends.js','ai3d/app/viewer.js','ai3d/app/studio.js'];
for (const f of files) w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
w.document.dispatchEvent(new w.Event('DOMContentLoaded',{bubbles:true}));
await new Promise(r=>setTimeout(r,300));

/* صورة مُصنّعة نضعها في getImageData لتمريرها كأنها مرفوعة */
const harness = await import(path.join(ROOT, 'tests/node/harness.mjs'));
const img = harness.makeTestImage(384,288,'sphere');
const ctx2d = w.document.createElement('canvas');
ctx2d.width = 384; ctx2d.height = 288;
const c = ctx2d.getContext('2d');
c.putImageData({ data: img.data, width: 384, height: 288 });
// تجاوز loadImageFile: نبني الإطار يدويًا ونستدعي الدوال الداخلية عبر حدث الرفع
const AI3D = w.AI3D;
AI3D.util.loadImageFile = async () => ({ canvas: ctx2d, width: 384, height: 288, name: 'test.png' });

const input = w.document.getElementById('fileInput');
const file = new w.File([new Uint8Array([1,2,3])], 'test.png', { type:'image/png' });
Object.defineProperty(input, 'files', { value: [file], writable: true });
input.dispatchEvent(new w.Event('change'));
await new Promise(r=>setTimeout(r,1200));

console.log('objects detected:', w.document.querySelectorAll('#objList .objchip').length);
console.log('analysis kv entries:', w.document.querySelectorAll('#kvBox dt').length);
console.log('palette swatches:', w.document.querySelectorAll('#paletteBox .swatch').length);
console.log('fit lines:', w.document.querySelectorAll('#fitBox .fitline').length);

/* تشغيل المسار الكامل */
w.document.getElementById('startBtn').click();
await new Promise(r=>setTimeout(r,12000));
const res = w.document.getElementById('resultSec');
console.log('result visible:', !res.classList.contains('hidden'));
console.log('scores cards:', w.document.querySelectorAll('#scores .score').length);
console.log('info entries:', w.document.querySelectorAll('#infoBox dt').length);
console.log('stages done:', w.document.querySelectorAll('#stages .stage.done').length);
const errBox = w.document.getElementById('errBox');
console.log('error box:', errBox.classList.contains('hidden') ? '(none)' : errBox.textContent);
/* أدوات الشبكة + التصدير */
const click = id => { const el = w.document.getElementById(id); if(el) el.click(); };
for (const id of ['centerBtn','normalsBtn','smoothBtn','repairBtn','decimateBtn','delIsoBtn','delEstBtn','rotBtn','gridBtn','estBtn','shotBtn','cmpRefresh','expTex','expCloud','expMaps']) {
  click(id);
  await new Promise(r=>setTimeout(r,120));
}
click('expMain');
await new Promise(r=>setTimeout(r,3000));
console.log('downloads triggered:', downloads);
console.log('info entries after tools:', w.document.querySelectorAll('#infoBox dt').length);
console.log(errors.length ? '❌ أخطاء:\n'+errors.join('\n') : '✅ لا أخطاء — المسار الكامل + الأدوات + التصدير تعمل');
