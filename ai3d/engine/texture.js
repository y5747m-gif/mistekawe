/* ============================================================
 * texture.js — الـ Texture والـ UV والخامات (مواصفة 14-19)
 * فصل اللون عن الإضاءة/الانعكاس + خريطة Normal + تقدير المادة.
 * ============================================================ */
(function (global) {
  'use strict';
  const AI3D = global.AI3D;
  const U = AI3D.util, F = AI3D.field;

  const TEX_SIZE = { standard: 512, high: 1024, ultra: 2048 };

  /* بناء الـ Texture من الصورة الأصلية + القناع */
  function buildTexture(imgCanvas, mask, w, h, quality) {
    const size = TEX_SIZE[quality] || 1024;
    const aspect = w / h;
    let tw = size, th = size;
    if (aspect >= 1) th = Math.round(size / aspect); else tw = Math.round(size * aspect);
    tw = Math.max(64, tw); th = Math.max(64, th);

    // 1) فصل الإضاءة: قسمة على حقل إضاءة مموّه (يقلل الظلال الثابتة)
    const img = imgCanvas.getContext('2d').getImageData(0, 0, w, h);
    const d = img.data, n = w * h;
    const lum = F.luminanceField(img, w, h);
    const light = F.boxBlur(Float32Array.from(lum), w, h, Math.max(6, (Math.min(w, h) / 24) | 0), 2);
    const albedo = U.makeCanvas(w, h);
    const actx = albedo.getContext('2d');
    const aimg = actx.createImageData(w, h);
    const o = aimg.data;
    // كبح البريق العاكس (specular suppression)
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const L = light[i];
      const norm = 0.55 + 0.45 * U.clamp01(L * 1.6); // لا نلغي الإضاءة كليًا
      let r = d[p] / 255 / norm, g = d[p + 1] / 255 / norm, b = d[p + 2] / 255 / norm;
      const mx = Math.max(r, g, b);
      if (mx > 1) { r /= mx; g /= mx; b /= mx; } // قص البريق
      o[p] = U.clamp(r * 255, 0, 255); o[p + 1] = U.clamp(g * 255, 0, 255);
      o[p + 2] = U.clamp(b * 255, 0, 255); o[p + 3] = 255;
    }
    actx.putImageData(aimg, 0, 0);

    // 2) قناع ألفا ناعم + تمديد الحواف (dilation للـ UV bleeding)
    const alpha = U.makeCanvas(w, h);
    const alctx = alpha.getContext('2d');
    const alimg = alctx.createImageData(w, h);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      alimg.data[p] = alimg.data[p + 1] = alimg.data[p + 2] = 255;
      alimg.data[p + 3] = U.clamp(mask[i], 0, 1) * 255;
    }
    alctx.putImageData(alimg, 0, 0);

    // 3) التركيب النهائي بالدقة المطلوبة
    const tex = U.makeCanvas(tw, th);
    const tctx = tex.getContext('2d');
    tctx.clearRect(0, 0, tw, th);
    tctx.drawImage(albedo, 0, 0, tw, th);
    // طبّق الألفا
    tctx.globalCompositeOperation = 'destination-in';
    tctx.drawImage(alpha, 0, 0, tw, th);
    tctx.globalCompositeOperation = 'source-over';

    return { canvas: tex, width: tw, height: th };
  }

  /* خريطة Normal من العمق (للتفاصيل السطحية الدقيقة) */
  function buildNormalMap(depth, w, h, strength) {
    strength = strength == null ? 2.0 : strength;
    const c = U.makeCanvas(w, h);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    const o = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const dx = (depth[y * w + Math.min(w - 1, x + 1)] - depth[y * w + Math.max(0, x - 1)]) * strength;
        const dy = (depth[Math.min(h - 1, y + 1) * w + x] - depth[Math.max(0, y - 1) * w + x]) * strength;
        const inv = 1 / Math.hypot(dx, dy, 1);
        o[i * 4] = (-dx * inv * 0.5 + 0.5) * 255;
        o[i * 4 + 1] = (-dy * inv * 0.5 + 0.5) * 255;
        o[i * 4 + 2] = (inv * 0.5 + 0.5) * 255;
        o[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /* تقدير الخامة (مواصفة 15 + 17 + 18) */
  function estimateMaterial(img, w, h, mask, analysis, objectType) {
    const d = img.data, n = w * h;
    const lum = F.luminanceField(img, w, h);
    let sat = 0, edgeHi = 0, tot = 0, bright = 0, dark = 0, mid = 0;
    const edge = F.sobelMagnitude(lum, w, h);
    for (let i = 0, p = 0; i < n; i += 3, p += 12) {
      if (mask[i] < 0.5) continue;
      tot++;
      const mx = Math.max(d[p], d[p + 1], d[p + 2]), mn = Math.min(d[p], d[p + 1], d[p + 2]);
      sat += mx > 0 ? (mx - mn) / mx : 0;
      if (edge[i] > 0.25) edgeHi++;
      const L = lum[i];
      if (L > 0.8) bright++; else if (L < 0.15) dark++; else mid++;
    }
    tot = Math.max(1, tot);
    sat /= tot;
    const edgeRatio = edgeHi / tot;
    const brightRatio = bright / tot, darkRatio = dark / tot;

    // تصنيف إرشادي للمادة
    let material = 'plastic', roughness = 0.6, metallic = 0.0, transparency = 0;
    const scores = {};
    scores.metal = (sat < 0.25 ? 0.5 : 0) + brightRatio * 2.2 + (edgeRatio < 0.2 ? 0.2 : 0);
    scores.glass = brightRatio * 1.4 + (sat < 0.15 ? 0.4 : 0) + (analysis.contrast > 0.2 ? 0.3 : 0);
    scores.fabric = (edgeRatio > 0.3 ? 0.5 : 0) + (sat > 0.25 ? 0.3 : 0) + (brightRatio < 0.05 ? 0.3 : 0);
    scores.wood = (sat > 0.3 && sat < 0.65 ? 0.4 : 0) + (edgeRatio > 0.15 && edgeRatio < 0.4 ? 0.4 : 0);
    scores.skin = (objectType === 'human' ? 0.9 : 0);
    scores.rubber = (darkRatio > 0.4 && sat < 0.3 ? 0.7 : 0);
    let best = 'plastic', bestS = 0.35;
    for (const k in scores) if (scores[k] > bestS) { bestS = scores[k]; best = k; }
    material = best === 'skin' ? 'skin' : best;

    switch (material) {
      case 'metal': roughness = 0.32; metallic = 0.85; break;
      case 'glass': roughness = 0.08; metallic = 0.1; transparency = 0.55; break;
      case 'fabric': roughness = 0.92; metallic = 0; break;
      case 'wood': roughness = 0.7; metallic = 0; break;
      case 'skin': roughness = 0.55; metallic = 0; break;
      case 'rubber': roughness = 0.9; metallic = 0; break;
      default: roughness = 0.6; metallic = 0.05;
    }
    // كشف شفافية إضافي: تباين داخلي منخفض جدًا + سطوع عالٍ
    if (brightRatio > 0.25 && analysis.contrast < 0.12 && material !== 'glass') {
      transparency = 0.3; roughness = Math.min(roughness, 0.25);
    }

    const MATERIAL_AR = {
      metal: 'معدن', glass: 'زجاج', fabric: 'قماش', wood: 'خشب',
      skin: 'بشرة', rubber: 'مطاط', plastic: 'بلاستيك'
    };
    return {
      material, materialAr: MATERIAL_AR[material] || material,
      roughness: +roughness.toFixed(2), metallic: +metallic.toFixed(2),
      transparency: +transparency.toFixed(2),
      stats: { saturation: +sat.toFixed(2), edgeRatio: +edgeRatio.toFixed(2), brightRatio: +brightRatio.toFixed(2) }
    };
  }

  /* عرض خريطة العمق ملوّنة (للمراجعة) */
  function renderDepthPreview(depth, mask, w, h) {
    const c = U.makeCanvas(w, h);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    const o = img.data;
    for (let i = 0; i < w * h; i++) {
      const v = U.clamp01(depth[i]);
      // turbo-lite colormap
      const r = U.clamp01(1.6 * v - 0.15), g = U.clamp01(1.8 * v * (1 - v) * 2 - 0.1), b = U.clamp01(1.4 * (1 - v) - 0.15);
      o[i * 4] = r * 255; o[i * 4 + 1] = g * 255; o[i * 4 + 2] = b * 255;
      o[i * 4 + 3] = mask[i] > 0.05 ? 255 : 40;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function renderMaskPreview(mask, w, h, bgCanvas) {
    const c = U.makeCanvas(w, h);
    const ctx = c.getContext('2d');
    if (bgCanvas) { ctx.globalAlpha = 0.35; ctx.drawImage(bgCanvas, 0, 0, w, h); ctx.globalAlpha = 1; }
    const img = ctx.getImageData(0, 0, w, h);
    const o = img.data;
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      const m = U.clamp01(mask[i]);
      o[p] = o[p] * (1 - m * 0.6) + 255 * m * 0.6;
      o[p + 1] = o[p + 1] * (1 - m * 0.6) + 60 * m * 0.6;
      o[p + 2] = o[p + 2] * (1 - m * 0.6) + 60 * m * 0.6;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  AI3D.Texture = { buildTexture, buildNormalMap, estimateMaterial, renderDepthPreview, renderMaskPreview, TEX_SIZE };
  AI3D.Models.register('texture', buildTexture);
})(window);
