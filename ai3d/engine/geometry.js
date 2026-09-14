/* ============================================================
 * geometry.js — بناء الـ Mesh وتنظيفه وتحسين الطوبولوجيا
 * (مواصفة 8 + 10 + 11 + 12 + 13 + 26 + 47)
 * شبكة أمامية من خريطة العمق + ظهر مُستنتَج + لحام الحواف +
 * إصلاح تلقائي + تبسيط + تنعيم. تمييز Observed vs Estimated.
 * ============================================================ */
(function (global) {
  'use strict';
  const AI3D = global.AI3D;
  const U = AI3D.util;

  const QUALITY_GRID = { low: 110, medium: 200, high: 300, ultra: 420 };

  function buildMesh(input) {
    const { depth, mask, confidence, w, h, bbox, quality, depthScale } = input;
    const grid = QUALITY_GRID[quality] || QUALITY_GRID.medium;
    const aspect = w / h;

    // منطقة الشبكة = bbox الموسّع قليلًا
    const pad = 0.015;
    const x0 = U.clamp(bbox.x0 - pad, 0, 1), y0 = U.clamp(bbox.y0 - pad, 0, 1);
    const x1 = U.clamp(bbox.x1 + pad, 0, 1), y1 = U.clamp(bbox.y1 + pad, 0, 1);
    const bw = Math.max(1e-4, x1 - x0), bh = Math.max(1e-4, y1 - y0);
    let gw = grid, gh = Math.max(24, Math.round(grid * (bh * h) / (bw * w)));
    gh = Math.min(gh, grid * 2);

    const sample = (field, u, v) => {
      const fx = U.clamp(u, 0, 1) * (w - 1), fy = U.clamp(v, 0, 1) * (h - 1);
      const xA = Math.floor(fx), yA = Math.floor(fy);
      const xB = Math.min(w - 1, xA + 1), yB = Math.min(h - 1, yA + 1);
      const tx = fx - xA, ty = fy - yA;
      return field[yA * w + xA] * (1 - tx) * (1 - ty) + field[yA * w + xB] * tx * (1 - ty) +
             field[yB * w + xA] * (1 - tx) * ty + field[yB * w + xB] * tx * ty;
    };

    const dScale = depthScale == null ? 0.55 : depthScale;
    const positions = [], uvs = [], confs = [], observed = [];
    const idx = new Int32Array(gw * gh).fill(-1);
    const inside = new Uint8Array(gw * gh);

    for (let gy = 0; gy < gh; gy++) {
      const v = y0 + (gy + 0.5) / gh * (y1 - y0);
      for (let gx = 0; gx < gw; gx++) {
        const u = x0 + (gx + 0.5) / gw * (x1 - x0);
        const m = sample(mask, u, v);
        if (m < 0.42) continue;
        const z = sample(depth, u, v);
        const id = gy * gw + gx;
        inside[id] = 1;
        idx[id] = positions.length / 3;
        // إحداثيات عالمية: X يمين، Y أعلى، Z عمق
        positions.push((u - 0.5) * aspect, (0.5 - v), z * dScale);
        uvs.push(u, 1 - v);
        confs.push(confidence ? sample(confidence, u, v) : 0.8);
        observed.push(1);
      }
    }

    const indices = [];
    const quadOk = (a, b, c, e) => inside[a] && inside[b] && inside[c] && inside[e];
    for (let gy = 0; gy < gh - 1; gy++) {
      for (let gx = 0; gx < gw - 1; gx++) {
        const a = gy * gw + gx, b = a + 1, c = a + gw, e = a + gw + 1;
        if (!quadOk(a, b, c, e)) continue;
        // فحص قفزة عمق حادة (تمزق عند الحواف) — تجاهل المثلثات الممزقة
        const za = positions[idx[a] * 3 + 2], zb = positions[idx[b] * 3 + 2];
        const zc = positions[idx[c] * 3 + 2], ze = positions[idx[e] * 3 + 2];
        const tear = dScale * 0.16;
        const okTear = (p, q, r) => Math.abs(p - q) < tear && Math.abs(q - r) < tear && Math.abs(p - r) < tear;
        // اتجاه اللف: شبكة Y لأسفل في الصورة → وجه أمامي +Z
        if (okTear(za, zc, zb)) indices.push(idx[a], idx[c], idx[b]);
        if (okTear(zb, zc, ze)) indices.push(idx[b], idx[c], idx[e]);
      }
    }

    let mesh = {
      positions: new Float32Array(positions),
      uvs: new Float32Array(uvs),
      indices: new Uint32Array(indices),
      confidence: new Float32Array(confs),
      observed: new Uint8Array(observed),
      meta: { gridW: gw, gridH: gh, quality, frontOnly: true }
    };

    // ظهر مُستنتَج بالذكاء الاصطناعي (مواصفة 10) + لحام الحواف
    mesh = addEstimatedBack(mesh, { thickness: dScale * 0.72, aspect });
    mesh.normals = computeNormals(mesh.positions, mesh.indices);
    mesh = repairMesh(mesh, { silent: true });
    centerMesh(mesh);
    return mesh;
  }

  /* ظهر مُقدَّر: قشرة خلفية بسُمك متناقص نحو الحواف + جوانب */
  function addEstimatedBack(mesh, opts) {
    const pos = mesh.positions, idx = mesh.indices;
    const vCount = pos.length / 3;
    // عدّ استخدام الحواف لاكتشاف الحدود
    const edgeUse = new Map();
    const ekey = (a, b) => a < b ? a * 10000000 + b : b * 10000000 + a;
    for (let t = 0; t < idx.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = idx[t + k], b = idx[t + (k + 1) % 3];
        const key = ekey(a, b);
        edgeUse.set(key, (edgeUse.get(key) || 0) + 1);
      }
    }
    const isBoundary = new Uint8Array(vCount);
    edgeUse.forEach((use, key) => {
      if (use === 1) {
        const a = Math.floor(key / 10000000), b = key % 10000000;
        isBoundary[a] = 1; isBoundary[b] = 1;
      }
    });
    // مسافة تقريبية عن الحدود عبر الانتشار
    const distB = new Float32Array(vCount).fill(1e9);
    const adj = new Map();
    const link = (a, b) => {
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a).push(b);
    };
    for (let t = 0; t < idx.length; t += 3) {
      link(idx[t], idx[t + 1]); link(idx[t + 1], idx[t]);
      link(idx[t + 1], idx[t + 2]); link(idx[t + 2], idx[t + 1]);
      link(idx[t + 2], idx[t]); link(idx[t], idx[t + 2]);
    }
    const queue = [];
    for (let i = 0; i < vCount; i++) if (isBoundary[i]) { distB[i] = 0; queue.push(i); }
    let qh = 0;
    while (qh < queue.length) {
      const v = queue[qh++], nb = adj.get(v);
      if (!nb) continue;
      for (const u of nb) if (distB[u] > distB[v] + 1) { distB[u] = distB[v] + 1; queue.push(u); }
    }
    let maxD = 1;
    for (let i = 0; i < vCount; i++) if (distB[i] < 1e8 && distB[i] > maxD) maxD = distB[i];

    const thickness = opts.thickness || 0.4;
    const newPos = Array.from(pos);
    const newUv = Array.from(mesh.uvs);
    const newConf = Array.from(mesh.confidence);
    const newObs = Array.from(mesh.observed);
    const backOf = new Int32Array(vCount);
    for (let i = 0; i < vCount; i++) {
      const fall = U.clamp01(distB[i] / (maxD * 0.9));
      const shell = 0.15 + 0.85 * fall * fall; // أنحف عند الحواف
      const zb = pos[i * 3 + 2] - thickness * shell;
      backOf[i] = newPos.length / 3;
      newPos.push(pos[i * 3], pos[i * 3 + 1], zb);
      newUv.push(mesh.uvs[i * 2], mesh.uvs[i * 2 + 1]);
      newConf.push(0.25);   // ثقة منخفضة: مُستنتَج
      newObs.push(0);       // 0 = AI Estimated Geometry
    }
    const newIdx = Array.from(idx);
    // وجوه خلفية معكوسة
    for (let t = 0; t < idx.length; t += 3) {
      newIdx.push(backOf[idx[t]], backOf[idx[t + 2]], backOf[idx[t + 1]]);
    }
    // جوانب على الحواف الحدودية
    edgeUse.forEach((use, key) => {
      if (use !== 1) return;
      const a = Math.floor(key / 10000000), b = key % 10000000;
      newIdx.push(a, b, backOf[b], a, backOf[b], backOf[a]);
    });
    return {
      positions: new Float32Array(newPos),
      uvs: new Float32Array(newUv),
      indices: new Uint32Array(newIdx),
      confidence: new Float32Array(newConf),
      observed: new Uint8Array(newObs),
      meta: Object.assign({}, mesh.meta, { frontOnly: false, estimatedRatio: vCount / (vCount * 2) })
    };
  }

  function computeNormals(positions, indices) {
    const n = new Float32Array(positions.length);
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
      const abx = positions[b] - positions[a], aby = positions[b + 1] - positions[a + 1], abz = positions[b + 2] - positions[a + 2];
      const acx = positions[c] - positions[a], acy = positions[c + 1] - positions[a + 1], acz = positions[c + 2] - positions[a + 2];
      let nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
      n[a] += nx; n[a + 1] += ny; n[a + 2] += nz;
      n[b] += nx; n[b + 1] += ny; n[b + 2] += nz;
      n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
    }
    for (let i = 0; i < n.length; i += 3) {
      const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
      n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
    }
    return n;
  }

  /* إصلاح تلقائي شامل (مواصفة 26) */
  function repairMesh(mesh, opts) {
    opts = opts || {};
    let { positions, indices, uvs, confidence, observed } = mesh;
    const vCount = positions.length / 3;
    // 1) إسقاط المثلثات المنحلّة
    const clean = [];
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t], b = indices[t + 1], c = indices[t + 2];
      if (a === b || b === c || a === c) continue;
      if (a >= vCount || b >= vCount || c >= vCount) continue;
      clean.push(a, b, c);
    }
    indices = new Uint32Array(clean);
    // 2) لحام الرؤوس المكررة (تكميم)
    const seen = new Map();
    const remap = new Int32Array(vCount).fill(-1);
    const np = [], nu = [], nc = [], no = [];
    for (let i = 0; i < vCount; i++) {
      const k = Math.round(positions[i * 3] * 4000) + '_' + Math.round(positions[i * 3 + 1] * 4000) + '_' + Math.round(positions[i * 3 + 2] * 4000);
      let id = seen.get(k);
      if (id === undefined) {
        id = np.length / 3;
        seen.set(k, id);
        np.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        nu.push(uvs[i * 2], uvs[i * 2 + 1]);
        nc.push(confidence ? confidence[i] : 0.8);
        no.push(observed ? observed[i] : 1);
      }
      remap[i] = id;
    }
    for (let t = 0; t < indices.length; t++) indices[t] = remap[indices[t]];
    positions = new Float32Array(np); uvs = new Float32Array(nu);
    confidence = new Float32Array(nc); observed = new Uint8Array(no);
    // 3) حذف الرؤوس العائمة
    const used = new Uint8Array(positions.length / 3);
    for (let t = 0; t < indices.length; t++) used[indices[t]] = 1;
    const remap2 = new Int32Array(used.length).fill(-1);
    const fp = [], fu = [], fc = [], fo = [];
    for (let i = 0; i < used.length; i++) {
      if (!used[i]) continue;
      remap2[i] = fp.length / 3;
      fp.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      fu.push(uvs[i * 2], uvs[i * 2 + 1]);
      fc.push(confidence[i]); fo.push(observed[i]);
    }
    for (let t = 0; t < indices.length; t++) indices[t] = remap2[indices[t]];
    // 4) إصلاح اتجاه اللف عبر الحجم الموقّع
    const P = new Float32Array(fp);
    let vol = 0;
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
      vol += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1])
           - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c])
           + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
    }
    if (vol < 0) {
      for (let t = 0; t < indices.length; t += 3) {
        const tmp = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = tmp;
      }
    }
    const out = {
      positions: P, uvs: new Float32Array(fu), indices,
      confidence: new Float32Array(fc), observed: new Uint8Array(fo),
      normals: null, meta: Object.assign({}, mesh.meta, { repaired: true })
    };
    out.normals = computeNormals(out.positions, out.indices);
    return out;
  }

  /* تنعيم لابلاسيان يحافظ على الحواف المرصودة */
  function smoothMesh(mesh, iterations, lambda) {
    iterations = iterations || 2; lambda = lambda == null ? 0.4 : lambda;
    const vCount = mesh.positions.length / 3;
    const adj = new Array(vCount);
    for (let t = 0; t < mesh.indices.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = mesh.indices[t + k], b = mesh.indices[t + (k + 1) % 3];
        (adj[a] || (adj[a] = [])).push(b);
        (adj[b] || (adj[b] = [])).push(a);
      }
    }
    const P = Float32Array.from(mesh.positions);
    for (let it = 0; it < iterations; it++) {
      const next = Float32Array.from(P);
      for (let i = 0; i < vCount; i++) {
        const nb = adj[i];
        if (!nb || !nb.length) continue;
        // رؤوس مرصودة عالية الثقة تتحرك أقل
        const w = lambda * (mesh.observed && mesh.observed[i] ? 0.45 : 1);
        let ax = 0, ay = 0, az = 0;
        for (const j of nb) { ax += P[j * 3]; ay += P[j * 3 + 1]; az += P[j * 3 + 2]; }
        ax /= nb.length; ay /= nb.length; az /= nb.length;
        next[i * 3] += (ax - P[i * 3]) * w;
        next[i * 3 + 1] += (ay - P[i * 3 + 1]) * w;
        next[i * 3 + 2] += (az - P[i * 3 + 2]) * w;
      }
      P.set(next);
    }
    mesh.positions = P;
    mesh.normals = computeNormals(P, mesh.indices);
    mesh.meta.smoothed = (mesh.meta.smoothed || 0) + iterations;
    return mesh;
  }

  /* تبسيط عبر تكتّل الرؤوس (Vertex Clustering) */
  function decimateMesh(mesh, targetRatio) {
    targetRatio = U.clamp(targetRatio == null ? 0.5 : targetRatio, 0.05, 0.95);
    const P = mesh.positions, vCount = P.length / 3;
    // صندوق محيط
    let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
    for (let i = 0; i < vCount; i++) {
      mnx = Math.min(mnx, P[i * 3]); mxx = Math.max(mxx, P[i * 3]);
      mny = Math.min(mny, P[i * 3 + 1]); mxy = Math.max(mxy, P[i * 3 + 1]);
      mnz = Math.min(mnz, P[i * 3 + 2]); mxz = Math.max(mxz, P[i * 3 + 2]);
    }
    const cells = Math.max(8, Math.round(Math.cbrt(vCount * targetRatio)));
    const sx = (mxx - mnx + 1e-6) / cells, sy = (mxy - mny + 1e-6) / cells, sz = (mxz - mnz + 1e-6) / cells;
    const buckets = new Map();
    const remap = new Int32Array(vCount);
    for (let i = 0; i < vCount; i++) {
      const k = Math.floor((P[i * 3] - mnx) / sx) + '_' + Math.floor((P[i * 3 + 1] - mny) / sy) + '_' + Math.floor((P[i * 3 + 2] - mnz) / sz);
      let b = buckets.get(k);
      if (!b) { b = { x: 0, y: 0, z: 0, u: 0, v: 0, c: 0, n: 0, o: 0 }; buckets.set(k, b); }
      b.x += P[i * 3]; b.y += P[i * 3 + 1]; b.z += P[i * 3 + 2];
      b.u += mesh.uvs[i * 2]; b.v += mesh.uvs[i * 2 + 1];
      b.c += mesh.confidence[i]; b.o += mesh.observed[i]; b.n++;
    }
    const ids = new Map(); let vi = 0;
    buckets.forEach((b, k) => { ids.set(k, vi++); });
    const np = new Float32Array(buckets.size * 3), nu = new Float32Array(buckets.size * 2);
    const nc = new Float32Array(buckets.size), no = new Uint8Array(buckets.size);
    buckets.forEach((b, k) => {
      const id = ids.get(k);
      np[id * 3] = b.x / b.n; np[id * 3 + 1] = b.y / b.n; np[id * 3 + 2] = b.z / b.n;
      nu[id * 2] = b.u / b.n; nu[id * 2 + 1] = b.v / b.n;
      nc[id] = b.c / b.n; no[id] = b.o / b.n > 0.5 ? 1 : 0;
    });
    for (let i = 0; i < vCount; i++) {
      const k = Math.floor((P[i * 3] - mnx) / sx) + '_' + Math.floor((P[i * 3 + 1] - mny) / sy) + '_' + Math.floor((P[i * 3 + 2] - mnz) / sz);
      remap[i] = ids.get(k);
    }
    const ni = [];
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const a = remap[mesh.indices[t]], b = remap[mesh.indices[t + 1]], c = remap[mesh.indices[t + 2]];
      if (a !== b && b !== c && a !== c) ni.push(a, b, c);
    }
    const out = {
      positions: np, uvs: nu, indices: new Uint32Array(ni), confidence: nc, observed: no,
      normals: null, meta: Object.assign({}, mesh.meta, { decimated: targetRatio })
    };
    out.normals = computeNormals(np, out.indices);
    return repairMesh(out, { silent: true });
  }

  /* حذف الأجزاء المُستنتَجة فقط (لمن يريد الهندسة المرصودة فقط) */
  function removeEstimated(mesh) {
    const keep = [];
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const a = mesh.indices[t], b = mesh.indices[t + 1], c = mesh.indices[t + 2];
      if (mesh.observed[a] && mesh.observed[b] && mesh.observed[c]) keep.push(a, b, c);
    }
    const out = Object.assign({}, mesh, { indices: new Uint32Array(keep) });
    return repairMesh(out, { silent: true });
  }

  /* حذف المكونات الصغيرة المنفصلة */
  function removeIsolated(mesh, minRatio) {
    minRatio = minRatio == null ? 0.02 : minRatio;
    const vCount = mesh.positions.length / 3;
    const parent = new Int32Array(vCount);
    for (let i = 0; i < vCount; i++) parent[i] = i;
    const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const a = find(mesh.indices[t]), b = find(mesh.indices[t + 1]), c = find(mesh.indices[t + 2]);
      parent[b] = a; parent[find(c)] = a;
    }
    const sizes = new Map();
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const r = find(mesh.indices[t]);
      sizes.set(r, (sizes.get(r) || 0) + 1);
    }
    const total = mesh.indices.length / 3;
    const keep = [];
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const r = find(mesh.indices[t]);
      if ((sizes.get(r) / total) >= minRatio) keep.push(mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]);
    }
    return repairMesh(Object.assign({}, mesh, { indices: new Uint32Array(keep) }), { silent: true });
  }

  /* تحويلات (مواصفة 47) */
  function transformMesh(mesh, m) {
    // m: {scale:[x,y,z], rotate:[rx,ry,rz] rad, translate:[x,y,z]}
    const P = mesh.positions;
    const s = (m && m.scale) || [1, 1, 1], r = (m && m.rotate) || [0, 0, 0], t = (m && m.translate) || [0, 0, 0];
    const cx = Math.cos(r[0]), sxx = Math.sin(r[0]), cy = Math.cos(r[1]), sy = Math.sin(r[1]), cz = Math.cos(r[2]), sz = Math.sin(r[2]);
    for (let i = 0; i < P.length; i += 3) {
      let x = P[i] * s[0], y = P[i + 1] * s[1], z = P[i + 2] * s[2];
      let y1 = y * cx - z * sxx, z1 = y * sxx + z * cx; y = y1; z = z1;       // X
      let x1 = x * cy + z * sy, z2 = -x * sy + z * cy; x = x1; z = z2;       // Y
      let x2 = x * cz - y * sz, y2 = x * sz + y * cz; x = x2; y = y2;        // Z
      P[i] = x + t[0]; P[i + 1] = y + t[1]; P[i + 2] = z + t[2];
    }
    mesh.normals = computeNormals(P, mesh.indices);
    return mesh;
  }

  function boundsOf(mesh) {
    const P = mesh.positions;
    let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
    for (let i = 0; i < P.length; i += 3) {
      if (P[i] < mnx) mnx = P[i]; if (P[i] > mxx) mxx = P[i];
      if (P[i + 1] < mny) mny = P[i + 1]; if (P[i + 1] > mxy) mxy = P[i + 1];
      if (P[i + 2] < mnz) mnz = P[i + 2]; if (P[i + 2] > mxz) mxz = P[i + 2];
    }
    return { min: [mnx, mny, mnz], max: [mxx, mxy, mxz], size: [mxx - mnx, mxy - mny, mxz - mnz] };
  }

  function centerMesh(mesh) {
    const b = boundsOf(mesh);
    const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const P = mesh.positions;
    for (let i = 0; i < P.length; i += 3) { P[i] -= cx; P[i + 1] -= cy; P[i + 2] -= cz; }
    return mesh;
  }

  function meshStats(mesh) {
    const b = boundsOf(mesh);
    let obs = 0;
    for (let i = 0; i < mesh.observed.length; i++) if (mesh.observed[i]) obs++;
    let edgeCount = mesh.indices.length;
    return {
      vertices: mesh.positions.length / 3,
      faces: mesh.indices.length / 3,
      edges: edgeCount,
      observedRatio: mesh.observed.length ? obs / mesh.observed.length : 1,
      bounds: b
    };
  }

  AI3D.Geometry = {
    buildMesh, repairMesh, smoothMesh, decimateMesh, removeEstimated,
    removeIsolated, transformMesh, centerMesh, boundsOf, computeNormals, meshStats, QUALITY_GRID
  };
  AI3D.Models.register('reconstruction', buildMesh);
})(window);
