/* ============================================================
 * detection.js — اكتشاف الأجسام + فهم النوع + ترشيح الأجزاء
 * (مواصفة 5 • 9 • 21 • 23)
 *  SLIC superpixels → Saliency Optimization (backgroundness) →
 *  مكوّنات متصلة → مقترحات أجسام → مصنّف سمات (prototype scoring)
 *  كل شيء محلي: لا YOLO سحابي، ولا أي API خارجي.
 * ============================================================ */
(function (global) {
  'use strict';
  const AI3D = global.AI3D;
  const U = AI3D.util, F = AI3D.field, C = AI3D.color;
  const clamp = U.clamp, clamp01 = U.clamp01;

  const TYPE_AR = {
    vehicle: 'مركبة', human: 'شخص', animal: 'حيوان', furniture: 'أثاث',
    building: 'مبنى', product: 'منتج', electronics: 'جهاز إلكتروني',
    clothing: 'ملابس', object: 'جسم', plant: 'نبات'
  };

  /* ---------------- SLIC superpixels ---------------- */
  function slic(img, w, h, k, compactness, iters) {
    const n = w * h;
    const S = Math.max(2, Math.sqrt(n / k));
    const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
    const d = img.data;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const lab = C.rgb2lab(d[p], d[p + 1], d[p + 2]);
      L[i] = lab[0]; A[i] = lab[1]; B[i] = lab[2];
    }
    const centers = [];
    const gw = Math.max(1, Math.round(w / S)), gh = Math.max(1, Math.round(h / S));
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const cx = Math.min(w - 1, Math.round((gx + 0.5) * S));
      const cy = Math.min(h - 1, Math.round((gy + 0.5) * S));
      const i = cy * w + cx;
      centers.push({ x: cx, y: cy, l: L[i], a: A[i], b: B[i] });
    }
    const labels = new Int32Array(n).fill(-1);
    const dist = new Float32Array(n).fill(Infinity);
    const mS = (compactness * compactness) / (S * S);
    for (let it = 0; it < (iters || 6); it++) {
      dist.fill(Infinity);
      for (let ci = 0; ci < centers.length; ci++) {
        const c = centers[ci];
        const x0 = Math.max(0, Math.floor(c.x - S)), x1 = Math.min(w - 1, Math.ceil(c.x + S));
        const y0 = Math.max(0, Math.floor(c.y - S)), y1 = Math.min(h - 1, Math.ceil(c.y + S));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const i = y * w + x;
          const dl = L[i] - c.l, da = A[i] - c.a, db = B[i] - c.b;
          const dc = dl * dl + da * da + db * db;
          const dx = x - c.x, dy = y - c.y;
          const ds = dx * dx + dy * dy;
          const dd = dc + ds * mS;
          if (dd < dist[i]) { dist[i] = dd; labels[i] = ci; }
        }
      }
      const sums = new Float64Array(centers.length * 5);
      const cnt = new Int32Array(centers.length);
      for (let i = 0; i < n; i++) {
        const ci = labels[i]; if (ci < 0) continue;
        const x = i % w, y = (i / w) | 0;
        sums[ci * 5] += x; sums[ci * 5 + 1] += y;
        sums[ci * 5 + 2] += L[i]; sums[ci * 5 + 3] += A[i]; sums[ci * 5 + 4] += B[i];
        cnt[ci]++;
      }
      for (let ci = 0; ci < centers.length; ci++) {
        if (!cnt[ci]) continue;
        centers[ci].x = sums[ci * 5] / cnt[ci];
        centers[ci].y = sums[ci * 5 + 1] / cnt[ci];
        centers[ci].l = sums[ci * 5 + 2] / cnt[ci];
        centers[ci].a = sums[ci * 5 + 3] / cnt[ci];
        centers[ci].b = sums[ci * 5 + 4] / cnt[ci];
        centers[ci].area = cnt[ci];
      }
    }
    // تجانس: اربط المكوّنات المتصلة الصغيرة بجيرانها
    const K = centers.length;
    const area = new Int32Array(K);
    for (let i = 0; i < n; i++) if (labels[i] >= 0) area[labels[i]]++;
    const meanL = new Float32Array(K), meanA = new Float32Array(K), meanB = new Float32Array(K);
    const cxArr = new Float32Array(K), cyArr = new Float32Array(K);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, ci = labels[i]; if (ci < 0) continue;
      meanL[ci] += L[i]; meanA[ci] += A[i]; meanB[ci] += B[i]; cxArr[ci] += x; cyArr[ci] += y;
    }
    for (let ci = 0; ci < K; ci++) {
      const a = Math.max(1, area[ci]);
      meanL[ci] /= a; meanA[ci] /= a; meanB[ci] /= a; cxArr[ci] /= a; cyArr[ci] /= a;
    }
    // المجاورة
    const adj = Array.from({ length: K }, () => new Set());
    for (let y = 1; y < h; y++) for (let x = 1; x < w; x++) {
      const i = y * w + x, a = labels[i];
      if (a < 0) continue;
      const r = labels[i - 1], dn = labels[i - w];
      if (r >= 0 && r !== a) { adj[a].add(r); adj[r].add(a); }
      if (dn >= 0 && dn !== a) { adj[a].add(dn); adj[dn].add(a); }
    }
    return {
      labels, K, w, h, area, adj: adj.map(s => [...s]),
      meanL, meanA, meanB, cx: cxArr, cy: cyArr
    };
  }

  /* ---------------- Saliency Optimization ---------------- */
  function saliencyFromSuperpixels(sp, w, h) {
    const K = sp.K;
    // وزن الخلفية الابتدائي: المكوّنات التي تلامس حدود الصورة
    const bgW = new Float32Array(K);
    const bw = Math.max(2, Math.round(w * 0.03)), bh = Math.max(2, Math.round(h * 0.03));
    const K0 = sp.K;
    for (let ci = 0; ci < K0; ci++) {
      const x = sp.cx[ci], y = sp.cy[ci];
      let border = 0;
      const px = clamp(Math.round(x), 0, w - 1), py = clamp(Math.round(y), 0, h - 1);
      if (px < bw || py < bh || px > w - bw || py > h - bh) border = 1;
      bgW[ci] = border;
    }
    // affinities
    const aff = [];
    for (let ci = 0; ci < K; ci++) {
      const list = sp.adj[ci], arr = [];
      let sum = 0;
      for (const cj of list) {
        const dl = sp.meanL[ci] - sp.meanL[cj], da = sp.meanA[ci] - sp.meanA[cj], db = sp.meanB[ci] - sp.meanB[cj];
        const a = Math.exp(-(dl * dl + da * da + db * db) / 320);
        arr.push({ j: cj, a }); sum += a;
      }
      for (const e of arr) e.a /= (sum || 1);
      aff.push(arr);
    }
    // انتشار الخلفية: حلّ هارموني (عقد الحدود ممتصّة بقيمة 1)
    // القيمة الناتجة ≈ احتمال وصول مسيرة عشوائية من العقدة إلى الحدود،
    // فتنخفض داخل الجسم وترتفع في الخلفية (Saliency Optimization).
    let bg = Float32Array.from(bgW);
    const isBorder = new Uint8Array(K);
    for (let ci = 0; ci < K; ci++) isBorder[ci] = bgW[ci] > 0.5 ? 1 : 0;
    for (let it = 0; it < 150; it++) {
      const nb = new Float32Array(K);
      let delta = 0;
      for (let ci = 0; ci < K; ci++) {
        if (isBorder[ci]) { nb[ci] = 1; continue; }
        let s = 0, wsum = 0;
        for (const e of aff[ci]) { s += e.a * bg[e.j]; wsum += e.a; }
        nb[ci] = wsum > 1e-6 ? s / wsum : 0;
        delta += Math.abs(nb[ci] - bg[ci]);
      }
      bg = nb;
      if (delta < 1e-4) break;
    }
    // تميّز اللون: بعد المسافة عن متوسط الصورة المرجّح بالمساحة
    let gL = 0, gA = 0, gB = 0, tot = 0;
    for (let ci = 0; ci < K; ci++) { const a = sp.area[ci]; gL += sp.meanL[ci] * a; gA += sp.meanA[ci] * a; gB += sp.meanB[ci] * a; tot += a; }
    gL /= (tot || 1); gA /= (tot || 1); gB /= (tot || 1);
    const sal = new Float32Array(K);
    for (let ci = 0; ci < K; ci++) {
      const dl = sp.meanL[ci] - gL, da = sp.meanA[ci] - gA, db = sp.meanB[ci] - gB;
      const distinct = clamp01(Math.sqrt(dl * dl + da * da + db * db) / 90);
      sal[ci] = clamp01(Math.pow(1 - bg[ci], 1.6) * (0.58 + 0.42 * distinct));
    }
    // صقل بالانتشار مع مركزية خفيفة
    let cur = Float32Array.from(sal);
    for (let it = 0; it < 4; it++) {
      const nb = new Float32Array(K);
      for (let ci = 0; ci < K; ci++) {
        let s = cur[ci], wsum = 1;
        for (const e of aff[ci]) { s += e.a * cur[e.j]; wsum += e.a; }
        nb[ci] = s / wsum;
      }
      cur = nb;
    }
    for (let ci = 0; ci < K; ci++) {
      const cxn = sp.cx[ci] / w - 0.5, cyn = sp.cy[ci] / h - 0.5;
      const centerPrior = clamp01(1 - Math.hypot(cxn * 1.1, cyn * 1.1) * 1.9);
      cur[ci] = clamp01(0.82 * cur[ci] + 0.18 * centerPrior * cur[ci] + 0.03 * centerPrior);
    }
    return cur;
  }

  /* ---------------- دوائر سريعة (عجلات/رؤوس) ---------------- */
  function detectCircles(edge, w, h, rMin, rMax, steps) {
    const thr = F.percentile(edge, 0.88);
    const pts = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (edge[y * w + x] >= thr) pts.push(y * w + x);
    const stride = Math.max(1, Math.floor(pts.length / 2500));
    const out = [];
    const nR = steps || 6;
    for (let ri = 0; ri < nR; ri++) {
      const r = Math.round(rMin + (rMax - rMin) * ri / Math.max(1, nR - 1));
      const acc = new Float32Array(w * h);
      const nAng = Math.max(24, Math.round(2 * Math.PI * r / 2));
      for (let s = 0; s < pts.length; s += stride) {
        const p = pts[s], cx0 = p % w, cy0 = (p / w) | 0;
        for (let a = 0; a < nAng; a++) {
          const t = a / nAng * Math.PI * 2;
          const x = Math.round(cx0 + Math.cos(t) * r), y = Math.round(cy0 + Math.sin(t) * r);
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          acc[y * w + x] += 1;
        }
      }
      const blur = F.boxBlur(acc, w, h, 2, 1);
      const peak = F.percentile(blur, 0.9995);
      for (let i = 0; i < blur.length; i++) {
        if (blur[i] < peak * 0.72 || blur[i] < nAng * 0.35) continue;
        const x = i % w, y = (i / w) | 0;
        let dup = false;
        for (const c of out) if (Math.hypot(c.x - x, c.y - y) < Math.max(6, r * 0.7)) { dup = true; break; }
        if (!dup) out.push({ x: x / w, y: y / h, r: r / Math.max(w, h), votes: blur[i] });
      }
    }
    out.sort((a, b) => b.votes - a.votes);
    return out.slice(0, 12);
  }

  /* ---------------- سمات لكل جسم ---------------- */
  function objectFeatures(img, w, h, mask, bbox, lum, edge) {
    let area = 0, sx = 0, sy = 0;
    let satSum = 0, valSum = 0, n = 0, skinN = 0, greenN = 0, grayN = 0;
    let lumIn = 0, lumOut = 0, nIn = 0, nOut = 0;
    const x0 = Math.max(0, Math.floor(bbox.x0 * w)), x1 = Math.min(w - 1, Math.ceil(bbox.x1 * w));
    const y0 = Math.max(0, Math.floor(bbox.y0 * h)), y1 = Math.min(h - 1, Math.ceil(bbox.y1 * h));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, m = mask[i] > 0.5;
      if (m) {
        area++; sx += x; sy += y;
        const p = i * 4, r = img.data[p] / 255, g = img.data[p + 1] / 255, b = img.data[p + 2] / 255;
        const hsv = C.rgb2hsv(r, g, b);
        satSum += hsv[1]; valSum += hsv[2]; n++;
        if (isSkin(r * 255, g * 255, b * 255)) skinN++;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx - mn < 0.09) grayN++;
        if (g > r * 1.06 && g > b * 1.06 && hsv[0] > 70 && hsv[0] < 170) greenN++;
        lumIn += lum[i]; nIn++;
      } else if (x >= x0 - 8 && x <= x1 + 8 && y >= y0 - 8 && y <= y1 + 8) {
        lumOut += lum[i]; nOut++;
      }
    }
    area = Math.max(1, area); n = Math.max(1, n);
    const bw = Math.max(1e-4, bbox.x1 - bbox.x0), bh = Math.max(1e-4, bbox.y1 - bbox.y0);
    const bboxArea = bw * bh * w * h;
    // محيط (من حافة القناع)
    let perim = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (mask[i] > 0.5 && (mask[i - 1] < 0.5 || mask[i + 1] < 0.5 || mask[i - w] < 0.5 || mask[i + w] < 0.5)) perim++;
    }
    const bwPx = Math.max(1, (x1 - x0)), bhPx = Math.max(1, (y1 - y0));
    // خطوط مستقيمة داخل الجسم
    let edgeIn = 0, nEdge = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * w + x; if (mask[i] < 0.5) continue;
      edgeIn += edge[i]; nEdge++;
    }
    return {
      area, areaRatio: area / (w * h),
      cx: sx / area / w, cy: sy / area / h,
      aspect: bwPx / bhPx,
      fillRatio: area / Math.max(1, bboxArea),
      compactness: clamp01((perim * perim) / (4 * Math.PI * area) / 4),
      saturation: satSum / n, value: valSum / n,
      skinRatio: skinN / n, greenRatio: greenN / n, grayRatio: grayN / n,
      edgeDensity: clamp01(edgeIn / Math.max(1, nEdge) * 6),
      contrastWithBg: clamp01(Math.abs(lumIn / Math.max(1, nIn) - lumOut / Math.max(1, nOut)) * 2.6),
      bbox
    };
  }
  function isSkin(r, g, b) {
    return r > 95 && g > 40 && b > 20 && r > g && r > b &&
           (Math.max(r, g, b) - Math.min(r, g, b)) > 15 && Math.abs(r - g) > 15;
  }

  /* ---------------- المصنّف (prototype scoring) ---------------- */
  const PROTOTYPES = {
    human: { aspect: 0.55, fill: 0.48, sym: 0.7, skin: 0.18, edge: 0.4, sat: 0.35 },
    animal: { aspect: 1.45, fill: 0.55, sym: 0.6, skin: 0.02, edge: 0.45, sat: 0.3 },
    vehicle: { aspect: 2.1, fill: 0.72, sym: 0.5, skin: 0.0, edge: 0.5, sat: 0.4 },
    furniture: { aspect: 1.0, fill: 0.62, sym: 0.75, skin: 0.02, edge: 0.45, sat: 0.3 },
    building: { aspect: 1.1, fill: 0.8, sym: 0.5, skin: 0.0, edge: 0.6, sat: 0.2 },
    product: { aspect: 0.85, fill: 0.68, sym: 0.8, skin: 0.02, edge: 0.35, sat: 0.45 },
    electronics: { aspect: 1.6, fill: 0.8, sym: 0.85, skin: 0.0, edge: 0.4, sat: 0.25 },
    clothing: { aspect: 0.9, fill: 0.6, sym: 0.8, skin: 0.05, edge: 0.35, sat: 0.4 },
    plant: { aspect: 1.0, fill: 0.5, sym: 0.5, skin: 0.0, edge: 0.6, sat: 0.45 }
  };
  function classify(feat, ctx) {
    const scores = {};
    let best = 'object', bestScore = -1;
    for (const key of Object.keys(PROTOTYPES)) {
      const p = PROTOTYPES[key];
      let s = 0;
      s += 0.26 * gauss(Math.log(Math.max(0.2, feat.aspect) / p.aspect), 0.42);
      s += 0.16 * gauss(feat.fillRatio - p.fill, 0.22);
      s += 0.14 * gauss(feat.symmetry - p.sym, 0.3);
      s += 0.12 * gauss(feat.saturation - p.sat, 0.28);
      s += 0.1 * gauss(feat.edgeDensity - p.edge, 0.3);
      s += 0.1 * gauss(feat.grayRatio - (key === 'electronics' ? 0.5 : 0.25), 0.35);
      // أدلة خاصة
      if (key === 'human') s += 0.30 * clamp01(feat.skinRatio / 0.16) + 0.12 * clamp01(feat.headHint || 0);
      if (key === 'animal') s += 0.18 * clamp01(feat.greenRatio * 0.4) + 0.1 * clamp01(1 - feat.skinRatio * 6) + 0.08 * clamp01(feat.legsHint || 0);
      if (key === 'vehicle') s += 0.34 * clamp01((feat.wheelHint || 0)) + 0.1 * clamp01(feat.aspect / 1.8);
      if (key === 'building') s += 0.22 * clamp01(feat.areaRatio / 0.35) + 0.16 * clamp01((feat.verticalLines || 0));
      if (key === 'product') s += 0.26 * clamp01(1 - ctx.backgroundComplexity * 1.5) + 0.14 * clamp01(1 - Math.hypot(feat.cx - 0.5, feat.cy - 0.5) * 2);
      if (key === 'plant') s += 0.3 * clamp01(feat.greenRatio / 0.25);
      if (key === 'electronics') s += 0.2 * clamp01(feat.aspect > 1 ? 1 : 0) + 0.1 * clamp01(feat.edgeDensity * 0.5);
      if (key === 'furniture') s += 0.16 * clamp01(feat.verticalLines || 0) + 0.1 * clamp01(feat.aspect < 1.6 ? 1 : 0);
      scores[key] = s;
      if (s > bestScore) { bestScore = s; best = key; }
    }
    // ثقة: الفارق عن ثاني أفضل
    const sorted = Object.values(scores).sort((a, b) => b - a);
    const margin = clamp01((sorted[0] - (sorted[1] || 0)) * 2.2);
    const conf = clamp01(0.45 + 0.35 * clamp01(sorted[0]) + 0.2 * margin);
    if (sorted[0] < 0.34) { best = 'object'; }
    return { type: best, typeAr: TYPE_AR[best] || 'جسم', score: conf, scores };
  }
  function gauss(x, sigma) { const t = x / sigma; return Math.exp(-0.5 * t * t); }

  function symmetryOfMask(mask, w, h, bbox) {
    const x0 = Math.max(0, Math.floor(bbox.x0 * w)), x1 = Math.min(w - 1, Math.ceil(bbox.x1 * w));
    const y0 = Math.max(0, Math.floor(bbox.y0 * h)), y1 = Math.min(h - 1, Math.ceil(bbox.y1 * h));
    let inter = 0, union = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const mx = x0 + x1 - x;
      if (mx < 0 || mx >= w) continue;
      const a = mask[y * w + x] > 0.5, b = mask[y * w + mx] > 0.5;
      if (a && b) inter++;
      if (a || b) union++;
    }
    return union ? inter / union : 0;
  }
  function verticalLineRatio(edge, w, h, mask) {
    const { gx, gy } = F.gradientXY(edge, w, h);
    let v = 0, tot = 0;
    for (let i = 0; i < edge.length; i++) {
      if (mask[i] < 0.5 || edge[i] < 0.04) continue;
      const a = Math.atan2(Math.abs(gy[i]), Math.abs(gx[i]) + 1e-6) * 180 / Math.PI;
      if (a > 62) v++;
      tot++;
    }
    return tot ? clamp01(v / tot * 1.5) : 0;
  }

  /* ---------------- الواجهة الرئيسية ---------------- */
  function detectObjects(img, w, h, analysis, opts) {
    opts = opts || {};
    const work = AI3D.Analysis.pickWorkSize(w, h, opts.quality || 'medium');
    const sImg = (work.w === w && work.h === h) ? img : U.resizeImage(img, work.w, work.h);
    const sw = sImg.width, sh = sImg.height;
    const lum = AI3D.Analysis.lumaImage(sImg);
    const edge = F.sobelMagnitude(lum, sw, sh);
    const backgroundComplexity = (analysis && analysis.backgroundComplexity) || clamp01(F.percentile(edge, 0.8) * 6);

    const kTarget = clamp(Math.round(sw * sh / 260), 120, 620);
    const sp = slic(sImg, sw, sh, kTarget, 18, 6);
    const salSP = saliencyFromSuperpixels(sp, sw, sh);
    const sal = new Float32Array(sw * sh);
    for (let i = 0; i < sal.length; i++) sal[i] = sp.labels[i] >= 0 ? salSP[sp.labels[i]] : 0;
    const salSmooth = F.jointBilateralSmooth(sal, lum, sw, sh, 2, 0.14);

    // عتبة أوتسو
    const hist = new Float32Array(256);
    for (let i = 0; i < salSmooth.length; i++) hist[clamp(Math.round(salSmooth[i] * 255), 0, 255)]++;
    let threshold = F.otsuThreshold(hist, salSmooth.length);
    threshold = clamp(threshold * 0.92, 0.18, 0.72);

    let bin = new Float32Array(sw * sh);
    for (let i = 0; i < bin.length; i++) bin[i] = salSmooth[i] >= threshold ? 1 : 0;
    // فتح مورفولوجي (تعرية ثم توسيع) لتنظيف النتوءات الصغيرة
    bin = F.morph(bin, sw, sh, 1, 'erode');
    bin = F.morph(bin, sw, sh, 1, 'dilate');
    // تنظيف: املأ الثقوب واحذف المكوّنات الصغيرة
    let ccMask = Float32Array.from(bin);
    ccMask = F.fillHoles(ccMask, sw, sh, 0.2);
    const kept = F.keepComponents(ccMask, sw, sh, 0.004, 6);
    let fg = kept.mask;
    // استبعاد المكوّنات التي تلامس حدود الصورة (غالبًا خلفية) إن وُجد بديل
    {
      const cc2 = F.connectedComponents(fg, sw, sh);
      const nonBorder = cc2.stats.filter(s => s.bbox.x0 > 0.02 && s.bbox.y0 > 0.02 && s.bbox.x1 < 0.98 && s.bbox.y1 < 0.98);
      if (nonBorder.length) {
        const keepIds = new Set(nonBorder.map(s => s.id));
        const out = new Float32Array(sw * sh);
        for (let i = 0; i < out.length; i++) if (cc2.labels[i] >= 0 && keepIds.has(cc2.labels[i])) out[i] = 1;
        let s2 = 0; for (let i = 0; i < out.length; i++) s2 += out[i];
        if (s2 / out.length > 0.004) fg = out;
      }
    }
    // لو فشل العزل (خلفية معقّدة أو القناع يغطي كل الصورة) → احتياطي
    let areaSum = 0;
    for (let i = 0; i < fg.length; i++) areaSum += fg[i];
    const ratio = areaSum / fg.length;
    let fallback = false;
    if (ratio < 0.005 || ratio > 0.92) {
      fallback = true;
      fg = new Float32Array(sw * sh);
      const bx0 = 0.08 * sw, bx1 = 0.92 * sw, by0 = 0.08 * sh, by1 = 0.92 * sh;
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        if (x >= bx0 && x <= bx1 && y >= by0 && y <= by1) fg[y * sw + x] = 1;
      }
    }

    const cc = F.connectedComponents(fg, sw, sh);
    const objects = [];
    const totalPx = sw * sh;
    const maxObjs = opts.maxObjects || 6;
    for (let c = 0; c < Math.min(cc.count, maxObjs); c++) {
      const st = cc.stats[c];
      if (st.area / totalPx < 0.004) continue;
      const mask = new Float32Array(sw * sh);
      for (let i = 0; i < mask.length; i++) mask[i] = cc.labels[i] === st.id ? 1 : 0;
      const bbox = st.bbox;
      const feat = objectFeatures(sImg, sw, sh, mask, bbox, lum, edge);
      feat.symmetry = symmetryOfMask(mask, sw, sh, bbox);
      feat.verticalLines = verticalLineRatio(edge, sw, sh, mask);
      // أدلة خاصة: عجلات (دوائر في الثلث السفلي) + رأس (دائرة في الثلث العلوي)
      const circles = detectCircles(edge, sw, sh, Math.max(6, Math.round(Math.min(sw, sh) * 0.045)), Math.max(10, Math.round(Math.min(sw, sh) * 0.16)), 5);
      const inBox = circles.filter(cc2 => cc2.x > bbox.x0 && cc2.x < bbox.x1 && cc2.y > bbox.y0 && cc2.y < bbox.y1);
      const lower = inBox.filter(cc2 => cc2.y > (bbox.y0 + (bbox.y1 - bbox.y0) * 0.62));
      const upper = inBox.filter(cc2 => cc2.y < (bbox.y0 + (bbox.y1 - bbox.y0) * 0.3));
      feat.wheelHint = clamp01(lower.length / 2);
      feat.headHint = clamp01(upper.length);
      feat.legsHint = clamp01(lower.length / 3);
      const cls = classify(feat, { backgroundComplexity });
      let objScore = clamp01(0.4 * cls.score + 0.3 * clamp01(feat.areaRatio * 6) +
                             0.15 * feat.contrastWithBg + 0.15 * clamp01(feat.fillRatio));
      objects.push({
        id: objects.length,
        bbox: { x0: clamp(bbox.x0, 0, 1), y0: clamp(bbox.y0, 0, 1), x1: clamp(bbox.x1, 0, 1), y1: clamp(bbox.y1, 0, 1) },
        mask, maskW: sw, maskH: sh,
        area: st.area, areaRatio: st.area / totalPx,
        score: objScore, type: cls.type, typeAr: cls.typeAr,
        confidence: cls.score, classScores: cls.scores,
        features: feat,
        parts: cls.type === 'vehicle' ? lower.slice(0, 4).map(c => ({ kind: 'wheel', x: c.x, y: c.y, r: c.r }))
          : (cls.type === 'human' && upper.length ? [{ kind: 'head', x: upper[0].x, y: upper[0].y, r: upper[0].r }] : [])
      });
    }
    objects.sort((a, b) => b.score - a.score);
    objects.forEach((o, i) => { o.id = i; });

    return {
      objects, saliency: salSmooth, saliencyW: sw, saliencyH: sh,
      threshold, backgroundComplexity, workW: sw, workH: sh,
      foreground: fg, fallback,
      superpixelCount: sp.K
    };
  }

  function unionBoxes(objs) {
    if (!objs || !objs.length) return { x0: 0.05, y0: 0.05, x1: 0.95, y1: 0.95 };
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const o of objs) {
      x0 = Math.min(x0, o.bbox.x0); y0 = Math.min(y0, o.bbox.y0);
      x1 = Math.max(x1, o.bbox.x1); y1 = Math.max(y1, o.bbox.y1);
    }
    const padX = 0.02, padY = 0.02;
    return { x0: clamp01(x0 - padX), y0: clamp01(y0 - padY), x1: clamp01(x1 + padX), y1: clamp01(y1 + padY) };
  }

  AI3D.Detection = { detectObjects, unionBoxes, slic, detectCircles, classify, TYPE_AR };
})(typeof window !== 'undefined' ? window : globalThis);
