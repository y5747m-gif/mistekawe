/* ============================================================
 * exporters.js — التصدير (مواصفة 31 + 32)
 * GLB / OBJ+MTL / STL / PLY + Texture PNG + مشروع ZIP.
 * كل التصدير محلي — يُبنى الملف داخل المتصفح.
 * ============================================================ */
(function (global) {
  'use strict';
  const AI3D = global.AI3D;

  function canvasToPNGBytes(canvas) {
    return new Promise((resolve) => {
      canvas.toBlob((b) => {
        const fr = new FileReader();
        fr.onload = () => resolve(new Uint8Array(fr.result));
        fr.readAsArrayBuffer(b);
      }, 'image/png');
    });
  }

  /* ---------- OBJ + MTL ---------- */
  function exportOBJ(mesh, name) {
    name = name || 'model';
    const P = mesh.positions, N = mesh.normals, T = mesh.uvs, I = mesh.indices;
    const L = [];
    L.push('# MISTEKAWE AI-3D Engine v' + AI3D.version);
    L.push('mtllib ' + name + '.mtl');
    L.push('o ' + name);
    for (let i = 0; i < P.length; i += 3) L.push('v ' + P[i].toFixed(6) + ' ' + P[i + 1].toFixed(6) + ' ' + P[i + 2].toFixed(6));
    for (let i = 0; i < T.length; i += 2) L.push('vt ' + T[i].toFixed(6) + ' ' + T[i + 1].toFixed(6));
    for (let i = 0; i < N.length; i += 3) L.push('vn ' + N[i].toFixed(6) + ' ' + N[i + 1].toFixed(6) + ' ' + N[i + 2].toFixed(6));
    L.push('usemtl mat0');
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] + 1, b = I[t + 1] + 1, c = I[t + 2] + 1;
      L.push('f ' + a + '/' + a + '/' + a + ' ' + b + '/' + b + '/' + b + ' ' + c + '/' + c + '/' + c);
    }
    const obj = new Blob([L.join('\n')], { type: 'text/plain' });
    const mtl = new Blob([[
      '# MISTEKAWE AI-3D', 'newmtl mat0', 'Ka 1.0 1.0 1.0', 'Kd 1.0 1.0 1.0',
      'Ks 0.15 0.15 0.15', 'Ns 32', 'd 1.0', 'illum 2', 'map_Kd ' + name + '_texture.png'
    ].join('\n')], { type: 'text/plain' });
    return { obj, mtl };
  }

  /* ---------- STL ثنائي ---------- */
  function exportSTL(mesh, name) {
    const P = mesh.positions, I = mesh.indices;
    const tris = I.length / 3;
    const buf = new ArrayBuffer(84 + tris * 50);
    const dv = new DataView(buf);
    const head = 'MISTEKAWE AI-3D STL';
    for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
    dv.setUint32(80, tris, true);
    let o = 84;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const abx = P[b] - P[a], aby = P[b + 1] - P[a + 1], abz = P[b + 2] - P[a + 2];
      const acx = P[c] - P[a], acy = P[c + 1] - P[a + 1], acz = P[c + 2] - P[a + 2];
      let nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true); o += 12;
      for (const v of [a, b, c]) {
        dv.setFloat32(o, P[v], true); dv.setFloat32(o + 4, P[v + 1], true); dv.setFloat32(o + 8, P[v + 2], true); o += 12;
      }
      dv.setUint16(o, 0, true); o += 2;
    }
    return new Blob([buf], { type: 'model/stl' });
  }

  /* ---------- PLY (مع ألوان مُستخلصة من الـ Texture) ---------- */
  function exportPLY(mesh, texCanvas) {
    const P = mesh.positions, T = mesh.uvs, I = mesh.indices;
    const vCount = P.length / 3;
    let tex = null, tw = 0, th = 0;
    if (texCanvas) {
      tw = texCanvas.width; th = texCanvas.height;
      tex = texCanvas.getContext('2d').getImageData(0, 0, tw, th).data;
    }
    const L = [];
    L.push('ply', 'format ascii 1.0', 'comment MISTEKAWE AI-3D Engine v' + AI3D.version);
    L.push('element vertex ' + vCount);
    L.push('property float x', 'property float y', 'property float z');
    L.push('property uchar red', 'property uchar green', 'property uchar blue');
    L.push('element face ' + (I.length / 3), 'property list uchar uint vertex_indices', 'end_header');
    for (let i = 0; i < vCount; i++) {
      let r = 200, g = 200, b = 200;
      if (tex) {
        const tx = Math.min(tw - 1, Math.max(0, Math.round(T[i * 2] * (tw - 1))));
        const ty = Math.min(th - 1, Math.max(0, Math.round((1 - T[i * 2 + 1]) * (th - 1))));
        const p = (ty * tw + tx) * 4;
        r = tex[p]; g = tex[p + 1]; b = tex[p + 2];
      }
      L.push(P[i * 3].toFixed(6) + ' ' + P[i * 3 + 1].toFixed(6) + ' ' + P[i * 3 + 2].toFixed(6) + ' ' + r + ' ' + g + ' ' + b);
    }
    for (let t = 0; t < I.length; t += 3) L.push('3 ' + I[t] + ' ' + I[t + 1] + ' ' + I[t + 2]);
    return new Blob([L.join('\n')], { type: 'text/plain' });
  }

  /* ---------- GLB ثنائي (مع Texture مضمّنة) ---------- */
  async function exportGLB(mesh, texCanvas, material) {
    const P = mesh.positions, N = mesh.normals, T = mesh.uvs, I = mesh.indices;
    const vCount = P.length / 3;
    const use32 = vCount > 65535;
    const idxArr = use32 ? new Uint32Array(I) : new Uint16Array(I);
    const idxType = use32 ? 5125 : 5123;

    // حدود
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < P.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (P[i + k] < mn[k]) mn[k] = P[i + k];
        if (P[i + k] > mx[k]) mx[k] = P[i + k];
      }
    }
    const png = texCanvas ? await canvasToPNGBytes(texCanvas) : null;

    const posBytes = new Uint8Array(P.buffer, P.byteOffset, P.byteLength);
    const norBytes = new Uint8Array(N.buffer, N.byteOffset, N.byteLength);
    const uvBytes = new Uint8Array(new Float32Array(T).buffer);
    const idxBytes = new Uint8Array(idxArr.buffer);

    const chunks = [posBytes, norBytes, uvBytes, idxBytes];
    if (png) chunks.push(png);
    // bufferViews مع محاذاة 4
    const bufferViews = [];
    let total = 0;
    const parts = [];
    chunks.forEach((ch, k) => {
      const pad = (4 - (total % 4)) % 4;
      if (pad) { parts.push(new Uint8Array(pad)); total += pad; }
      bufferViews.push({ buffer: 0, byteOffset: total, byteLength: ch.byteLength, target: k < 3 ? 34962 : (k === 3 ? 34963 : undefined) });
      if (bufferViews[k].target === undefined) delete bufferViews[k].target;
      parts.push(ch); total += ch.byteLength;
    });
    const binLength = total;
    const bin = new Uint8Array(binLength);
    let off = 0;
    for (const p of parts) { bin.set(p, off); off += p.byteLength; }

    const json = {
      asset: { version: '2.0', generator: 'MISTEKAWE AI-3D Engine v' + AI3D.version },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: 'AI3D_Model' }],
      meshes: [{
        name: 'AI3D_Mesh',
        primitives: [{
          attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
          indices: 3, material: 0, mode: 4
        }]
      }],
      materials: [{
        name: 'AI3D_Material',
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: material ? material.metallic : 0.05,
          roughnessFactor: material ? material.roughness : 0.6
        },
        doubleSided: true
      }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: vCount, type: 'VEC3', min: mn, max: mx },
        { bufferView: 1, componentType: 5126, count: vCount, type: 'VEC3' },
        { bufferView: 2, componentType: 5126, count: vCount, type: 'VEC2' },
        { bufferView: 3, componentType: idxType, count: I.length, type: 'SCALAR' }
      ],
      bufferViews,
      buffers: [{ byteLength: binLength }]
    };
    if (png) {
      const imgView = bufferViews.length - 1;
      json.images = [{ bufferView: imgView, mimeType: 'image/png', name: 'texture' }];
      json.textures = [{ source: 0, sampler: 0 }];
      json.samplers = [{ magFilter: 9729, minFilter: 9986, wrapS: 10497, wrapT: 10497 }];
      json.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };
    }
    const jsonStr = JSON.stringify(json);
    const jsonBytes = new TextEncoder().encode(jsonStr);
    const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
    const totalLen = 12 + 8 + jsonBytes.length + jsonPad + 8 + binLength;
    const out = new Uint8Array(totalLen);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546C67, true); // glTF
    dv.setUint32(4, 2, true);
    dv.setUint32(8, totalLen, true);
    let o = 12;
    dv.setUint32(o, jsonBytes.length + jsonPad, true); o += 4;
    dv.setUint32(o, 0x4E4F534A, true); o += 4; // JSON
    out.set(jsonBytes, o); o += jsonBytes.length;
    for (let i = 0; i < jsonPad; i++) out[o++] = 0x20;
    dv.setUint32(o, binLength, true); o += 4;
    dv.setUint32(o, 0x004E4942, true); o += 4; // BIN
    out.set(bin, o);
    return new Blob([out.buffer], { type: 'model/gltf-binary' });
  }

  /* ---------- كاتب ZIP (store بدون ضغط — متوافق) ---------- */
  function writeZip(files) {
    // files: [{name, data:Uint8Array}]
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const nameB = enc.encode(f.name);
      const crc = AI3D.crc32(f.data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0, true);
      lh.setUint16(8, 0, true); // store
      lh.setUint16(10, 0, true); lh.setUint16(12, 0, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, f.data.byteLength, true);
      lh.setUint32(22, f.data.byteLength, true);
      lh.setUint16(26, nameB.length, true);
      lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), nameB, f.data);
      central.push({ nameB, crc, size: f.data.byteLength, offset });
      offset += 30 + nameB.length + f.data.byteLength;
    }
    const cdStart = offset;
    let cdSize = 0;
    for (const c of central) {
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, 0, true); ch.setUint16(14, 0, true);
      ch.setUint32(16, c.crc, true);
      ch.setUint32(20, c.size, true); ch.setUint32(24, c.size, true);
      ch.setUint16(28, c.nameB.length, true);
      ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
      ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true);
      ch.setUint32(42, c.offset, true);
      parts.push(new Uint8Array(ch.buffer), c.nameB);
      cdSize += 46 + c.nameB.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, central.length, true);
    end.setUint16(10, central.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, cdStart, true);
    end.setUint16(20, 0, true);
    parts.push(new Uint8Array(end.buffer));
    return new Blob(parts, { type: 'application/zip' });
  }

  async function blobToBytes(blob) {
    const ab = await blob.arrayBuffer();
    return new Uint8Array(ab);
  }

  /* حزمة المشروع الكاملة */
  async function exportProjectZIP(project) {
    const files = [];
    const meta = {
      app: 'MISTEKAWE AI-3D Studio', engine: 'AI-3D Engine v' + AI3D.version,
      createdAt: new Date().toISOString(), name: project.name,
      settings: project.settings, scores: project.scores, info: project.info,
      material: project.material, note: 'نموذج مُولّد محليًا — تقييمات الجودة تقديرية داخلية.'
    };
    files.push({ name: 'meta.json', data: new TextEncoder().encode(JSON.stringify(meta, null, 2)) });
    if (project.modelGLB) files.push({ name: project.name + '.glb', data: await blobToBytes(project.modelGLB) });
    if (project.modelOBJ) {
      files.push({ name: project.name + '.obj', data: await blobToBytes(project.modelOBJ.obj) });
      files.push({ name: project.name + '.mtl', data: await blobToBytes(project.modelOBJ.mtl) });
    }
    if (project.texturePNG) files.push({ name: project.name + '_texture.png', data: await blobToBytes(project.texturePNG) });
    if (project.originalJPG) files.push({ name: 'source_original.jpg', data: await blobToBytes(project.originalJPG) });
    if (project.depthPNG) files.push({ name: 'debug_depth.png', data: await blobToBytes(project.depthPNG) });
    if (project.maskPNG) files.push({ name: 'debug_mask.png', data: await blobToBytes(project.maskPNG) });
    return writeZip(files);
  }

  AI3D.Exporters = { exportOBJ, exportSTL, exportPLY, exportGLB, writeZip, exportProjectZIP, canvasToPNGBytes, blobToBytes };
})(window);
