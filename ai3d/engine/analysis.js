/* ============================================================
 * analysis.js — تحليل الصورة قبل إعادة البناء (مواصفة 4 + 25 + 43)
 * الدقة، الجودة، التشويش، الإضاءة، التباين، الحدة، زاوية
 * التصوير، المنظور + بوابة قبول الصور غير المناسبة.
 * ============================================================ */
(function (global) {
  'use strict';
  const AI3D = global.AI3D;
  const U = AI3D.util, F = AI3D.field;

  function analyzeImage(img, w, h) {
    const d = img.data, n = w * h;
    const lum = F.luminanceField(img, w, h);

    // --- إحصاءات اللون والإضاءة ---
    let sumL = 0, sumL2 = 0, sumR = 0, sumG = 0, sumB = 0;
    let sumSat = 0, dark = 0, bright = 0;
    const hist = new Uint32Array(256);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const L = lum[i];
      sumL += L; sumL2 += L * L; hist[(L * 255) | 0]++;
      const r = d[p] / 255, g = d[p + 1] / 255, b = d[p + 2] / 255;
      sumR += r; sumG += g; sumB += b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sumSat += mx > 0 ? (mx - mn) / mx : 0;
      if (L < 0.08) dark++; if (L > 0.95) bright++;
    }
    const mean = sumL / n;
    const variance = Math.max(0, sumL2 / n - mean * mean);
    const contrast = Math.sqrt(variance);           // انحراف معياري للإضاءة
    const saturation = sumSat / n;
    const darkRatio = dark / n, brightRatio = bright / n;

    // --- الحدة: تباين لابلاسيان ---
    let lapSum = 0, lapSq = 0;
    const sw = Math.min(w, 256), sh = Math.round(sw * h / w);
    const small = F.resampleField(lum, w, h, sw, sh);
    for (let y = 1; y < sh - 1; y++) {
      for (let x = 1; x < sw - 1; x++) {
        const i = y * sw + x;
        const lap = 4 * small[i] - small[i - 1] - small[i + 1] - small[i - sw] - small[i + sw];
        lapSum += lap; lapSq += lap * lap;
      }
    }
    const m = (sw - 2) * (sh - 2);
    const sharpVar = Math.max(0, lapSq / m - Math.pow(lapSum / m, 2));
    const sharpness = AI3D.util.clamp(sharpVar * 22, 0, 1); // معايرة تجريبية

    // --- التشويش: فرق الصورة عن نسخة مموّهة ---
    const blur = F.boxBlur(Float32Array.from(small), sw, sh, 1, 1);
    let noiseAcc = 0, cnt = 0;
    for (let y = 2; y < sh - 2; y += 2) {
      for (let x = 2; x < sw - 2; x += 2) {
        const i = y * sw + x;
        noiseAcc += Math.abs(small[i] - blur[i]); cnt++;
      }
    }
    const noise = AI3D.util.clamp((noiseAcc / cnt) * 9 - sharpness * 0.25, 0, 1);

    // --- اتجاه الضوء: تدرج الإضاءة العام ---
    const q = (x0, y0, x1, y1) => {
      let s = 0, c = 0;
      for (let y = Math.floor(y0 * sh); y < Math.floor(y1 * sh); y++)
        for (let x = Math.floor(x0 * sw); x < Math.floor(x1 * sw); x++) { s += small[y * sw + x]; c++; }
      return s / Math.max(1, c);
    };
    const left = q(0, 0.25, 0.33, 0.75), right = q(0.67, 0.25, 1, 0.75);
    const top = q(0.25, 0, 0.75, 0.33), bottom = q(0.25, 0.67, 0.75, 1);
    const lightDir = { x: (right - left), y: (bottom - top) };
    const lightMag = Math.hypot(lightDir.x, lightDir.y);
    if (lightMag > 1e-4) { lightDir.x /= lightMag; lightDir.y /= lightMag; }
    const lightAngle = Math.round(Math.atan2(lightDir.y, lightDir.x) * 180 / Math.PI);

    // --- المنظور: هيستوغرام اتجاهات الحواف (تقدير الأفق/زاوية التصوير) ---
    const edge = F.sobelMagnitude(small, sw, sh);
    const oriHist = new Float32Array(18);
    let horizonScore = 0, verticalScore = 0;
    for (let y = 1; y < sh - 1; y += 2) {
      for (let x = 1; x < sw - 1; x += 2) {
        const i = y * sw + x;
        if (edge[i] < 0.08) continue;
        const gx = small[i + 1] - small[i - 1], gy = small[i + sw] - small[i - sw];
        let a = Math.atan2(gy, gx) * 180 / Math.PI; if (a < 0) a += 180;
        oriHist[Math.min(17, (a / 10) | 0)] += edge[i];
      }
    }
    for (let k = 0; k < 18; k++) {
      const a = k * 10;
      if (a < 20 || a > 160) horizonScore += oriHist[k];
      if (a > 70 && a < 110) verticalScore += oriHist[k];
    }
    const totalOri = horizonScore + verticalScore + 1e-6;
    const tiltHint = verticalScore > horizonScore * 1.6 ? 'vertical-dominant'
      : (horizonScore > verticalScore * 1.6 ? 'horizon-dominant' : 'mixed');
    // تقدير بسيط لانحراف المنظور من عدم تماثل كتلة الحواف يمين/يسار
    let edgeL = 0, edgeR = 0;
    for (let y = 0; y < sh; y += 2) for (let x = 0; x < sw; x += 2) {
      const e = edge[y * sw + x];
      if (x < sw / 2) edgeL += e; else edgeR += e;
    }
    const perspectiveSkew = (edgeR - edgeL) / (edgeR + edgeL + 1e-6);

    // --- درجات الجودة الداخلية (تقديرية — مواصفة 27) ---
    const resScore = AI3D.util.clamp(Math.min(w, h) / 900, 0.15, 1);
    const qSharp = sharpness, qNoise = 1 - noise;
    const qExpo = 1 - AI3D.util.clamp(darkRatio * 2.2 + brightRatio * 2.2, 0, 1);
    const qContrast = AI3D.util.clamp(contrast * 5.2, 0, 1);
    const overall = 0.30 * resScore + 0.30 * qSharp + 0.15 * qNoise + 0.12 * qExpo + 0.13 * qContrast;

    // --- بوابة القبول (مواصفة 25) ---
    const warnings = [];
    if (Math.min(w, h) < 220) warnings.push({ code: 'too-small', text: 'الصورة صغيرة جدًا وقد تؤثر على دقة النموذج.' });
    if (sharpness < 0.10) warnings.push({ code: 'blurry', text: 'الصورة ضبابية — جودة النموذج قد تكون منخفضة.' });
    if (mean < 0.12) warnings.push({ code: 'dark', text: 'الصورة مظلمة جدًا — يُفضَّل صورة بإضاءة أفضل.' });
    if (mean > 0.90) warnings.push({ code: 'bright', text: 'الصورة ساطعة أكثر من اللازم (احتراق إضاءة).' });
    if (noise > 0.55) warnings.push({ code: 'noisy', text: 'تشويش شديد في الصورة قد يسبب تشوهات.' });
    if (contrast < 0.06) warnings.push({ code: 'flat', text: 'تباين منخفض — الجسم قد يكون غير واضح.' });
    const blocking = warnings.some(x => x.code === 'too-small' && Math.min(w, h) < 96);

    return {
      width: w, height: h, aspect: w / h, megapixels: (n / 1e6),
      brightness: mean, contrast, saturation,
      sharpness, noise, darkRatio, brightRatio,
      avgColor: { r: sumR / n, g: sumG / n, b: sumB / n },
      light: { dir: lightDir, angle: lightAngle, strength: AI3D.util.clamp(lightMag * 6, 0, 1) },
      perspective: { tiltHint, skew: perspectiveSkew, horizonScore: horizonScore / totalOri },
      quality: { resolution: resScore, sharpness: qSharp, noise: qNoise, exposure: qExpo, contrast: qContrast, overall },
      warnings, blocking
    };
  }

  /* تصحيح المنظور (مواصفة 43): إمالة عكسية خفيفة + قص */
  function correctPerspective(canvas, skew, strength) {
    strength = strength == null ? 0.5 : strength;
    const w = canvas.width, h = canvas.height;
    const shift = AI3D.util.clamp(skew, -0.5, 0.5) * w * 0.06 * strength;
    if (Math.abs(shift) < 0.5) return canvas;
    const out = AI3D.util.makeCanvas(w, h);
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    ctx.setTransform(1, 0, shift / h, 1, -shift / 2, 0);
    ctx.drawImage(canvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return out;
  }

  /* تحسين الصورة الاختياري (مواصفة 44/45): تباين تكيفي + إزالة ضجيج + حدة */
  function enhanceImage(canvas, opts) {
    opts = opts || {};
    const w = canvas.width, h = canvas.height;
    const src = AI3D.util.getImageData(canvas);
    const d = src.data, n = w * h;
    const lum = F.luminanceField(src, w, h);
    // متوسط محلي لتسوية الإضاءة (unsharp-mask مضاد للضباب)
    const local = F.boxBlur(Float32Array.from(lum), w, h, Math.max(4, (Math.min(w, h) / 40) | 0), 2);
    const out = AI3D.util.makeCanvas(w, h);
    const octx = out.getContext('2d');
    const dst = octx.createImageData(w, h);
    const o = dst.data;
    const amt = opts.amount == null ? 0.6 : opts.amount;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const boost = AI3D.util.clamp(0.5 + (lum[i] - local[i]) * 1.6, 0, 1.35);
      const lift = 1 + (0.5 - local[i]) * 0.22 * amt; // موازنة ظلال/إضاءة
      let r = d[p] * boost * lift, g = d[p + 1] * boost * lift, b = d[p + 2] * boost * lift;
      // تشبع لطيف
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = 1 + 0.12 * amt;
      const mid = (mx + mn) / 2;
      r = mid + (r - mid) * sat; g = mid + (g - mid) * sat; b = mid + (b - mid) * sat;
      o[p] = AI3D.util.clamp(r, 0, 255); o[p + 1] = AI3D.util.clamp(g, 0, 255);
      o[p + 2] = AI3D.util.clamp(b, 0, 255); o[p + 3] = 255;
    }
    octx.putImageData(dst, 0, 0);
    return out;
  }

  AI3D.Analysis = { analyzeImage, correctPerspective, enhanceImage };
  AI3D.Models.register('analysis', analyzeImage);
})(window);
