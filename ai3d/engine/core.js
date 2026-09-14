/* ============================================================
 * MISTEKAWE / AI-3D Engine — core.js  (v2)
 * النواة: أدوات رياضية + حقول صورية + أدوات لون + تسمية المناطق
 *        + سجل النماذج القابلة للاستبدال (AI3D.Models)
 * كل المعالجة محلية 100% — لا يوجد أي نداء لخدمة AI خارجية.
 * الوحدات هنا خالية من DOM قدر الإمكان كي يمكن اختبارها في Node.
 * ============================================================ */
(function (global) {
  'use strict';

  const AI3D = global.AI3D || (global.AI3D = {});
  AI3D.version = '2.0.0';

  /* ---------- سجل النماذج: أي مرحلة قابلة للاستبدال ----------
   * المراحل: analysis • detection • segmentation • depth •
   *          intrinsics • reconstruction • texture • material
   * الاستبدال: AI3D.Models.register('depth', fn) — دون لمس الواجهة.
   */
  const _models = Object.create(null);
  AI3D.Models = {
    register(name, fn, meta) { _models[name] = { fn, meta: meta || {} }; },
    unregister(name) { delete _models[name]; },
    get(name) { return _models[name] ? _models[name].fn : null; },
    has(name) { return !!_models[name]; },
    meta(name) { return _models[name] ? _models[name].meta : null; },
    list() { return Object.keys(_models); }
  };

  /* ---------- أدوات عامة ---------- */
  const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const clamp01 = v => (v < 0 ? 0 : (v > 1 ? 1 : v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const now = () => (global.performance && global.performance.now ? global.performance.now() : Date.now());
  const tick = ms => new Promise(r => setTimeout(r, ms || 0));
  const uid = p => (p || 'id') + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);

  function fmtBytes(n) {
    if (!isFinite(n)) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }
  function fmtTime(ms) { return ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + ' s'; }
  function fmtNum(n) { return Math.round(n).toLocaleString('en-US'); }

  /* كائن صورة بسيط {data:Uint8ClampedArray(RGBA), width, height} */
  function imageLike(w, h, fill) {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h, _fill: fill || 0 };
  }
  function cloneImage(img) {
    return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
  }
  function resizeImage(img, w, h) {
    const dst = imageLike(w, h);
    resampleRGBAInto(img.data, img.width, img.height, dst.data, w, h);
    return dst;
  }
  function resampleRGBAInto(src, sw, sh, dst, dw, dh) {
    for (let y = 0; y < dh; y++) {
      const sy = clamp01((y + 0.5) / dh) * (sh - 1);
      const y0 = Math.floor(sy), y1 = Math.min(sh - 1, y0 + 1), fy = sy - y0;
      for (let x = 0; x < dw; x++) {
        const sx = clamp01((x + 0.5) / dw) * (sw - 1);
        const x0 = Math.floor(sx), x1 = Math.min(sw - 1, x0 + 1), fx = sx - x0;
        const p00 = (y0 * sw + x0) * 4, p10 = (y0 * sw + x1) * 4;
        const p01 = (y1 * sw + x0) * 4, p11 = (y1 * sw + x1) * 4;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        const o = (y * dw + x) * 4;
        for (let c = 0; c < 4; c++) {
          dst[o + c] = src[p00 + c] * w00 + src[p10 + c] * w10 + src[p01 + c] * w01 + src[p11 + c] * w11;
        }
      }
    }
    return dst;
  }

  /* DOM helpers (تُستخدم من الواجهة فقط — لا تُستدعى داخل المحرك) */
  function makeCanvas(w, h) {
    const c = global.document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    return c;
  }
  function getImageData(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }
  function toCanvas(img) {
    const c = makeCanvas(img.width, img.height);
    const ctx = c.getContext('2d');
    const im = ctx.createImageData(img.width, img.height);
    im.data.set(img.data);
    ctx.putImageData(im, 0, 0);
    return c;
  }
  async function loadImageFile(file, maxSide) {
    const bmp = await global.createImageBitmap(file, { imageOrientation: 'from-image' });
    let w = bmp.width, h = bmp.height;
    const m = maxSide || 1600;
    const s = Math.min(1, m / Math.max(w, h));
    w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
    const c = makeCanvas(w, h);
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    try { bmp.close(); } catch (e) { /* ignore */ }
    return { canvas: c, width: w, height: h, name: file.name || 'image' };
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = global.document.createElement('a');
    a.href = url; a.download = filename;
    global.document.body.appendChild(a); a.click();
    setTimeout(() => { global.document.body.removeChild(a); URL.revokeObjectURL(url); }, 800);
  }

  /* ---------- حقول أحادية القناة ---------- */
  function luminanceField(img, w, h) {
    const d = img.data, out = new Float32Array(w * h);
    for (let i = 0, p = 0; i < out.length; i++, p += 4) {
      out[i] = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255;
    }
    return out;
  }
  function boxBlur(src, w, h, radius, iters) {
    let a = Float32Array.from(src), b = new Float32Array(src.length);
    radius = Math.max(1, radius | 0); iters = iters || 1;
    for (let it = 0; it < iters; it++) {
      for (let y = 0; y < h; y++) {
        let acc = 0, row = y * w;
        for (let x = -radius; x <= radius; x++) acc += a[row + clamp(x, 0, w - 1)];
        for (let x = 0; x < w; x++) {
          b[row + x] = acc / (2 * radius + 1);
          acc += a[row + clamp(x + radius + 1, 0, w - 1)] - a[row + clamp(x - radius, 0, w - 1)];
        }
      }
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let y = -radius; y <= radius; y++) acc += b[clamp(y, 0, h - 1) * w + x];
        for (let y = 0; y < h; y++) {
          a[y * w + x] = acc / (2 * radius + 1);
          acc += b[clamp(y + radius + 1, 0, h - 1) * w + x] - b[clamp(y - radius, 0, h - 1) * w + x];
        }
      }
    }
    return a;
  }
  function gaussianBlur(src, w, h, sigma, iters) {
    const r = Math.max(1, Math.round(sigma * 1.5));
    return boxBlur(src, w, h, r, iters || 3);
  }
  function sobelMagnitude(lum, w, h) {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const yu = clamp(y - 1, 0, h - 1) * w, yc = y * w, yd = clamp(y + 1, 0, h - 1) * w;
      for (let x = 0; x < w; x++) {
        const xl = clamp(x - 1, 0, w - 1), xr = clamp(x + 1, 0, w - 1);
        const gx = (lum[yu + xr] + 2 * lum[yc + xr] + lum[yd + xr]) - (lum[yu + xl] + 2 * lum[yc + xl] + lum[yd + xl]);
        const gy = (lum[yd + xl] + 2 * lum[yd + x] + lum[yd + xr]) - (lum[yu + xl] + 2 * lum[yu + x] + lum[yu + xr]);
        out[yc + x] = Math.sqrt(gx * gx + gy * gy) / 4;
      }
    }
    return out;
  }
  function gradientXY(f, w, h) {
    const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const yc = y * w, yu = clamp(y - 1, 0, h - 1) * w, yd = clamp(y + 1, 0, h - 1) * w;
      for (let x = 0; x < w; x++) {
        const xl = clamp(x - 1, 0, w - 1), xr = clamp(x + 1, 0, w - 1);
        gx[yc + x] = (f[yc + xr] - f[yc + xl]) * 0.5;
        gy[yc + x] = (f[yd + x] - f[yu + x]) * 0.5;
      }
    }
    return { gx, gy };
  }
  function jointBilateralSmooth(field, guide, w, h, radius, sigma) {
    radius = radius || 2; sigma = sigma || 0.12;
    const out = new Float32Array(field.length), twoS = 2 * sigma * sigma;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, g0 = guide[i];
        let acc = 0, wsum = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const yy = clamp(y + dy, 0, h - 1);
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = clamp(x + dx, 0, w - 1);
            const j = yy * w + xx, dg = guide[j] - g0;
            const wt = Math.exp(-(dg * dg) / twoS) / (1 + dx * dx + dy * dy);
            acc += field[j] * wt; wsum += wt;
          }
        }
        out[i] = wsum > 0 ? acc / wsum : field[i];
      }
    }
    return out;
  }
  function normalize01(f, lo, hi) {
    let mn = Infinity, mx = -Infinity;
    if (lo != null && hi != null) { mn = lo; mx = hi; }
    else { for (let i = 0; i < f.length; i++) { if (f[i] < mn) mn = f[i]; if (f[i] > mx) mx = f[i]; } }
    const r = (mx - mn) || 1, out = new Float32Array(f.length);
    for (let i = 0; i < f.length; i++) out[i] = clamp01((f[i] - mn) / r);
    return { field: out, min: mn, max: mx };
  }
  function otsuThreshold(hist, total) {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, thresh = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thresh = t; }
    }
    return thresh / 255;
  }
  function resampleField(src, sw, sh, dw, dh) {
    const out = new Float32Array(dw * dh);
    for (let y = 0; y < dh; y++) {
      const sy = clamp01((y + 0.5) / dh) * (sh - 1);
      const y0 = Math.floor(sy), y1 = Math.min(sh - 1, y0 + 1), fy = sy - y0;
      for (let x = 0; x < dw; x++) {
        const sx = clamp01((x + 0.5) / dw) * (sw - 1);
        const x0 = Math.floor(sx), x1 = Math.min(sw - 1, x0 + 1), fx = sx - x0;
        out[y * dw + x] =
          src[y0 * sw + x0] * (1 - fx) * (1 - fy) + src[y0 * sw + x1] * fx * (1 - fy) +
          src[y1 * sw + x0] * (1 - fx) * fy + src[y1 * sw + x1] * fx * fy;
      }
    }
    return out;
  }
  /* إعادة أخذ عيّنات بمتوسط مساحة (Box) — يقلّل التشويش عند التصغير.
   * win (اختياري): نافذة المصدر بالبكسل {x0,y0,x1,y1}. */
  function resampleFieldBox(src, sw, sh, dw, dh, weight, win) {
    const wx0 = win ? Math.max(0, Math.floor(win.x0)) : 0;
    const wy0 = win ? Math.max(0, Math.floor(win.y0)) : 0;
    const wx1 = win ? Math.min(sw, Math.ceil(win.x1)) : sw;
    const wy1 = win ? Math.min(sh, Math.ceil(win.y1)) : sh;
    const ww = Math.max(1, wx1 - wx0), wh = Math.max(1, wy1 - wy0);
    const out = new Float32Array(dw * dh);
    for (let y = 0; y < dh; y++) {
      const y0 = wy0 + Math.floor(y * wh / dh), y1 = Math.max(y0 + 1, wy0 + Math.floor((y + 1) * wh / dh));
      for (let x = 0; x < dw; x++) {
        const x0 = wx0 + Math.floor(x * ww / dw), x1 = Math.max(x0 + 1, wx0 + Math.floor((x + 1) * ww / dw));
        let acc = 0, wsum = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
          const w = weight ? weight[yy * sw + xx] : 1;
          acc += src[yy * sw + xx] * w; wsum += w;
        }
        out[y * dw + x] = wsum > 0 ? acc / wsum : 0;
      }
    }
    return out;
  }
  function sampleFieldBilinear(f, w, h, u, v) {
    const fx = clamp(u, 0, 1) * (w - 1), fy = clamp(v, 0, 1) * (h - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    return f[y0 * w + x0] * (1 - tx) * (1 - ty) + f[y0 * w + x1] * tx * (1 - ty) +
           f[y1 * w + x0] * (1 - tx) * ty + f[y1 * w + x1] * tx * ty;
  }
  function percentile(f, p, mask) {
    const vals = [];
    const step = Math.max(1, Math.floor(f.length / 20000));
    for (let i = 0; i < f.length; i += step) { if (!mask || mask[i] > 0.5) vals.push(f[i]); }
    if (!vals.length) return 0;
    vals.sort((a, b) => a - b);
    return vals[clamp(Math.floor(p * (vals.length - 1)), 0, vals.length - 1)];
  }

  /* ---------- تحويل مسافة (EDT مربّع — Felzenszwalb & Huttenlocher) ---------- */
  function edt1d(f, d, v, z, n) {
    let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const dx = q - v[k];
      d[q] = dx * dx + f[v[k]];
    }
  }
  /* مسافة إقليدية (غير مربّعة) إلى أقرب بكسل محايد (zero = target) */
  function edt2d(bin, w, h, invert) {
    const INF = 1e20;
    const f = new Float32Array(Math.max(w, h));
    const d = new Float32Array(Math.max(w, h));
    const v = new Int32Array(Math.max(w, h) + 1);
    const z = new Float32Array(Math.max(w, h) + 2);
    const grid = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const on = bin[i] > 0.5;
      grid[i] = (invert ? on : !on) ? 0 : INF;
    }
    // أعمدة
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
      edt1d(f, d, v, z, h);
      for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
    }
    // صفوف
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
      edt1d(f, d, v, z, w);
      for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
    }
    const out = new Float32Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(grid[i]);
    return out;
  }
  /* مسافة موقّعة: موجبة داخل القناع، سالبة خارجه */
  function signedDistance(mask, w, h) {
    const bin = new Float32Array(w * h);
    for (let i = 0; i < bin.length; i++) bin[i] = mask[i] > 0.5 ? 1 : 0;
    const dToBg = edt2d(bin, w, h, false);   // داخل القناع: البعد عن الخلفية
    const dToFg = edt2d(bin, w, h, true);    // خارج القناع: البعد عن المقدمة
    const sdf = new Float32Array(w * h);
    for (let i = 0; i < sdf.length; i++) sdf[i] = bin[i] > 0.5 ? dToBg[i] : -dToFg[i];
    return sdf;
  }

  /* ---------- مورفولوجيا + مكوّنات متصلة ----------
   * ملاحظة الاصطلاح:
   *   edt2d(bin, …, false) = المسافة إلى أقرب بكسل قيمته 0 (الخلفية)
   *   edt2d(bin, …, true)  = المسافة إلى أقرب بكسل قيمته 1 (المقدمة)
   */
  function morph(mask, w, h, r, op) {
    const bin = new Float32Array(w * h);
    for (let i = 0; i < bin.length; i++) bin[i] = mask[i] > 0.5 ? 1 : 0;
    const dToBg = edt2d(bin, w, h, false);
    const dToFg = edt2d(bin, w, h, true);
    const out = new Float32Array(w * h);
    for (let i = 0; i < out.length; i++) {
      if (op === 'erode') out[i] = (bin[i] > 0.5 && dToBg[i] >= r) ? 1 : 0;
      else out[i] = (bin[i] > 0.5 || dToFg[i] <= r) ? 1 : 0;   // dilate
    }
    return out;
  }
  function connectedComponents(mask, w, h) {
    const labels = new Int32Array(w * h).fill(-1);
    const stats = [];
    const stack = new Int32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (labels[i] !== -1 || mask[i] < 0.5) continue;
      const id = stats.length;
      let sp = 0; stack[sp++] = i; labels[i] = id;
      let area = 0, sx = 0, sy = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
      while (sp > 0) {
        const p = stack[--sp];
        const x = p % w, y = (p / w) | 0;
        area++; sx += x; sy += y;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (labels[q] === -1 && mask[q] >= 0.5) { labels[q] = id; stack[sp++] = q; }
        }
      }
      stats.push({ id, area, cx: sx / area, cy: sy / area, bbox: { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h } });
    }
    stats.sort((a, b) => b.area - a.area);
    return { labels, count: stats.length, stats };
  }
  function keepComponents(mask, w, h, minAreaRatio, keepTop) {
    const cc = connectedComponents(mask, w, h);
    if (!cc.count) return { mask: new Float32Array(w * h), count: 0, stats: [] };
    const total = w * h;
    const keep = new Uint8Array(cc.count);
    const n = keepTop || cc.count;
    for (let i = 0; i < Math.min(n, cc.count); i++) {
      if (cc.stats[i].area / total >= (minAreaRatio || 0)) keep[cc.stats[i].id] = 1;
    }
    const out = new Float32Array(w * h);
    for (let i = 0; i < out.length; i++) if (labels0(cc, i) >= 0 && keep[labels0(cc, i)]) out[i] = 1;
    return { mask: out, count: cc.count, stats: cc.stats };
    function labels0(c, i) { return c.labels[i]; }
  }
  function fillHoles(mask, w, h, maxAreaRatio) {
    const inv = new Float32Array(w * h);
    for (let i = 0; i < inv.length; i++) inv[i] = mask[i] > 0.5 ? 0 : 1;
    const cc = connectedComponents(inv, w, h);
    if (!cc.count) return Float32Array.from(mask);
    const out = Float32Array.from(mask);
    const total = w * h;
    for (let c = 0; c < cc.count; c++) {
      const s = cc.stats[c];
      // الثقب = مكوّن خلفي لا يلامس حدود الصورة
      const touches = s.bbox.x0 <= 0 || s.bbox.y0 <= 0 || s.bbox.x1 >= 0.999 || s.bbox.y1 >= 0.999;
      if (touches) continue;
      if (s.area / total > (maxAreaRatio || 0.3)) continue;
      for (let i = 0; i < out.length; i++) if (cc.labels[i] === s.id) out[i] = 1;
    }
    return out;
  }

  /* ---------- ألوان ---------- */
  function rgb2hsv(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let hh = 0;
    if (d > 1e-6) {
      if (mx === r) hh = ((g - b) / d) % 6;
      else if (mx === g) hh = (b - r) / d + 2;
      else hh = (r - g) / d + 4;
      hh *= 60; if (hh < 0) hh += 360;
    }
    return [hh, mx > 1e-6 ? d / mx : 0, mx];
  }
  function hsv2rgb(h, s, v) {
    const c = v * s, hh = (((h % 360) + 360) % 360) / 60, x = c * (1 - Math.abs((hh % 2) - 1));
    let r = 0, g = 0, b = 0;
    if (hh < 1) { r = c; g = x; } else if (hh < 2) { r = x; g = c; }
    else if (hh < 3) { g = c; b = x; } else if (hh < 4) { g = x; b = c; }
    else if (hh < 5) { r = x; b = c; } else { r = c; b = x; }
    const m = v - c;
    return [r + m, g + m, b + m];
  }
  function srgb2lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function rgb2lab(r, g, b) {
    const R = srgb2lin(r), G = srgb2lin(g), B = srgb2lin(b);
    let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    let Y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
    let Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const f = t => (t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116));
    X = f(X); Y = f(Y); Z = f(Z);
    return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
  }
  function labDist(a, b) { const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2]; return Math.sqrt(dl * dl + da * da + db * db); }

  /* k-means بسيط على عيّنات (لبناء نماذج لونية) */
  function kmeans(samples, k, iters) {
    k = Math.max(1, k | 0); iters = iters || 8;
    const n = samples.length, dim = samples[0].length;
    const centers = [];
    for (let c = 0; c < k; c++) centers.push(samples[Math.floor(c * n / k) % n].slice());
    const assign = new Int32Array(n);
    for (let it = 0; it < iters; it++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        let best = 0, bd = Infinity;
        for (let c = 0; c < k; c++) {
          let d = 0;
          for (let j = 0; j < dim; j++) { const t = samples[i][j] - centers[c][j]; d += t * t; }
          if (d < bd) { bd = d; best = c; }
        }
        if (assign[i] !== best) { assign[i] = best; moved = true; }
      }
      const sums = centers.map(() => new Float64Array(dim));
      const cnt = new Int32Array(k);
      for (let i = 0; i < n; i++) { const c = assign[i]; for (let j = 0; j < dim; j++) sums[c][j] += samples[i][j]; cnt[c]++; }
      for (let c = 0; c < k; c++) {
        if (!cnt[c]) continue;
        for (let j = 0; j < dim; j++) centers[c][j] = sums[c][j] / cnt[c];
      }
      if (!moved) break;
    }
    return { centers, assign };
  }

  /* CRC32 لكاتب ZIP */
  const _crcTable = (function () {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = _crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  AI3D.util = {
    clamp, clamp01, lerp, now, tick, uid, fmtBytes, fmtTime, fmtNum,
    makeCanvas, getImageData, toCanvas, loadImageFile, downloadBlob,
    imageLike, cloneImage, resizeImage, resampleRGBAInto
  };
  AI3D.field = {
    luminanceField, boxBlur, gaussianBlur, sobelMagnitude, gradientXY, jointBilateralSmooth,
    normalize01, otsuThreshold, resampleField, sampleFieldBilinear, percentile,
    edt2d, signedDistance, morph, connectedComponents, keepComponents, fillHoles,
    resampleFieldBox
  };
  AI3D.color = { rgb2hsv, hsv2rgb, rgb2lab, labDist, kmeans };
  AI3D.crc32 = crc32;

})(typeof window !== 'undefined' ? window : globalThis);
