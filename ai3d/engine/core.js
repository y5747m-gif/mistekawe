/* ============================================================
 * MISTEKAWE / AI-3D Engine — core.js
 * النواة: أدوات الصور والرياضيات + سجل النماذج القابلة للتبديل
 * كل المعالجة محلية 100% — لا توجد أي calls لخدمات AI خارجية.
 * ============================================================ */
(function (global) {
  'use strict';

  const AI3D = global.AI3D || (global.AI3D = {});
  AI3D.version = '1.0.0';

  /* ---------- سجل النماذج: يسمح مستقبلًا بحقن نماذج أقوى ----------
   * أي مرحلة يمكن استبدالها: AI3D.Models.register('depth', myFn)
   * دون تغيير الواجهة أو الـ pipeline. (مواصفة 60) */
  const _models = {};
  AI3D.Models = {
    register(name, fn) { _models[name] = fn; },
    get(name) { return _models[name] || null; },
    has(name) { return !!_models[name]; },
    list() { return Object.keys(_models); }
  };

  /* ---------- أدوات عامة ---------- */
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = v => v < 0 ? 0 : (v > 1 ? 1 : v);

  function tick(ms) { return new Promise(r => setTimeout(r, ms || 0)); }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 800);
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function getImageData(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  /* تحميل ملف صورة إلى canvas مع احترام اتجاه EXIF ودعم كل الصيغ */
  async function loadImageFile(file, maxSide) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    let w = bmp.width, h = bmp.height;
    const m = maxSide || 1600;
    const s = Math.min(1, m / Math.max(w, h));
    w = Math.max(1, Math.round(w * s));
    h = Math.max(1, Math.round(h * s));
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0, w, h);
    try { bmp.close(); } catch (e) {}
    return { canvas: c, width: w, height: h, name: file.name || 'image' };
  }

  function canvasToImageData(canvas) { return getImageData(canvas); }

  /* ---------- Float field helpers (خرائط أحادية القناة) ---------- */
  function luminanceField(img, w, h) {
    const d = img.data, out = new Float32Array(w * h);
    for (let i = 0, p = 0; i < out.length; i++, p += 4) {
      out[i] = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255;
    }
    return out;
  }

  function boxBlur(src, w, h, radius, iters) {
    let a = src, b = new Float32Array(src.length);
    radius = Math.max(1, radius | 0);
    iters = iters || 1;
    for (let it = 0; it < iters; it++) {
      // أفقي
      for (let y = 0; y < h; y++) {
        let acc = 0, row = y * w;
        for (let x = -radius; x <= radius; x++) acc += a[row + clamp(x, 0, w - 1)];
        for (let x = 0; x < w; x++) {
          b[row + x] = acc / (2 * radius + 1);
          acc += a[row + clamp(x + radius + 1, 0, w - 1)] - a[row + clamp(x - radius, 0, w - 1)];
        }
      }
      // عمودي
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

  /* bilateral تقريبي سريع يحافظ على الحواف (لتجانس العمق) */
  function jointBilateralSmooth(field, guide, w, h, radius, sigma) {
    radius = radius || 2; sigma = sigma || 0.12;
    const out = new Float32Array(field.length);
    const twoS = 2 * sigma * sigma;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, g0 = guide[i];
        let acc = 0, wsum = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const yy = clamp(y + dy, 0, h - 1);
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = clamp(x + dx, 0, w - 1);
            const j = yy * w + xx;
            const dg = guide[j] - g0;
            const wt = Math.exp(-(dg * dg) / twoS) * (1 / (1 + dx * dx + dy * dy));
            acc += field[j] * wt; wsum += wt;
          }
        }
        out[i] = wsum > 0 ? acc / wsum : field[i];
      }
    }
    return out;
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

  function normalize01(f) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < f.length; i++) { if (f[i] < mn) mn = f[i]; if (f[i] > mx) mx = f[i]; }
    const r = (mx - mn) || 1;
    const out = new Float32Array(f.length);
    for (let i = 0; i < f.length; i++) out[i] = (f[i] - mn) / r;
    return { field: out, min: mn, max: mx };
  }

  function otsuThreshold(hist, total) {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, thresh = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thresh = t; }
    }
    return thresh / 255;
  }

  /* تصغير حقل إلى شبكة عمل */
  function resampleField(src, sw, sh, dw, dh) {
    const out = new Float32Array(dw * dh);
    for (let y = 0; y < dh; y++) {
      const sy = clamp01((y + 0.5) / dh) * (sh - 1);
      const y0 = Math.floor(sy), y1 = Math.min(sh - 1, y0 + 1), fy = sy - y0;
      for (let x = 0; x < dw; x++) {
        const sx = clamp01((x + 0.5) / dw) * (sw - 1);
        const x0 = Math.floor(sx), x1 = Math.min(sw - 1, x0 + 1), fx = sx - x0;
        out[y * dw + x] =
          src[y0 * sw + x0] * (1 - fx) * (1 - fy) +
          src[y0 * sw + x1] * fx * (1 - fy) +
          src[y1 * sw + x0] * (1 - fx) * fy +
          src[y1 * sw + x1] * fx * fy;
      }
    }
    return out;
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

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }
  function fmtTime(ms) {
    if (ms < 1000) return Math.round(ms) + ' ms';
    return (ms / 1000).toFixed(1) + ' s';
  }

  AI3D.util = { clamp, clamp01, lerp, tick, downloadBlob, makeCanvas, getImageData, loadImageFile, canvasToImageData, fmtBytes, fmtTime };
  AI3D.field = { luminanceField, boxBlur, jointBilateralSmooth, sobelMagnitude, normalize01, otsuThreshold, resampleField };
  AI3D.crc32 = crc32;

})(window);
