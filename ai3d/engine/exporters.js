/* ============================================================
 * exporters.js — GLB / glTF / OBJ+MTL / STL / PLY / ZIP
 * (مواصفة 31 • 32)
 *  كتّاب ثنائيون مكتوبون داخل المشروع — لا اعتماد على أي مكتبة خارجية.
 *  ترميز PNG داخلي (Deflate عبر CompressionStream أو كتل مخزّنة).
 * ============================================================ */
(function (global) {
  'use strict';
  const AI3D = global.AI3D;
  const U = AI3D.util;

  /* ---------------- ترميز PNG ---------------- */
  async function deflateBytes(bytes) {
    if (typeof global.CompressionStream === 'function') {
      const cs = new global.CompressionStream('deflate');
      const stream = new Blob([bytes]).stream().pipeThrough(cs);
      const buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    }
    // احتياطي: كتل deflate مخزّنة (غير مضغوطة)
    const out = [0x78, 0x01];
    let pos = 0;
    const CHUNK = 65535;
    const parts = [new Uint8Array(out)];
    while (pos < bytes.length) {
      const len = Math.min(CHUNK, bytes.length - pos);
      const isLast = (pos + len >= bytes.length) ? 1 : 0;
      const header = new Uint8Array(5);
      header[0] = isLast;
      header[1] = len & 0xFF; header[2] = (len >> 8) & 0xFF;
      header[3] = (~len) & 0xFF; header[4] = ((~len) >> 8) & 0xFF;
      parts.push(header, bytes.subarray(pos, pos + len));
      pos += len;
    }
    // adler32
    let a = 1, b = 0;
    for (let i = 0; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; }
    const adler = ((b << 16) | a) >>> 0;
    const tail = new Uint8Array(4);
    tail[0] = (adler >>> 24) & 0xFF; tail[1] = (adler >>> 16) & 0xFF;
    tail[2] = (adler >>> 8) & 0xFF; tail[3] = adler & 0xFF;
    parts.push(tail);
    let total = 0;
    for (const p of parts) total += p.length;
    const res = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { res.set(p, o); o += p.length; }
    return res;
  }
  function crcTable() {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  }
  const CRC = crcTable();
  function crc32bytes(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  async function encodePNG(img) {
    const w = img.width, h = img.height;
    const raw = new Uint8Array((w * 4 + 1) * h);
    let p = 0;
    for (let y = 0; y < h; y++) {
      raw[p++] = 0; // فلتر: None
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 4;
        raw[p++] = img.data[s]; raw[p++] = img.data[s + 1]; raw[p++] = img.data[s + 2]; raw[p++] = img.data[s + 3];
      }
    }
    const idat = await deflateBytes(raw);
    const chunks = [];
    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w); dv.setUint32(4, h);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    chunks.push(sig, makeChunk('IHDR', ihdr), makeChunk('IDAT', idat), makeChunk('IEND', new Uint8Array(0)));
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }
  function makeChunk(type, data) {
    const len = data.length;
    const out = new Uint8Array(len + 12);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, len);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    const crcInput = out.subarray(4, 8 + len);
    dv.setUint32(8 + len, crc32bytes(crcInput));
    return out;
  }

  /* ---------------- GLB / glTF ---------------- */
  function meshBounds(mesh) {
    const P = mesh.positions;
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    for (let i = 0; i < P.length; i += 3) {
      if (P[i] < mnx) mnx = P[i]; if (P[i] > mxx) mxx = P[i];
      if (P[i + 1] < mny) mny = P[i + 1]; if (P[i + 1] > mxy) mxy = P[i + 1];
      if (P[i + 2] < mnz) mnz = P[i + 2]; if (P[i + 2] > mxz) mxz = P[i + 2];
    }
    return [mnx, mny, mnz, mxx, mxy, mxz];
  }
  async function buildGLTF(mesh, maps, material, opts) {
    opts = opts || {};
    material = material || { metallic: 0.1, roughness: 0.6, transparency: 0 };
    const embedded = opts.embedded !== false;
    const P = mesh.positions, N = mesh.normals, UV = mesh.uvs, I = mesh.indices;
    const vCount = P.length / 3;
    const use32 = vCount > 65535;

    // ترتيب المخزن: indices, positions, normals, uvs, [images...]
    const parts = [];
    let offset = 0;
    const push = (arr, align) => {
      const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      const pad = (align - (offset % align)) % align;
      if (pad) { parts.push(new Uint8Array(pad)); offset += pad; }
      parts.push(bytes);
      const view = { byteOffset: offset, byteLength: bytes.length };
      offset += bytes.length;
      return view;
    };
    const idxArr = use32 ? new Uint32Array(I) : new Uint16Array(I);
    const idxView = push(idxArr, 4);
    const posView = push(P, 4);
    const norView = push(N, 4);
    const uvView = push(UV, 4);

    const images = [], textures = [], bufferViews = [];
    bufferViews.push({ buffer: 0, byteOffset: idxView.byteOffset, byteLength: idxView.byteLength, target: 34963 });
    bufferViews.push({ buffer: 0, byteOffset: posView.byteOffset, byteLength: posView.byteLength, target: 34962 });
    bufferViews.push({ buffer: 0, byteOffset: norView.byteOffset, byteLength: norView.byteLength, target: 34962 });
    bufferViews.push({ buffer: 0, byteOffset: uvView.byteOffset, byteLength: uvView.byteLength, target: 34962 });

    const addImage = async (img, name) => {
      if (!img) return null;
      const png = await encodePNG(img);
      const idx = bufferViews.length;
      if (embedded) {
        const view = push(png, 4);
        bufferViews.push({ buffer: 0, byteOffset: view.byteOffset, byteLength: view.byteLength });
        images.push({ name, bufferView: idx, mimeType: 'image/png' });
      } else {
        images.push({ name, uri: name + '.png' });
      }
      return { png, index: images.length - 1 };
    };
    const albedoImg = await addImage(maps && maps.albedo, 'albedo');
    const ormImg = await addImage(maps && maps.orm, 'orm');
    const normalImg = await addImage(maps && maps.normal, 'normal');

    const tex = (imgInfo) => {
      if (!imgInfo) return null;
      textures.push({ sampler: 0, source: imgInfo.index });
      return { index: textures.length - 1, texCoord: 0 };
    };
    const albedoTex = tex(albedoImg), ormTex = tex(ormImg), normalTex = tex(normalImg);

    const accessors = [];
    const addAccessor = (viewIdx, componentType, count, type, minmax) => {
      accessors.push(Object.assign({ bufferView: viewIdx, componentType, count, type }, minmax || {}));
      return accessors.length - 1;
    };
    const b = meshBounds(mesh);
    const aIdx = addAccessor(0, use32 ? 5125 : 5123, I.length, 'SCALAR');
    const aPos = addAccessor(1, 5126, vCount, 'VEC3', { min: [b[0], b[1], b[2]], max: [b[3], b[4], b[5]] });
    const aNor = addAccessor(2, 5126, vCount, 'VEC3');
    const aUv = addAccessor(3, 5126, vCount, 'VEC2');

    const pbr = {
      baseColorFactor: [1, 1, 1, 1],
      metallicFactor: material.metallic != null ? material.metallic : 0.1,
      roughnessFactor: material.roughness != null ? material.roughness : 0.6
    };
    if (albedoTex) pbr.baseColorTexture = albedoTex;
    if (ormTex) pbr.metallicRoughnessTexture = ormTex;
    const mat = {
      name: opts.name || 'AI3D_Material',
      pbrMetallicRoughness: pbr,
      doubleSided: false
    };
    if (normalTex) mat.normalTexture = Object.assign({ scale: 1 }, normalTex);
    if (ormTex) mat.occlusionTexture = Object.assign({ strength: 0.85 }, ormTex);
    const extensionsUsed = [];
    if (material.transparency > 0) {
      mat.extensions = mat.extensions || {};
      mat.extensions.KHR_materials_transmission = { transmissionFactor: material.transmission || material.transparency || 0, ior: material.ior || 1.5 };
      extensionsUsed.push('KHR_materials_transmission');
    }
    if (material.clearcoat > 0) {
      mat.extensions = mat.extensions || {};
      mat.extensions.KHR_materials_clearcoat = { clearcoatFactor: material.clearcoat, clearcoatRoughnessFactor: 0.12 };
      extensionsUsed.push('KHR_materials_clearcoat');
    }
    if (material.sheen > 0) {
      mat.extensions = mat.extensions || {};
      mat.extensions.KHR_materials_sheen = { sheenColorFactor: [1, 1, 1], sheenRoughnessFactor: 0.4 };
      extensionsUsed.push('KHR_materials_sheen');
    }

    const gltf = {
      asset: { version: '2.0', generator: 'MISTEKAWE AI-3D Engine ' + AI3D.version },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: opts.name || 'AI3D_Model' }],
      meshes: [{ name: opts.name || 'AI3D_Mesh', primitives: [{ attributes: { POSITION: aPos, NORMAL: aNor, TEXCOORD_0: aUv }, indices: aIdx, material: 0, mode: 4 }] }],
      materials: [mat],
      accessors, bufferViews,
      buffers: [{ byteLength: 0 }],
      samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }]
    };
    if (textures.length) gltf.textures = textures;
    if (images.length) gltf.images = images;
    if (extensionsUsed.length) gltf.extensionsUsed = extensionsUsed;
    // إجمالي طول المخزن (بعد اللصق)
    let binLength = offset;
    const padBin = (4 - (binLength % 4)) % 4;
    if (padBin) { parts.push(new Uint8Array(padBin)); binLength += padBin; }
    gltf.buffers[0].byteLength = binLength;
    if (!embedded) gltf.buffers[0].uri = (opts.name || 'model') + '.bin';

    // اجمع المخزن
    const bin = new Uint8Array(binLength);
    let o = 0;
    for (const p of parts) { bin.set(p, o); o += p.length; }

    return { gltf, bin, textures: { albedo: albedoImg && albedoImg.png, orm: ormImg && ormImg.png, normal: normalImg && normalImg.png } };
  }
  function pad4(n) { return (4 - (n % 4)) % 4; }
  async function exportGLB(mesh, maps, material, opts) {
    const built = await buildGLTF(mesh, maps, material, Object.assign({ embedded: true }, opts || {}));
    const jsonBytes = new TextEncoder().encode(JSON.stringify(built.gltf));
    const jsonPad = new Uint8Array(pad4(jsonBytes.length)).fill(0x20);
    const jsonLen = jsonBytes.length + jsonPad.length;
    const bin = built.bin;
    const binPad = new Uint8Array(pad4(bin.length)).fill(0);
    const binLen = bin.length + binPad.length;
    const total = 12 + 8 + jsonLen + 8 + binLen;
    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546C67, true);   // glTF
    dv.setUint32(4, 2, true);
    dv.setUint32(8, total, true);
    dv.setUint32(12, jsonLen, true);
    dv.setUint32(16, 0x4E4F534A, true);  // JSON
    out.set(jsonBytes, 20);
    out.set(jsonPad, 20 + jsonBytes.length);
    const binHeader = 20 + jsonLen;
    dv.setUint32(binHeader, binLen, true);
    dv.setUint32(binHeader + 4, 0x004E4942, true); // BIN
    out.set(bin, binHeader + 8);
    out.set(binPad, binHeader + 8 + bin.length);
    return new Blob([out], { type: 'model/gltf-binary' });
  }
  async function exportGLTFSeparate(mesh, maps, material, opts) {
    const built = await buildGLTF(mesh, maps, material, Object.assign({ embedded: false }, opts || {}));
    return {
      gltf: new Blob([JSON.stringify(built.gltf, null, 1)], { type: 'model/gltf+json' }),
      bin: new Blob([built.bin], { type: 'application/octet-stream' }),
      albedo: built.textures.albedo ? new Blob([built.textures.albedo], { type: 'image/png' }) : null,
      orm: built.textures.orm ? new Blob([built.textures.orm], { type: 'image/png' }) : null,
      normal: built.textures.normal ? new Blob([built.textures.normal], { type: 'image/png' }) : null
    };
  }

  /* ---------------- OBJ + MTL ---------------- */
  function exportOBJ(mesh, name, material) {
    name = name || 'ai3d-model';
    const P = mesh.positions, N = mesh.normals, UV = mesh.uvs, I = mesh.indices;
    const lines = [];
    lines.push('# MISTEKAWE AI-3D Engine ' + AI3D.version);
    lines.push('mtllib ' + name + '.mtl');
    lines.push('o ' + name);
    for (let i = 0; i < P.length; i += 3) lines.push('v ' + P[i].toFixed(6) + ' ' + P[i + 1].toFixed(6) + ' ' + P[i + 2].toFixed(6));
    for (let i = 0; i < UV.length; i += 2) lines.push('vt ' + UV[i].toFixed(6) + ' ' + (1 - UV[i + 1]).toFixed(6));
    for (let i = 0; i < N.length; i += 3) lines.push('vn ' + N[i].toFixed(5) + ' ' + N[i + 1].toFixed(5) + ' ' + N[i + 2].toFixed(5));
    lines.push('usemtl ai3d_material');
    lines.push('s off');
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] + 1, b = I[t + 1] + 1, c = I[t + 2] + 1;
      lines.push('f ' + a + '/' + a + '/' + a + ' ' + b + '/' + b + '/' + b + ' ' + c + '/' + c + '/' + c);
    }
    const mtl = [
      '# MISTEKAWE AI-3D Engine ' + AI3D.version,
      'newmtl ai3d_material',
      'Ka 1.000 1.000 1.000',
      'Kd 1.000 1.000 1.000',
      'Ks ' + (1 - (material ? material.roughness : 0.6) * 0.8).toFixed(3) + ' ' + (1 - (material ? material.roughness : 0.6) * 0.8).toFixed(3) + ' ' + (1 - (material ? material.roughness : 0.6) * 0.8).toFixed(3),
      'Ns ' + Math.round(4 + 200 * (1 - (material ? material.roughness : 0.6))),
      (material && material.transparency > 0) ? 'd ' + (1 - material.transparency * 0.75).toFixed(3) : 'd 1.0',
      'illum 2',
      'map_Kd ' + name + '_albedo.png',
      'map_Kn ' + name + '_normal.png',
      'map_Pr ' + name + '_orm.png'
    ].join('\n');
    return {
      obj: new Blob([lines.join('\n')], { type: 'model/obj' }),
      mtl: new Blob([mtl], { type: 'model/mtl' }),
      text: lines.join('\n')
    };
  }

  /* ---------------- STL ---------------- */
  function exportSTL(mesh, binary) {
    const P = mesh.positions, I = mesh.indices;
    if (binary === false) {
      const out = ['solid ai3d'];
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        let nx = 0, ny = 0, nz = 0;
        const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
        const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
        nx = e1y * e2z - e1z * e2y; ny = e1z * e2x - e1x * e2z; nz = e1x * e2y - e1y * e2x;
        const l = Math.hypot(nx, ny, nz) || 1;
        out.push(' facet normal ' + (nx / l).toExponential(6) + ' ' + (ny / l).toExponential(6) + ' ' + (nz / l).toExponential(6));
        out.push('  outer loop');
        for (const o of [a, b, c]) out.push('   vertex ' + P[o].toExponential(6) + ' ' + P[o + 1].toExponential(6) + ' ' + P[o + 2].toExponential(6));
        out.push('  endloop');
        out.push(' endfacet');
      }
      out.push('endsolid ai3d');
      return new Blob([out.join('\n')], { type: 'model/stl' });
    }
    const triCount = I.length / 3;
    const buf = new ArrayBuffer(84 + triCount * 50);
    const dv = new DataView(buf);
    const header = 'MISTEKAWE AI-3D ' + AI3D.version;
    for (let i = 0; i < 80; i++) dv.setUint8(i, i < header.length ? header.charCodeAt(i) : 32);
    dv.setUint32(80, triCount, true);
    let o = 84;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
      const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const l = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
      o += 12;
      for (const p of [a, b, c]) {
        dv.setFloat32(o, P[p], true); dv.setFloat32(o + 4, P[p + 1], true); dv.setFloat32(o + 8, P[p + 2], true);
        o += 12;
      }
      dv.setUint16(o, 0, true); o += 2;
    }
    return new Blob([new Uint8Array(buf)], { type: 'model/stl' });
  }

  /* ---------------- PLY (شبكة / سحابة نقطية) ---------------- */
  function exportPLY(mesh, maps, withColor) {
    const P = mesh.positions, I = mesh.indices;
    const vCount = P.length / 3, fCount = I.length / 3;
    const hasColor = withColor && maps && maps.albedo;
    const header = [
      'ply',
      'format ascii 1.0',
      'comment MISTEKAWE AI-3D Engine ' + AI3D.version,
      'element vertex ' + vCount,
      'property float x', 'property float y', 'property float z'
    ];
    if (hasColor) header.push('property uchar red', 'property uchar green', 'property uchar blue');
    header.push('element face ' + fCount, 'property list uchar int vertex_indices', 'end_header');
    const out = [header.join('\n')];
    const albedo = hasColor ? maps.albedo : null;
    const UV = mesh.uvs;
    for (let i = 0; i < vCount; i++) {
      let line = P[i * 3].toFixed(5) + ' ' + P[i * 3 + 1].toFixed(5) + ' ' + P[i * 3 + 2].toFixed(5);
      if (hasColor && UV) {
        const u = UV[i * 2], v = 1 - UV[i * 2 + 1];
        const x = Math.min(albedo.width - 1, Math.max(0, Math.round(u * (albedo.width - 1))));
        const y = Math.min(albedo.height - 1, Math.max(0, Math.round(v * (albedo.height - 1))));
        const p = (y * albedo.width + x) * 4;
        line += ' ' + albedo.data[p] + ' ' + albedo.data[p + 1] + ' ' + albedo.data[p + 2];
      }
      out.push(line);
    }
    for (let t = 0; t < I.length; t += 3) out.push('3 ' + I[t] + ' ' + I[t + 1] + ' ' + I[t + 2]);
    return new Blob([out.join('\n')], { type: 'model/ply' });
  }
  function exportPointCloudPLY(cloud) {
    const P = cloud.positions, C = cloud.colors, n = cloud.count;
    const hasColor = !!C && C.length >= n * 3;
    const header = [
      'ply', 'format ascii 1.0',
      'comment MISTEKAWE AI-3D point cloud',
      'element vertex ' + n,
      'property float x', 'property float y', 'property float z'
    ];
    if (hasColor) header.push('property uchar red', 'property uchar green', 'property uchar blue');
    header.push('end_header');
    const out = [header.join('\n')];
    for (let i = 0; i < n; i++) {
      let line = P[i * 3].toFixed(5) + ' ' + P[i * 3 + 1].toFixed(5) + ' ' + P[i * 3 + 2].toFixed(5);
      if (hasColor) {
        line += ' ' + Math.round(C[i * 3] * 255) + ' ' + Math.round(C[i * 3 + 1] * 255) + ' ' + Math.round(C[i * 3 + 2] * 255);
      }
      out.push(line);
    }
    return new Blob([out.join('\n')], { type: 'model/ply' });
  }

  /* ---------------- ZIP (حزمة المشروع) ---------------- */
  async function exportProjectZIP(files, opts) {
    opts = opts || {};
    const entries = [];
    const enc = new TextEncoder();
    for (const f of files) {
      const data = typeof f.data === 'string' ? enc.encode(f.data) : new Uint8Array(await f.data.arrayBuffer());
      entries.push({ name: f.name, data });
    }
    const chunks = [];
    let offset = 0;
    const central = [];
    for (const e of entries) {
      const nameBytes = enc.encode(e.name);
      const crc = crc32bytes(e.data);
      const local = new Uint8Array(30 + nameBytes.length);
      const dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);   // version needed
      dv.setUint16(6, 0x0800, true); // UTF-8 flag
      dv.setUint16(8, 0, true);    // stored
      dv.setUint16(10, 0, true); dv.setUint16(12, 0, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, e.data.length, true);
      dv.setUint32(22, e.data.length, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      chunks.push(local, e.data);
      const cd = new Uint8Array(46 + nameBytes.length);
      const dv2 = new DataView(cd.buffer);
      dv2.setUint32(0, 0x02014b50, true);
      dv2.setUint16(4, 20, true); dv2.setUint16(6, 20, true);
      dv2.setUint16(8, 0x0800, true); dv2.setUint16(10, 0, true);
      dv2.setUint16(12, 0, true); dv2.setUint16(14, 0, true);
      dv2.setUint32(16, crc, true);
      dv2.setUint32(20, e.data.length, true);
      dv2.setUint32(24, e.data.length, true);
      dv2.setUint16(28, nameBytes.length, true);
      dv2.setUint32(42, offset, true);
      cd.set(nameBytes, 46);
      central.push(cd);
      offset += local.length + e.data.length;
    }
    const centralSize = central.reduce((a, c) => a + c.length, 0);
    const end = new Uint8Array(22);
    const dve = new DataView(end.buffer);
    dve.setUint32(0, 0x06054b50, true);
    dve.setUint16(8, entries.length, true);
    dve.setUint16(10, entries.length, true);
    dve.setUint32(12, centralSize, true);
    dve.setUint32(16, offset, true);
    const all = chunks.concat(central, [end]);
    const total = all.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of all) { out.set(c, o); o += c.length; }
    return new Blob([out], { type: 'application/zip' });
  }

  /* تحويل صورة (ImageLike) إلى Blob PNG */
  async function imageToBlob(img) {
    const png = await encodePNG(img);
    return new Blob([png], { type: 'image/png' });
  }

  AI3D.Exporters = {
    exportGLB, exportGLTFSeparate, exportOBJ, exportSTL, exportPLY,
    exportPointCloudPLY, exportProjectZIP, encodePNG, imageToBlob, buildGLTF
  };
})(typeof window !== 'undefined' ? window : globalThis);
