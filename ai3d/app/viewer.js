/* ============================================================
 * viewer.js — عارض 3D احترافي بـ WebGL خالص (بدون أي مكتبة)
 * تدوير/تقريب/تحريك + لمس + دوران تلقائي + wireframe/solid/
 * texture + إضاءة + خلفيات + تمييز المناطق المستنتَجة.
 * (مواصفة 28 + 51 + 52)
 * ============================================================ */
(function (global) {
  'use strict';

  function mat4Perspective(out, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    out.fill(0);
    out[0] = f / aspect; out[5] = f;
    out[10] = (far + near) / (near - far);
    out[11] = -1;
    out[14] = (2 * far * near) / (near - far);
    return out;
  }
  function mat4LookAt(out, eye, at, up) {
    let zx = eye[0] - at[0], zy = eye[1] - at[1], zz = eye[2] - at[2];
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
    out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
    out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
    out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    out[15] = 1;
    return out;
  }
  function mat4Mul(out, a, b) {
    const t = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      t[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    out.set(t);
    return out;
  }

  const VS = `
    attribute vec3 aPos; attribute vec3 aNor; attribute vec2 aUv; attribute float aObs;
    uniform mat4 uMVP; uniform mat4 uModel;
    varying vec3 vNor; varying vec2 vUv; varying vec3 vPos; varying float vObs;
    void main(){
      vec4 wp = uModel * vec4(aPos, 1.0);
      vPos = wp.xyz;
      vNor = mat3(uModel) * aNor;
      vUv = aUv; vObs = aObs;
      gl_Position = uMVP * vec4(aPos, 1.0);
    }`;
  const FS = `
    precision mediump float;
    varying vec3 vNor; varying vec2 vUv; varying vec3 vPos; varying float vObs;
    uniform sampler2D uTex; uniform int uMode; // 0 solid 1 texture 2 xray 3 material
    uniform vec3 uCam; uniform vec3 uLightDir; uniform float uLightI; uniform vec3 uAmb;
    uniform vec3 uSolid; uniform int uShowEst; uniform float uAlpha;
    uniform float uMetal; uniform float uRough;
    void main(){
      vec3 N = normalize(vNor);
      if(!gl_FrontFacing) N = -N;
      vec3 L = normalize(-uLightDir);
      float dif = max(dot(N, L), 0.0);
      vec3 V = normalize(uCam - vPos);
      vec3 H = normalize(L + V);
      vec3 base = uSolid;
      vec4 tx = texture2D(uTex, vUv);
      if(uMode == 1){ base = mix(uSolid, tx.rgb, tx.a); if(tx.a < 0.04) discard; }
      if(uMode == 2){ base = mix(vec3(0.2,0.7,1.0), vec3(0.9,0.3,0.9), vUv.y); }
      if(uMode == 3){
        base = mix(uSolid, tx.rgb, tx.a);
        if(tx.a < 0.04) discard;
        // تقريب PBR: لامع ↔ معدن، خشن ↔ مطفي
        float shin = mix(6.0, 180.0, 1.0 - uRough);
        float spec = pow(max(dot(N, H), 0.0), shin) * mix(0.25, 1.25, 1.0 - uRough);
        vec3 F0 = mix(vec3(0.04), base, uMetal);
        vec3 specCol = F0 + (1.0 - F0) * spec;
        vec3 diffCol = base * (1.0 - uMetal * 0.85);
        vec3 col = diffCol * (uAmb + uLightI * dif) + specCol * spec * uLightI * 2.2;
        if(uShowEst == 1 && vObs < 0.5) col = mix(col, vec3(1.0, 0.55, 0.1), 0.5);
        gl_FragColor = vec4(col, 1.0);
        return;
      }
      float spec = pow(max(dot(N, H), 0.0), 42.0) * 0.35;
      vec3 col = base * (uAmb + uLightI * dif) + vec3(spec) * uLightI;
      if(uShowEst == 1 && vObs < 0.5){
        col = mix(col, vec3(1.0, 0.55, 0.1), 0.55); // المناطق المستنتَجة بالبرتقالي
      }
      gl_FragColor = vec4(col, uMode == 2 ? uAlpha : 1.0);
    }`;
  const VS_W = `attribute vec3 aPos; uniform mat4 uMVP; void main(){ gl_Position = uMVP * vec4(aPos,1.0); }`;
  const FS_W = `precision mediump float; uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor, 1.0); }`;
  /* نقاط السحابة */
  const VS_P = `
    attribute vec3 aPos; attribute vec3 aCol; attribute float aObs;
    uniform mat4 uMVP; uniform float uPointSize;
    varying vec3 vCol; varying float vObs;
    void main(){
      vCol = aCol; vObs = aObs;
      gl_Position = uMVP * vec4(aPos, 1.0);
      gl_PointSize = uPointSize;
    }`;
  const FS_P = `
    precision mediump float;
    varying vec3 vCol; varying float vObs;
    uniform int uShowEst;
    void main(){
      vec2 d = gl_PointCoord - vec2(0.5);
      if(dot(d,d) > 0.25) discard;
      vec3 c = vCol;
      if(uShowEst == 1 && vObs < 0.5) c = mix(c, vec3(1.0,0.55,0.1), 0.6);
      gl_FragColor = vec4(c, 1.0);
    }`;

  class Viewer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: true });
      if (!gl) throw new Error('WebGL غير مدعوم في هذا المتصفح');
      this.gl = gl;
      this.prog = this._link(VS, FS);
      this.progW = this._link(VS_W, FS_W);
      this.progP = this._link(VS_P, FS_P);
      this.mesh = null;
      this.cloud = null;
      this.material = { metallic: 0.1, roughness: 0.6 };
      this.showGrid = false;
      this.mode = 'texture';       // texture | solid | wireframe | xray | material | points
      this.autoRotate = false;
      this.showEstimated = false;
      this.lightPreset = 'studio';
      this.bgPreset = 'dark';
      this.solidColor = [0.75, 0.77, 0.82];
      // الكاميرا المدارية
      this.target = [0, 0, 0];
      this.radius = 2.6; this.theta = 0.6; this.phi = 1.12;
      this.fov = 42 * Math.PI / 180;
      this._tex = null;
      this._whiteTex = null;
      this._raf = 0;
      this._bindInput();
      this._resize();
      window.addEventListener('resize', () => this._resize());
      this._loop();
    }

    _shader(type, src) {
      const gl = this.gl;
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    _link(vs, fs) {
      const gl = this.gl;
      const p = gl.createProgram();
      gl.attachShader(p, this._shader(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, this._shader(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }

    setMesh(mesh, texCanvas) {
      const gl = this.gl;
      this._lastPos = mesh.positions;
      // مستوى الشبكة الأرضية عند قاع النموذج
      {
        let mn = Infinity, mx = -Infinity;
        for (let i = 1; i < mesh.positions.length; i += 3) {
          if (mesh.positions[i] < mn) mn = mesh.positions[i];
          if (mesh.positions[i] > mx) mx = mesh.positions[i];
        }
        this._gridY = isFinite(mn) ? mn - (mx - mn) * 0.06 : -1;
      }
      if (!mesh.normals || mesh.normals.length !== mesh.positions.length) {
        mesh.normals = new Float32Array(mesh.positions.length);
        const I = mesh.indices;
        for (let t = 0; t < I.length; t += 3) {
          const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
          const e1x = mesh.positions[b] - mesh.positions[a], e1y = mesh.positions[b + 1] - mesh.positions[a + 1], e1z = mesh.positions[b + 2] - mesh.positions[a + 2];
          const e2x = mesh.positions[c] - mesh.positions[a], e2y = mesh.positions[c + 1] - mesh.positions[a + 1], e2z = mesh.positions[c + 2] - mesh.positions[a + 2];
          const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
          for (const o of [a, b, c]) { mesh.normals[o] += nx; mesh.normals[o + 1] += ny; mesh.normals[o + 2] += nz; }
        }
        for (let i = 0; i < mesh.normals.length; i += 3) {
          const l = Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]) || 1;
          mesh.normals[i] /= l; mesh.normals[i + 1] /= l; mesh.normals[i + 2] /= l;
        }
      }
      if (!mesh.uvs || mesh.uvs.length !== (mesh.positions.length / 3) * 2) {
        mesh.uvs = new Float32Array((mesh.positions.length / 3) * 2);
      }
      // أطلق القديم
      if (this.mesh) {
        const m = this.mesh;
        [m.vbo, m.nbo, m.uvbo, m.obo, m.ibo, m.wibo].forEach(b => b && gl.deleteBuffer(b));
      }
      if (this._tex) gl.deleteTexture(this._tex);
      const vCount = mesh.positions.length / 3;
      const mk = (data, size, target) => {
        const b = gl.createBuffer();
        gl.bindBuffer(target || gl.ARRAY_BUFFER, b);
        gl.bufferData(target || gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        return b;
      };
      const use32 = vCount > 65535;
      const idx = use32 ? new Uint32Array(mesh.indices) : new Uint16Array(mesh.indices);
      if (use32) gl.getExtension('OES_element_index_uint');
      // حواف wireframe
      const wset = new Set();
      const widx = [];
      for (let t = 0; t < mesh.indices.length; t += 3) {
        for (let k = 0; k < 3; k++) {
          const a = mesh.indices[t + k], b = mesh.indices[t + (k + 1) % 3];
          const key = a < b ? a * 2000000 + b : b * 2000000 + a;
          if (!wset.has(key)) { wset.add(key); widx.push(a, b); }
        }
      }
      // حدّ أقصى للحواف للأداء
      const widxArr = use32 ? new Uint32Array(widx.slice(0, 600000)) : new Uint16Array(widx.slice(0, 600000));
      const obs = new Float32Array(vCount);
      for (let i = 0; i < vCount; i++) obs[i] = mesh.observed ? mesh.observed[i] : 1;
      this.mesh = {
        vbo: mk(new Float32Array(mesh.positions), 3),
        nbo: mk(new Float32Array(mesh.normals), 3),
        uvbo: mk(new Float32Array(mesh.uvs), 2),
        obo: mk(obs, 1),
        ibo: mk(idx, 0, gl.ELEMENT_ARRAY_BUFFER),
        wibo: mk(widxArr, 0, gl.ELEMENT_ARRAY_BUFFER),
        triCount: mesh.indices.length, wireCount: widxArr.length, use32
      };
      // الـ texture
      this._tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this._tex);
      if (texCanvas) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texCanvas);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([200, 200, 205, 255]));
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      try { gl.generateMipmap(gl.TEXTURE_2D); } catch (e) {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }
      this.resetCamera();
    }

    updatePositions(mesh) {
      // تحديث سريع بعد أدوات التعديل
      const gl = this.gl;
      this._lastPos = mesh.positions;
      if (!this.mesh) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.mesh.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.positions), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.mesh.nbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.normals), gl.STATIC_DRAW);
    }

    refreshMesh(mesh, texCanvas) {
      this._lastPos = mesh.positions;
      this.setMesh(mesh, texCanvas || this._texCanvas);
      if (this.cloud) { /* السحابة تبقى كما هي */ }
    }

    /* سحابة نقطية (مواصفة 11) */
    setPointCloud(cloud) {
      const gl = this.gl;
      if (!cloud || !cloud.count) { this.cloud = null; return; }
      if (this.cloud) {
        [this.cloud.pbo, this.cloud.cbo, this.cloud.obo].forEach(b => b && gl.deleteBuffer(b));
      }
      const mk = (data) => {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        return b;
      };
      const colors = cloud.colors && cloud.colors.length >= cloud.count * 3
        ? new Float32Array(cloud.colors.subarray(0, cloud.count * 3))
        : new Float32Array(cloud.count * 3).fill(0.7);
      const obs = cloud.confidence && cloud.confidence.length >= cloud.count
        ? new Float32Array(cloud.confidence.subarray(0, cloud.count))
        : new Float32Array(cloud.count).fill(1);
      this.cloud = {
        pbo: mk(new Float32Array(cloud.positions.subarray(0, cloud.count * 3))),
        cbo: mk(colors),
        obo: mk(obs),
        count: cloud.count
      };
    }
    setMaterial(material) { this.material = material || { metallic: 0.1, roughness: 0.6 }; }

    /* تحديد رؤوس داخل مستطيل شاشة (للحذف/إعادة البناء) — مواصفة 48+49 */
    pickRect(rect) {
      const out = new Set();
      if (!this.mesh || !this._lastMVP) return out;
      const P = this._lastPos, mvp = this._lastMVP, w = this.canvas.width, h = this.canvas.height;
      for (let i = 0; i < P.length / 3; i++) {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        const cx = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12];
        const cy = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13];
        const cw = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
        if (cw <= 0.0001) continue;
        const sx = (cx / cw * 0.5 + 0.5), sy = (1 - (cy / cw * 0.5 + 0.5));
        if (sx >= rect.x0 && sx <= rect.x1 && sy >= rect.y0 && sy <= rect.y1) out.add(i);
      }
      void w; void h;
      return out;
    }

    _resize() {
      const c = this.canvas, r = c.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      this.gl.viewport(0, 0, c.width, c.height);
    }

    resetCamera() {
      this.target = [0, 0, 0];
      this.radius = 2.6; this.theta = 0.6; this.phi = 1.12;
    }
    setView(name) {
      const V = {
        front: [0, Math.PI / 2], back: [Math.PI, Math.PI / 2],
        left: [-Math.PI / 2, Math.PI / 2], right: [Math.PI / 2, Math.PI / 2],
        top: [0, 0.15], bottom: [0, Math.PI - 0.15]
      }[name];
      if (V) { this.theta = V[0]; this.phi = V[1]; }
    }

    _bindInput() {
      const c = this.canvas;
      const pts = new Map();
      let lastPinch = 0;
      c.style.touchAction = 'none';
      c.addEventListener('pointerdown', e => {
        if (this.lockInput) return;
        c.setPointerCapture(e.pointerId);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 2) {
          const [a, b] = [...pts.values()];
          lastPinch = Math.hypot(a.x - b.x, a.y - b.y);
        }
      });
      c.addEventListener('pointermove', e => {
        if (this.lockInput) return;
        if (!pts.has(e.pointerId)) return;
        const p = pts.get(e.pointerId);
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;
        if (pts.size === 1) {
          if (e.shiftKey || this._panMode) this._pan(dx, dy);
          else { this.theta -= dx * 0.008; this.phi = Math.min(Math.PI - 0.05, Math.max(0.05, this.phi - dy * 0.008)); }
        } else if (pts.size === 2) {
          const [a, b] = [...pts.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (lastPinch) this.radius = Math.min(8, Math.max(0.8, this.radius * (lastPinch / Math.max(1, d))));
          lastPinch = d;
          this._pan(dx / 2, dy / 2); // إصبعان = تحريك
        }
      });
      const up = e => { pts.delete(e.pointerId); lastPinch = 0; };
      c.addEventListener('pointerup', up);
      c.addEventListener('pointercancel', up);
      c.addEventListener('wheel', e => {
        e.preventDefault();
        this.radius = Math.min(8, Math.max(0.8, this.radius * (1 + e.deltaY * 0.001)));
      }, { passive: false });
      c.addEventListener('dblclick', () => this.resetCamera());
      // نقرة مزدوجة باللمس
      let lastTap = 0;
      c.addEventListener('pointerup', e => {
        if (e.pointerType === 'touch') {
          const now = Date.now();
          if (now - lastTap < 300) this.resetCamera();
          lastTap = now;
        }
      });
    }
    _pan(dx, dy) {
      const s = this.radius * 0.0016;
      const ct = Math.cos(this.theta), st = Math.sin(this.theta);
      this.target[0] -= (dx * ct) * s;
      this.target[1] += dy * s;
      this.target[2] -= (-dx * st) * s;
      for (let i = 0; i < 3; i++) this.target[i] = Math.max(-2, Math.min(2, this.target[i]));
    }

    _lights() {
      const P = {
        studio: { dir: [0.5, 0.8, 0.6], i: 1.05, amb: [0.42, 0.42, 0.46] },
        soft: { dir: [0.2, 1.0, 0.3], i: 0.8, amb: [0.55, 0.55, 0.6] },
        dramatic: { dir: [0.9, 0.25, 0.4], i: 1.2, amb: [0.18, 0.18, 0.22] },
        top: { dir: [0.0, 1.0, 0.05], i: 1.0, amb: [0.35, 0.35, 0.38] }
      };
      return P[this.lightPreset] || P.studio;
    }
    _bg() {
      const B = {
        dark: [0.07, 0.08, 0.11], light: [0.93, 0.93, 0.95],
        blue: [0.05, 0.12, 0.22], warm: [0.16, 0.12, 0.09]
      };
      return B[this.bgPreset] || B.dark;
    }

    _loop() {
      cancelAnimationFrame(this._raf);
      const frame = () => {
        if (this.autoRotate) this.theta += 0.012;
        this._draw();
        this._raf = requestAnimationFrame(frame);
      };
      frame();
    }

    _draw() {
      const gl = this.gl;
      this._resize();
      const bg = this._bg();
      gl.clearColor(bg[0], bg[1], bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      if (!this.mesh) { this._drawPlaceholder(); return; }

      const eye = [
        this.target[0] + this.radius * Math.sin(this.phi) * Math.sin(this.theta),
        this.target[1] + this.radius * Math.cos(this.phi),
        this.target[2] + this.radius * Math.sin(this.phi) * Math.cos(this.theta)
      ];
      const proj = mat4Perspective(new Float32Array(16), this.fov, this.canvas.width / this.canvas.height, 0.05, 50);
      const view = mat4LookAt(new Float32Array(16), eye, this.target, [0, 1, 0]);
      const mvp = mat4Mul(new Float32Array(16), proj, view);
      const model = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      this._lastMVP = mvp;

      if (this.showGrid) this._drawGrid(mvp);

      if (this.mode === 'points') { this._drawPoints(mvp, eye); return; }

      if (this.mode === 'wireframe') {
        gl.useProgram(this.progW);
        const aPos = gl.getAttribLocation(this.progW, 'aPos');
        gl.bindBuffer(gl.ARRAY_BUFFER, this.mesh.vbo);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.progW, 'uMVP'), false, mvp);
        const dark = this.bgPreset === 'light';
        gl.uniform3f(gl.getUniformLocation(this.progW, 'uColor'), dark ? 0.1 : 0.4, dark ? 0.5 : 0.8, dark ? 0.9 : 1.0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.mesh.wibo);
        gl.drawElements(gl.LINES, this.mesh.wireCount, this.mesh.use32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
        gl.disableVertexAttribArray(aPos);
        return;
      }

      gl.useProgram(this.prog);
      const A = n => gl.getAttribLocation(this.prog, n);
      const bind = (name, buf, size) => {
        const loc = A(name);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      };
      bind('aPos', this.mesh.vbo, 3);
      bind('aNor', this.mesh.nbo, 3);
      bind('aUv', this.mesh.uvbo, 2);
      bind('aObs', this.mesh.obo, 1);
      const Uu = n => gl.getUniformLocation(this.prog, n);
      gl.uniformMatrix4fv(Uu('uMVP'), false, mvp);
      gl.uniformMatrix4fv(Uu('uModel'), false, model);
      gl.uniform1i(Uu('uMode'), this.mode === 'texture' ? 1 : (this.mode === 'xray' ? 2 : (this.mode === 'material' ? 3 : 0)));
      gl.uniform3f(Uu('uCam'), eye[0], eye[1], eye[2]);
      const L = this._lights();
      gl.uniform3f(Uu('uLightDir'), L.dir[0], L.dir[1], L.dir[2]);
      gl.uniform1f(Uu('uLightI'), L.i);
      gl.uniform3f(Uu('uAmb'), L.amb[0], L.amb[1], L.amb[2]);
      gl.uniform3f(Uu('uSolid'), this.solidColor[0], this.solidColor[1], this.solidColor[2]);
      gl.uniform1i(Uu('uShowEst'), this.showEstimated ? 1 : 0);
      gl.uniform1f(Uu('uAlpha'), 0.75);
      gl.uniform1f(Uu('uMetal'), this.material.metallic || 0);
      gl.uniform1f(Uu('uRough'), this.material.roughness == null ? 0.6 : this.material.roughness);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._tex);
      gl.uniform1i(Uu('uTex'), 0);
      if (this.mode === 'xray') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST); }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.mesh.ibo);
      gl.drawElements(gl.TRIANGLES, this.mesh.triCount, this.mesh.use32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
      if (this.mode === 'xray') { gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); }
      ['aPos', 'aNor', 'aUv', 'aObs'].forEach(n => gl.disableVertexAttribArray(A(n)));
    }

    _drawPoints(mvp, eye) {
      const gl = this.gl;
      if (!this.cloud) { this._drawPlaceholder(); return; }
      gl.useProgram(this.progP);
      const A = n => gl.getAttribLocation(this.progP, n);
      const bind = (name, buf, size) => {
        const loc = A(name);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      };
      bind('aPos', this.cloud.pbo, 3);
      bind('aCol', this.cloud.cbo, 3);
      bind('aObs', this.cloud.obo, 1);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.progP, 'uMVP'), false, mvp);
      gl.uniform1f(gl.getUniformLocation(this.progP, 'uPointSize'), Math.max(1.4, 2.4 * (window.devicePixelRatio || 1)));
      gl.uniform1i(gl.getUniformLocation(this.progP, 'uShowEst'), this.showEstimated ? 1 : 0);
      gl.drawArrays(gl.POINTS, 0, this.cloud.count);
      ['aPos', 'aCol', 'aObs'].forEach(n => gl.disableVertexAttribArray(A(n)));
      void eye;
    }

    _drawGrid(mvp) {
      const gl = this.gl;
      const N = 10, verts = [];
      const y = this._gridY == null ? -1 : this._gridY;
      for (let i = -N; i <= N; i++) {
        verts.push(i / N * 2, y, -2, i / N * 2, y, 2);
        verts.push(-2, y, i / N * 2, 2, y, i / N * 2);
      }
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
      gl.useProgram(this.progW);
      const aPos = gl.getAttribLocation(this.progW, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.progW, 'uMVP'), false, mvp);
      const dark = this.bgPreset === 'light';
      gl.uniform3f(gl.getUniformLocation(this.progW, 'uColor'), dark ? 0.55 : 0.28, dark ? 0.58 : 0.33, dark ? 0.62 : 0.42);
      gl.drawArrays(gl.LINES, 0, verts.length / 3);
      gl.disableVertexAttribArray(aPos);
      gl.deleteBuffer(b);
    }

    _drawPlaceholder() {
      // شبكة أرضية بسيطة عندما لا يوجد نموذج
      const gl = this.gl;
      gl.useProgram(this.progW);
      const N = 12, verts = [];
      for (let i = -N; i <= N; i++) {
        verts.push(i / N * 2, -0.8, -2, i / N * 2, -0.8, 2);
        verts.push(-2, -0.8, i / N * 2, 2, -0.8, i / N * 2);
      }
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
      const eye = [this.radius * Math.sin(this.phi) * Math.sin(this.theta), this.radius * Math.cos(this.phi), this.radius * Math.sin(this.phi) * Math.cos(this.theta)];
      const proj = mat4Perspective(new Float32Array(16), this.fov, this.canvas.width / this.canvas.height, 0.05, 50);
      const view = mat4LookAt(new Float32Array(16), eye, [0, -0.3, 0], [0, 1, 0]);
      const mvp = mat4Mul(new Float32Array(16), proj, view);
      const aPos = gl.getAttribLocation(this.progW, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.progW, 'uMVP'), false, mvp);
      gl.uniform3f(gl.getUniformLocation(this.progW, 'uColor'), 0.25, 0.3, 0.4);
      gl.drawArrays(gl.LINES, 0, verts.length / 3);
      gl.disableVertexAttribArray(aPos);
      gl.deleteBuffer(b);
    }

    screenshot() { this._draw(); return this.canvas.toDataURL('image/png'); }
    dispose() { cancelAnimationFrame(this._raf); }
  }

  global.AI3DViewer = Viewer;
})(window);
