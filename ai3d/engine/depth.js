/* ============================================================
 * depth.js — تقدير العمق من صورة واحدة (مواصفة 7)
 *  إشارات متعددة: Shape-from-Shading (حل تكراري للمعادلة الخطية)
 *  + البؤرة/الحدة + ميل المنظور + كثافة النسيج + تحدّب الصورة
 *  الظلية + التماثل + البروز + الضباب الجوي
 *  ثم: دمج بمربعات صغرى مع تجانس يحافظ على الحواف،
 *      صقل SfS، فرض التماثل، وخريطة ثقة.
 *  محلي 100% — قابل للاستبدال بنموذج عصبي محلي عبر AI3D.Models.
 * ============================================================ */
(function (global) {
  'use strict';
  const AI3D = global.AI3D;
  const U = AI3D.util, F = AI3D.field;
  const clamp = U.clamp, clamp01 = U.clamp01;

  const TYPE_W = {
    vehicle: { sfs: 0.9, bulge: 1.0, ground: 0.7, tex: 0.8, sym: 0.5 },
    human: { sfs: 1.0, bulge: 1.1, ground: 0.35, tex: 0.5, sym: 0.8 },
    animal: { sfs: 1.0, bulge: 1.1, ground: 0.3, tex: 0.5, sym: 0.7 },
    furniture: { sfs: 0.85, bulge: 0.7, ground: 0.5, tex: 0.7, sym: 0.7 },
    building: { sfs: 0.6, bulge: 0.25, ground: 0.6, tex: 0.9, sym: 0.5 },
    product: { sfs: 1.0, bulge: 1.0, ground: 0.2, tex: 0.6, sym: 0.8 },
    electronics: { sfs: 0.8, bulge: 0.5, ground: 0.2, tex: 0.7, sym: 0.8 },
    clothing: { sfs: 0.9, bulge: 0.8, ground: 0.2, tex: 0.6, sym: 0.7 },
    plant: { sfs: 0.7, bulge: 0.9, ground: 0.4, tex: 0.6, sym: 0.4 },
    object: { sfs: 0.9, bulge: 0.85, ground: 0.35, tex: 0.6, sym: 0.6 }
  };

  /* Retinex أحادي المقياس: فصل الإضاءة عن الخامة (albedo) */
  function intrinsicDecompose(lum, w, h) {
    const big = F.boxBlur(Float32Array.from(lum), w, h, Math.max(6, Math.round(Math.min(w, h) / 12)), 2);
    const albedo = new Float32Array(w * h), shading = new Float32Array(w * h);
    for (let i = 0; i < lum.length; i++) {
      const illum = clamp(big[i], 0.06, 1);
      albedo[i] = clamp01(lum[i] / illum * 0.55);
      shading[i] = clamp01(illum);
    }
    const norm = F.normalize01(albedo);
    return { albedo: norm.field, shading };
  }

  /* ---------- الإشارات ---------- */
  function cueSharpness(img, lum, w, h, mask) {
    const edge = F.sobelMagnitude(lum, w, h);
    const sm = F.boxBlur(Float32Array.from(edge), w, h, Math.max(3, Math.round(Math.min(w, h) / 40)), 2);
    return F.normalize01(sm).field;
  }
  function cueTextureDensity(img, lum, w, h, mask) {
    // كثافة التباين المحلي (نسيج) — تقل مع البعد
    const mean = F.boxBlur(Float32Array.from(lum), w, h, 2, 1);
    const abs = new Float32Array(w * h);
    for (let i = 0; i < abs.length; i++) abs[i] = Math.abs(lum[i] - mean[i]);
    const sm = F.boxBlur(abs, w, h, Math.max(4, Math.round(Math.min(w, h) / 30)), 2);
    return F.normalize01(sm).field;
  }
  function cueBulge(mask, w, h) {
    // تحدّب: البعد عن حدود الصورة الظلية داخل القناع (المركز أقرب).
    // نستخدم مقطعًا كرويًا: profile = sqrt(t(2-t)) أقرب لسطح جسم محدّب من التدرّج الخطي.
    const dist = F.edt2d(mask, w, h, false);   // المسافة إلى أقرب بكسل خلفية
    let mx = 1e-6;
    for (let i = 0; i < dist.length; i++) if (dist[i] > mx) mx = dist[i];
    const out = new Float32Array(dist.length);
    for (let i = 0; i < dist.length; i++) {
      const t = clamp01(dist[i] / mx);
      out[i] = Math.sqrt(clamp01(t * (2 - t)));
    }
    return out;
  }
  function cueGround(h, w, mask) {
    // الأسفل أقرب (للأجسام الواقفة على الأرض)
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const v = 1 - y / (h - 1);
      for (let x = 0; x < w; x++) out[y * w + x] = v;
    }
    return out;
  }
  function cueHaze(img, w, h) {
    // الضباب/الزرقة: البعيد أقل تباينًا وأكثر زرقة
    const out = new Float32Array(w * h);
    const d = img.data;
    for (let i = 0, p = 0; i < out.length; i++, p += 4) {
      const r = d[p] / 255, g = d[p + 1] / 255, b = d[p + 2] / 255;
      out[i] = clamp01(0.5 + (b - (r + g) / 2) * 1.2);
    }
    return F.normalize01(F.boxBlur(out, w, h, Math.max(4, Math.round(Math.min(w, h) / 25)), 1)).field;
  }

  /* ---------- Shape-from-Shading: حل تكراري خطي ---------- */
  function shapeFromShading(shading, albedo, light, mask, w, h, iters, init) {
    const lx = light.dir[0], ly = -light.dir[1], lz = Math.max(0.25, light.dir[2]);
    const nrm = Math.hypot(lx, ly, lz) || 1;
    const L = [lx / nrm, ly / nrm, lz / nrm];
    let z = init ? Float32Array.from(init) : new Float32Array(w * h);
    const wData = new Float32Array(w * h);
    for (let i = 0; i < wData.length; i++) {
      // ثقة الإشارة: المناطق قليلة النسيج (سطح أملس) وكافية الإضاءة
      const albedoVar = Math.abs(albedo[i] - 0.5);
      wData[i] = mask[i] * clamp01(1 - albedoVar * 1.6) * clamp01(shading[i] * 2.2);
    }
    const lambda = 0.35, tau = 0.2;
    const b = new Float32Array(w * h);
    for (let i = 0; i < b.length; i++) b[i] = L[2] - clamp01(shading[i]) * 1.15;
    const r = new Float32Array(w * h), gx = new Float32Array(w * h), gy = new Float32Array(w * h);
    const tmp = new Float32Array(w * h);
    for (let it = 0; it < iters; it++) {
      // residuals: r = b - (Lx·zx + Ly·zy)  مع gx = w·r·Lx
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          const zx = (z[i + 1] - z[i - 1]) * 0.5;
          const zy = (z[i + w] - z[i - w]) * 0.5;
          r[i] = b[i] - (L[0] * zx + L[1] * zy);
          gx[i] = wData[i] * r[i] * L[0];
          gy[i] = wData[i] * r[i] * L[1];
        }
      }
      // هبوط تدرّج: ∂E/∂z = (gx[i+1]-gx[i-1]) + (gy[i+w]-gy[i-w]) + 8λ(z - avg)
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (mask[i] < 0.05 && wData[i] < 1e-4) { tmp[i] = z[i]; continue; }
          const avg = (z[i - 1] + z[i + 1] + z[i - w] + z[i + w]) * 0.25;
          const grad = (gx[i + 1] - gx[i - 1]) + (gy[i + w] - gy[i - w]) + 8 * lambda * (z[i] - avg);
          tmp[i] = clamp(z[i] - tau * grad, -1.5, 1.5);
        }
      }
      z.set(tmp);
    }
    return z;
  }

  /* ---------- تجانس يحافظ على الحواف (دمج الإشارات) ---------- */
  function edgeAwareSmooth(z, guide, w, h, iters, lambda) {
    let a = Float32Array.from(z), b = new Float32Array(z.length);
    for (let it = 0; it < iters; it++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x, g0 = guide[i];
          let acc = 0, wsum = 0;
          if (x > 0) { const j = i - 1, wt = edgeW(g0, guide[j]); acc += a[j] * wt; wsum += wt; }
          if (x < w - 1) { const j = i + 1, wt = edgeW(g0, guide[j]); acc += a[j] * wt; wsum += wt; }
          if (y > 0) { const j = i - w, wt = edgeW(g0, guide[j]); acc += a[j] * wt; wsum += wt; }
          if (y < h - 1) { const j = i + w, wt = edgeW(g0, guide[j]); acc += a[j] * wt; wsum += wt; }
          const prior = 1.0;
          b[i] = (acc + prior * lambda * a[i]) / (wsum + prior * lambda);
        }
      }
      const t = a; a = b; b = t;
    }
    return a;
  }
  function edgeW(a, b) { const d = a - b; return Math.exp(-(d * d) * 42); }

  /* ---------- التقدير الرئيسي ---------- */
  function estimateDepth(img, w, h, mask, ctx, opts) {
    opts = opts || {}; ctx = ctx || {};
    const t0 = U.now();
    const type = opts.objectType || ctx.objectType || 'object';
    const W = TYPE_W[type] || TYPE_W.object;
    const quality = opts.geometry || 'balanced';
    const sfsIters = quality === 'fast' ? 22 : (quality === 'detailed' ? 60 : 36);
    const lum = AI3D.Analysis.lumaImage(img);
    const intr = intrinsicDecompose(lum, w, h);
    const light = (ctx.analysis && ctx.analysis.light) || { dir: [0.35, 0.55, 0.7], strength: 0.5, ambient: 0.4, intensity: 0.9 };

    /* 1) الإشارات */
    const cSharp = cueSharpness(img, lum, w, h, mask);
    const cTex = cueTextureDensity(img, lum, w, h, mask);
    const cBulge = cueBulge(mask, w, h);
    const cGround = cueGround(h, w, mask);
    const cHaze = cueHaze(img, w, h);
    // البروز (إن اختلفت دقته عن دقة العمل) يُعاد أخذ عيّناته
    let salField = ctx.saliency || null;
    if (salField && ctx.saliencyW && ctx.saliencyH && (ctx.saliencyW !== w || ctx.saliencyH !== h)) {
      salField = F.resampleField(salField, ctx.saliencyW, ctx.saliencyH, w, h);
    }
    const cSal = salField ? F.normalize01(salField).field : null;

    /* 2) SfS على شبكة مصغّرة ثم رفع الدقة */
    const sfsMax = 320;
    const scale = Math.min(1, sfsMax / Math.max(w, h));
    const sw = Math.max(32, Math.round(w * scale)), sh = Math.max(32, Math.round(h * scale));
    const mS = F.resampleField(mask, w, h, sw, sh);
    const shS = F.resampleField(intr.shading, w, h, sw, sh);
    const alS = F.resampleField(intr.albedo, w, h, sw, sh);
    let zSfs = shapeFromShading(shS, alS, light, mS, sw, sh, sfsIters, null);
    zSfs = edgeAwareSmooth(zSfs, F.boxBlur(Float32Array.from(shS), sw, sh, 1, 1), sw, sh, 4, 0.6);
    let cSfs = F.resampleField(zSfs, sw, sh, w, h);
    cSfs = F.normalize01(cSfs).field;

    /* 3) دمج مرجّح */
    const acc = new Float32Array(w * h), wsum = new Float32Array(w * h);
    const add = (field, weight, scaleType) => {
      if (!field || !weight) return;
      for (let i = 0; i < acc.length; i++) { acc[i] += field[i] * weight * scaleType; wsum[i] += weight * scaleType; }
    };
    add(cSfs, 1.0, W.sfs);
    add(cBulge, 0.85, W.bulge);
    add(cSharp, 0.45, W.tex);
    add(cTex, 0.3, W.tex);
    add(cGround, 0.35, W.ground);
    add(cHaze, 0.15, 1);
    if (cSal) add(cSal, 0.3, 0.6);
    const prior = new Float32Array(w * h);
    for (let i = 0; i < prior.length; i++) prior[i] = wsum[i] > 1e-6 ? acc[i] / wsum[i] : 0.5;

    /* 4) تنعيم عالمي يحافظ على الحواف (موجّه بالألbedo) */
    const guide = F.boxBlur(Float32Array.from(intr.albedo), w, h, 1, 1);
    let z = edgeAwareSmooth(prior, guide, w, h, quality === 'fast' ? 6 : 14, 0.75);

    /* 5) صقل SfS النهائي عند دقة العمل */
    z = shapeFromShading(intr.shading, intr.albedo, light, mask, w, h, Math.round(sfsIters / 3), z);
    z = edgeAwareSmooth(z, guide, w, h, 6, 0.9);

    /* 6) فرض التماثل (للأجسام المتناظرة) */
    const sym = (ctx.analysis && ctx.analysis.symmetry) || 0.5;
    const symW = clamp01((sym - 0.35) * 1.4) * W.sym * 0.5;
    if (symW > 0.02) {
      const mirrored = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mirrored[y * w + x] = z[y * w + (w - 1 - x)];
      for (let i = 0; i < z.length; i++) z[i] = U.lerp(z[i], (z[i] + mirrored[i]) * 0.5, symW);
    }

    /* 7) تطبيع داخل القناع + ثقة */
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < z.length; i++) if (mask[i] > 0.4) { if (z[i] < mn) mn = z[i]; if (z[i] > mx) mx = z[i]; }
    const range = Math.max(1e-5, mx - mn);
    const depth = new Float32Array(w * h);
    for (let i = 0; i < z.length; i++) depth[i] = mask[i] > 0.05 ? clamp01((z[i] - mn) / range) : 0;
    // خارج القناع: صفر (بعيد)
    for (let i = 0; i < depth.length; i++) depth[i] *= clamp01(mask[i] * 1.4);

    /* الثقة: اتفاق الإشارات + قوة النسيج + البعد عن الحواف */
    const maskSdf = F.signedDistance(mask, w, h);
    const conf = new Float32Array(w * h);
    const cues = [cSfs, cBulge, cSharp, cTex];
    for (let i = 0; i < conf.length; i++) {
      if (mask[i] < 0.2) { conf[i] = 0; continue; }
      let m = 0, v = 0;
      for (const c of cues) m += c[i];
      m /= cues.length;
      for (const c of cues) v += (c[i] - m) * (c[i] - m);
      v = Math.sqrt(v / cues.length);
      const agreement = clamp01(1 - v * 2.4);
      const edgeDist = clamp01(maskSdf[i] / (0.06 * Math.min(w, h)));
      const texStrength = clamp01(0.35 + cTex[i] * 0.9 + (1 - intr.albedo[i] * 0 + 0) * 0);
      conf[i] = clamp01(0.42 * agreement + 0.28 * edgeDist + 0.3 * texStrength) * clamp01(mask[i] * 1.6);
    }

    /* 8) النواميس من ميلان العمق */
    const depthWorldScale = opts.depthScale || 0.55;
    const normals = normalsFromDepth(depth, w, h, depthWorldScale, mask,
      opts.px2worldX || (1 / Math.max(1, w)), opts.px2worldY || (1 / Math.max(1, h)));

    /* 9) تحليل هندسي: انحناء + أسطح مستوية/منحنية + أجزاء */
    const geometryInfo = analyzeDepthGeometry(depth, normals, mask, w, h);

    return {
      depth, confidence: conf, normals, w, h,
      cues: { sfs: cSfs, bulge: cBulge, sharpness: cSharp, texture: cTex, ground: cGround, haze: cHaze },
      albedo: intr.albedo, shading: intr.shading,
      geometry: geometryInfo,
      method: 'multi-cue + linear SfS + edge-aware fusion (local)',
      ms: Math.round(U.now() - t0)
    };
  }

  /* النواميس من حقل العمق.
   * الاصطلاح: Depth = 1 أقرب → Z أكبر (باتجاه الكاميرا).
   * px2world: معامل تحويل البكسل إلى وحدة العالم (للميل الصحيح). */
  function normalsFromDepth(depth, w, h, scale, mask, px2worldX, px2worldY) {
    const nx = new Float32Array(w * h), ny = new Float32Array(w * h), nz = new Float32Array(w * h);
    const sx = (px2worldX || 1 / Math.max(1, w)), sy = (px2worldY || 1 / Math.max(1, h));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (mask && mask[i] < 0.05) { nx[i] = 0; ny[i] = 0; nz[i] = 1; continue; }
        const xm = Math.max(0, x - 1), xp = Math.min(w - 1, x + 1);
        const ym = Math.max(0, y - 1), yp = Math.min(h - 1, y + 1);
        const dzdx = (depth[y * w + xp] - depth[y * w + xm]) / Math.max(1, xp - xm);
        const dzdy = (depth[yp * w + x] - depth[ym * w + x]) / Math.max(1, yp - ym);
        // Z = (depth-0.5)*scale  ⇒  ∂Z/∂X = scale·dzdx·(وحدة عالم/بكسل)
        const ax = -dzdx * scale / sx, ay = dzdy * scale / sy, az = 1.0;
        const len = Math.hypot(ax, ay, az) || 1;
        nx[i] = ax / len; ny[i] = ay / len; nz[i] = az / len;
      }
    }
    return { nx, ny, nz };
  }

  /* تحليل هندسي: انحناء وأسطح وأجزاء (مواصفة 8) */
  function analyzeDepthGeometry(depth, normals, mask, w, h) {
    let curvSum = 0, n = 0, planar = 0;
    const { gx, gy } = F.gradientXY(depth, w, h);
    const gxS = F.boxBlur(Float32Array.from(gx), w, h, 2, 1);
    const gyS = F.boxBlur(Float32Array.from(gy), w, h, 2, 1);
    let lxx = 0, lyy = 0;
    const curv = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (mask[i] < 0.5) continue;
      const dxx = depth[i + 1] - 2 * depth[i] + depth[i - 1];
      const dyy = depth[i + w] - 2 * depth[i] + depth[i - w];
      const dxy = (depth[i + w + 1] - depth[i + w - 1] - depth[i - w + 1] + depth[i - w - 1]) * 0.25;
      const k = Math.abs(dxx + dyy) * 0.5 + Math.abs(dxy);
      curv[i] = k;
      curvSum += k; n++;
      const gradMag = Math.hypot(gxS[i], gyS[i]);
      if (gradMag < 0.006) planar++;
      lxx += Math.abs(dxx); lyy += Math.abs(dyy);
    }
    n = Math.max(1, n);
    // أجزاء: عناقيد بسيطة على (العمق + اتجاه الناموس)
    const partLabels = segmentParts(depth, normals, mask, w, h);
    return {
      curvature: clamp01(curvSum / n * 26),
      flatRatio: clamp01(planar / n * 1.6),
      anisotropy: clamp01(Math.abs(lxx - lyy) / Math.max(1e-6, lxx + lyy) * 2),
      partCount: partLabels.count,
      parts: partLabels.parts,
      partLabels: partLabels.labels
    };
  }

  function segmentParts(depth, normals, mask, w, h) {
    // تجميع خشن: يتجاهل التفاصيل ويبحث عن مناطق متجاورة متشابهة العمق والناموس
    const cell = Math.max(6, Math.round(Math.min(w, h) / 22));
    const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
    const cells = [];
    for (let gy2 = 0; gy2 < gh; gy2++) for (let gx2 = 0; gx2 < gw; gx2++) {
      let cnt = 0, dz = 0, nx = 0, ny = 0, nz = 0;
      for (let y = gy2 * cell; y < Math.min(h, (gy2 + 1) * cell); y++)
        for (let x = gx2 * cell; x < Math.min(w, (gx2 + 1) * cell); x++) {
          const i = y * w + x;
          if (mask[i] < 0.5) continue;
          cnt++; dz += depth[i]; nx += normals.nx[i]; ny += normals.ny[i]; nz += normals.nz[i];
        }
      if (cnt < cell * cell * 0.35) { cells.push(null); continue; }
      cells.push({ gx: gx2, gy: gy2, d: dz / cnt, n: [nx / cnt, ny / cnt, nz / cnt], area: cnt });
    }
    // عناقيد بالانتشار على الشبكة
    const label = new Int32Array(gw * gh).fill(-1);
    const clusters = [];
    const idx = (a, b) => b * gw + a;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]; if (!c || label[i] >= 0) continue;
      const id = clusters.length;
      const stack = [i]; label[i] = id;
      const cluster = { id, d: 0, n: [0, 0, 0], area: 0, cells: 0, minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9 };
      while (stack.length) {
        const p = stack.pop(), cp = cells[p];
        cluster.d += cp.d; cluster.area += cp.area; cluster.cells++;
        for (let k = 0; k < 3; k++) cluster.n[k] += cp.n[k];
        cluster.minX = Math.min(cluster.minX, cp.gx); cluster.maxX = Math.max(cluster.maxX, cp.gx);
        cluster.minY = Math.min(cluster.minY, cp.gy); cluster.maxY = Math.max(cluster.maxY, cp.gy);
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dy] of nb) {
          const a = cp.gx + dx, b = cp.gy + dy;
          if (a < 0 || b < 0 || a >= gw || b >= gh) continue;
          const q = idx(a, b), cq = cells[q];
          if (!cq || label[q] >= 0) continue;
          const dd = Math.abs(cq.d - cp.d);
          const dn = Math.hypot(cq.n[0] - cp.n[0], cq.n[1] - cp.n[1], cq.n[2] - cp.n[2]);
          if (dd < 0.14 && dn < 0.55) { label[q] = id; stack.push(q); }
        }
      }
      cluster.d /= Math.max(1, cluster.cells);
      for (let k = 0; k < 3; k++) cluster.n[k] /= Math.max(1, cluster.cells);
      clusters.push(cluster);
    }
    clusters.sort((a, b) => b.area - a.area);
    const parts = clusters.slice(0, 8).filter(c => c.area > (w * h) * 0.006).map((c, i) => ({
      id: i,
      name: partName(c, gh),
      depth: +c.d.toFixed(3),
      areaRatio: +(c.area / (w * h)).toFixed(4),
      normal: c.n.map(v => +v.toFixed(2)),
      bbox: { x0: c.minX / gw, y0: c.minY / gh, x1: (c.maxX + 1) / gw, y1: (c.maxY + 1) / gh }
    }));
    return { count: parts.length, parts, labels: label };
  }
  function partName(c, gh) {
    const cy = (c.minY + c.maxY) / 2 / gh;
    const facing = c.n[2];
    if (facing > 0.75) return cy < 0.4 ? 'أعلى / سطح علوي' : (cy > 0.7 ? 'قاعدة' : 'واجهة أمامية');
    if (facing < -0.3) return 'خلفية (مستنتَجة)';
    if (c.n[0] > 0.5) return 'جانب أيمن';
    if (c.n[0] < -0.5) return 'جانب أيسر';
    return cy < 0.35 ? 'جزء علوي' : (cy > 0.65 ? 'جزء سفلي' : 'جزء أوسط');
  }

  /* ---------- دمج متعدد الصور (مواصفة 24) ---------- */
  function fuseDepths(frames) {
    if (!frames || !frames.length) return null;
    if (frames.length === 1) return { depth: frames[0].depth, confidence: frames[0].confidence, views: 1 };
    const w = frames[0].w, h = frames[0].h, n = w * h;
    const out = new Float32Array(n), conf = new Float32Array(n);
    const vals = new Float32Array(frames.length);
    const ws = new Float32Array(frames.length);
    for (let i = 0; i < n; i++) {
      let m = frames[0].mask ? frames[0].mask[i] : 1;
      if (m < 0.2) { out[i] = 0; conf[i] = 0; continue; }
      let k = 0, wsum = 0;
      for (let f = 0; f < frames.length; f++) {
        const fr = frames[f];
        const mm = fr.mask ? fr.mask[i] : 1;
        if (mm < 0.2) continue;
        vals[k] = fr.depth[i];
        ws[k] = (fr.confidence ? fr.confidence[i] : 0.6) * mm;
        wsum += ws[k]; k++;
      }
      if (!k) { out[i] = 0; conf[i] = 0; continue; }
      // متوسط مرجّح + حماية من القيم الشاذة (تجاهل الأبعد عن الوسيط)
      let mean = 0, ww = 0;
      for (let j = 0; j < k; j++) { mean += vals[j] * ws[j]; ww += ws[j]; }
      mean /= (ww || 1);
      let acc = 0, accw = 0;
      for (let j = 0; j < k; j++) {
        if (Math.abs(vals[j] - mean) > 0.42) continue; // قيمة شاذة
        acc += vals[j] * ws[j]; accw += ws[j];
      }
      out[i] = accw ? acc / accw : mean;
      // الثقة تزيد مع عدد المشاهد المتفقة
      const agree = clamp01(1 - Math.abs(acc / (accw || 1) - mean) * 3);
      conf[i] = clamp01((0.55 + 0.15 * k) * agree);
    }
    return { depth: out, confidence: conf, views: frames.length };
  }

  AI3D.Depth = {
    estimateDepth, fuseDepths, normalsFromDepth, intrinsicDecompose,
    shapeFromShading, edgeAwareSmooth, analyzeDepthGeometry
  };
})(typeof window !== 'undefined' ? window : globalThis);
