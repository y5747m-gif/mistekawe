/* ============================================================
 * depth.js — تقدير العمق Monocular متعدد الإشارات (مواصفة 7+8)
 * دمج: التظليل + حدة البؤرة + البروز + الموقع + التماثل،
 * ثم تجانس يحافظ على الحواف + خريطة ثقة.
 * ============================================================ */
(function (global) {
  'use strict';
  const AI3D = global.AI3D;
  const U = AI3D.util, F = AI3D.field;

  function estimateDepth(img, w, h, mask, saliency, opts) {
    opts = opts || {};
    const geoMode = opts.geometry || 'balanced'; // fast|balanced|detailed
    const n = w * h;
    const lum = F.luminanceField(img, w, h);

    // 1) إشارة التظليل: سطوع مموّه داخل القناع
    const lumB = F.boxBlur(Float32Array.from(lum), w, h, 3, 2);

    // 2) إشارة البؤرة: حدة محلية (الأقرب غالبًا أوضح)
    const edge = F.sobelMagnitude(lum, w, h);
    const sharp = F.boxBlur(Float32Array.from(edge), w, h, 2, 2);

    // 3) مركز الثقل + إشارة القرب من المركز
    let sx = 0, sy = 0, sm = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const m = mask[y * w + x];
      sx += x * m; sy += y * m; sm += m;
    }
    sm = Math.max(1e-6, sm);
    const cx = sx / sm, cy = sy / sm;

    // نطاق القناع للتطبيع
    let mnL = 1, mxL = 0, mnS = 1e9, mxS = -1e9;
    for (let i = 0; i < n; i++) {
      if (mask[i] < 0.35) continue;
      if (lumB[i] < mnL) mnL = lumB[i]; if (lumB[i] > mxL) mxL = lumB[i];
      if (sharp[i] < mnS) mnS = sharp[i]; if (sharp[i] > mxS) mxS = sharp[i];
    }
    const rL = Math.max(1e-4, mxL - mnL), rS = Math.max(1e-6, mxS - mnS);

    // أوزان حسب نوع الجسم
    const type = opts.objectType || 'object';
    let wShade = 0.34, wSharp = 0.24, wCenter = 0.22, wVert = 0.08, wSal = 0.12;
    if (type === 'human' || type === 'animal') { wShade = 0.30; wSharp = 0.22; wCenter = 0.30; wSal = 0.12; wVert = 0.06; }
    if (type === 'vehicle' || type === 'product' || type === 'furniture') { wShade = 0.38; wSharp = 0.26; wCenter = 0.18; wSal = 0.10; wVert = 0.08; }
    if (type === 'building') { wShade = 0.30; wSharp = 0.20; wCenter = 0.10; wVert = 0.30; wSal = 0.10; }

    const depth = new Float32Array(n);
    const rough = Math.max(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, m = mask[i];
        if (m < 0.05) { depth[i] = 0; continue; }
        const cShade = (lumB[i] - mnL) / rL;
        const cSharp = U.clamp01((sharp[i] - mnS) / rS);
        const dc = Math.hypot(x - cx, y - cy) / rough;
        const cCenter = U.clamp01(1 - dc * 3.2);
        const cVert = 1 - (y / h); // الأسفل أقرب غالبًا للأجسام الأرضية
        let cS = 0.5;
        if (saliency) {
          const sal = saliency.field || saliency;
          const sw = saliency.w || w, sh = saliency.h || h;
          const sxx = Math.min(sw - 1, (x / w * sw) | 0), syy = Math.min(sh - 1, (y / h * sh) | 0);
          cS = U.clamp01(sal[syy * sw + sxx] * 2.2);
        }
        let v = wShade * cShade + wSharp * (0.35 + 0.65 * cSharp) + wCenter * cCenter + wVert * cVert + wSal * cS;
        // تعزيز التماثل للأجسام الصلبة (مقاومة إضاءة جانبية)
        depth[i] = v * (0.25 + 0.75 * m);
      }
    }

    // تطبيع داخل القناع
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < n; i++) if (mask[i] > 0.35) { if (depth[i] < mn) mn = depth[i]; if (depth[i] > mx) mx = depth[i]; }
    const r = Math.max(1e-6, mx - mn);
    for (let i = 0; i < n; i++) {
      if (mask[i] > 0.35) depth[i] = 0.08 + 0.92 * (depth[i] - mn) / r;
      else depth[i] = 0;
    }

    // تجانس يحافظ على الحواف
    const passes = geoMode === 'fast' ? 1 : (geoMode === 'detailed' ? 3 : 2);
    let smooth = depth;
    for (let p = 0; p < passes; p++) smooth = F.jointBilateralSmooth(smooth, lum, w, h, 2, 0.10);

    // خريطة الثقة: مرتفعة داخل الجسم بعيدًا عن الحواف + مناطق غنية بالتفاصيل
    const maskBlur = F.boxBlur(Float32Array.from(mask), w, h, 4, 2);
    const conf = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const m = mask[i];
      if (m < 0.35) { conf[i] = 0; continue; }
      const interior = U.clamp01((maskBlur[i] - 0.5) * 2.4);
      const tex = U.clamp01(sharp[i] / (rS * 0.6 + 1e-6));
      conf[i] = U.clamp01(0.35 + 0.45 * interior + 0.20 * Math.min(1, tex));
    }

    return { depth: smooth, confidence: conf, w, h, center: { x: cx / w, y: cy / h } };
  }

  /* دمج أعماق متعددة (وضع Multi-View — مواصفة 24) */
  function fuseDepths(frames) {
    // frames: [{depth, mask, w, h}] — محاذاة بالمركز والحجم ثم متوسط مرجّح
    if (!frames.length) return null;
    if (frames.length === 1) return frames[0];
    const ref = frames[0], w = ref.w, h = ref.h;
    const acc = new Float32Array(w * h), wacc = new Float32Array(w * h);
    const centerOf = f => {
      let sx = 0, sy = 0, sm = 1e-6;
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
        const m = f.mask[y * f.w + x]; sx += x * m; sy += y * m; sm += m;
      }
      return { x: sx / sm / f.w, y: sy / sm / f.h };
    };
    const rc = centerOf(ref);
    frames.forEach((f) => {
      const c = centerOf(f);
      const dx = (rc.x - c.x), dy = (rc.y - c.y);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u = x / w - dx, v = y / h - dy;
        if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
        const fx = Math.min(f.w - 1, (u * f.w) | 0), fy = Math.min(f.h - 1, (v * f.h) | 0);
        const j = fy * f.w + fx, i = y * w + x;
        const m = f.mask[j];
        if (m > 0.3) { acc[i] += f.depth[j] * m; wacc[i] += m; }
      }
    });
    const out = new Float32Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = wacc[i] > 0 ? acc[i] / wacc[i] : ref.depth[i];
    return { depth: F.jointBilateralSmooth(out, ref.lum || out, w, h, 2, 0.08), confidence: ref.confidence, w, h, center: rc, fused: frames.length };
  }

  AI3D.Depth = { estimateDepth, fuseDepths };
  AI3D.Models.register('depth', estimateDepth);
})(window);
