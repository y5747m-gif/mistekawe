/* ============================================================
 * segmentation.js — عزل الجسم عن الخلفية بدقة (مواصفة 6)
 *  trimap → GMM لوني (EM) → Local Color-Line Matting → تنعيم
 *  يحافظ على الشعر والحواف الدقيقة والفتحات، مع alpha ناعم.
 *  محلي 100% — لا خدمة خارجية.
 * ============================================================ */
(function (global) {
  'use strict';
  const AI3D = global.AI3D;
  const U = AI3D.util, F = AI3D.field;
  const clamp = U.clamp, clamp01 = U.clamp01;

  /* ---------------- GMM قطري (EM) ---------------- */
  function fitGMM(samples, K, iters) {
    K = Math.max(1, Math.min(K, Math.floor(samples.length / 8) || 1));
    const dim = 3, n = samples.length;
    if (!n) return null;
    const km = AI3D.color.kmeans(samples.map(s => [s[0], s[1], s[2]]), K, 6);
    const w = new Float64Array(K), mu = new Float64Array(K * dim), varc = new Float64Array(K * dim);
    const cnt = new Int32Array(K);
    for (let i = 0; i < n; i++) {
      const c = km.assign[i]; cnt[c]++;
      for (let j = 0; j < dim; j++) mu[c * dim + j] += samples[i][j];
    }
    for (let c = 0; c < K; c++) {
      w[c] = Math.max(1e-4, cnt[c] / n);
      for (let j = 0; j < dim; j++) mu[c * dim + j] /= Math.max(1, cnt[c]);
    }
    for (let i = 0; i < n; i++) {
      const c = km.assign[i];
      for (let j = 0; j < dim; j++) { const d = samples[i][j] - mu[c * dim + j]; varc[c * dim + j] += d * d; }
    }
    for (let c = 0; c < K; c++) for (let j = 0; j < dim; j++) varc[c * dim + j] = Math.max(1e-4, varc[c * dim + j] / Math.max(1, cnt[c]));

    const resp = new Float64Array(n * K);
    for (let it = 0; it < (iters || 8); it++) {
      // E
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let c = 0; c < K; c++) {
          let e = 0, norm = 1;
          for (let j = 0; j < dim; j++) {
            const d = samples[i][j] - mu[c * dim + j];
            e += (d * d) / (2 * varc[c * dim + j]);
            norm *= Math.sqrt(2 * Math.PI * varc[c * dim + j]);
          }
          const p = w[c] * Math.exp(-e) / (norm + 1e-12);
          resp[i * K + c] = p; sum += p;
        }
        const inv = 1 / (sum + 1e-12);
        for (let c = 0; c < K; c++) resp[i * K + c] *= inv;
      }
      // M
      const nk = new Float64Array(K);
      mu.fill(0);
      for (let i = 0; i < n; i++) for (let c = 0; c < K; c++) {
        const r = resp[i * K + c]; nk[c] += r;
        for (let j = 0; j < dim; j++) mu[c * dim + j] += r * samples[i][j];
      }
      for (let c = 0; c < K; c++) {
        w[c] = Math.max(1e-4, nk[c] / n);
        for (let j = 0; j < dim; j++) mu[c * dim + j] /= Math.max(1e-6, nk[c]);
      }
      varc.fill(0);
      for (let i = 0; i < n; i++) for (let c = 0; c < K; c++) {
        const r = resp[i * K + c];
        for (let j = 0; j < dim; j++) { const d = samples[i][j] - mu[c * dim + j]; varc[c * dim + j] += r * d * d; }
      }
      for (let c = 0; c < K; c++) for (let j = 0; j < dim; j++) varc[c * dim + j] = Math.max(1e-4, varc[c * dim + j] / Math.max(1e-6, nk[c]));
    }
    return { K, w, mu, var: varc };
  }
  function gmmLogProb(g, x) {
    let sum = 0;
    for (let c = 0; c < g.K; c++) {
      let e = 0, norm = 1;
      for (let j = 0; j < 3; j++) {
        const d = x[j] - g.mu[c * 3 + j];
        e += (d * d) / (2 * g.var[c * 3 + j]);
        norm *= Math.sqrt(2 * Math.PI * g.var[c * 3 + j]);
      }
      sum += g.w[c] * Math.exp(-e) / (norm + 1e-12);
    }
    return Math.log(sum + 1e-12);
  }

  /* ---------------- matting بخط اللون المحلي ---------------- */
  function colorLineAlpha(px, fgSamples, bgSamples) {
    const NC = 8;
    let bestA = null, bestErr = Infinity;
    const fgPick = pickNearest(px, fgSamples, NC);
    const bgPick = pickNearest(px, bgSamples, NC);
    if (!fgPick.length || !bgPick.length) return null;
    for (const f of fgPick) for (const b of bgPick) {
      const dx = f.c[0] - b.c[0], dy = f.c[1] - b.c[1], dz = f.c[2] - b.c[2];
      const denom = dx * dx + dy * dy + dz * dz;
      if (denom < 1e-5) continue;
      let a = ((px[0] - b.c[0]) * dx + (px[1] - b.c[1]) * dy + (px[2] - b.c[2]) * dz) / denom;
      a = clamp(a, 0, 1);
      const er = (px[0] - (a * f.c[0] + (1 - a) * b.c[0]));
      const eg = (px[1] - (a * f.c[1] + (1 - a) * b.c[1]));
      const eb = (px[2] - (a * f.c[2] + (1 - a) * b.c[2]));
      const err = er * er + eg * eg + eb * eb;
      if (err < bestErr) { bestErr = err; bestA = a; }
    }
    return bestA;
  }
  function pickNearest(px, samples, n) {
    const scored = samples.map(s => {
      const d0 = s.c[0] - px[0], d1 = s.c[1] - px[1], d2 = s.c[2] - px[2];
      return { s, d: d0 * d0 + d1 * d1 + d2 * d2 };
    });
    scored.sort((a, b) => a.d - b.d);
    return scored.slice(0, n).map(x => x.s);
  }

  /* ---------------- الواجهة ---------------- */
  function refineMask(img, w, h, seedMask, opts) {
    opts = opts || {};
    const detail = opts.detail || 'high';              // fast | high | ultra
    const trimapPx = detail === 'ultra' ? 5 : (detail === 'fast' ? 9 : 7);
    const winPx = detail === 'ultra' ? 16 : (detail === 'fast' ? 8 : 12);
    const seed = (seedMask.length === w * h) ? seedMask : F.resampleField(seedMask, opts.seedW || w, opts.seedH || h, w, h);

    // 1) ثنائية مبدئية + تنظيف
    let bin = new Float32Array(w * h);
    for (let i = 0; i < bin.length; i++) bin[i] = seed[i] > 0.5 ? 1 : 0;
    bin = F.fillHoles(bin, w, h, 0.25);
    const kept = F.keepComponents(bin, w, h, 0.002, opts.keepParts ? 8 : 2);
    bin = kept.mask;
    let cover = 0;
    for (let i = 0; i < bin.length; i++) cover += bin[i];
    if (cover < 20) {
      return { mask: Float32Array.from(seed), w, h, bbox: bboxOf(seed, w, h), coverage: cover / (w * h), method: 'seed-fallback', confidence: 0.3 };
    }

    // 2) Trimap
    const fgCore = F.morph(bin, w, h, trimapPx, 'erode');
    const bgCore = new Float32Array(w * h);
    const binDil = F.morph(bin, w, h, trimapPx, 'dilate');
    for (let i = 0; i < bgCore.length; i++) bgCore[i] = binDil[i] > 0.5 ? 0 : 1;

    // 3) عيّنات اللون
    const d = img.data, n = w * h;
    const fgSamples = [], bgSamples = [];
    const stepFg = Math.max(1, Math.floor(countOf(fgCore) / 900));
    const stepBg = Math.max(1, Math.floor(countOf(bgCore) / 900));
    let cf = 0, cb = 0;
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      const c = [d[p] / 255, d[p + 1] / 255, d[p + 2] / 255];
      if (fgCore[i] > 0.5 && (cf++ % stepFg === 0)) fgSamples.push({ i, c });
      else if (bgCore[i] > 0.5 && (cb++ % stepBg === 0)) bgSamples.push({ i, c });
    }
    const lum = AI3D.Analysis ? AI3D.Analysis.lumaImage(img) : F.luminanceField(img, w, h);
    let alpha;
    if (fgSamples.length > 40 && bgSamples.length > 40) {
      const gF = fitGMM(fgSamples.map(s => s.c), 5, 8);
      const gB = fitGMM(bgSamples.map(s => s.c), 5, 8);
      alpha = new Float32Array(n);
      // فهارس مكانية للبحث المحلي
      const fgIdx = buildSpatialIndex(fgSamples, w, h, winPx);
      const bgIdx = buildSpatialIndex(bgSamples, w, h, winPx);
      for (let i = 0; i < n; i++) {
        if (fgCore[i] > 0.5) { alpha[i] = 1; continue; }
        if (bgCore[i] > 0.5) { alpha[i] = 0; continue; }
        const p = i * 4;
        const px = [d[p] / 255, d[p + 1] / 255, d[p + 2] / 255];
        const lf = gF ? gmmLogProb(gF, px) : 0, lb = gB ? gmmLogProb(gB, px) : 0;
        const ratio = 1 / (1 + Math.exp(-(lf - lb) * 0.85));
        const aMatte = colorLineAlpha(px, fgIdx.lookup(i), bgIdx.lookup(i));
        alpha[i] = aMatte == null ? ratio : clamp01(0.45 * ratio + 0.55 * aMatte);
      }
    } else {
      alpha = new Float32Array(n);
      for (let i = 0; i < n; i++) alpha[i] = bin[i];
    }

    // 4) تنعيم موجّه باللون (يحافظ على الحواف) + استعادة حدود دقيقة
    const smoothed = F.jointBilateralSmooth(Float32Array.from(alpha), lum, w, h, 2, 0.075);
    for (let i = 0; i < n; i++) {
      alpha[i] = fgCore[i] > 0.5 ? 1 : (bgCore[i] > 0.5 ? Math.min(0.02, smoothed[i]) : smoothed[i]);
    }
    alpha = F.jointBilateralSmooth(alpha, lum, w, h, 1, 0.05);

    // 5) تنظيف نهائي
    const hard = new Float32Array(n);
    for (let i = 0; i < n; i++) hard[i] = alpha[i] > 0.5 ? 1 : 0;
    let cleaned = F.fillHoles(hard, w, h, 0.12);
    const parts = F.keepComponents(cleaned, w, h, opts.minPartRatio || 0.004, opts.keepParts ? 8 : 1);
    cleaned = parts.mask;
    let cov = 0;
    for (let i = 0; i < n; i++) { if (cleaned[i] > 0.5) cov++; alpha[i] = clamp01(alpha[i] * 0.9 + cleaned[i] * 0.1); }

    // ثقة العزل: تباين الألوان بين الداخل والخارج
    let mi = 0, mo = 0, ni = 0, no = 0;
    for (let i = 0; i < n; i++) {
      if (cleaned[i] > 0.5) { mi += lum[i]; ni++; } else { mo += lum[i]; no++; }
    }
    const sep = Math.abs(mi / Math.max(1, ni) - mo / Math.max(1, no));
    const confidence = clamp01(0.45 + sep * 1.4 + clamp01(cov / n) * 0.25);

    return {
      mask: alpha, hard: cleaned, w, h,
      bbox: bboxOf(cleaned, w, h),
      coverage: cov / n,
      confidence,
      method: fgSamples.length > 40 && bgSamples.length > 40 ? 'gmm+colorline-matting' : 'morphology',
      parts: parts.stats.slice(0, 6).map(s => ({ area: s.area / n, bbox: s.bbox }))
    };
  }

  function countOf(f) { let c = 0; for (let i = 0; i < f.length; i++) if (f[i] > 0.5) c++; return c; }
  function bboxOf(mask, w, h) {
    let x0 = w, y0 = h, x1 = 0, y1 = 0, any = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (mask[y * w + x] > 0.5) {
        any = true;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (!any) return { x0: 0.05, y0: 0.05, x1: 0.95, y1: 0.95 };
    const pad = Math.max(2, Math.round(Math.min(w, h) * 0.015));
    return {
      x0: clamp01((x0 - pad) / w), y0: clamp01((y0 - pad) / h),
      x1: clamp01((x1 + pad) / w), y1: clamp01((y1 + pad) / h)
    };
  }
  /* فهرس مكاني بشبكة للبحث عن أقرب عيّنات معروفة */
  function buildSpatialIndex(samples, w, h, winPx) {
    const cell = Math.max(4, winPx);
    const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
    const buckets = Array.from({ length: gw * gh }, () => []);
    for (const s of samples) {
      const x = s.i % w, y = (s.i / w) | 0;
      buckets[(y / cell | 0) * gw + (x / cell | 0)].push(s);
    }
    return {
      lookup(i) {
        const x = i % w, y = (i / w) | 0;
        const out = [];
        const gx = (x / cell) | 0, gy = (y / cell) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const cx = gx + dx, cy = gy + dy;
          if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) continue;
          const b = buckets[cy * gw + cx];
          for (let k = 0; k < b.length; k++) out.push(b[k]);
        }
        if (out.length < 6) for (let k = 0; k < samples.length; k += Math.max(1, Math.floor(samples.length / 24))) out.push(samples[k]);
        return out;
      }
    };
  }

  /* دمج أقنعة عدة أجسام (وضع "تحويل الكل") */
  function unionMasks(masks, w, h) {
    const out = new Float32Array(w * h);
    for (const m of masks) {
      const mm = (m.length === w * h) ? m : F.resampleField(m, 0, 0, w, h);
      for (let i = 0; i < out.length; i++) out[i] = Math.max(out[i], mm[i]);
    }
    return out;
  }

  AI3D.Segmentation = { refineMask, unionMasks, fitGMM, bboxOf, countOf };
})(typeof window !== 'undefined' ? window : globalThis);
