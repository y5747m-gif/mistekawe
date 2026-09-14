/* ============================================================
 * harness.mjs — تحميل محرك AI3D داخل Node (بدون DOM) للاختبار
 * يُستخدم للتحقق من صحة المراحل الحسابية على صور مُصنّعة.
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ENGINE_DIR = path.resolve(__dirname, '../../ai3d/engine');

const FILES = ['core.js', 'analysis.js', 'detection.js', 'segmentation.js', 'depth.js', 'geometry.js', 'texture.js', 'exporters.js', 'pipeline.js'];

export function loadEngine() {
  for (const f of FILES) {
    const code = fs.readFileSync(path.join(ENGINE_DIR, f), 'utf8');
    vm.runInThisContext(code, { filename: f });
  }
  return globalThis.AI3D;
}

/* صورة مُصنّعة: كرة مظللة + خلفية متدرجة + مستطيل ملصق */
export function makeTestImage(w = 512, h = 384, kind = 'sphere') {
  const img = { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = (y * w + x) * 4;
    img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b; img.data[p + 3] = 255;
  };
  // خلفية
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = y / h;
    const n = (Math.sin(x * 0.21) + Math.cos(y * 0.17)) * 3;
    put(x, y, 40 + 60 * t + n, 48 + 70 * t + n, 62 + 90 * t + n);
  }
  if (kind === 'sphere') {
    const cx = w * 0.5, cy = h * 0.48, R = Math.min(w, h) * 0.3;
    const Lx = -0.55, Ly = -0.62, Lz = 0.56;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (x - cx) / R, dy = (y - cy) / R;
      const r2 = dx * dx + dy * dy;
      if (r2 > 1) continue;
      const nz = Math.sqrt(1 - r2);
      const ndl = Math.max(0, dx * Lx + dy * Ly + nz * Lz);
      const spec = Math.pow(Math.max(0, nz * 0.9 + dx * -Lx * 0.2), 48) * 0.9;
      const base = [188, 120, 70];
      const shade = 0.25 + 0.85 * ndl + spec;
      put(x, y,
        Math.min(255, base[0] * shade),
        Math.min(255, base[1] * shade),
        Math.min(255, base[2] * shade));
      // نسيج خفيف لتمكين إشارة النسيج
      if (Math.sin(x * 0.7) * Math.cos(y * 0.7) > 0.86) {
        const p = (y * w + x) * 4;
        img.data[p] = Math.max(0, img.data[p] - 26);
      }
    }
  } else if (kind === 'box') {
    // صندوق منظوري بسيط (منتج)
    const x0 = w * 0.3, x1 = w * 0.7, y0 = h * 0.32, y1 = h * 0.78;
    for (let y = Math.floor(y0); y < y1; y++) for (let x = Math.floor(x0); x < x1; x++) {
      const u = (x - x0) / (x1 - x0), v = (y - y0) / (y1 - y0);
      let shade = 0.55 + 0.5 * (1 - u) * (1 - v * 0.4);
      const edge = (u < 0.05 || u > 0.95 || v < 0.05 || v > 0.95);
      if (edge) shade *= 0.72;
      put(x, y, Math.round(210 * shade), Math.round(70 * shade), Math.round(70 * shade));
    }
    // ملصق أبيض
    for (let y = Math.floor(h * 0.48); y < Math.floor(h * 0.62); y++)
      for (let x = Math.floor(w * 0.36); x < Math.floor(w * 0.64); x++) put(x, y, 235, 235, 240);
    // ظل أرضي
    for (let y = Math.floor(y1); y < Math.min(h, y1 + 14); y++)
      for (let x = Math.floor(x0); x < Math.floor(x1); x++) {
        const p = (y * w + x) * 4;
        img.data[p] *= 0.5; img.data[p + 1] *= 0.5; img.data[p + 2] *= 0.5;
      }
  }
  return img;
}

export function ok(cond, msg) {
  if (!cond) throw new Error('✗ ' + msg);
  console.log('  ✓ ' + msg);
}
export function section(name) { console.log('\n— ' + name); }
