/* ============================================================
 * analysis.js — تحليل الصورة + بوابة الجودة + الإضاءة + المنظور
 *              + الكاميرا + تحسين الصورة + تصحيح المنظور
 * (مواصفة 4 • 16 • 25 • 41 • 43 • 44 • 45)
 * وحدة خالية من DOM: تتعامل مع {data,width,height}
 * ============================================================ */
(function (global) {
  'use strict';
  const AI3D = global.AI3D;
  const U = AI3D.util, F = AI3D.field, C = AI3D.color;
  const clamp = U.clamp, clamp01 = U.clamp01;

  /* حجم العمل لكل مرحلة حقلية (أداء أفضل دون فقدان التفاصيل المهمة) */
  const WORK = { low: 256, medium: 384, high: 512, ultra: 640 };
  function pickWorkSize(w, h, quality) {
    const target = WORK[quality] || WORK.medium;
    const s = Math.min(1, target / Math.max(w, h));
    return { w: Math.max(32, Math.round(w * s)), h: Math.max(32, Math.round(h * s)), scale: s };
  }

  function lumaImage(img) {
    const w = img.width, h = img.height, d = img.data, out = new Float32Array(w * h);
    for (let i = 0, p = 0; i < out.length; i++, p += 4) {
      out[i] = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255;
    }
    return out;
  }

  /* ---------------- تحليل شامل ---------------- */
  function analyzeImage(img, w, h, opts) {
    opts = opts || {};
    const t0 = U.now();
    const small = pickWorkSize(w, h, opts.quality || 'medium');
    const sImg = (small.w === w && small.h === h) ? img : U.resizeImage(img, small.w, small.h);
    const sw = sImg.width, sh = sImg.height;
    const lum = lumaImage(sImg);

    /* 1) التعريض والتباين والتشبّع */
    let mean = 0, sq = 0;
    for (let i = 0; i < lum.length; i++) { mean += lum[i]; sq += lum[i] * lum[i]; }
    mean /= lum.length; sq /= lum.length;
    const std = Math.sqrt(Math.max(0, sq - mean * mean));
    const p05 = F.percentile(lum, 0.05), p50 = F.percentile(lum, 0.5), p95 = F.percentile(lum, 0.95);
    const dynamicRange = clamp01(p95 - p05);

    const hist = new Float32Array(256);
    for (let i = 0; i < lum.length; i++) hist[clamp(Math.round(lum[i] * 255), 0, 255)]++;
    const total = lum.length;
    const under = (hist[0] + hist[1] + hist[2]) / total;
    const over = (hist[255] + hist[254] + hist[253]) / total;

    let satSum = 0, satCnt = 0, colorfulness = 0;
    const step = Math.max(1, Math.floor(total / 12000));
    let rgSum = 0, ybSum = 0, rgSq = 0, ybSq = 0;
    for (let i = 0; i < total; i += step) {
      const p = i * 4, r = sImg.data[p] / 255, g = sImg.data[p + 1] / 255, b = sImg.data[p + 2] / 255;
      const hsv = C.rgb2hsv(r, g, b);
      satSum += hsv[1]; satCnt++;
      const rg = r - g, yb = 0.5 * (r + g) - b;
      rgSum += rg; ybSum += yb; rgSq += rg * rg; ybSq += yb * yb;
    }
    const saturation = satCnt ? satSum / satCnt : 0;
    const rgM = rgSum / satCnt, ybM = ybSum / satCnt;
    const rgStd = Math.sqrt(Math.max(0, rgSq / satCnt - rgM * rgM));
    const ybStd = Math.sqrt(Math.max(0, ybSq / satCnt - ybM * ybM));
    colorfulness = clamp01((Math.sqrt(rgStd * rgStd + ybStd * ybStd) + 0.3 * Math.sqrt(rgM * rgM + ybM * ybM)) / 1.1);

    /* 2) الحدة (Laplacian) + تقدير نصف قطر الضباب */
    let lapSum = 0, lapSq = 0;
    for (let y = 1; y < sh - 1; y++) {
      for (let x = 1; x < sw - 1; x++) {
        const i = y * sw + x;
        const l = 4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - sw] - lum[i + sw];
        lapSum += Math.abs(l); lapSq += l * l;
      }
    }
    const n2 = (sw - 2) * (sh - 2) || 1;
    const lapMean = lapSum / n2, lapVar = Math.max(0, lapSq / n2 - lapMean * lapMean);
    const sharpness = clamp01(Math.sqrt(lapVar) * 9);
    const blurSigma = clamp(0.5 * Math.exp(-3.2 * sharpness) + 0.05, 0.05, 2.2);

    /* 3) التشويش (Immerkær: مشتقّات ثانية على صورة مموّهة) */
    const sm = F.boxBlur(Float32Array.from(lum), sw, sh, 1, 1);
    let noiseAcc = 0, noiseN = 0;
    for (let y = 1; y < sh - 1; y += 2) {
      for (let x = 1; x < sw - 1; x += 2) {
        const i = y * sw + x;
        const v = Math.abs(4 * sm[i] - sm[i - 1] - sm[i + 1] - sm[i - sw] - sm[i + sw]);
        noiseAcc += v; noiseN++;
      }
    }
    const noiseSigma = clamp01((noiseAcc / Math.max(1, noiseN)) * 3.2);
    const noise = clamp01(noiseSigma * 1.15);

    /* 4) الإضاءة: اتجاه الضوء من توزّع السطوع + ثنائية الجانبين */
    const light = estimateLighting(sImg, lum, sw, sh);

    /* 5) المنظور والخطوط ونقاط التلاشي */
    const perspective = estimatePerspective(lum, sw, sh);

    /* 6) تعقيد الخلفية + كثافة الحواف */
    const edge = F.sobelMagnitude(lum, sw, sh);
    let borderEdge = 0, borderN = 0, innerEdge = 0, innerN = 0;
    const bw = Math.max(2, Math.round(Math.min(sw, sh) * 0.12));
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const e = edge[y * sw + x];
      const onBorder = x < bw || y < bw || x >= sw - bw || y >= sh - bw;
      if (onBorder) { borderEdge += e; borderN++; } else { innerEdge += e; innerN++; }
    }
    const edgeDensity = clamp01((innerEdge / Math.max(1, innerN)) * 6);
    const backgroundComplexity = clamp01((borderEdge / Math.max(1, borderN)) * 7);

    /* 7) لوحة الألوان المهيمنة */
    const palette = dominantPalette(sImg, 5);

    /* 8) تماثل أفقي تقريبي (مفيد للأجسام الصناعية) */
    const symmetry = horizontalSymmetry(sImg, lum, sw, sh);

    /* 9) الكاميرا المقدّرة */
    const intrinsics = estimateIntrinsics(w, h, perspective);

    /* 10) بوابة الجودة */
    const quality = {
      resolution: clamp01(Math.log(Math.max(1, w * h) / (320 * 320)) / Math.log(4)),
      sharpness, exposure: clamp01(1 - Math.abs(mean - 0.5) * 1.7),
      contrast: clamp01(std * 3.4), noisePenalty: noise
    };
    quality.overall = clamp01(
      0.3 * quality.resolution + 0.34 * quality.sharpness +
      0.18 * quality.exposure + 0.18 * dynamicRange - 0.12 * noise
    );

    const warnings = buildWarnings({
      w, h, mean, sharpness, noise, under, over, dynamicRange, backgroundComplexity
    });
    const blocking = w < 96 || h < 96;

    return {
      width: w, height: h, aspect: w / h, megapixels: (w * h) / 1e6,
      resolution: { w, h },
      brightness: mean, contrast: std, dynamicRange, saturation, colorfulness,
      underExposure: under, overExposure: over, histogram: hist,
      sharpness, blurSigma, noise, noiseSigma, edgeDensity, backgroundComplexity,
      symmetry,
      light, perspective, palette, intrinsics,
      quality, warnings, blocking,
      analysisMs: Math.round(U.now() - t0),
      workSize: { w: sw, h: sh }
    };
  }

  /* ---------------- الإضاءة ---------------- */
  function estimateLighting(img, lum, w, h) {
    // أوجد ألمع المناطق (أعلى 4%) ومركز ثقل الصورة → متجه اتجاه الضوء
    const thr = F.percentile(lum, 0.96);
    let bx = 0, by = 0, bw = 0, cnt = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = lum[y * w + x];
      if (v >= thr) { const wt = (v - thr) + 1e-3; bx += x * wt; by += y * wt; bw += wt; cnt++; }
    }
    if (!cnt || bw <= 0) { bx = w / 2; by = h * 0.2; bw = 1; }
    const hx = bx / bw, hy = by / bw;
    const dx = (hx - w / 2) / w, dy = (hy - h / 2) / h;      // +dy = ضوء من الأسفل
    let angle = Math.atan2(dx, -dy) * 180 / Math.PI;          // 0° = من الأعلى، يمين موجب
    angle = ((angle % 360) + 360) % 360;
    // القوة: فرق السطوع بين نصف الصورة باتجاه الضوء والنصف المعاكس
    let sA = 0, nA = 0, sB = 0, nB = 0;
    const nx = Math.sin(angle * Math.PI / 180), ny = -Math.cos(angle * Math.PI / 180);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const rx = (x - w / 2) / w, ry = (y - h / 2) / h;
      const side = rx * nx + ry * ny;
      if (side > 0.08) { sA += lum[y * w + x]; nA++; }
      else if (side < -0.08) { sB += lum[y * w + x]; nB++; }
    }
    const mA = sA / Math.max(1, nA), mB = sB / Math.max(1, nB);
    const strength = clamp01(0.35 + (mA - mB) * 1.6);
    const rad = angle * Math.PI / 180;
    const dir = [Math.sin(rad) * 0.85, Math.cos(rad) * 0.7, 0.62]; // نحو المشاهد z موجب
    const ambient = clamp01(0.62 - 0.3 * strength);
    const intensity = clamp01(0.55 + 0.75 * strength);
    // درجة حرارة اللون من توازن الأبيض
    let rS = 0, bS = 0, n = 0;
    for (let i = 0; i < img.data.length; i += 4 * 37) { rS += img.data[i]; bS += img.data[i + 2]; n++; }
    const warmth = clamp01(((rS - bS) / Math.max(1, n)) / 60 + 0.5);
    return {
      angle: Math.round(angle), strength: +strength.toFixed(3),
      dir, ambient, intensity, warmth,
      temperatureK: Math.round(3200 + warmth * 4200),
      specular: clamp01((F.percentile(lum, 0.999) - F.percentile(lum, 0.9)) * 2.2)
    };
  }

  /* ---------------- المنظور ونقاط التلاشي (Hough مُصغّر) ---------------- */
  function estimatePerspective(lum, w, h) {
    const edge = F.sobelMagnitude(lum, w, h);
    const thr = F.percentile(edge, 0.9);
    const TH = 90, RH = 96;
    const acc = new Float32Array(TH * RH);
    const maxRho = Math.hypot(w, h);
    const diag = maxRho;
    const samples = [];
    for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) {
      if (edge[y * w + x] < thr) continue;
      samples.push(y * w + x);
    }
    const stride = Math.max(1, Math.floor(samples.length / 6000));
    for (let s = 0; s < samples.length; s += stride) {
      const p = samples[s], x = p % w, y = (p / w) | 0;
      for (let ti = 0; ti < TH; ti++) {
        const th = ti * Math.PI / TH;
        const rho = x * Math.cos(th) + y * Math.sin(th);
        const ri = clamp(Math.round(rho / diag * RH + RH / 2), 0, RH - 1);
        acc[ti * RH + ri] += 1;
      }
    }
    const accBlur = F.boxBlur(acc, RH, TH, 1, 1);
    // قمم مع قمع غير أقصى
    const peaks = [];
    for (let ti = 0; ti < TH; ti++) for (let ri = 0; ri < RH; ri++) {
      const v = accBlur[ti * RH + ri];
      if (v < 3) continue;
      let isMax = true;
      for (let dt = -2; dt <= 2 && isMax; dt++) for (let dr = -3; dr <= 3; dr++) {
        const t2 = ti + dt, r2 = ri + dr;
        if (t2 < 0 || t2 >= TH || r2 < 0 || r2 >= RH) continue;
        if (accBlur[t2 * RH + r2] > v) { isMax = false; break; }
      }
      if (isMax) {
        const th = ti * Math.PI / TH, rho = (ri - RH / 2) / RH * diag;
        peaks.push({ th, rho, votes: v, deg: th * 180 / Math.PI });
      }
    }
    peaks.sort((a, b) => b.votes - a.votes);
    const lines = [];
    for (const p of peaks) {
      let dup = false;
      for (const l of lines) {
        let dth = Math.abs(l.deg - p.deg); dth = Math.min(dth, 180 - dth);
        if (dth < 8 && Math.abs(l.rho - p.rho) < diag * 0.05) { dup = true; break; }
      }
      if (!dup) lines.push(p);
      if (lines.length >= 6) break;
    }
    const classify = d => {
      const dd = ((d % 180) + 180) % 180;
      if (dd < 22 || dd > 158) return 'horizontal';
      if (Math.abs(dd - 90) < 22) return 'vertical';
      return 'diagonal';
    };
    lines.forEach(l => { l.kind = classify(l.deg); });
    const verticals = lines.filter(l => l.kind === 'vertical');
    const horizontals = lines.filter(l => l.kind === 'horizontal');
    // الانحراف (tilt) من الخطوط الأفقية
    let skew = 0;
    if (horizontals.length) {
      let acc2 = 0, wsum = 0;
      horizontals.slice(0, 4).forEach(l => {
        let d = ((l.deg % 180) + 180) % 180; if (d > 90) d -= 180;
        acc2 += d * l.votes; wsum += l.votes;
      });
      skew = (acc2 / Math.max(1e-6, wsum)) * Math.PI / 180;
    }
    // تقارب الخطوط الرأسية → قوة المنظور
    let convergence = 0;
    if (verticals.length >= 2) {
      const devs = verticals.slice(0, 4).map(l => {
        let d = ((l.deg % 180) + 180) % 180; return Math.abs(d - 90);
      });
      convergence = clamp01((Math.max(...devs) - Math.min(...devs)) / 12);
    }
    // نقطة تلاشي من تقاطع أفضل خطين غير متوازيين
    let vp = null;
    if (lines.length >= 2) {
      const a = lines[0], b = lines.slice(1).find(l => {
        let dth = Math.abs(l.deg - a.deg); dth = Math.min(dth, 180 - dth); return dth > 25;
      });
      if (b) {
        const c1 = Math.cos(a.th), s1 = Math.sin(a.th), c2 = Math.cos(b.th), s2 = Math.sin(b.th);
        const det = c1 * s2 - s1 * c2;
        if (Math.abs(det) > 1e-4) {
          vp = { x: (a.rho * s2 - b.rho * s1) / det, y: (c1 * b.rho - c2 * a.rho) / det };
        }
      }
    }
    const strength = clamp01(convergence * 0.7 + (vp ? 0.35 * clamp01(Math.hypot(vp.x - w / 2, vp.y - h / 2) / (0.9 * Math.max(w, h))) : 0));
    const tiltHint = Math.abs(skew) < 0.03 ? 'مستقيم' : (Math.abs(skew) < 0.12 ? 'مائل قليلًا' : 'مائل بوضوح');
    return { skew: +skew.toFixed(4), tiltHint, convergence, strength, vp, lines: lines.slice(0, 5), horizonY: vp ? vp.y / h : 0.5 };
  }

  /* ---------------- الكاميرا ---------------- */
  function estimateIntrinsics(w, h, perspective) {
    let f = 1.0 * Math.max(w, h);
    if (perspective && perspective.lines && perspective.lines.length >= 2) {
      // تقدير بؤري من خطين متعامدين (إن وُجدت نقطة تلاشي قريبة من المركز)
      const vp = perspective.vp;
      if (vp) {
        const d = Math.hypot(vp.x - w / 2, vp.y - h / 2);
        if (d > 1e-3) f = clamp(0.55 * Math.max(w, h) + d * 0.9, 0.4 * Math.max(w, h), 3 * Math.max(w, h));
      }
    }
    return { fx: f, fy: f, cx: w / 2, cy: h / 2, fovDeg: 2 * Math.atan(Math.max(w, h) / (2 * f)) * 180 / Math.PI, estimated: true };
  }

  /* ---------------- لوحة الألوان ---------------- */
  function dominantPalette(img, k) {
    const samples = [];
    const step = Math.max(1, Math.floor(img.width * img.height / 4000));
    for (let i = 0; i < img.width * img.height; i += step) {
      const p = i * 4;
      samples.push(C.rgb2lab(img.data[p], img.data[p + 1], img.data[p + 2]));
    }
    if (!samples.length) return [];
    const km = C.kmeans(samples, k, 8);
    const out = [];
    for (let c = 0; c < km.centers.length; c++) {
      const members = samples.filter((_, i) => km.assign[i] === c);
      if (!members.length) continue;
      const lab = km.centers[c];
      // Lab → RGB تقريبي
      const fy = (lab[0] + 16) / 116, fx = fy + lab[1] / 500, fz = fy - lab[2] / 200;
      const fi = t => (t > 0.2069 ? t * t * t : (t - 16 / 116) / 7.787);
      let X = fi(fx) * 0.95047, Y = fi(fy), Z = fi(fz) * 1.08883;
      let r = X * 3.2406 + Y * -1.5372 + Z * -0.4986;
      let g = X * -0.9689 + Y * 1.8758 + Z * 0.0415;
      let b = X * 0.0557 + Y * -0.2040 + Z * 1.0570;
      const g2 = v => Math.round(clamp01(v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255);
      out.push({ rgb: [g2(r), g2(g), g2(b)], hex: '#' + [g2(r), g2(g), g2(b)].map(v => v.toString(16).padStart(2, '0')).join(''), ratio: members.length / samples.length });
    }
    out.sort((a, b) => b.ratio - a.ratio);
    return out;
  }

  function horizontalSymmetry(img, lum, w, h) {
    let diff = 0, n = 0;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w >> 1; x += 2) {
      diff += Math.abs(lum[y * w + x] - lum[y * w + (w - 1 - x)]); n++;
    }
    return clamp01(1 - (diff / Math.max(1, n)) * 4.5);
  }

  /* ---------------- رسائل الجودة (مواصفة 25 + 54) ---------------- */
  function buildWarnings(m) {
    const out = [];
    const add = (level, text) => out.push({ level, text });
    if (m.sharpness < 0.14) add('high', 'الصورة ضبابية — قد تقل دقة الحواف والتفاصيل.');
    else if (m.sharpness < 0.26) add('med', 'حدة الصورة متوسطة — جرّب تفعيل تحسين الصورة.');
    if (m.mean < 0.16) add('high', 'الصورة مظلمة جدًا — قد تضعف قدرة النظام على تمييز السطح.');
    else if (m.mean < 0.26) add('med', 'إضاءة ضعيفة — النتيجة قد تحتوي تشويشًا.');
    if (m.over > 0.12) add('med', 'يوجد احتراق في الإضاءة (مناطق بيضاء مفرطة) — قد تُفقد تفاصيلها.');
    if (m.noise > 0.55) add('med', 'تشويش عالٍ في الصورة — يُنصح بتفعيل تحسين الصورة.');
    if (m.dynamicRange < 0.25) add('med', 'تباين منخفض — تمييز الحواف سيكون أصعب.');
    if (m.w < 420 || m.h < 420) add('med', 'دقة الصورة منخفضة وقد تؤثر على دقة النموذج.');
    if (m.w < 160 || m.h < 160) add('high', 'الصورة صغيرة جدًا — قد يتعذّر إنتاج نموذج مستقر.');
    if (m.backgroundComplexity > 0.62) add('med', 'الخلفية معقّدة — قد يحتاج العزل إلى مراجعة القناع.');
    if (!out.length) add('ok', 'جودة الصورة مناسبة للمعالجة.');
    return out;
  }

  /* ---------------- تحسين الصورة (مواصفة 44 + 45) ---------------- */
  function enhanceImage(img, opts) {
    opts = opts || {};
    const amount = (opts.amount == null ? 0.6 : opts.amount);
    const doDenoise = opts.denoise !== false && amount > 0.25;
    const doSharp = opts.sharpen !== false;
    const doColor = opts.color !== false;
    const doLocal = opts.localContrast !== false;
    const w = img.width, h = img.height;
    const out = U.cloneImage(img);
    const d = out.data;

    if (doColor) {
      // توازن أبيض Gray-World + تمدد مستويات لكل قناة
      let rS = 0, gS = 0, bS = 0, n = 0;
      const st = Math.max(1, Math.floor(w * h / 20000));
      for (let i = 0; i < w * h; i += st) { const p = i * 4; rS += d[p]; gS += d[p + 1]; bS += d[p + 2]; n++; }
      const mr = rS / n, mg = gS / n, mb = bS / n, gray = (mr + mg + mb) / 3;
      const kr = gray / Math.max(1, mr), kg = gray / Math.max(1, mg), kb = gray / Math.max(1, mb);
      const kk = [kr, kg, kb].map(k => clamp(k, 0.7, 1.4));
      const lim = [kk[0], kk[1], kk[2]];
      for (let c = 0; c < 3; c++) {
        const vals = [];
        for (let i = 0; i < w * h; i += st) vals.push(clamp(d[i * 4 + c] * lim[c], 0, 255));
        vals.sort((a, b) => a - b);
        const lo = vals[Math.floor(vals.length * 0.015)], hi = vals[Math.floor(vals.length * 0.985)];
        const span = Math.max(1, hi - lo);
        for (let i = 0; i < w * h; i++) {
          const p = i * 4 + c;
          d[p] = clamp((d[p] * lim[c] - lo) * (255 / span), 0, 255);
        }
      }
    }

    if (doDenoise) {
      const lum = lumaImage(out);
      const chans = [0, 1, 2].map(c => {
        const f = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) f[i] = d[i * 4 + c];
        return F.jointBilateralSmooth(f, lum, w, h, 2, 0.09 * (1 + amount));
      });
      for (let i = 0; i < w * h; i++) {
        const p = i * 4;
        for (let c = 0; c < 3; c++) d[p + c] = clamp(U.lerp(d[p + c], chans[c][i], 0.55 * amount), 0, 255);
      }
    }

    if (doLocal) {
      const lum = lumaImage(out);
      const lowFreq = F.boxBlur(Float32Array.from(lum), w, h, Math.max(4, Math.round(Math.min(w, h) / 24)), 2);
      for (let i = 0; i < w * h; i++) {
        const boost = (lum[i] - lowFreq[i]) * 0.55 * amount;
        const p = i * 4;
        for (let c = 0; c < 3; c++) d[p + c] = clamp(d[p + c] + boost * 255, 0, 255);
      }
    }

    if (doSharp) {
      const lum = lumaImage(out);
      const blur = F.boxBlur(Float32Array.from(lum), w, h, 2, 2);
      for (let i = 0; i < w * h; i++) {
        const high = lum[i] - blur[i];
        const p = i * 4;
        for (let c = 0; c < 3; c++) d[p + c] = clamp(d[p + c] + high * 255 * 0.85 * amount, 0, 255);
      }
    }
    return out;
  }

  /* ---------------- تصحيح المنظور (مواصفة 43) ---------------- */
  function correctPerspective(img, skew, strength) {
    strength = strength == null ? 0.6 : strength;
    const w = img.width, h = img.height;
    const out = U.imageLike(w, h);
    const src = img.data, dst = out.data;
    const k = -skew * strength * 1.6;         // ميل أفقي
    const ky = clamp(Math.abs(skew) * strength * 0.5, 0, 0.25); // تقارب رأسي خفيف
    for (let y = 0; y < h; y++) {
      const v = y / (h - 1) - 0.5;
      const scaleY = 1 + ky * v * 2;
      for (let x = 0; x < w; x++) {
        const u = x / (w - 1) - 0.5;
        const su = (u + k * v) / scaleY + 0.5;
        const sv = (v / scaleY) + 0.5;
        // أخذ عيّنة ثنائية الخطوط
        const fx = clamp(su, 0, 1) * (w - 1), fy = clamp(sv, 0, 1) * (h - 1);
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
        const tx = fx - x0, ty = fy - y0;
        const p00 = (y0 * w + x0) * 4, p10 = (y0 * w + x1) * 4, p01 = (y1 * w + x0) * 4, p11 = (y1 * w + x1) * 4;
        const o = (y * w + x) * 4;
        for (let c = 0; c < 4; c++) {
          dst[o + c] = src[p00 + c] * (1 - tx) * (1 - ty) + src[p10 + c] * tx * (1 - ty) +
                       src[p01 + c] * (1 - tx) * ty + src[p11 + c] * tx * ty;
        }
      }
    }
    return out;
  }

  AI3D.Analysis = {
    analyzeImage, enhanceImage, correctPerspective, estimateIntrinsics,
    estimateLighting, estimatePerspective, dominantPalette, pickWorkSize, lumaImage
  };
})(typeof window !== 'undefined' ? window : globalThis);
