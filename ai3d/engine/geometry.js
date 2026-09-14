/* ============================================================
 * geometry.js — محرك إعادة البناء ثلاثي الأبعاد (مواصفة 10+11+12+13+26+47)
 *  Point Cloud → حجم TSDF (سطح أمامي مرصود + سماكة مُستنتَجة تغلق
 *  الجسم) → Marching Tetrahedra (شبكة مغلقة مانعة للتسرّب) →
 *  تنظيف/إصلاح/تنعيم/تبسيط QEM + أدوات التعديل.
 *  محلي 100%: لا مكتبات خارجية ولا خدمات.
 * ============================================================ */
(function (global) {
  'use strict';
  const AI3D = global.AI3D;
  const U = AI3D.util, F = AI3D.field;
  const clamp = U.clamp, clamp01 = U.clamp01;

  /* عدد المضلعات يُضبط عبر دقة شبكة TSDF (أضمن طوبولوجيًا من التبسيط القاسي).
     التبسيط QEM يبقى أداة يدوية متاحة للمستخدم. */
  const QUALITY = {
    low: { grid: 48, keep: 1.0, smooth: 2, cloud: 12000 },
    medium: { grid: 68, keep: 1.0, smooth: 1, cloud: 30000 },
    high: { grid: 92, keep: 1.0, smooth: 1, cloud: 70000 },
    ultra: { grid: 116, keep: 1.0, smooth: 0, cloud: 140000 }
  };
  /* سماكة نسبية لكل نوع جسم (نسبة إلى بُعد الصورة الظلية) */
  const THICKNESS = {
    vehicle: 0.60, human: 0.44, animal: 0.52, furniture: 0.80, building: 1.15,
    product: 0.72, electronics: 0.26, clothing: 0.38, plant: 0.55, object: 0.62
  };

  /* ---------------- سحابة نقطية (مواصفة 11) ---------------- */
  function buildPointCloud(input) {
    const { depth, mask, w, h, img, bbox, confidence, aspect, depthRange } = input;
    const maxPts = input.maxPoints || 30000;
    const x0 = Math.max(0, Math.floor(bbox.x0 * w)), x1 = Math.min(w - 1, Math.ceil(bbox.x1 * w));
    const y0 = Math.max(0, Math.floor(bbox.y0 * h)), y1 = Math.min(h - 1, Math.ceil(bbox.y1 * h));
    const bwPx = Math.max(1, x1 - x0), bhPx = Math.max(1, y1 - y0);
    let inside = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (mask[y * w + x] > 0.5) inside++;
    const stride = Math.max(1, Math.floor(Math.sqrt(inside / Math.max(1, maxPts))));
    const pts = [], cols = [], confs = [];
    const cxc = (bbox.x0 + bbox.x1) / 2, cyc = (bbox.y0 + bbox.y1) / 2;
    for (let y = y0; y <= y1; y += stride) {
      for (let x = x0; x <= x1; x += stride) {
        const i = y * w + x;
        if (mask[i] < 0.5) continue;
        const u = x / (w - 1), v = y / (h - 1);
        const d = depth[i];
        pts.push((u - cxc) * aspect, (cyc - v), (d - 0.5) * depthRange);
        if (img) {
          const p = i * 4;
          cols.push(img.data[p] / 255, img.data[p + 1] / 255, img.data[p + 2] / 255);
        } else cols.push(0.7, 0.7, 0.7);
        confs.push(confidence ? confidence[i] : 0.6);
      }
    }
    return {
      positions: new Float32Array(pts), colors: new Float32Array(cols),
      confidence: new Float32Array(confs), count: pts.length / 3, stride, sourcePixels: inside
    };
  }

  /* ---------------- TSDF + Marching Tetrahedra ---------------- */
  function reconstruct(input) {
    const t0 = U.now();
    const { depth, mask, confidence, w, h, bbox, quality, objectType } = input;
    const Q = QUALITY[quality] || QUALITY.medium;
    const aspect = input.aspect || (w / h);
    const depthScale = input.depthScale == null ? 0.55 : input.depthScale;

    // أبعاد العالم: ارتفاع الصورة الظلية = 1 وحدة، العرض بالنسبة
    const pad = 0.03;
    const u0 = clamp01(bbox.x0 - pad), u1 = clamp01(bbox.x1 + pad);
    const v0 = clamp01(bbox.y0 - pad), v1 = clamp01(bbox.y1 + pad);
    const W = Math.max(0.02, (u1 - u0) * aspect);
    const H = Math.max(0.02, (v1 - v0));
    // المجال العميق: بروز السطح الأمامي + سماكة مُستنتَجة (تُغلق الجسم)
    const minDim = Math.min(W, H);
    const depthRange = depthScale * minDim * 0.9;
    const T = (THICKNESS[objectType] || THICKNESS.object) * minDim * 0.85;

    const N = Q.grid;
    let s = Math.max(W, H, depthRange + T) / N;
    const Nx = Math.max(4, Math.ceil(W / s)), Ny = Math.max(4, Math.ceil(H / s));
    const D0 = depthRange + T + 6 * s;
    const Nz = Math.max(4, Math.ceil(D0 / s));
    const zMin = -depthRange / 2 - T - 3 * s;

    /* 1) خرائط الأعمدة */
    // خرائط الأعمدة: نأخذ متوسط المساحة (لا العيّنة النقطية) لتقليل تشويش العمق
    const win = { x0: u0 * w, y0: v0 * h, x1: u1 * w, y1: v1 * h };
    const depthG = F.resampleFieldBox(depth, w, h, Nx, Ny, mask, win);
    const maskG = F.resampleFieldBox(mask, w, h, Nx, Ny, null, win);
    const confG = confidence ? F.resampleFieldBox(confidence, w, h, Nx, Ny, mask, win) : null;
    // تجانس خفيف إضافي على شبكة الأعمدة (يضمن اتصال الحجم)
    const depthSmooth = F.boxBlur(Float32Array.from(depthG), Nx, Ny, 1, 1);
    const gridMask = new Float32Array(Nx * Ny);
    const frontC = new Float32Array(Nx * Ny);
    const backC = new Float32Array(Nx * Ny);
    const confC = new Float32Array(Nx * Ny);
    for (let idx = 0; idx < Nx * Ny; idx++) {
      const m = maskG[idx];
      gridMask[idx] = m > 0.5 ? 1 : 0;
      const d = depthG[idx] * (depthSmooth[idx] > 0 ? 0.35 : 0) + depthSmooth[idx] * 0.65;
      confC[idx] = confG ? confG[idx] : 0.6;
      const zf = (d - 0.5) * depthRange;
      frontC[idx] = (zf - zMin) / s;
      backC[idx] = frontC[idx];
    }
    // مسافة جانبية (بالخلايا) و سماكة محلية مُدوَّرة
    const dToBg = F.edt2d(gridMask, Nx, Ny, false);   // داخل الصورة الظلية: البعد عن الخلفية
    const dToFg = F.edt2d(gridMask, Nx, Ny, true);    // خارجها: البعد عن المقدمة
    const latC = new Float32Array(Nx * Ny);
    let maxLat = 1;
    for (let idx = 0; idx < latC.length; idx++) latC[idx] = gridMask[idx] > 0.5 ? dToBg[idx] : -dToFg[idx];
    for (let idx = 0; idx < latC.length; idx++) if (latC[idx] > maxLat) maxLat = latC[idx];
    const minDimCells = Math.max(2, Math.min(Nx, Ny));
    const Tcells = T / s;
    for (let idx = 0; idx < backC.length; idx++) {
      const t = gridMask[idx] > 0.5 ? clamp01(latC[idx] / (0.42 * minDimCells)) : 0;
      const local = Tcells * Math.sqrt(t);
      // السطح الأمامي يبقى مرصودًا، والظهر يُستنتَج للخلف
      backC[idx] = frontC[idx] - Math.max(0.8, local);
    }

    /* 2) حقل المسافة الموقّع */
    const nVox = (Nx + 1) * (Ny + 1) * (Nz + 1);
    const sdf = new Float32Array(nVox);
    const TRUNC = 1.75;
    const idx3 = (i, j, k) => (k * (Ny + 1) + j) * (Nx + 1) + i;
    for (let k = 0; k <= Nz; k++) {
      for (let j = 0; j <= Ny; j++) {
        for (let i = 0; i <= Nx; i++) {
          const ij = Math.min(Nx - 1, i) + Math.min(Ny - 1, j) * Nx;
          const lat = latC[ij];
          const dFront = frontC[ij] - k;
          const dBack = k - backC[ij];
          const depthTerm = Math.min(dFront, dBack);
          let v;
          if (lat > 0 && depthTerm > 0) v = -Math.min(lat, depthTerm);
          else if (lat > 0) v = -depthTerm;
          else if (depthTerm > 0) v = -lat;
          else v = Math.hypot(lat, depthTerm);
          sdf[idx3(i, j, k)] = v < -TRUNC ? -TRUNC : (v > TRUNC ? TRUNC : v);
        }
      }
    }

    /* 3) Marching Tetrahedra */
    const TETS = [
      [0, 1, 3, 7], [0, 1, 5, 7], [0, 2, 3, 7], [0, 2, 6, 7], [0, 4, 5, 7], [0, 4, 6, 7]
    ];
    const pos = [], imgUv = [], indices = [];
    const edgeCache = new Map();
    const x0w = -W / 2, y0w = H / 2;
    const strideXY = (Nx + 1), strideZ = (Nx + 1) * (Ny + 1);
    const du = (u1 - u0) / Nx, dv = (v1 - v0) / Ny;

    // فكّ ترميز مؤشر الفوكسل إلى إحداثيات (بدون تخزين إضافي)
    const vx = new Float32Array(6), vy = new Float32Array(6), vz = new Float32Array(6);
    const vu = new Float32Array(6), vv = new Float32Array(6);
    function decode(gi, slot) {
      const i = gi % strideXY;
      const rem = (gi - i) / strideXY;
      const j = rem % (Ny + 1);
      const k = (rem - j) / (Ny + 1);
      vx[slot] = x0w + i * s; vy[slot] = y0w - j * s; vz[slot] = zMin + k * s;
      vu[slot] = u0 + i * du; vv[slot] = v0 + j * dv;
    }
    function getVertex(ia, ib, va, vb) {
      const key = ia < ib ? ia * 4294967296 + ib : ib * 4294967296 + ia;
      let id = edgeCache.get(key);
      if (id !== undefined) return id;
      const t = va / (va - vb);
      decode(ia, 0); decode(ib, 1);
      id = pos.length / 3;
      pos.push(vx[0] + (vx[1] - vx[0]) * t, vy[0] + (vy[1] - vy[0]) * t, vz[0] + (vz[1] - vz[0]) * t);
      imgUv.push(vu[0] + (vu[1] - vu[0]) * t, vv[0] + (vv[1] - vv[0]) * t);
      edgeCache.set(key, id);
      return id;
    }

    /* ترتيب دوري لأربع نقاط حول محور (يضمن تثليثًا متسقًا) */
    function quadOrder(ids, ax, ay, az) {
      const al = Math.hypot(ax, ay, az) || 1;
      const nx = ax / al, ny = ay / al, nz = az / al;
      // أساس عمودي على المحور
      let ux = -ny, uy = nx, uz = 0;
      if (Math.hypot(ux, uy, uz) < 1e-6) { ux = 1; uy = 0; uz = 0; }
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul; uy /= ul; uz /= ul;
      const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < 4; i++) { const o = ids[i] * 3; cx += pos[o]; cy += pos[o + 1]; cz += pos[o + 2]; }
      cx /= 4; cy /= 4; cz /= 4;
      const ang = ids.map(id => {
        const o = id * 3;
        const dx = pos[o] - cx, dy = pos[o + 1] - cy, dz = pos[o + 2] - cz;
        return { id, a: Math.atan2(dx * vx + dy * vy + dz * vz, dx * ux + dy * uy + dz * uz) };
      });
      ang.sort((A, B) => A.a - B.a);
      return ang.map(x => x.id);
    }

    const cIdx = new Int32Array(8), cVal = new Float32Array(8);
    const gIns = new Int32Array(4), gOut = new Int32Array(4);
    const vIns = new Float32Array(4), vOut = new Float32Array(4);
    const ci = [0, 0, 0], co = [0, 0, 0];

    for (let k = 0; k < Nz; k++) {
      for (let j = 0; j < Ny; j++) {
        for (let i = 0; i < Nx; i++) {
          let allIn = true, allOut = true;
          for (let c = 0; c < 8; c++) {
            const di = c & 1, dj = (c >> 1) & 1, dk = (c >> 2) & 1;
            const gi = idx3(i + di, j + dj, k + dk);
            const v = sdf[gi];
            cIdx[c] = gi; cVal[c] = v;
            if (v < 0) allOut = false; else allIn = false;
          }
          if (allIn || allOut) continue;
          for (let ti = 0; ti < 6; ti++) {
            const tet = TETS[ti];
            let ni = 0, no = 0;
            for (let t = 0; t < 4; t++) {
              const c = tet[t], gi = cIdx[c], v = cVal[c];
              if (v < 0) { gIns[ni] = gi; vIns[ni] = v; ni++; }
              else { gOut[no] = gi; vOut[no] = v; no++; }
            }
            if (ni === 0 || no === 0) continue;
            // مرجّح الاتجاه: من centroid الداخل إلى centroid الخارج
            ci[0] = ci[1] = ci[2] = 0; co[0] = co[1] = co[2] = 0;
            for (let t = 0; t < ni; t++) { decode(gIns[t], 2); ci[0] += vx[2]; ci[1] += vy[2]; ci[2] += vz[2]; }
            for (let t = 0; t < no; t++) { decode(gOut[t], 2); co[0] += vx[2]; co[1] += vy[2]; co[2] += vz[2]; }
            const ox = co[0] / no - ci[0] / ni, oy = co[1] / no - ci[1] / ni, oz = co[2] / no - ci[2] / ni;
            // رؤوس التقاطع
            const eIdx = [];
            for (let a = 0; a < ni; a++) for (let b = 0; b < no; b++) eIdx.push(getVertex(gIns[a], gOut[b], vIns[a], vOut[b]));
            const tris = [];
            if (ni === 1) {
              tris.push([eIdx[0], eIdx[1], eIdx[2]]);
            } else if (ni === 3) {
              tris.push([eIdx[0], eIdx[2], eIdx[1]]);
            } else {
              // حالة 2-2: ترتيب دوري لنقاط التقاطع حول محور الخروج،
              // ثم تثليث ثابت (0,1,2)+(0,2,3) — يضمن اتساق القطر بين
              // التتراهيدرات المتجاورة ويمنع الحواف غير المانيفولدية.
              const q = quadOrder(eIdx, ox, oy, oz);
              tris.push([q[0], q[1], q[2]]);
              tris.push([q[0], q[2], q[3]]);
            }
            for (let t = 0; t < tris.length; t++) {
              const a = tris[t][0], b = tris[t][1], c2 = tris[t][2];
              if (a === b || b === c2 || a === c2) continue;
              const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
              const e1x = pos[b * 3] - ax, e1y = pos[b * 3 + 1] - ay, e1z = pos[b * 3 + 2] - az;
              const e2x = pos[c2 * 3] - ax, e2y = pos[c2 * 3 + 1] - ay, e2z = pos[c2 * 3 + 2] - az;
              const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
              const dot = nx * ox + ny * oy + nz * oz;
              if (dot > 0) indices.push(a, b, c2);
              else indices.push(a, c2, b);
            }
          }
        }
      }
    }
    edgeCache.clear();

    let positions = new Float32Array(pos);
    let idx = new Uint32Array(indices);

    /* 4) تمييز المرصود مقابل المستنتَج + الثقة */
    const observed = new Float32Array(positions.length / 3);
    const conf = new Float32Array(positions.length / 3);
    for (let vi = 0; vi < observed.length; vi++) {
      const X = positions[vi * 3], Y = positions[vi * 3 + 1], Z = positions[vi * 3 + 2];
      const gi = clamp(Math.round((X - x0w) / s), 0, Nx - 1);
      const gj = clamp(Math.round((y0w - Y) / s), 0, Ny - 1);
      const ij = gj * Nx + gi;
      const kc = (Z - zMin) / s;
      const dFront = Math.abs(frontC[ij] - kc), dBack = Math.abs(kc - backC[ij]);
      const lat = latC[ij];
      const isFront = lat > 1.2 && dFront <= dBack + 0.35;
      observed[vi] = isFront ? 1 : 0;
      const c0 = confC[ij] * (isFront ? 1 : 0.55);
      conf[vi] = clamp01(c0 * (gridMask[ij] > 0.5 ? 1 : 0.7));
    }

    let mesh = {
      positions, indices: idx, uvs: new Float32Array(imgUv),
      observed, confidence: conf,
      normals: null,
      meta: {
        method: 'TSDF + Marching Tetrahedra', grid: [Nx, Ny, Nz], cellSize: s,
        depthRange, thickness: T, watertight: true, ms: Math.round(U.now() - t0)
      }
    };
    mesh.normals = computeNormals(mesh.positions, mesh.indices);

    /* 5) تحسين الطوبولوجيا حسب الجودة (مواصفة 13) */
    const dbg = (tag) => {
      if (!global.__AI3D_DEBUG) return;
      const st = meshStats(mesh);
      console.log('[dbg] ' + tag + ' F=' + st.faces + ' comps=' + st.components + ' vol=' + st.volume.toFixed(4) +
        ' bounds=' + st.bounds.size.map(v => v.toFixed(3)).join(',') + ' wt=' + st.watertight + ' nonman=' + st.nonManifoldEdges);
    };
    if (Q.smooth > 0) smoothMesh(mesh, Q.smooth, 0.35);
    dbg('after-smooth');
    if (Q.keep < 1) mesh = decimateMesh(mesh, Q.keep);
    dbg('after-decimate');
    mesh = repairMesh(mesh, { minComponentRatio: 0.02 });
    dbg('after-repair');
    mesh.stats = meshStats(mesh);
    return mesh;
  }

  /* ---------------- النواميس ---------------- */
  function computeNormals(positions, indices) {
    const n = new Float32Array(positions.length);
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
      const e1x = positions[b] - positions[a], e1y = positions[b + 1] - positions[a + 1], e1z = positions[b + 2] - positions[a + 2];
      const e2x = positions[c] - positions[a], e2y = positions[c + 1] - positions[a + 1], e2z = positions[c + 2] - positions[a + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      for (const o of [a, b, c]) { n[o] += nx; n[o + 1] += ny; n[o + 2] += nz; }
    }
    for (let i = 0; i < n.length; i += 3) {
      const len = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
      n[i] /= len; n[i + 1] /= len; n[i + 2] /= len;
    }
    return n;
  }

  /* ---------------- إحصاءات الشبكة ---------------- */
  function meshStats(mesh) {
    const P = mesh.positions, I = mesh.indices;
    const vCount = P.length / 3, fCount = I.length / 3;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < P.length; i += 3) {
      if (P[i] < minX) minX = P[i]; if (P[i] > maxX) maxX = P[i];
      if (P[i + 1] < minY) minY = P[i + 1]; if (P[i + 1] > maxY) maxY = P[i + 1];
      if (P[i + 2] < minZ) minZ = P[i + 2]; if (P[i + 2] > maxZ) maxZ = P[i + 2];
    }
    let area = 0, volume = 0, degenerate = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
      const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-12) { degenerate++; continue; }
      area += len * 0.5;
      volume += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) -
                 P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) +
                 P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
    }
    // حواف / مانيفولد — نحسبها على رؤوس ملحومة بالموضع (تصحّ بعد تقسيم الأطلس)
    const weld = weldMap(P);
    const edges = new Map();
    const ek = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
    for (let t = 0; t < I.length; t += 3) {
      const v = [weld[I[t]], weld[I[t + 1]], weld[I[t + 2]]];
      if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) { degenerate++; continue; }
      for (let e = 0; e < 3; e++) {
        const k = ek(v[e], v[(e + 1) % 3]);
        edges.set(k, (edges.get(k) || 0) + 1);
      }
    }
    let boundary = 0, nonManifold = 0;
    for (const c of edges.values()) { if (c === 1) boundary++; else if (c > 2) nonManifold++; }
    // مكوّنات متصلة
    const comps = components(mesh);
    let obs = 0;
    if (mesh.observed) for (let i = 0; i < mesh.observed.length; i++) obs += mesh.observed[i];
    let cf = 0;
    if (mesh.confidence) for (let i = 0; i < mesh.confidence.length; i++) cf += mesh.confidence[i];
    const size = [maxX - minX, maxY - minY, maxZ - minZ];
    return {
      vertices: vCount, faces: fCount, triangles: fCount,
      bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], size, center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2] },
      area, volume: Math.abs(volume), signedVolume: volume,
      boundaryEdges: boundary, nonManifoldEdges: nonManifold, degenerateFaces: degenerate,
      components: comps, watertight: boundary === 0 && nonManifold === 0,
      observedRatio: mesh.observed ? obs / Math.max(1, mesh.observed.length) : 1,
      avgConfidence: mesh.confidence ? cf / Math.max(1, mesh.confidence.length) : 0.8
    };
  }
  /* خريطة لحام: مؤشّر فريد لكل موضع (يُستخدم لقياس الطوبولوجيا الحقيقية) */
  function weldMap(P) {
    const vCount = P.length / 3;
    const map = new Map();
    const out = new Int32Array(vCount);
    for (let i = 0; i < vCount; i++) {
      const qx = Math.round(P[i * 3] * 1e5), qy = Math.round(P[i * 3 + 1] * 1e5), qz = Math.round(P[i * 3 + 2] * 1e5);
      const key = qx + ',' + qy + ',' + qz;
      let id = map.get(key);
      if (id === undefined) { id = map.size; map.set(key, id); }
      out[i] = id;
    }
    return out;
  }
  function components(mesh) {
    const I = mesh.indices, vCount = mesh.positions.length / 3;
    const weld = weldMap(mesh.positions);
    const parent = new Int32Array(Math.max(vCount, weld.reduce((a, b) => Math.max(a, b), 0) + 1));
    for (let i = 0; i < vCount; i++) parent[i] = i;
    const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
    for (let t = 0; t < I.length; t += 3) { uni(weld[I[t]], weld[I[t + 1]]); uni(weld[I[t + 1]], weld[I[t + 2]]); }
    const counts = new Set();
    for (let i = 0; i < vCount; i++) counts.add(find(weld[i]));
    return counts.size;
  }

  /* ---------------- إصلاح ---------------- */
  function repairMesh(mesh, opts) {
    opts = opts || {};
    let m = { positions: mesh.positions, indices: mesh.indices, uvs: mesh.uvs, observed: mesh.observed, confidence: mesh.confidence, meta: mesh.meta };
    // أزل الوجوه المنحلة
    const I = m.indices, keep = [];
    const P = m.positions;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      if (a === b || b === c || a === c) continue;
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const e1x = P[b * 3] - ax, e1y = P[b * 3 + 1] - ay, e1z = P[b * 3 + 2] - az;
      const e2x = P[c * 3] - ax, e2y = P[c * 3 + 1] - ay, e2z = P[c * 3 + 2] - az;
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      if (Math.hypot(nx, ny, nz) < 1e-14) continue;
      keep.push(a, b, c);
    }
    m.indices = new Uint32Array(keep);
    // احذف الرؤوس غير المستخدمة
    m = compactVertices(m);
    // أغلق الثقوب الصغيرة (حلقات حدودية ≤ 12)
    m = fillSmallHoles(m, 12);
    // احذف المكوّنات الصغيرة المنفصلة
    const ratio = opts.minComponentRatio || 0.02;
    m = removeIsolated(m, ratio);
    m.normals = computeNormals(m.positions, m.indices);
    if (!m.observed) m.observed = new Float32Array(m.positions.length / 3).fill(1);
    if (!m.confidence) m.confidence = new Float32Array(m.positions.length / 3).fill(0.7);
    if (mesh.meta) m.meta = Object.assign({}, mesh.meta, { repaired: true });
    return m;
  }
  function compactVertices(mesh) {
    const used = new Uint8Array(mesh.positions.length / 3);
    for (let i = 0; i < mesh.indices.length; i++) used[mesh.indices[i]] = 1;
    const remap = new Int32Array(used.length).fill(-1);
    let n = 0;
    for (let i = 0; i < used.length; i++) if (used[i]) remap[i] = n++;
    const P = new Float32Array(n * 3), Uv = new Float32Array(n * 2);
    const Ob = new Float32Array(n), Cf = new Float32Array(n);
    for (let i = 0; i < used.length; i++) {
      const j = remap[i]; if (j < 0) continue;
      P[j * 3] = mesh.positions[i * 3]; P[j * 3 + 1] = mesh.positions[i * 3 + 1]; P[j * 3 + 2] = mesh.positions[i * 3 + 2];
      if (mesh.uvs) { Uv[j * 2] = mesh.uvs[i * 2]; Uv[j * 2 + 1] = mesh.uvs[i * 2 + 1]; }
      if (mesh.observed) Ob[j] = mesh.observed[i];
      if (mesh.confidence) Cf[j] = mesh.confidence[i];
    }
    const I = new Uint32Array(mesh.indices.length);
    for (let i = 0; i < mesh.indices.length; i++) I[i] = remap[mesh.indices[i]];
    return { positions: P, indices: I, uvs: Uv, observed: Ob, confidence: Cf, meta: mesh.meta, normals: null };
  }
  function fillSmallHoles(mesh, maxLoop) {
    // ابنِ خريطة الحواف
    const I = mesh.indices;
    const edgeFace = new Map();
    const ek = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
    const adj = new Map();
    for (let t = 0; t < I.length; t += 3) {
      const v = [I[t], I[t + 1], I[t + 2]];
      for (let e = 0; e < 3; e++) {
        const a = v[e], b = v[(e + 1) % 3];
        const k = ek(a, b);
        edgeFace.set(k, (edgeFace.get(k) || 0) + 1);
        if (!adj.has(a)) adj.set(a, []);
        adj.get(a).push(b);
      }
    }
    const boundaryEdges = [];
    for (const [k, c] of edgeFace) if (c === 1) {
      const a = Math.floor(k / 4294967296), b = k % 4294967296;
      boundaryEdges.push([a, b]);
    }
    if (!boundaryEdges.length) return mesh;
    const next = new Map();
    for (const [a, b] of boundaryEdges) next.set(a, b);
    const visited = new Set();
    const newTris = [];
    for (const [start] of boundaryEdges) {
      if (visited.has(start)) continue;
      const loop = [];
      let cur = start, guard = 0;
      while (next.has(cur) && !visited.has(cur) && guard++ < maxLoop + 2) {
        visited.add(cur); loop.push(cur); cur = next.get(cur);
        if (cur === start) break;
      }
      if (loop.length >= 3 && loop.length <= maxLoop && cur === start) {
        // تثليث مروحي
        for (let i = 1; i < loop.length - 1; i++) newTris.push(loop[0], loop[i], loop[i + 1]);
      }
    }
    if (!newTris.length) return mesh;
    const merged = new Uint32Array(I.length + newTris.length);
    merged.set(I, 0);
    merged.set(newTris, I.length);
    return Object.assign({}, mesh, { indices: merged });
  }
  function removeIsolated(mesh, ratio) {
    const I = mesh.indices, vCount = mesh.positions.length / 3;
    const parent = new Int32Array(vCount);
    for (let i = 0; i < vCount; i++) parent[i] = i;
    const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    for (let t = 0; t < I.length; t += 3) {
      const ra = find(I[t]), rb = find(I[t + 1]), rc = find(I[t + 2]);
      if (ra !== rb) parent[ra] = rb;
      if (rb !== rc) parent[rb] = rc;
    }
    const triCount = new Map();
    for (let t = 0; t < I.length; t += 3) {
      const r = find(I[t]);
      triCount.set(r, (triCount.get(r) || 0) + 1);
    }
    const total = I.length / 3;
    const keepRoots = new Set();
    for (const [r, c] of triCount) if (c / Math.max(1, total) >= ratio) keepRoots.add(r);
    if (keepRoots.size === triCount.size) return mesh;
    const keep = [];
    for (let t = 0; t < I.length; t += 3) if (keepRoots.has(find(I[t]))) keep.push(I[t], I[t + 1], I[t + 2]);
    const m2 = Object.assign({}, mesh, { indices: new Uint32Array(keep) });
    return compactVertices(m2);
  }

  /* ---------------- تنعيم (Laplacian يحافظ على الملامح) ---------------- */
  function smoothMesh(mesh, iters, lambda) {
    iters = iters || 1; lambda = lambda == null ? 0.5 : lambda;
    const P = mesh.positions, I = mesh.indices;
    const nbr = buildAdjacency(P.length / 3, I);
    for (let it = 0; it < iters; it++) {
      const out = Float32Array.from(P);
      for (let v = 0; v < P.length / 3; v++) {
        const list = nbr[v];
        if (!list || !list.length) continue;
        let ax = 0, ay = 0, az = 0;
        for (const n of list) { ax += P[n * 3]; ay += P[n * 3 + 1]; az += P[n * 3 + 2]; }
        ax /= list.length; ay /= list.length; az /= list.length;
        out[v * 3] = U.lerp(P[v * 3], ax, lambda);
        out[v * 3 + 1] = U.lerp(P[v * 3 + 1], ay, lambda);
        out[v * 3 + 2] = U.lerp(P[v * 3 + 2], az, lambda);
      }
      mesh.positions.set(out);
      // وقف الاتجاه للداخل: حافظ على الحجم بخطوة مقابلة (Taubin مبسّط)
      if (it % 2 === 1) {
        const shrink = Float32Array.from(mesh.positions);
        for (let v = 0; v < P.length / 3; v++) {
          const list = nbr[v]; if (!list || !list.length) continue;
          let ax = 0, ay = 0, az = 0;
          for (const n of list) { ax += mesh.positions[n * 3]; ay += mesh.positions[n * 3 + 1]; az += mesh.positions[n * 3 + 2]; }
          ax /= list.length; ay /= list.length; az /= list.length;
          shrink[v * 3] = U.lerp(mesh.positions[v * 3], ax, -lambda * 0.6);
          shrink[v * 3 + 1] = U.lerp(mesh.positions[v * 3 + 1], ay, -lambda * 0.6);
          shrink[v * 3 + 2] = U.lerp(mesh.positions[v * 3 + 2], az, -lambda * 0.6);
        }
        mesh.positions.set(shrink);
      }
    }
    mesh.normals = computeNormals(mesh.positions, mesh.indices);
    return mesh;
  }
  function buildAdjacency(vCount, I) {
    const adj = Array.from({ length: vCount }, () => new Set());
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      adj[a].add(b); adj[a].add(c);
      adj[b].add(a); adj[b].add(c);
      adj[c].add(a); adj[c].add(b);
    }
    return adj.map(s => [...s]);
  }

  /* ---------------- تبسيط QEM (Garland & Heckbert) ---------------- */
  function decimateMesh(mesh, ratio) {
    ratio = clamp(ratio, 0.05, 1);
    const targetFaces = Math.max(8, Math.floor((mesh.indices.length / 3) * ratio));
    if (mesh.indices.length / 3 <= targetFaces) return mesh;
    const P = mesh.positions, I = mesh.indices, vCount = P.length / 3;
    // مصفوفات التربيع
    const Q = new Float64Array(vCount * 10); // xx xy xz yy yz zz x y z 1(وزن)
    const addPlane = (v, a, b, c, d) => {
      const o = v * 10;
      Q[o] += a * a; Q[o + 1] += a * b; Q[o + 2] += a * c; Q[o + 3] += a * d;
      Q[o + 4] += b * b; Q[o + 5] += b * c; Q[o + 6] += b * d;
      Q[o + 7] += c * c; Q[o + 8] += c * d;
      Q[o + 9] += d * d;
    };
    for (let t = 0; t < I.length; t += 3) {
      const ia = I[t] * 3, ib = I[t + 1] * 3, ic = I[t + 2] * 3;
      const ax = P[ia], ay = P[ia + 1], az = P[ia + 2];
      const e1x = P[ib] - ax, e1y = P[ib + 1] - ay, e1z = P[ib + 2] - az;
      const e2x = P[ic] - ax, e2y = P[ic + 1] - ay, e2z = P[ic + 2] - az;
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const d = -(nx * ax + ny * ay + nz * az);
      addPlane(I[t], nx, ny, nz, d); addPlane(I[t + 1], nx, ny, nz, d); addPlane(I[t + 2], nx, ny, nz, d);
    }
    const quadricError = (o, x, y, z) =>
      Q[o] * x * x + 2 * Q[o + 1] * x * y + 2 * Q[o + 2] * x * z + 2 * Q[o + 3] * x +
      Q[o + 4] * y * y + 2 * Q[o + 5] * y * z + 2 * Q[o + 6] * y +
      Q[o + 7] * z * z + 2 * Q[o + 8] * z + Q[o + 9];

    // الحواف
    const ek = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
    const edgeSet = new Map();
    for (let t = 0; t < I.length; t += 3) {
      const v = [I[t], I[t + 1], I[t + 2]];
      for (let e = 0; e < 3; e++) {
        const a = v[e], b = v[(e + 1) % 3];
        const k = ek(a, b);
        if (!edgeSet.has(k)) edgeSet.set(k, [a, b]);
      }
    }
    // Union-Find للرؤوس (يمنع التكلفة التربيعية)
    const parent = new Int32Array(vCount);
    for (let i = 0; i < vCount; i++) parent[i] = i;
    function find(v) {
      let r = v;
      while (parent[r] !== r) r = parent[r];
      while (parent[v] !== r) { const nx = parent[v]; parent[v] = r; v = nx; }
      return r;
    }
    // مجاورة تقريبية لشرط الربط (link condition) — يمنع الحواف غير المانيفولدية
    const nbr = buildAdjacency(vCount, I);
    const nbrSet = nbr.map(s => new Set(s));
    const heap = new MinHeap();
    for (const e of edgeSet.values()) {
      const a = e[0], b = e[1];
      if (a === b) continue;
      const oa = a * 10, ob = b * 10;
      const x = (P[a * 3] + P[b * 3]) * 0.5, y = (P[a * 3 + 1] + P[b * 3 + 1]) * 0.5, z = (P[a * 3 + 2] + P[b * 3 + 2]) * 0.5;
      const cost = Math.min(quadricError(oa, x, y, z), quadricError(ob, x, y, z));
      heap.push({ cost, a, b });
    }

    let faces = I.length / 3;
    const collapseCount = Math.max(0, Math.floor((faces - targetFaces) / 2));
    let collapsed = 0, guard = 0;
    const guardMax = Math.max(2000, collapseCount * 14);
    // كل انهيار لحافة داخلية يحذف وجهين — نستمر حتى بلوغ الهدف
    while (faces > targetFaces && collapsed < collapseCount && heap.size() > 0 && guard++ < guardMax) {
      const e = heap.pop();
      if (!e) break;
      const a = find(e.a), b = find(e.b);
      if (a === b) continue;
      // شرط الربط: التقاء مجاورتَي الرأسين يجب ألا يتجاوز الرأسين المشتركين
      if (guard % 3 === 0) {
        let common = 0;
        const sa = nbrSet[a], sb = nbrSet[b];
        for (const x of sa) if (sb.has(x) && find(x) !== a && find(x) !== b) common++;
        if (common > 2) continue;
      }
      collapsed++; faces -= 2;
      // ادمج b في a مع تحديث الموضع الأمثل من التربيعي المدموج
      for (let k = 0; k < 10; k++) Q[a * 10 + k] += Q[b * 10 + k];
      const opt = optimalPosition(Q, a, [
        (P[a * 3] + P[b * 3]) * 0.5,
        (P[a * 3 + 1] + P[b * 3 + 1]) * 0.5,
        (P[a * 3 + 2] + P[b * 3 + 2]) * 0.5
      ]);
      P[a * 3] = opt[0]; P[a * 3 + 1] = opt[1]; P[a * 3 + 2] = opt[2];
      parent[b] = a;
    }
    // أعد بناء الوجوه
    const out = [];
    for (let t = 0; t < I.length; t += 3) {
      const a = find(I[t]), b = find(I[t + 1]), c = find(I[t + 2]);
      if (a === b || b === c || a === c) continue;
      out.push(a, b, c);
    }
    const m2 = {
      positions: P, indices: new Uint32Array(out), uvs: mesh.uvs,
      observed: mesh.observed, confidence: mesh.confidence, meta: mesh.meta, normals: null
    };
    const compacted = compactVertices(m2);
    compacted.normals = computeNormals(compacted.positions, compacted.indices);
    return compacted;
  }

  /* الموضع الأمثل لانهيار حافة (حل 3×3 من مصفوفة التربيع) */
  function optimalPosition(Q, v, fallback) {
    const o = v * 10;
    const a = Q[o], b = Q[o + 1], c = Q[o + 2], d = Q[o + 3];
    const e = Q[o + 4], f = Q[o + 5], g = Q[o + 6], h = Q[o + 7], i2 = Q[o + 8];
    const A11 = e * h - f * f, A12 = c * f - b * h, A13 = b * f - e * c;
    const A22 = a * h - c * c, A23 = b * c - a * f, A33 = a * e - b * b;
    const det = a * A11 + b * A12 + c * A13;
    if (!isFinite(det) || Math.abs(det) < 1e-14) return fallback;
    const x = -(A11 * d + A12 * g + A13 * i2) / det;
    const y = -(A12 * d + A22 * g + A23 * i2) / det;
    const z = -(A13 * d + A23 * g + A33 * i2) / det;
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return fallback;
    // حماية: لا تبتعد كثيرًا عن الموضع الأصلي
    const dist = Math.hypot(x - fallback[0], y - fallback[1], z - fallback[2]);
    const scaleRef = Math.hypot(fallback[0], fallback[1], fallback[2]) + 1e-6;
    if (dist > scaleRef * 0.5 + 0.5) return fallback;
    return [x, y, z];
  }

  class MinHeap {
    constructor() { this.a = []; }
    size() { return this.a.length; }
    push(x) {
      const a = this.a; a.push(x);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].cost <= a[i].cost) break;
        const t = a[p]; a[p] = a[i]; a[i] = t; i = p;
      }
    }
    pop() {
      const a = this.a;
      if (!a.length) return null;
      const top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < a.length && a[l].cost < a[m].cost) m = l;
          if (r < a.length && a[r].cost < a[m].cost) m = r;
          if (m === i) break;
          const t = a[m]; a[m] = a[i]; a[i] = t; i = m;
        }
      }
      return top;
    }
  }

  /* ---------------- أدوات التعديل (مواصفة 47) ---------------- */
  function transformMesh(mesh, t) {
    const P = mesh.positions, N = mesh.normals;
    const sx = t.scale ? t.scale[0] : 1, sy = t.scale ? t.scale[1] : 1, sz = t.scale ? t.scale[2] : 1;
    const rx = t.rotate ? t.rotate[0] : 0, ry = t.rotate ? t.rotate[1] : 0, rz = t.rotate ? t.rotate[2] : 0;
    const tr = t.translate || [0, 0, 0];
    const cx = Math.cos(rx), sxr = Math.sin(rx), cy = Math.cos(ry), syr = Math.sin(ry), cz = Math.cos(rz), szr = Math.sin(rz);
    const rot = (x, y, z, out) => {
      let X = x, Y = y, Z = z, t1;
      t1 = X * cz - Y * szr; Y = X * szr + Y * cz; X = t1;      // Z
      t1 = X * cy + Z * syr; Z = -X * syr + Z * cy; X = t1;     // Y
      t1 = Y * cx - Z * sxr; Z = Y * sxr + Z * cx; Y = t1;      // X
      out[0] = X; out[1] = Y; out[2] = Z;
      return out;
    };
    const o = [0, 0, 0];
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i] * sx, y = P[i + 1] * sy, z = P[i + 2] * sz;
      rot(x, y, z, o);
      P[i] = o[0] + tr[0]; P[i + 1] = o[1] + tr[1]; P[i + 2] = o[2] + tr[2];
    }
    if (N) for (let i = 0; i < N.length; i += 3) {
      rot(N[i], N[i + 1], N[i + 2], o);
      const len = Math.hypot(o[0], o[1], o[2]) || 1;
      N[i] = o[0] / len; N[i + 1] = o[1] / len; N[i + 2] = o[2] / len;
    }
    if (mesh.stats) mesh.stats = meshStats(mesh);
    return mesh;
  }
  function centerMesh(mesh) {
    const s = meshStats(mesh).bounds;
    transformMesh(mesh, { translate: [-s.center[0], -s.center[1], -s.center[2]] });
    return mesh;
  }
  function fitScale(mesh, targetHeight) {
    const s = meshStats(mesh).bounds;
    const h = Math.max(1e-6, s.size[1]);
    const k = targetHeight / h;
    centerMesh(mesh);
    transformMesh(mesh, { scale: [k, k, k] });
    return mesh;
  }
  function removeEstimated(mesh) {
    if (!mesh.observed) return mesh;
    const keep = [];
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const a = mesh.indices[t], b = mesh.indices[t + 1], c = mesh.indices[t + 2];
      if (mesh.observed[a] > 0.5 && mesh.observed[b] > 0.5 && mesh.observed[c] > 0.5) keep.push(a, b, c);
    }
    const m2 = Object.assign({}, mesh, { indices: new Uint32Array(keep) });
    return repairMesh(compactVertices(m2), { minComponentRatio: 0.05 });
  }
  /* حذف منطقة محددة (مجموعة رؤوس) — مواصفة 48 */
  function deleteVertices(mesh, vertexSet) {
    const keep = [];
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const a = mesh.indices[t], b = mesh.indices[t + 1], c = mesh.indices[t + 2];
      if (vertexSet.has(a) || vertexSet.has(b) || vertexSet.has(c)) continue;
      keep.push(a, b, c);
    }
    if (!keep.length) return mesh;
    const m2 = Object.assign({}, mesh, { indices: new Uint32Array(keep) });
    return repairMesh(compactVertices(m2), { minComponentRatio: 0.02 });
  }
  /* دمج شبكتين (لإعادة بناء منطقة محددة) */
  function mergeMeshes(a, b) {
    const va = a.positions.length / 3, vb = b.positions.length / 3;
    const P = new Float32Array((va + vb) * 3);
    P.set(a.positions, 0); P.set(b.positions, va * 3);
    const Uv = new Float32Array((va + vb) * 2);
    if (a.uvs) Uv.set(a.uvs, 0);
    if (b.uvs) Uv.set(b.uvs, va * 2);
    const Ob = new Float32Array(va + vb).fill(1);
    if (a.observed) Ob.set(a.observed, 0);
    if (b.observed) Ob.set(b.observed, va);
    const Cf = new Float32Array(va + vb).fill(0.7);
    if (a.confidence) Cf.set(a.confidence, 0);
    if (b.confidence) Cf.set(b.confidence, va);
    const I = new Uint32Array(a.indices.length + b.indices.length);
    I.set(a.indices, 0);
    for (let i = 0; i < b.indices.length; i++) I[a.indices.length + i] = b.indices[i] + va;
    return {
      positions: P, indices: I, uvs: Uv, observed: Ob, confidence: Cf,
      normals: computeNormals(P, I), meta: a.meta
    };
  }

  AI3D.Geometry = {
    reconstruct, buildPointCloud, computeNormals, meshStats, components,
    repairMesh, compactVertices, smoothMesh, decimateMesh, removeIsolated,
    transformMesh, centerMesh, fitScale, removeEstimated, deleteVertices,
    mergeMeshes, fillSmallHoles, buildAdjacency, weldMap, QUALITY, THICKNESS
  };
})(typeof window !== 'undefined' ? window : globalThis);
