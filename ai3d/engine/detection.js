/* ============================================================
 * detection.js — اكتشاف الأجسام + العزل عن الخلفية
 * (مواصفة 5 + 6 + 9 + 23)
 * saliency متعدد الإشارات → عتبة Otsu → مكونات متصلة →
 * مقترحات أجسام مصنّفة → تجزئة دقيقة GrabCut-lite.
 * يعمل محليًا بالكامل وقابل للاستبدال بنموذج أقوى عبر AI3D.Models.
 * ============================================================ */
(function (global) {
  'use strict';
  const AI3D = global.AI3D;
  const U = AI3D.util, F = AI3D.field;

  const WORK = 192; // دقة عمل خريطة البروز

  /* خريطة البروز: tuned-frequency + أولوية المركز + كثافة الحواف */
  function saliencyMap(img, w, h) {
    const d = img.data, n = w * h;
    let mR = 0, mG = 0, mB = 0;
    for (let p = 0, i = 0; i < n; i++, p += 4) { mR += d[p]; mG += d[p + 1]; mB += d[p + 2]; }
    mR /= n; mG /= n; mB /= n;
    const sal = new Float32Array(n);
    const cx = w / 2, cy = h / 2, maxD = Math.hypot(cx, cy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, p = i * 4;
        const cd = Math.hypot(d[p] - mR, d[p + 1] - mG, d[p + 2] - mB) / 441.6;
        const dc = Math.hypot(x - cx, y - cy) / maxD;
        const centerPrior = 1 - 0.55 * dc * dc;
        sal[i] = cd * centerPrior;
      }
    }
    const lum = F.luminanceField(img, w, h);
    const edge = F.sobelMagnitude(lum, w, h);
    const edgeBlur = F.boxBlur(edge, w, h, 3, 2);
    for (let i = 0; i < n; i++) sal[i] = sal[i] * 0.72 + Math.min(1, edgeBlur[i] * 3) * 0.28;
    return F.boxBlur(sal, w, h, 2, 1);
  }

  /* وسم المكونات المتصلة (union-find بتمريرتين) */
  function labelComponents(bin, w, h) {
    const labels = new Int32Array(w * h);
    const parent = [0];
    const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
    let next = 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!bin[i]) continue;
        const nb = [];
        if (x > 0 && bin[i - 1]) nb.push(labels[i - 1]);
        if (y > 0 && bin[i - w]) nb.push(labels[i - w]);
        if (!nb.length) { labels[i] = next; parent[next] = next; next++; }
        else {
          let m = nb[0];
          for (const v of nb) if (v < m) m = v;
          labels[i] = m;
          for (const v of nb) if (v !== m) union(m, v);
        }
      }
    }
    // ضغط + إحصاءات
    const remap = new Map(); const stats = [];
    for (let i = 0; i < w * h; i++) {
      if (!bin[i]) continue;
      const r = find(labels[i]);
      let id = remap.get(r);
      if (id === undefined) { id = stats.length; remap.set(r, id); stats.push({ area: 0, x0: w, y0: h, x1: 0, y1: 0, sx: 0, sy: 0 }); }
      const s = stats[id], x = i % w, y = (i / w) | 0;
      s.area++; s.sx += x; s.sy += y;
      if (x < s.x0) s.x0 = x; if (x > s.x1) s.x1 = x;
      if (y < s.y0) s.y0 = y; if (y > s.y1) s.y1 = y;
      labels[i] = id + 1;
    }
    return { labels, stats };
  }

  /* تخمين نوع الجسم من الشكل واللون (مصنّف إرشادي قابل للاستبدال) */
  function guessType(feat) {
    // feat: aspect, fillRatio, solidity, posY, skinScore, metalScore, edgeDensity, symmetry
    const { aspect, fillRatio, skinScore, metalScore, edgeDensity, symmetry } = feat;
    if (skinScore > 0.28 && aspect > 0.45 && aspect < 1.1 && fillRatio > 0.35) return 'human';
    if (skinScore > 0.18 && edgeDensity > 0.30) return 'human';
    if (aspect > 1.7 && symmetry > 0.55 && metalScore > 0.22) return 'vehicle';
    if (aspect > 1.5 && fillRatio > 0.45 && symmetry > 0.5) return 'vehicle';
    if (metalScore > 0.45 && edgeDensity < 0.25) return 'product';
    if (edgeDensity > 0.42 && symmetry < 0.4) return 'animal';
    if (aspect < 0.75 && fillRatio > 0.5) return 'furniture';
    if (aspect > 0.8 && aspect < 1.5 && fillRatio > 0.55) return 'product';
    return 'object';
  }
  const TYPE_AR = { human: 'شخص', vehicle: 'مركبة', furniture: 'أثاث', animal: 'حيوان/عضوي', product: 'منتج', building: 'مبنى', object: 'جسم' };

  function skinScoreOf(img, mask, w, h) {
    const d = img.data;
    let skin = 0, tot = 0;
    for (let i = 0; i < w * h; i += 2) {
      if (!mask[i]) continue; tot++;
      const p = i * 4, r = d[p], g = d[p + 1], b = d[p + 2];
      if (r > 95 && g > 40 && b > 20 && r > g && r > b && (r - Math.min(g, b)) > 15 && Math.abs(r - g) > 12) skin++;
    }
    return tot ? skin / tot : 0;
  }

  function metalScoreOf(img, mask, w, h, lum) {
    const d = img.data;
    let hi = 0, tot = 0, lowSat = 0;
    for (let i = 0; i < w * h; i += 2) {
      if (!mask[i]) continue; tot++;
      const p = i * 4;
      const mx = Math.max(d[p], d[p + 1], d[p + 2]), mn = Math.min(d[p], d[p + 1], d[p + 2]);
      const sat = mx > 0 ? (mx - mn) / mx : 0;
      if (sat < 0.18) lowSat++;
      if (lum[i] > 0.82) hi++;
    }
    if (!tot) return 0;
    return lowSat / tot * 0.6 + (hi / tot) * 2.2 * 0.4;
  }

  /* الاكتشاف الرئيسي: يعيد قائمة أجسام مرتبة */
  function detectObjects(imgFull, wFull, hFull, analysis) {
    // صغّر لشبكة العمل
    const scale = WORK / Math.max(wFull, hFull);
    const w = Math.max(48, Math.round(wFull * scale)), h = Math.max(48, Math.round(hFull * scale));
    const small = U.makeCanvas(w, h);
    const sctx = small.getContext('2d');
    // أعد رسم الصورة الكاملة مصغّرة
    const fullCanvas = U.makeCanvas(wFull, hFull);
    fullCanvas.getContext('2d').putImageData(imgFull, 0, 0);
    sctx.drawImage(fullCanvas, 0, 0, w, h);
    const img = sctx.getImageData(0, 0, w, h);
    const lum = F.luminanceField(img, w, h);
    const sal = saliencyMap(img, w, h);

    const hist = new Uint32Array(256);
    for (let i = 0; i < sal.length; i++) hist[Math.min(255, (sal[i] * 255) | 0)]++;
    let thr = F.otsuThreshold(hist, sal.length);
    thr = U.clamp(thr, 0.12, 0.6);
    const bin = new Uint8Array(w * h);
    for (let i = 0; i < sal.length; i++) bin[i] = sal[i] > thr ? 1 : 0;

    // تنظيف مورفولوجي
    morphClose(bin, w, h, 2);
    const { stats } = labelComponents(bin, w, h);

    const edge = F.sobelMagnitude(lum, w, h);
    const objs = [];
    const minArea = w * h * 0.015;
    stats.forEach((s) => {
      if (s.area < minArea) return;
      const bw = s.x1 - s.x0 + 1, bh = s.y1 - s.y0 + 1;
      const aspect = bw / Math.max(1, bh);
      const fillRatio = s.area / (bw * bh);
      // قناع هذا الجسم
      const m = new Uint8Array(w * h);
      // أعد البناء من bin عبر flood من المركز
      const seedX = Math.round(s.sx / s.area), seedY = Math.round(s.sy / s.area);
      floodFrom(bin, w, h, seedX, seedY, m);
      let edgeSum = 0, ec = 0;
      for (let i = 0; i < w * h; i += 2) if (m[i]) { edgeSum += edge[i]; ec++; }
      const edgeDensity = ec ? U.clamp(edgeSum / ec * 4, 0, 1) : 0;
      const skin = skinScoreOf(img, m, w, h);
      const metal = metalScoreOf(img, m, w, h, lum);
      // تماثل أفقي
      let symA = 0, symC = 0;
      const cxm = (s.x0 + s.x1) / 2;
      for (let y = s.y0; y <= s.y1; y += 2) {
        for (let x = s.x0; x < cxm; x += 2) {
          const xr = Math.round(2 * cxm - x);
          if (xr > s.x1) continue;
          symC++;
          if (!!m[y * w + x] === !!m[y * w + xr]) symA++;
        }
      }
      const symmetry = symC ? symA / symC : 0.5;
      const type = guessType({ aspect, fillRatio, skinScore: skin, metalScore: metal, edgeDensity, symmetry });
      const centrality = 1 - Math.hypot(s.sx / s.area - w / 2, s.sy / s.area - h / 2) / Math.hypot(w, h);
      const score = U.clamp01(0.45 * (s.area / (w * h)) * 6 + 0.35 * centrality + 0.2 * fillRatio);
      objs.push({
        score, type, typeAr: TYPE_AR[type] || type,
        bbox: { x0: s.x0 / w, y0: s.y0 / h, x1: (s.x1 + 1) / w, y1: (s.y1 + 1) / h },
        areaRatio: s.area / (w * h),
        features: { aspect, fillRatio, skin, metal, edgeDensity, symmetry }
      });
    });
    objs.sort((a, b) => b.score - a.score);
    // حد أقصى 6 أجسام
    const objects = objs.slice(0, 6).map((o, k) => ({ id: k, ...o }));
    return { objects, saliency: sal, saliencyW: w, saliencyH: h, threshold: thr };
  }

  function floodFrom(bin, w, h, sx, sy, out) {
    if (!bin[sy * w + sx]) {
      // ابحث عن أقرب بكسل موجب
      let found = false;
      outer: for (let r = 1; r < Math.max(w, h) / 2 && !found; r++) {
        for (let dy = -r; dy <= r && !found; dy += 2) for (let dx = -r; dx <= r && !found; dx += 2) {
          const x = sx + dx, y = sy + dy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          if (bin[y * w + x]) { sx = x; sy = y; found = true; }
        }
      }
      if (!found) return;
    }
    const stack = [sy * w + sx];
    out[sy * w + sx] = 1;
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      if (x > 0 && bin[i - 1] && !out[i - 1]) { out[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && bin[i + 1] && !out[i + 1]) { out[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && bin[i - w] && !out[i - w]) { out[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && bin[i + w] && !out[i + w]) { out[i + w] = 1; stack.push(i + w); }
    }
  }

  function morphClose(bin, w, h, r) {
    morphDilate(bin, w, h, r);
    morphErode(bin, w, h, r);
  }
  function morphDilate(bin, w, h, r) {
    const src = Uint8Array.from(bin);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (src[y * w + x]) continue;
      let hit = false;
      for (let dy = -r; dy <= r && !hit; dy++) for (let dx = -r; dx <= r && !hit; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        if (src[yy * w + xx]) hit = true;
      }
      if (hit) bin[y * w + x] = 1;
    }
  }
  function morphErode(bin, w, h, r) {
    const src = Uint8Array.from(bin);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!src[y * w + x]) continue;
      let ok = true;
      for (let dy = -r; dy <= r && ok; dy++) for (let dx = -r; dx <= r && ok; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) { ok = false; break; }
        if (!src[yy * w + xx]) ok = false;
      }
      if (!ok) bin[y * w + x] = 0;
    }
  }

  function fillHoles(bin, w, h) {
    // فيض من الحدود على الخلفية ثم اعكس
    const bg = new Uint8Array(w * h);
    const stack = [];
    for (let x = 0; x < w; x++) { if (!bin[x]) { bg[x] = 1; stack.push(x); } if (!bin[(h - 1) * w + x]) { bg[(h - 1) * w + x] = 1; stack.push((h - 1) * w + x); } }
    for (let y = 0; y < h; y++) { if (!bin[y * w]) { bg[y * w] = 1; stack.push(y * w); } if (!bin[y * w + w - 1]) { bg[y * w + w - 1] = 1; stack.push(y * w + w - 1); } }
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      const nb = [];
      if (x > 0) nb.push(i - 1); if (x < w - 1) nb.push(i + 1);
      if (y > 0) nb.push(i - w); if (y < h - 1) nb.push(i + w);
      for (const j of nb) if (!bin[j] && !bg[j]) { bg[j] = 1; stack.push(j); }
    }
    for (let i = 0; i < w * h; i++) if (!bg[i]) bin[i] = 1;
  }

  /* تجزئة دقيقة GrabCut-lite داخل bbox مختار (مواصفة 6) */
  function segmentSelection(imgFull, w, h, bbox, opts) {
    opts = opts || {};
    const pad = opts.pad == null ? 0.06 : opts.pad;
    let x0 = Math.max(0, Math.floor((bbox.x0 - pad) * w)), y0 = Math.max(0, Math.floor((bbox.y0 - pad) * h));
    let x1 = Math.min(w, Math.ceil((bbox.x1 + pad) * w)), y1 = Math.min(h, Math.ceil((bbox.y1 + pad) * h));
    const rw = Math.max(8, x1 - x0), rh = Math.max(8, y1 - y0);
    // شبكة عمل للتجزئة
    const SW = 220, SH = Math.max(60, Math.round(SW * rh / rw));
    const region = U.makeCanvas(SW, SH);
    const rctx = region.getContext('2d');
    const fullCanvas = U.makeCanvas(w, h);
    fullCanvas.getContext('2d').putImageData(imgFull, 0, 0);
    rctx.drawImage(fullCanvas, x0, y0, rw, rh, 0, 0, SW, SH);
    const img = rctx.getImageData(0, 0, SW, SH);
    const d = img.data, n = SW * SH;

    // تهيئة: المركز = مقدمة، الحدود = خلفية
    const fg = new Uint8Array(n);
    const cx = SW / 2, cy = SH / 2;
    const rx = SW * 0.36, ry = SH * 0.36;
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      fg[y * SW + x] = (dx * dx + dy * dy < 1) ? 1 : 0;
    }
    // K-means لوني k=2 تكراري
    let cFg = [128, 128, 128], cBg = [128, 128, 128];
    const meanOf = sel => {
      let r = 0, g = 0, b = 0, c = 0;
      for (let i = 0, p = 0; i < n; i += 1, p += 4) {
        if (!!fg[i] !== sel) continue;
        r += d[p]; g += d[p + 1]; b += d[p + 2]; c++;
      }
      c = Math.max(1, c);
      return [r / c, g / c, b / c];
    };
    for (let it = 0; it < 6; it++) {
      cFg = meanOf(true); cBg = meanOf(false);
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        const df = (d[p] - cFg[0]) ** 2 + (d[p + 1] - cFg[1]) ** 2 + (d[p + 2] - cFg[2]) ** 2;
        const db = (d[p] - cBg[0]) ** 2 + (d[p + 1] - cBg[1]) ** 2 + (d[p + 2] - cBg[2]) ** 2;
        // أولوية مكانية خفيفة للمركز
        const x = i % SW, y = (i / SW) | 0;
        const dx = (x - cx) / (SW / 2), dy = (y - cy) / (SH / 2);
        const spatial = (dx * dx + dy * dy) * 900;
        fg[i] = (df - db + (spatial - 900) * 0.15) < 0 ? 1 : 0;
      }
    }
    // احتفظ بأكبر مكون متصل + املأ الثقوب + نظّف
    const { stats, labels } = labelComponents(fg, SW, SH);
    if (stats.length) {
      let best = 0;
      stats.forEach((s, k) => { if (s.area > stats[best].area) best = k; });
      for (let i = 0; i < n; i++) fg[i] = (labels[i] === best + 1) ? 1 : 0;
    }
    fillHoles(fg, SW, SH);
    morphClose(fg, SW, SH, 2);

    // تنعيم الحواف: قناع عائم
    const soft = new Float32Array(n);
    for (let i = 0; i < n; i++) soft[i] = fg[i];
    F.boxBlur(soft, SW, SH, 1, 2);

    // أعد الإسقاط على أبعاد الصورة الكاملة
    const full = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const yy = (y - y0) / rh * SH;
      if (yy < 0 || yy >= SH) continue;
      for (let x = 0; x < w; x++) {
        const xx = (x - x0) / rw * SW;
        if (xx < 0 || xx >= SW) continue;
        const xA = Math.floor(xx), yA = Math.floor(yy);
        full[y * w + x] = soft[Math.min(SH - 1, yA) * SW + Math.min(SW - 1, xA)];
      }
    }
    // حدّث الـ bbox الفعلي من القناع
    let fx0 = w, fy0 = h, fx1 = 0, fy1 = 0, area = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (full[y * w + x] > 0.5) {
        area++;
        if (x < fx0) fx0 = x; if (x > fx1) fx1 = x;
        if (y < fy0) fy0 = y; if (y > fy1) fy1 = y;
      }
    }
    if (!area) { // فشل العزل: استخدم المنطقة كاملة
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) full[y * w + x] = 1;
      fx0 = x0; fy0 = y0; fx1 = x1; fy1 = y1; area = rw * rh;
    }
    return {
      mask: full, w, h,
      bbox: { x0: fx0 / w, y0: fy0 / h, x1: (fx1 + 1) / w, y1: (fy1 + 1) / h },
      coverage: area / (w * h)
    };
  }

  /* دمج أقنعة عدة أجسام (وضع تحويل الكل) */
  function unionBoxes(objects) {
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const o of objects) {
      x0 = Math.min(x0, o.bbox.x0); y0 = Math.min(y0, o.bbox.y0);
      x1 = Math.max(x1, o.bbox.x1); y1 = Math.max(y1, o.bbox.y1);
    }
    return { x0, y0, x1, y1 };
  }

  AI3D.Detection = { detectObjects, segmentSelection, unionBoxes, labelComponents, fillHoles, TYPE_AR };
  AI3D.Models.register('detection', detectObjects);
  AI3D.Models.register('segmentation', segmentSelection);
})(window);
