/* ============================================================
 * texture.js — UV Atlas + خبز الـ Texture + الخرائط + الخامات
 * (مواصفة 14 • 15 • 16 • 17 • 18 • 19)
 *  إسقاط محوري لكل وجه (6 اتجاهات) → حزم مخططات في أطلس →
 *  خبز اللون من الصورة الأصلية مع إزالة الإضاءة (de-light) →
 *  حشو الثغرات (push-pull inpainting) + توسيع الحواف →
 *  Normal / AO / Roughness / Metalness → تقدير الخامة.
 * ============================================================ */
(function (global) {
  'use strict';
  const AI3D = global.AI3D;
  const U = AI3D.util, F = AI3D.field;
  const clamp = U.clamp, clamp01 = U.clamp01;

  const TEX_SIZE = { standard: 1024, high: 2048, ultra: 4096 };
  /* حدّ آمن لدقة الأطلس حسب قدرة الجهاز (يتجنّب نفاد الذاكرة في المتصفح) */
  function safeTexSize(requested) {
    const nav = (typeof navigator !== 'undefined') ? navigator : {};
    const mem = nav.deviceMemory || 0;
    const cores = nav.hardwareConcurrency || 4;
    let max = 2048;
    if (mem >= 8 || (!mem && cores >= 8)) max = 4096;
    if (mem && mem <= 2) max = 1024;
    return Math.max(512, Math.min(requested, max));
  }
  const AXES = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },   // +X
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },   // -X
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },    // +Y
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1] },  // -Y
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },    // +Z
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] }   // -Z
  ];

  /* ---------------- بناء أطلس UV ---------------- */
  function buildUVAtlas(mesh, texSize) {
    const P = mesh.positions, N = mesh.normals, I = mesh.indices;
    const faceCount = I.length / 3;
    const faceAxis = new Uint8Array(faceCount);
    const charts = [];
    for (let a = 0; a < AXES.length; a++) charts.push({ axis: a, faces: [], minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity });

    // توزيع الوجوه على المحاور
    for (let t = 0; t < faceCount; t++) {
      const i0 = I[t * 3] * 3, i1 = I[t * 3 + 1] * 3, i2 = I[t * 3 + 2] * 3;
      let nx = N[i0] + N[i1] + N[i2], ny = N[i0 + 1] + N[i1 + 1] + N[i2 + 1], nz = N[i0 + 2] + N[i1 + 2] + N[i2 + 2];
      const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
      let axis = az >= ax && az >= ay ? (nz >= 0 ? 4 : 5) : (ay >= ax ? (ny >= 0 ? 2 : 3) : (nx >= 0 ? 0 : 1));
      faceAxis[t] = axis;
      charts[axis].faces.push(t);
    }
    // حدود كل مخطط بوحدات العالم
    for (const ch of charts) {
      if (!ch.faces.length) continue;
      const A = AXES[ch.axis];
      for (const t of ch.faces) {
        for (let k = 0; k < 3; k++) {
          const i = I[t * 3 + k] * 3;
          const x = P[i], y = P[i + 1], z = P[i + 2];
          const uu = x * A.u[0] + y * A.u[1] + z * A.u[2];
          const vv = x * A.v[0] + y * A.v[1] + z * A.v[2];
          if (uu < ch.minU) ch.minU = uu; if (uu > ch.maxU) ch.maxU = uu;
          if (vv < ch.minV) ch.minV = vv; if (vv > ch.maxV) ch.maxV = vv;
        }
      }
      ch.su = Math.max(1e-5, ch.maxU - ch.minU);
      ch.sv = Math.max(1e-5, ch.maxV - ch.minV);
    }
    const active = charts.filter(c => c.faces.length);
    const pad = 3;
    let totalArea = 0;
    for (const c of active) totalArea += c.su * c.sv;
    /* تعبئة الرفوف (shelf packing) مع بحث ثنائي عن أكبر مقياس يتّسع */
    const tryPack = (k) => {
      for (const c of active) {
        c.w = Math.max(2, Math.round(c.su * k));
        c.h = Math.max(2, Math.round(c.sv * k));
      }
      const order = active.slice().sort((a, b) => b.h - a.h);
      let px = pad, py = pad, shelfH = 0;
      for (const c of order) {
        if (c.w + 2 * pad > texSize || c.h + 2 * pad > texSize) return false;
        if (px + c.w + pad > texSize) { px = pad; py += shelfH + pad; shelfH = 0; }
        if (py + c.h + pad > texSize) return false;
        c.x = px; c.y = py;
        px += c.w + pad;
        shelfH = Math.max(shelfH, c.h);
      }
      return true;
    };
    const kIdeal = Math.sqrt(0.92 * texSize * texSize / Math.max(1e-6, totalArea));
    let lo = 1, hi = kIdeal, best = 1, bestPack = null;
    if (tryPack(kIdeal)) { hi = kIdeal; }
    // بحث ثنائي: أكبر مقياس يحقق تعبئة ناجحة
    let snapshot = null;
    for (let it = 0; it < 14; it++) {
      const mid = (lo + hi) / 2;
      if (tryPack(mid)) {
        best = mid; bestPack = true;
        snapshot = active.map(c => ({ x: c.x, y: c.y, w: c.w, h: c.h }));
        lo = mid;
      } else hi = mid;
    }
    if (bestPack && snapshot) {
      active.forEach((c, i) => { c.x = snapshot[i].x; c.y = snapshot[i].y; c.w = snapshot[i].w; c.h = snapshot[i].h; });
    } else {
      tryPack(1);
    }

    // رؤوس جديدة لكل (رأس، مخطط)
    const keyMap = new Map();
    const newPos = [], newNor = [], newUv = [], newImgUv = [], newObs = [], newConf = [];
    const faceNewIdx = new Int32Array(I.length);
    for (let t = 0; t < faceCount; t++) {
      const axis = faceAxis[t], ch = charts[axis], A = AXES[axis];
      const scaleU = (ch.w - 2 * pad) / ch.su, scaleV = (ch.h - 2 * pad) / ch.sv;
      for (let k = 0; k < 3; k++) {
        const vi = I[t * 3 + k];
        const key = vi * 8 + axis;
        let ni = keyMap.get(key);
        if (ni === undefined) {
          const i3 = vi * 3;
          const x = P[i3], y = P[i3 + 1], z = P[i3 + 2];
          const uu = x * A.u[0] + y * A.u[1] + z * A.u[2];
          const vv = x * A.v[0] + y * A.v[1] + z * A.v[2];
          const fu = (uu - ch.minU) * scaleU + pad + ch.x;
          const fv = (vv - ch.minV) * scaleV + pad + ch.y;
          ni = newPos.length / 3;
          newPos.push(x, y, z);
          newNor.push(N[i3], N[i3 + 1], N[i3 + 2]);
          newUv.push(fu / texSize, 1 - fv / texSize);
          newImgUv.push(mesh.uvs ? mesh.uvs[vi * 2] : 0.5, mesh.uvs ? mesh.uvs[vi * 2 + 1] : 0.5);
          newObs.push(mesh.observed ? mesh.observed[vi] : 1);
          newConf.push(mesh.confidence ? mesh.confidence[vi] : 0.7);
          keyMap.set(key, ni);
        }
        faceNewIdx[t * 3 + k] = ni;
      }
    }
    return {
      mesh: {
        positions: new Float32Array(newPos),
        normals: new Float32Array(newNor),
        uvs: new Float32Array(newUv),
        imgUv: new Float32Array(newImgUv),
        indices: new Uint32Array(faceNewIdx),
        observed: new Float32Array(newObs),
        confidence: new Float32Array(newConf),
        meta: mesh.meta
      },
      charts: active, texSize, faceAxis,
      vertexCount: newPos.length / 3,
      triangleCount: faceNewIdx.length / 3,
      chartAreaRatio: active.reduce((a, c) => a + c.w * c.h, 0) / (texSize * texSize)
    };
  }

  /* ---------------- خبز الخرائط ---------------- */
  function bakeMaps(atlas, img, opts) {
    opts = opts || {};
    const size = atlas.texSize;
    const m = atlas.mesh;
    const P = m.positions, N = m.normals, I = m.indices, UV = m.uvs, IMGUV = m.imgUv, OBS = m.observed;
    const src = img.data, sw = img.width, sh = img.height;
    const light = opts.light || { dir: [0.3, 0.6, 0.7], intensity: 0.9, ambient: 0.45 };
    const L = normalize3(light.dir);
    const amb = light.ambient == null ? 0.45 : light.ambient;
    const inten = light.intensity == null ? 0.9 : light.intensity;

    // مخزنات Uint8 (أقل استهلاكًا للذاكرة بدقة كافية للخبز)
    const albedo = new Uint8ClampedArray(size * size * 4);
    const normal = new Uint8ClampedArray(size * size * 4);
    const orm = new Uint8ClampedArray(size * size * 4);
    const depthBuf = new Float32Array(size * size).fill(-1e9);
    const written = new Uint8Array(size * size);
    const valid = new Uint8Array(size * size);
    const cavity = opts.cavity || null;
    const cavityW = opts.cavityW || sw, cavityH = opts.cavityH || sh;

    const mat = opts.material || { roughness: 0.6, metallic: 0.1 };
    const baseRough = mat.roughness, baseMetal = mat.metallic;

    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
      const cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2];
      let nx = N[a * 3] + N[b * 3] + N[c * 3];
      let ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1];
      let nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      // إطار المماس من محور المخطط
      const axis = atlas.faceAxis[t / 3];
      const A = AXES[axis];
      const fnA = nx * A.n[0] + ny * A.n[1] + nz * A.n[2];
      if (fnA < 0) { nx = -nx; ny = -ny; nz = -nz; }   // الوجوه المواجهة للمحور فقط
      const tx = nx * A.u[0] + ny * A.u[1] + nz * A.u[2];
      const ty = nx * A.v[0] + ny * A.v[1] + nz * A.v[2];
      const tz = Math.abs(fnA);

      const u0 = UV[a * 2] * size, v0 = (1 - UV[a * 2 + 1]) * size;
      const u1 = UV[b * 2] * size, v1 = (1 - UV[b * 2 + 1]) * size;
      const u2 = UV[c * 2] * size, v2 = (1 - UV[c * 2 + 1]) * size;
      const minX = Math.max(0, Math.floor(Math.min(u0, u1, u2) - 0.5));
      const maxX = Math.min(size - 1, Math.ceil(Math.max(u0, u1, u2) + 0.5));
      const minY = Math.max(0, Math.floor(Math.min(v0, v1, v2) - 0.5));
      const maxY = Math.min(size - 1, Math.ceil(Math.max(v0, v1, v2) + 0.5));
      const d = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
      if (Math.abs(d) < 1e-9) continue;
      const invD = 1 / d;
      const iu0 = IMGUV[a * 2], iv0 = IMGUV[a * 2 + 1];
      const iu1 = IMGUV[b * 2], iv1 = IMGUV[b * 2 + 1];
      const iu2 = IMGUV[c * 2], iv2 = IMGUV[c * 2 + 1];
      const obs0 = OBS[a], obs1 = OBS[b], obs2 = OBS[c];
      // عمق الإسقاط (لمخزن العمق داخل المخطط)
      const projA = ax * A.n[0] + ay * A.n[1] + az * A.n[2];
      const projB = bx * A.n[0] + by * A.n[1] + bz * A.n[2];
      const projC = cx * A.n[0] + cy * A.n[1] + cz * A.n[2];

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const pxc = x + 0.5, pyc = y + 0.5;
          let w1 = ((pxc - u0) * (v2 - v0) - (u2 - u0) * (pyc - v0)) * invD;
          let w2 = ((u1 - u0) * (pyc - v0) - (pxc - u0) * (v1 - v0)) * invD;
          const w0 = 1 - w1 - w2;
          if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02 || w0 > 1.02 || w1 > 1.02 || w2 > 1.02) continue;
          const zz = w0 * projA + w1 * projB + w2 * projC;
          const pi = y * size + x;
          if (zz <= depthBuf[pi]) continue;
          depthBuf[pi] = zz;
          // إحداثيات الصورة
          const iu = clamp01(w0 * iu0 + w1 * iu1 + w2 * iu2);
          const iv = clamp01(w0 * iv0 + w1 * iv1 + w2 * iv2);
          const sx = clamp(Math.round(iu * (sw - 1)), 0, sw - 1);
          const sy = clamp(Math.round(iv * (sh - 1)), 0, sh - 1);
          const sp = (sy * sw + sx) * 4;
          let r = src[sp] / 255, g = src[sp + 1] / 255, b = src[sp + 2] / 255;
          // إزالة الإضاءة: albedo = color / (ambient + intensity·max(0,N·L))
          const ndl = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
          const illum = clamp(amb + inten * ndl, 0.28, 1.85);
          r = clamp01(r / illum); g = clamp01(g / illum); b = clamp01(b / illum);
          const o = pi * 4;
          albedo[o] = r * 255; albedo[o + 1] = g * 255; albedo[o + 2] = b * 255; albedo[o + 3] = 255;
          normal[o] = (tx * 0.5 + 0.5) * 255; normal[o + 1] = (ty * 0.5 + 0.5) * 255; normal[o + 2] = (tz * 0.5 + 0.5) * 255; normal[o + 3] = 255;
          // AO تقريبي من تجويف العمق
          let ao = 1;
          if (cavity) {
            const csx = clamp(Math.round(iu * (cavityW - 1)), 0, cavityW - 1);
            const csy = clamp(Math.round(iv * (cavityH - 1)), 0, cavityH - 1);
            ao = clamp01(1 - Math.max(0, -cavity[csy * cavityW + csx]) * 2.2);
          }
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const rough = clamp01(baseRough + (lum - 0.5) * 0.12);
          const metal = clamp01(baseMetal + (1 - Math.min(1, Math.abs(r - g) + Math.abs(g - b) + Math.abs(r - b) + 0.25)) * 0.15);
          orm[o] = ao * 255; orm[o + 1] = rough * 255; orm[o + 2] = metal * 255; orm[o + 3] = 255;
          written[pi] = 1;
          const obs = w0 * obs0 + w1 * obs1 + w2 * obs2;
          valid[pi] = obs > 0.45 ? 1 : 2;   // 1 = مرصود، 2 = مستنتَج (يحتاج حشو)
        }
      }
    }

    // توسيع الحواف (dilation) لملء الحواف بين المخططات
    dilate(albedo, written, size, 3);
    dilate(normal, written, size, 3);
    dilate(orm, written, size, 3);
    // حشو المناطق المستنتَجة (push-pull inpainting)
    const holes = new Uint8Array(size * size);
    for (let i = 0; i < holes.length; i++) holes[i] = valid[i] === 2 ? 1 : 0;
    inpaint(albedo, valid, size);
    inpaint(normal, valid, size);
    // املأ كل ما لم يُكتب بلون متوسط
    fillUnwritten(albedo, written, size, [158, 158, 163]);
    fillUnwritten(normal, written, size, [128, 128, 255]);
    fillUnwritten(orm, written, size, [255, Math.round(baseRough * 255), Math.round(baseMetal * 255)]);

    return {
      albedo: toImage(albedo, size),
      normal: toImage(normal, size),
      orm: toImage(orm, size),
      size,
      coverageStats: coverageOf(written, valid, size)
    };
  }

  function normalize3(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function toImage(buf, size) {
    const img = U.imageLike(size, size);
    img.data.set(buf);
    return img;
  }
  function coverageOf(written, valid, size) {
    let w = 0, v = 0;
    for (let i = 0; i < written.length; i++) { if (written[i]) w++; if (valid[i] === 1) v++; }
    return { texels: written.length, covered: w, observed: v, coverage: w / written.length, observedRatio: v / Math.max(1, w) };
  }
  function dilate(buf, mask, size, iters) {
    let cur = Uint8Array.from(mask);
    for (let it = 0; it < iters; it++) {
      const next = Uint8Array.from(cur);
      const add = [];
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (cur[i]) continue;
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
          const j = yy * size + xx;
          if (!cur[j]) continue;
          r += buf[j * 4]; g += buf[j * 4 + 1]; b += buf[j * 4 + 2]; a += buf[j * 4 + 3]; n++;
        }
        if (n) {
          const o = i * 4;
          buf[o] = r / n; buf[o + 1] = g / n; buf[o + 2] = b / n; buf[o + 3] = a / n;
          next[i] = 1;
          add.push(1);
        }
      }
      cur = next;
      if (!add.length) break;
    }
  }
  /* Push–Pull: حشو متعدد المقاييس */
  function inpaint(buf, validMask, size) {
    const holes = new Uint8Array(size * size);
    let holeCount = 0;
    for (let i = 0; i < holes.length; i++) { holes[i] = validMask[i] === 1 ? 0 : 1; if (holes[i]) holeCount++; }
    if (!holeCount) return;
    let curSize = size, curColor = buf, curValid = null;
    const levels = [];
    // تصغير
    let cC = Float32Array.from(buf);
    let cV = new Float32Array(size * size);
    for (let i = 0; i < cV.length; i++) cV[i] = holes[i] ? 0 : 1;
    let cS = size;
    while (cS > 8) {
      const nS = cS >> 1;
      const nC = new Float32Array(nS * nS * 4);
      const nV = new Float32Array(nS * nS);
      for (let y = 0; y < nS; y++) for (let x = 0; x < nS; x++) {
        const o = (y * nS + x) * 4;
        let r = 0, g = 0, b = 0, a = 0, w = 0, vv = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const j = ((y * 2 + dy) * cS + (x * 2 + dx));
          const wj = cV[j];
          r += cC[j * 4] * wj; g += cC[j * 4 + 1] * wj; b += cC[j * 4 + 2] * wj; a += cC[j * 4 + 3] * wj;
          w += wj; vv += wj;
        }
        if (w > 0) { nC[o] = r / w; nC[o + 1] = g / w; nC[o + 2] = b / w; nC[o + 3] = a / w; }
        nV[y * nS + x] = Math.min(1, vv / 4);
      }
      levels.push({ size: cS, c: cC, v: cV });
      cC = nC; cV = nV; cS = nS;
    }
    // تكبير وإعادة دمج
    for (let li = levels.length - 1; li >= 0; li--) {
      const lv = levels[li];
      const up = upsample(cC, cV, cS, lv.size);
      for (let i = 0; i < lv.size * lv.size; i++) {
        if (lv.v[i] > 0.01) continue;
        const o = i * 4;
        for (let c = 0; c < 4; c++) lv.c[o + c] = up.c[o + c];
        lv.v[i] = Math.max(lv.v[i], up.v[i] * 0.6);
      }
      cC = lv.c; cV = lv.v; cS = lv.size;
    }
    void curSize; void curColor; void curValid;
    buf.set(cC);
  }
  function upsample(cC, cV, cS, nS) {
    const nC = new Float32Array(nS * nS * 4), nV = new Float32Array(nS * nS);
    for (let y = 0; y < nS; y++) for (let x = 0; x < nS; x++) {
      const sx = Math.min(cS - 1, x >> 1), sy = Math.min(cS - 1, y >> 1);
      const o = (y * nS + x) * 4, j = (sy * cS + sx) * 4;
      for (let c = 0; c < 4; c++) nC[o + c] = cC[j + c];
      nV[y * nS + x] = cV[sy * cS + sx];
    }
    // تنعيم خفيف
    const blurC = new Float32Array(nC.length), blurV = new Float32Array(nV.length);
    for (let y = 0; y < nS; y++) for (let x = 0; x < nS; x++) {
      const o = (y * nS + x) * 4;
      let r = 0, g = 0, b = 0, a = 0, v = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= nS || yy >= nS) continue;
        const k = yy * nS + xx;
        r += nC[k * 4]; g += nC[k * 4 + 1]; b += nC[k * 4 + 2]; a += nC[k * 4 + 3]; v += nV[k]; n++;
      }
      blurC[o] = r / n; blurC[o + 1] = g / n; blurC[o + 2] = b / n; blurC[o + 3] = a / n;
      blurV[y * nS + x] = v / n;
    }
    return { c: blurC, v: blurV };
  }
  function fillUnwritten(buf, mask, size, color) {
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) continue;
      const o = i * 4;
      buf[o] = color[0]; buf[o + 1] = color[1]; buf[o + 2] = color[2]; buf[o + 3] = 1;
    }
  }

  /* ---------------- تقدير الخامة (مواصفة 15 + 17 + 18) ---------------- */
  const MAT_AR = {
    metal: 'معدن', plastic: 'بلاستيك', glass: 'زجاج', wood: 'خشب', fabric: 'قماش',
    leather: 'جلد', rubber: 'مطاط', stone: 'حجر', concrete: 'خرسانة', ceramic: 'سيراميك', unknown: 'غير محدد'
  };
  function estimateMaterial(img, w, h, mask, analysis, objectType) {
    const d = img.data;
    let n = 0, satSum = 0, valSum = 0, grayN = 0, darkN = 0, brightN = 0;
    let specN = 0, hueHist = new Float32Array(12);
    let lumIn = [], gradSum = 0, gradN = 0;
    const step = Math.max(1, Math.floor(w * h / 20000));
    for (let i = 0; i < w * h; i += step) {
      if (mask[i] < 0.5) continue;
      const p = i * 4, r = d[p] / 255, g = d[p + 1] / 255, b = d[p + 2] / 255;
      const hsv = AI3D.color.rgb2hsv(r, g, b);
      satSum += hsv[1]; valSum += hsv[2]; n++;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn < 0.08) grayN++;
      if (hsv[2] < 0.22) darkN++;
      if (hsv[2] > 0.86 && hsv[1] < 0.32) { specN++; brightN++; }
      else if (hsv[2] > 0.86) brightN++;
      hueHist[Math.min(11, Math.floor(hsv[0] / 30))]++;
    }
    n = Math.max(1, n);
    const saturation = satSum / n, value = valSum / n;
    const grayRatio = grayN / n, darkRatio = darkN / n, specRatio = specN / n;
    const brightRatio = brightN / n;
    // تباين موضعي (خشونة/نسيج)
    const lum = AI3D.Analysis.lumaImage(img);
    const blur = F.boxBlur(Float32Array.from(lum), w, h, 1, 1);
    for (let i = 0; i < lum.length; i++) {
      if (mask[i] < 0.5) continue;
      gradSum += Math.abs(lum[i] - blur[i]); gradN++;
    }
    const microrough = clamp01((gradSum / Math.max(1, gradN)) * 9);
    const specular = (analysis && analysis.light && analysis.light.specular) || clamp01(specRatio * 6);
    let hueDom = 0, hueIdx = 0;
    for (let i = 0; i < 12; i++) if (hueHist[i] > hueDom) { hueDom = hueHist[i]; hueIdx = i; }
    const hueDeg = hueIdx * 30 + 15;
    const brownish = (hueDeg > 10 && hueDeg < 55) ? clamp01(hueDom / n * 3) : 0;
    const greenish = (hueDeg > 70 && hueDeg < 170) ? clamp01(hueDom / n * 3) : 0;
    // مؤشر الشفافية: تشابه ألوان الجسم مع خلفيته + حدّة عالية
    let inVar = 0, outVar = 0, inN = 0, outN = 0, inMean = 0, outMean = 0;
    for (let i = 0; i < lum.length; i += 3) {
      if (mask[i] > 0.5) { inMean += lum[i]; inN++; } else { outMean += lum[i]; outN++; }
    }
    inMean /= Math.max(1, inN); outMean /= Math.max(1, outN);
    for (let i = 0; i < lum.length; i += 3) {
      if (mask[i] > 0.5) inVar += (lum[i] - inMean) * (lum[i] - inMean);
      else outVar += (lum[i] - outMean) * (lum[i] - outMean);
    }
    inVar = Math.sqrt(inVar / Math.max(1, inN)); outVar = Math.sqrt(outVar / Math.max(1, outN));
    // الجسم الشفاف غالبًا يشبه خلفيته لونيًا + تنوّع داخلي عالٍ + لمعان قوي
    const bgSimilarity = clamp01(1 - Math.abs(inMean - outMean) / 0.22);
    const innerVariance = clamp01(inVar / (outVar + 0.02) - 0.75);
    const transparency = clamp01(
      0.40 * bgSimilarity + 0.25 * innerVariance +
      0.20 * clamp01(specRatio * 3) + 0.15 * clamp01(brightRatio * 1.5)
    );

    // تسجيل الأنواع
    const S = {
      metal: 0.34 * clamp01(specular * 1.6) + 0.26 * grayRatio + 0.18 * (1 - saturation * 2.2) + 0.12 * clamp01(1 - microrough * 1.4) + 0.1 * (objectType === 'vehicle' ? 1 : 0.2),
      plastic: 0.3 * clamp01(1 - microrough * 1.3) + 0.22 * clamp01(saturation * 2) + 0.18 * clamp01(specular * 1.1) + 0.15 * clamp01(1 - transparency * 2) + 0.15,
      glass: 0.42 * transparency + 0.24 * clamp01(specular * 1.5) + 0.16 * clamp01(1 - saturation) + 0.18 * clamp01(brightRatio * 3),
      wood: 0.46 * brownish + 0.2 * clamp01(microrough * 1.4) + 0.14 * clamp01(1 - specular) + 0.1 * clamp01(value),
      fabric: 0.36 * clamp01(microrough * 1.5) + 0.24 * clamp01(1 - specular * 2.2) + 0.2 * clamp01(1 - transparency * 2) + 0.2 * (objectType === 'clothing' ? 1 : 0.25),
      leather: 0.3 * brownish + 0.22 * clamp01(microrough) + 0.18 * clamp01(specular * 0.9) + 0.2 * darkRatio + 0.1,
      rubber: 0.4 * darkRatio + 0.24 * (1 - saturation * 2.4) + 0.2 * clamp01(1 - specular * 2.4) + 0.16 * clamp01(microrough),
      stone: 0.34 * grayRatio + 0.26 * clamp01(microrough * 1.2) + 0.2 * clamp01(1 - specular * 2) + 0.2 * clamp01(1 - saturation * 2),
      concrete: 0.32 * grayRatio + 0.28 * clamp01(microrough * 1.1) + 0.2 * clamp01(1 - specular * 2.2) + 0.2 * clamp01(1 - Math.abs(value - 0.5) * 2.4),
      ceramic: 0.32 * clamp01(1 - microrough * 1.6) + 0.26 * clamp01(specular * 1.4) + 0.22 * clamp01(1 - saturation) + 0.2 * clamp01(value * 1.4)
    };
    let best = 'plastic', bestS = -1;
    for (const k in S) if (S[k] > bestS) { bestS = S[k]; best = k; }
    const confidence = clamp01(bestS * 1.25);

    // معاملات PBR
    let metallic = best === 'metal' ? clamp01(0.72 + 0.25 * (1 - saturation * 3)) : clamp01(0.04 + 0.18 * (1 - saturation * 2) * (best === 'ceramic' ? 0.6 : 0.2));
    let roughness = clamp01(
      0.18 + 0.55 * microrough + (best === 'metal' ? -0.12 : 0) + (best === 'ceramic' ? -0.2 : 0) +
      (best === 'glass' ? -0.15 : 0) + (best === 'fabric' ? 0.18 : 0) + (best === 'rubber' ? 0.15 : 0)
    );
    const ior = best === 'glass' ? 1.5 : 1.45;
    const transmission = best === 'glass' ? clamp01(0.35 + transparency * 0.6) : (transparency > 0.55 ? 0.18 : 0);
    const sheen = best === 'fabric' ? clamp01(0.4 + microrough * 0.4) : (best === 'leather' ? 0.15 : 0);
    const clearcoat = (best === 'metal' || best === 'ceramic' || objectType === 'vehicle') ? clamp01(0.35 + specular * 0.3) : 0;

    return {
      material: best, materialAr: MAT_AR[best] || best, confidence,
      metallic: +metallic.toFixed(2), roughness: +roughness.toFixed(2),
      transparency: +transmission.toFixed(2), ior, sheen: +sheen.toFixed(2), clearcoat: +clearcoat.toFixed(2),
      scores: S,
      stats: {
        saturation: +saturation.toFixed(3), value: +value.toFixed(3), grayRatio: +grayRatio.toFixed(3),
        specular: +specular.toFixed(3), microrough: +microrough.toFixed(3),
        transparencyEstimate: +transparency.toFixed(3), dominantHue: hueDeg,
        brownish: +brownish.toFixed(2), greenish: +greenish.toFixed(2)
      }
    };
  }

  /* ---------------- خرائط مساعدة من العمق ---------------- */
  function buildNormalMapFromDepth(depth, w, h, strength) {
    const img = U.imageLike(w, h);
    const d = img.data;
    const { gx, gy } = F.gradientXY(depth, w, h);
    for (let i = 0; i < w * h; i++) {
      let nx = -gx[i] * strength * 40, ny = gy[i] * strength * 40, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      d[i * 4] = Math.round((nx * 0.5 + 0.5) * 255);
      d[i * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      d[i * 4 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      d[i * 4 + 3] = 255;
    }
    return img;
  }
  /* تجويف العمق (cavity) لاستخدامه كـ AO تقريبي */
  function buildCavityMap(depth, w, h) {
    const big = F.boxBlur(Float32Array.from(depth), w, h, Math.max(4, Math.round(Math.min(w, h) / 16)), 2);
    const out = new Float32Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = depth[i] - big[i];
    return out;
  }

  /* ---------------- معاينات (DOM) ---------------- */
  function renderMaskPreview(mask, w, h, refCanvas) {
    const c = U.makeCanvas(w, h);
    const x = c.getContext('2d');
    if (refCanvas) { x.globalAlpha = 0.42; x.drawImage(refCanvas, 0, 0, w, h); x.globalAlpha = 1; }
    const im = x.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const m = mask[i];
      const o = i * 4;
      if (m <= 0.02) continue;
      im.data[o] = 40 + 60 * (1 - m);
      im.data[o + 1] = 170;
      im.data[o + 2] = 255;
      im.data[o + 3] = Math.round(clamp01(m) * 210);
    }
    x.putImageData(im, 0, 0);
    return c;
  }
  function renderDepthPreview(depth, mask, w, h) {
    const c = U.makeCanvas(w, h);
    const x = c.getContext('2d');
    const im = x.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      if (mask && mask[i] < 0.04) { im.data[o + 3] = 0; continue; }
      const t = clamp01(depth[i]);
      // لوحة "turbo" مبسّطة
      const r = clamp01(Math.abs(2 * t - 0.5)), g = clamp01(Math.sin(Math.PI * t)), b = clamp01(1 - t);
      im.data[o] = Math.round(r * 255);
      im.data[o + 1] = Math.round(g * 235);
      im.data[o + 2] = Math.round(b * 255);
      im.data[o + 3] = 255;
    }
    x.putImageData(im, 0, 0);
    return c;
  }
  function renderFieldPreview(field, w, h, mask) {
    const c = U.makeCanvas(w, h);
    const x = c.getContext('2d');
    const im = x.createImageData(w, h);
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < field.length; i++) { if (field[i] < mn) mn = field[i]; if (field[i] > mx) mx = field[i]; }
    const r = (mx - mn) || 1;
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      const t = (field[i] - mn) / r;
      im.data[o] = Math.round(t * 255);
      im.data[o + 1] = Math.round(t * 255);
      im.data[o + 2] = Math.round(t * 255);
      im.data[o + 3] = (mask && mask[i] < 0.04) ? 40 : 255;
    }
    x.putImageData(im, 0, 0);
    return c;
  }

  AI3D.Texture = {
    buildUVAtlas, bakeMaps, estimateMaterial, buildNormalMapFromDepth, buildCavityMap, safeTexSize,
    renderMaskPreview, renderDepthPreview, renderFieldPreview, TEX_SIZE, MAT_AR
  };
})(typeof window !== 'undefined' ? window : globalThis);
