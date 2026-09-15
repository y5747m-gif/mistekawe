/* ============================================================
 * studio.js — واجهة الاستوديو: رفع، إعدادات، اكتشاف، تشغيل،
 *  عارض، مقارنة، أدوات شبكة، تصدير، مشاريع (IndexedDB)، خصوصية.
 * ============================================================ */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const U = window.AI3D.util;
  const AI3D = window.AI3D;

  const state = {
    frames: [],           // [{canvas,w,h,name,file}]
    analysis: null, detection: null,
    selection: 'auto',
    result: null,
    viewer: null,
    previewTab: 'original',
    theme: 'dark',
    running: false,
    cancel: false,
    selecting: false,
    selectionRect: null,
    selectedVertices: null,
    idb: null
  };

  /* ---------- تخزين آمن ---------- */
  const store = {
    _m: {},
    get(k) { try { return window.localStorage.getItem(k); } catch (e) { return this._m[k] || null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { this._m[k] = String(v); } }
  };

  /* ---------- IndexedDB للمشاريع (الصور والنماذج تبقى محلية) ---------- */
  const DB_NAME = 'ai3d-projects', DB_STORE = 'projects';
  function openDB() {
    return new Promise((resolve, reject) => {
      if (state.idb) return resolve(state.idb);
      if (!window.indexedDB) return reject(new Error('IndexedDB غير متاح'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => { state.idb = req.result; resolve(req.result); };
      req.onerror = () => reject(req.error);
    });
  }
  async function idbPut(entry) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(entry);
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
    });
  }
  async function idbAll() {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const rq = tx.objectStore(DB_STORE).getAll();
      rq.onsuccess = () => res(rq.result || []);
      rq.onerror = () => rej(rq.error);
    });
  }
  async function idbDelete(id) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(id);
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
    });
  }
  async function idbClear() {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).clear();
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
    });
  }

  /* ---------------- تهيئة ---------------- */
  window.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initUpload();
    initSettings();
    initObjects();
    initCompare();
    initMeshTools();
    initExport();
    initProjects();
    initEngineInfo();
    renderStages();
    try { AI3D.Backends.tryLoadLocalModels('models/').then(r => { if (r.loaded) { renderModels(); toast('تم تحميل ' + r.loaded + ' نموذج محلي'); } }); } catch (e) { /* ignore */ }
  });

  function toast(msg, ms) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), ms || 2800);
  }
  const pct = v => Math.round(U.clamp01(v) * 100) + '%';
  const kv = (k, v) => '<dt>' + k + '</dt><dd>' + v + '</dd>';
  const num = n => Math.round(n).toLocaleString('en-US');

  /* ---------------- المظهر ---------------- */
  function initTheme() {
    const saved = store.get('ai3d-theme');
    if (saved) state.theme = saved;
    document.documentElement.setAttribute('data-theme', state.theme);
    $('themeBtn').textContent = state.theme === 'dark' ? '☀️' : '🌙';
    $('themeBtn').onclick = () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', state.theme);
      store.set('ai3d-theme', state.theme);
      $('themeBtn').textContent = state.theme === 'dark' ? '☀️' : '🌙';
    };
  }

  /* ---------------- الرفع ---------------- */
  const ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff', 'image/x-tiff', 'image/gif'];
  function initUpload() {
    const drop = $('drop'), input = $('fileInput');
    drop.addEventListener('click', e => { if (e.target.closest('button')) return; input.click(); });
    $('browseBtn').onclick = e => { e.stopPropagation(); input.click(); };
    input.addEventListener('change', () => addFiles(input.files).then(() => { input.value = ''; }));
    ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));
    $('sampleBtn1').onclick = e => { e.stopPropagation(); addSample('product'); };
    $('sampleBtn2').onclick = e => { e.stopPropagation(); addSample('car'); };
    $('clearBtn').onclick = e => { e.stopPropagation(); state.frames = []; state.detection = null; state.result = null; renderThumbs(); updateCTA(); renderObjList(); renderPreview(); };
    $('modeSel').addEventListener('change', () => {
      input.multiple = $('modeSel').value === 'multi';
      if ($('modeSel').value === 'single' && state.frames.length > 1) {
        state.frames = [state.frames[0]]; renderThumbs();
        toast('وضع الصورة الواحدة: تم الاحتفاظ بالصورة الأولى');
      }
      updateCTA();
    });
    input.multiple = false;
  }

  async function addFiles(files) {
    const multi = $('modeSel').value === 'multi';
    const list = [...files].filter(f => f.type.startsWith('image/') || ACCEPT.includes(f.type));
    if (!list.length) { toast('اختر ملف صورة صالح (JPG / PNG / WEBP / BMP / TIFF)'); return; }
    for (const f of list) {
      if (!multi && state.frames.length >= 1) state.frames = [];
      if (multi && state.frames.length >= 6) { toast('الحد الأقصى 6 صور في وضع تعدد الصور'); break; }
      try {
        const loaded = await U.loadImageFile(f, 1600);
        state.frames.push({ canvas: loaded.canvas, w: loaded.width, h: loaded.height, name: loaded.name, file: f });
      } catch (err) { toast('تعذّر قراءة الصورة: ' + (f.name || '')); }
    }
    renderThumbs(); updateCTA();
    if (state.frames.length) await preAnalyze();
  }

  function renderThumbs() {
    const box = $('thumbs'); box.innerHTML = '';
    state.frames.forEach((f, i) => {
      const d = document.createElement('div');
      d.className = 'thumb';
      const img = document.createElement('img');
      img.src = f.canvas.toDataURL('image/jpeg', 0.7);
      d.appendChild(img);
      const ord = document.createElement('span');
      ord.className = 'ord'; ord.textContent = (i + 1) + ' / ' + state.frames.length;
      d.appendChild(ord);
      const x = document.createElement('button');
      x.textContent = '✕';
      x.onclick = e => { e.stopPropagation(); state.frames.splice(i, 1); renderThumbs(); updateCTA(); if (state.frames.length) preAnalyze(); };
      d.appendChild(x);
      box.appendChild(d);
    });
  }
  function updateCTA() {
    $('startBtn').disabled = !state.frames.length || state.running;
    $('pipeHint').textContent = state.frames.length ? ('جاهز — ' + state.frames.length + ' صورة') : 'اختر صورة للبدء';
  }

  /* تحليل مبدئي: تحذيرات الجودة + اكتشاف الأجسام للاختيار */
  async function preAnalyze() {
    const f = state.frames[0];
    if (!f) return;
    $('preWarn').innerHTML = '';
    const img = U.getImageData(f.canvas);
    state.analysis = AI3D.Analysis.analyzeImage(img, f.w, f.h, { quality: $('qualitySel').value });
    renderAnalysis();
    await U.tick(30);
    try {
      state.detection = AI3D.Detection.detectObjects(img, f.w, f.h, state.analysis, { quality: $('qualitySel').value });
    } catch (e) { console.error(e); state.detection = { objects: [] }; }
    state.selection = 'auto';
    renderObjList(); renderPreview();
  }

  function renderAnalysis() {
    const a = state.analysis;
    if (!a) return;
    const q = a.quality;
    $('kvBox').innerHTML =
      kv('الدقة', a.width + '×' + a.height + ' (' + a.megapixels.toFixed(2) + ' MP)') +
      kv('نسبة الأبعاد', a.aspect.toFixed(2) + ' : 1') +
      kv('الحدة', pct(a.sharpness) + (a.blurSigma > 0.9 ? ' (ضبابي)' : '')) +
      kv('التشويش', pct(a.noise)) +
      kv('التباين / المدى', pct(a.contrast * 2.6) + ' / ' + pct(a.dynamicRange)) +
      kv('الإضاءة / التعريض', pct(a.brightness) + (a.underExposure > 0.1 ? ' (مظلمة)' : '') + (a.overExposure > 0.1 ? ' (محرقة)' : '')) +
      kv('اتجاه الضوء', a.light.angle + '° — قوة ' + pct(a.light.strength) + ' — ' + Math.round(a.light.temperatureK) + 'K') +
      kv('المنظور', a.perspective.tiltHint + ' (انحراف ' + a.perspective.skew.toFixed(3) + '، تقارب ' + pct(a.perspective.convergence) + ')') +
      kv('تعقيد الخلفية', pct(a.backgroundComplexity)) +
      kv('التماثل', pct(a.symmetry)) +
      kv('الكاميرا المقدّرة', 'f≈' + Math.round(a.intrinsics.fx) + 'px • FOV ' + Math.round(a.intrinsics.fovDeg) + '°') +
      kv('الجودة الإجمالية للصورة', pct(q.overall));
    $('paletteBox').innerHTML = (a.palette || []).map(p =>
      '<span class="swatch" style="background:' + p.hex + '" title="' + p.hex + ' • ' + Math.round(p.ratio * 100) + '%"></span>').join('');
    const levels = { ok: 'ok', med: 'warn', high: 'bad' };
    $('fitBox').innerHTML = a.warnings.map(w =>
      '<div class="fitline ' + (levels[w.level] || 'warn') + '">' + (w.level === 'ok' ? '✅' : (w.level === 'high' ? '⛔' : '⚠️')) + ' ' + w.text + '</div>').join('');
    const box = document.createElement('div');
    const high = a.warnings.filter(w => w.level === 'high');
    if (high.length || a.blocking) {
      box.className = 'warnbox';
      box.innerHTML = '⛔ ' + (a.blocking ? 'الصورة صغيرة جدًا — قد يتعذّر إنتاج نموذج مستقر. ' : '') +
        high.map(w => w.text).join(' • ') + '<br><small>يمكنك المتابعة على أي حال.</small>';
    } else if (a.warnings.some(w => w.level === 'med')) {
      box.className = 'warnbox soft';
      box.innerHTML = '⚠️ جودة الصورة منخفضة جزئيًا وقد تؤثر على دقة النموذج. <small>يمكن المتابعة أو تفعيل «تحسين الصورة».</small>';
    }
    $('preWarn').innerHTML = '';
    if (box.innerHTML) $('preWarn').appendChild(box);
  }

  /* ---------------- صور تجريبية مولّدة محليًا ---------------- */
  function addSample(kind) {
    const c = U.makeCanvas(640, 480);
    const x = c.getContext('2d');
    const bg = x.createLinearGradient(0, 0, 640, 480);
    bg.addColorStop(0, '#2b3550'); bg.addColorStop(1, '#171c2b');
    x.fillStyle = bg; x.fillRect(0, 0, 640, 480);
    const glow = x.createRadialGradient(320, 220, 40, 320, 220, 420);
    glow.addColorStop(0, 'rgba(120,150,255,.28)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = glow; x.fillRect(0, 0, 640, 480);
    x.fillStyle = '#141926'; x.fillRect(0, 380, 640, 100);
    x.fillStyle = 'rgba(255,255,255,.06)'; x.fillRect(0, 380, 640, 2);

    if (kind === 'product') {
      // كرة/جسم مظلل (منتج)
      const cx = 320, cy = 250, R = 118;
      const L = [-0.55, -0.6, 0.58];
      const limg = x.createImageData(2 * R, 2 * R);
      for (let py = 0; py < 2 * R; py++) for (let px = 0; px < 2 * R; px++) {
        const dx = (px - R) / R, dy = (py - R) / R;
        const r2 = dx * dx + dy * dy;
        const o = (py * 2 * R + px) * 4;
        if (r2 > 1) { limg.data[o + 3] = 0; continue; }
        const nz = Math.sqrt(1 - r2);
        const ndl = Math.max(0, dx * L[0] + dy * L[1] + nz * L[2]);
        const spec = Math.pow(Math.max(0, nz * 0.92), 40) * 0.85;
        const sh = 0.22 + 0.9 * ndl + spec;
        limg.data[o] = Math.min(255, 196 * sh); limg.data[o + 1] = Math.min(255, 122 * sh);
        limg.data[o + 2] = Math.min(255, 74 * sh); limg.data[o + 3] = 255;
      }
      x.putImageData(limg, cx - R, cy - R);
      x.fillStyle = 'rgba(0,0,0,.35)';
      x.beginPath(); x.ellipse(cx, 392, 120, 14, 0, 0, 7); x.fill();
    } else {
      // مركبة جانبية
      const carG = x.createLinearGradient(0, 200, 0, 380);
      carG.addColorStop(0, '#e0393e'); carG.addColorStop(0.55, '#a3151c'); carG.addColorStop(1, '#5d0a0f');
      x.fillStyle = carG;
      x.beginPath();
      x.moveTo(90, 380); x.lineTo(90, 320);
      x.quadraticCurveTo(95, 300, 150, 295);
      x.lineTo(210, 240); x.quadraticCurveTo(218, 230, 235, 230);
      x.lineTo(400, 230); x.quadraticCurveTo(415, 230, 425, 242);
      x.lineTo(480, 295); x.lineTo(545, 305);
      x.quadraticCurveTo(560, 310, 560, 330); x.lineTo(560, 380);
      x.closePath(); x.fill();
      x.fillStyle = '#bcd6ea';
      x.beginPath(); x.moveTo(225, 245); x.lineTo(395, 245); x.lineTo(435, 288); x.lineTo(190, 288); x.closePath(); x.fill();
      x.fillStyle = 'rgba(255,255,255,.45)';
      x.beginPath(); x.moveTo(250, 245); x.lineTo(300, 245); x.lineTo(270, 288); x.lineTo(225, 288); x.closePath(); x.fill();
      x.strokeStyle = '#3d0a0d'; x.lineWidth = 5;
      x.beginPath(); x.moveTo(310, 245); x.lineTo(310, 288); x.stroke();
      x.fillStyle = '#ffd76a'; x.fillRect(545, 320, 14, 22);
      x.fillStyle = '#7a0d11'; x.fillRect(90, 320, 12, 22);
      x.fillStyle = 'rgba(255,255,255,.22)'; x.fillRect(100, 305, 440, 8);
      x.strokeStyle = '#2b0608'; x.lineWidth = 3;
      x.beginPath(); x.moveTo(310, 295); x.lineTo(310, 375); x.stroke();
      const wheel = wx => {
        x.fillStyle = '#0c0d12'; x.beginPath(); x.arc(wx, 375, 46, 0, 7); x.fill();
        x.fillStyle = '#3a3f4d'; x.beginPath(); x.arc(wx, 375, 30, 0, 7); x.fill();
        x.fillStyle = '#aeb6c6'; x.beginPath(); x.arc(wx, 375, 12, 0, 7); x.fill();
        x.strokeStyle = '#aeb6c6'; x.lineWidth = 5;
        for (let a = 0; a < 5; a++) {
          const t = a / 5 * Math.PI * 2;
          x.beginPath(); x.moveTo(wx, 375); x.lineTo(wx + Math.cos(t) * 28, 375 + Math.sin(t) * 28); x.stroke();
        }
      };
      wheel(190); wheel(465);
      x.fillStyle = 'rgba(0,0,0,.4)';
      x.beginPath(); x.ellipse(325, 424, 250, 14, 0, 0, 7); x.fill();
    }
    if ($('modeSel').value !== 'multi') state.frames = [];
    state.frames.push({ canvas: c, w: c.width, h: c.height, name: 'sample-' + kind + '.png' });
    renderThumbs(); updateCTA(); preAnalyze();
    toast('تم توليد صورة تجريبية محليًا — جاهزة للتحويل');
    document.getElementById('setupSec').scrollIntoView({ behavior: 'smooth' });
  }

  /* ---------------- الإعدادات ---------------- */
  function initSettings() {
    $('startBtn').onclick = startPipeline;
    $('cancelBtn').onclick = () => { state.cancel = true; toast('جارٍ الإيقاف…'); };
    $('depthRange').addEventListener('input', e => { $('depthVal').textContent = e.target.value; });
    ['qualitySel', 'texSel', 'geoSel'].forEach(id => {
      $(id).addEventListener('change', () => {
        if (state.frames.length) preAnalyze();
        if (state.result) $('impTips').textContent = 'ستُطبَّق الإعدادات الجديدة عند الضغط على «تحسين النموذج» أو إعادة البناء.';
      });
    });
    $('outSel').addEventListener('change', () => { $('expFmt').textContent = $('outSel').value.toUpperCase(); });
    $('expFmt').textContent = $('outSel').value.toUpperCase();
  }
  function collectOptions() {
    const refObjCm = parseFloat($('refObjSel').value) || null;
    return {
      mode: $('modeSel').value,
      quality: $('qualitySel').value,
      texture: $('texSel').value,
      geometry: $('geoSel').value,
      output: $('outSel').value,
      enhance: $('enhanceSw').checked,
      perspective: $('perspSw').checked,
      keepParts: $('partsSw').checked,
      selection: state.selection,
      depthScale: parseFloat($('depthRange').value),
      refWidthCm: parseFloat($('refInput').value) || null,
      refObject: 0,
      refObjectCm: refObjCm,
      targetHeightCm: parseFloat($('targetH').value) || null
    };
  }

  /* ---------------- الأجسام ---------------- */
  function initObjects() {
    document.querySelectorAll('#previewTabs .tab').forEach(t => {
      t.onclick = () => {
        document.querySelectorAll('#previewTabs .tab').forEach(x => x.classList.remove('on'));
        t.classList.add('on');
        state.previewTab = t.dataset.tab;
        renderPreview();
      };
    });
    $('allObjBtn').onclick = () => {
      state.selection = state.selection === 'all' ? 'auto' : 'all';
      $('allObjBtn').classList.toggle('sel', state.selection === 'all');
      renderObjList(); drawBboxes();
    };
    window.addEventListener('resize', () => drawBboxes());
  }

  function renderObjList() {
    const box = $('objList');
    box.innerHTML = '';
    const det = state.detection;
    if (!det || !det.objects.length) {
      box.innerHTML = '<div class="empty">لم يتم اكتشاف أجسام واضحة — سيُحوَّل كامل الصورة.</div>';
      $('allObjBtn').classList.add('hidden');
      return;
    }
    det.objects.forEach((o, i) => {
      const sel = (state.selection === i) || (state.selection === 'auto' && i === 0);
      const c = document.createElement('div');
      c.className = 'objchip' + (sel ? ' sel' : '');
      c.innerHTML = '<b>' + (i + 1) + ' • ' + o.typeAr + '</b>' +
        '<small>ثقة ' + Math.round(o.confidence * 100) + '% • تغطية ' + Math.round(o.areaRatio * 100) + '%</small>';
      c.onclick = () => { state.selection = i; $('allObjBtn').classList.remove('sel'); renderObjList(); drawBboxes(); };
      box.appendChild(c);
    });
    $('allObjBtn').classList.toggle('hidden', det.objects.length < 2);
  }

  function renderPreview() {
    const box = $('previewCanvasBox');
    box.innerHTML = '';
    const f = state.frames[0];
    if (!f) { $('bboxLayer').innerHTML = ''; return; }
    const tab = state.previewTab;
    const show = c => {
      c.style.maxWidth = '100%';
      box.appendChild(c);
      requestAnimationFrame(() => drawBboxes());
    };
    const r = state.result;
    if (tab === 'mask' && r) { show(AI3D.Texture.renderMaskPreview(r.segmentation.hard || r.segmentation.mask, r.workW, r.workH, r.refCanvas)); return; }
    if (tab === 'depth' && r) { show(AI3D.Texture.renderDepthPreview(r.depth.depth, r.segmentation.hard || r.segmentation.mask, r.workW, r.workH)); return; }
    if (tab === 'saliency' && state.detection) {
      show(AI3D.Texture.renderFieldPreview(state.detection.saliency, state.detection.saliencyW, state.detection.saliencyH, null)); return;
    }
    if (tab === 'albedo' && r) { show(U.toCanvas(r.maps.albedo)); return; }
    if (tab === 'normal' && r) { show(U.toCanvas(r.maps.normal)); return; }
    const c = document.createElement('canvas');
    c.width = f.w; c.height = f.h;
    c.getContext('2d').drawImage(f.canvas, 0, 0);
    show(c);
  }

  function drawBboxes() {
    const layer = $('bboxLayer');
    layer.innerHTML = '';
    if (!state.detection || state.previewTab === 'albedo' || state.previewTab === 'normal') return;
    const canvas = $('previewCanvasBox').querySelector('canvas');
    if (!canvas) return;
    const r = canvas.getBoundingClientRect(), pr = $('previewWrap').getBoundingClientRect();
    const ox = r.left - pr.left, oy = r.top - pr.top;
    state.detection.objects.forEach((o, i) => {
      const sel = (state.selection === i) || (state.selection === 'auto' && i === 0) || state.selection === 'all';
      const d = document.createElement('div');
      d.className = 'bbox' + (sel ? ' sel' : '');
      d.style.left = (ox + o.bbox.x0 * r.width) + 'px';
      d.style.top = (oy + o.bbox.y0 * r.height) + 'px';
      d.style.width = ((o.bbox.x1 - o.bbox.x0) * r.width) + 'px';
      d.style.height = ((o.bbox.y1 - o.bbox.y0) * r.height) + 'px';
      d.innerHTML = '<span>' + (i + 1) + ' • ' + o.typeAr + '</span>';
      d.onclick = () => { state.selection = i; $('allObjBtn').classList.remove('sel'); renderObjList(); drawBboxes(); };
      layer.appendChild(d);
    });
  }

  /* ---------------- التشغيل ---------------- */
  async function startPipeline() {
    if (!state.frames.length) { toast('ارفع صورة أولًا'); return; }
    if (state.running) return;
    if (state.analysis && state.analysis.blocking) {
      if (!confirm('الصورة صغيرة جدًا وقد لا ينتج عنها نموذج مستقر. هل تريد المتابعة على أي حال؟')) return;
    }
    state.running = true; state.cancel = false;
    $('startBtn').disabled = true; $('cancelBtn').disabled = false;
    $('errBox').classList.add('hidden');
    $('resultSec').classList.add('hidden');
    renderStages();
    $('pbarFill').style.width = '0%';
    $('pipeCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    const opts = collectOptions();
    const t0 = performance.now();
    try {
      const res = await AI3D.Pipeline.runPipeline(state.frames, opts, (stage, p) => {
        if (state.cancel) throw new Error('تم إيقاف المعالجة بواسطة المستخدم');
        markStages(stage);
        $('pbarFill').style.width = p + '%';
        $('pipeHint').textContent = stageLabel(stage) + ' — ' + p + '%';
      });
      res.procMs = performance.now() - t0;
      res.info.processingTime = U.fmtTime(res.procMs);
      state.result = res;
      state.selectedVertices = null;
      showResult(res);
      await saveProject(true);
      toast('اكتمل إنشاء النموذج ثلاثي الأبعاد ✓');
    } catch (err) {
      console.error(err);
      const box = $('errBox');
      box.classList.remove('hidden');
      box.textContent = friendlyError(err);
    } finally {
      state.running = false;
      $('startBtn').disabled = false;
      $('cancelBtn').disabled = true;
      updateCTA();
    }
  }

  function stageLabel(id) {
    const s = AI3D.Pipeline.STAGES.find(x => x.id === id);
    return s ? s.ar : id;
  }
  function renderStages() {
    const box = $('stages');
    box.innerHTML = '';
    AI3D.Pipeline.STAGES.forEach(s => {
      const d = document.createElement('div');
      d.className = 'stage';
      d.id = 'st-' + s.id;
      d.innerHTML = '<span class="st-ic">○</span><span>' + s.ar + ' <small>' + s.en + '</small></span>';
      box.appendChild(d);
    });
  }
  function markStages(activeId) {
    const order = AI3D.Pipeline.STAGES.map(s => s.id);
    const ai = order.indexOf(activeId);
    order.forEach((id, i) => {
      const el = $('st-' + id);
      if (!el) return;
      el.classList.remove('run', 'done');
      const ic = el.querySelector('.st-ic');
      if (i < ai || activeId === 'complete') { el.classList.add('done'); ic.textContent = '✓'; }
      else if (id === activeId && activeId !== 'complete') { el.classList.add('run'); ic.textContent = '◌'; }
      else ic.textContent = '○';
    });
  }
  function friendlyError(err) {
    const m = String((err && err.message) || err);
    if (/إيقاف/.test(m)) return m;
    if (/small|صغيرة|width|height/i.test(m)) return 'الصورة صغيرة جدًا — جرّب صورة أوضح وأكبر.';
    if (/WebGL/i.test(m)) return 'تعذّر تشغيل العارض ثلاثي الأبعاد: WebGL غير مدعوم في هذا المتصفح.';
    if (/memory|length|RangeError/i.test(m)) return 'نفدت الذاكرة أثناء المعالجة — جرّب جودة أقل (Low/Medium) وTexture أصغر.';
    if (/لم يتم|لا يوجد جسم|coverage/i.test(m)) return 'لم يتم اكتشاف جسم مناسب — جرّب صورة أوضح أو بخلفية أبسط.';
    return 'حدث خطأ أثناء معالجة النموذج. جرّب صورة أوضح أو جودة أقل. (' + m.slice(0, 140) + ')';
  }

  /* ---------------- النتيجة ---------------- */
  function showResult(res) {
    document.querySelectorAll('#previewTabs .tab').forEach(t => {
      if (['mask', 'depth', 'saliency', 'albedo', 'normal'].includes(t.dataset.tab)) t.classList.remove('hidden');
    });
    ensureViewer();
    const texCanvas = U.toCanvas(res.maps.albedo);
    state.viewer.setMesh(res.mesh, texCanvas);
    state.viewer.setPointCloud(res.cloud);
    state.viewer.setMaterial(res.material);
    renderScores();
    renderInfo();
    renderCompare();
    renderImproveTips();
    $('resultSec').classList.remove('hidden');
    $('resultSec').scrollIntoView({ behavior: 'smooth' });
    if (state.previewTab === 'original' || state.previewTab === 'objects') { state.previewTab = 'depth'; document.querySelectorAll('#previewTabs .tab').forEach(t => t.classList.toggle('on', t.dataset.tab === 'depth')); }
    renderPreview();
  }

  function renderScores() {
    const s = state.result.scores;
    $('scores').innerHTML =
      '<div class="score hero-score"><b>' + s.overall + '%</b><span>الجودة الإجمالية</span></div>' +
      scoreCard(s.geometry, 'الهندسة Geometry') + scoreCard(s.texture, 'الـ Texture') +
      scoreCard(s.integrity, 'سلامة الشبكة') + scoreCard(s.depth, 'ثقة العمق') +
      '<div class="hint" style="grid-column:1/-1">ℹ️ ' + s.disclaimer + '</div>' +
      '<div class="hint" style="grid-column:1/-1">تفصيل: تغطية العزل ' + s.parts.coverage + '% • بروز العمق ' + s.parts.relief +
      '% • ملء الأطلس ' + s.parts.atlas + '% • مرصود ' + s.parts.observed + '% • مانيفولد ' + s.parts.manifold + '%</div>';
    function scoreCard(v, k) { return '<div class="score"><b>' + v + '%</b><span>' + k + '</span></div>'; }
  }

  function renderInfo() {
    const r = state.result, i = r.info, st = r.stats, m = r.material;
    const d = i.dimensions;
    $('infoBox').innerHTML =
      kv('اسم النموذج', 'AI3D_' + (r.id || Date.now().toString(36))) +
      kv('نوع الجسم', i.objectLabel + ' (ثقة ' + Math.round((r.typeConfidence || 0.6) * 100) + '%)') +
      kv('الرؤوس / الوجوه', num(st.vertices) + ' / ' + num(st.faces)) +
      kv('نقاط السحابة', num(i.pointCloudPoints)) +
      kv('دقة الـ Texture', i.textureResolution + ' • مخططات أطلس: ' + i.atlasCharts) +
      kv('الخامة المقدّرة', i.materialAr + ' — خشونة ' + m.roughness + ' • معدنية ' + m.metallic +
        (m.transparency > 0 ? ' • شفافية ' + m.transparency : '') + (m.clearcoat > 0 ? ' • طبقة شفافة ' + m.clearcoat : '')) +
      kv('الأبعاد', d.x + ' × ' + d.y + ' × ' + d.z + ' ' + d.unit) +
      kv('مصدر القياس', i.scaleSource) +
      kv('زمن المعالجة', i.processingTime) +
      kv('دقة المصدر / العمل', i.sourceResolution + ' / ' + r.workW + '×' + r.workH) +
      kv('الهندسة المرصودة', Math.round(st.observedRatio * 100) + '% مرصودة • ' + Math.round((1 - st.observedRatio) * 100) + '% مُستنتَجة') +
      kv('سلامة الشبكة', (st.watertight ? 'مغلقة بالكامل ✓' : 'شبه مغلقة') + ' • مكوّنات: ' + st.components +
        ' • حواف غير مانيفولدية: ' + st.nonManifoldEdges) +
      kv('المساحة / الحجم', st.area.toFixed(3) + ' / ' + st.volume.toFixed(3)) +
      '<div class="hint" style="grid-column:1/-1">⚠️ ' + i.estimatedNotice + '</div>';
    const hs = $('hudStats');
    if (hs) hs.textContent = num(st.faces) + ' وجه • ' + num(st.vertices) + ' رأس • ' + i.textureResolution;
  }

  function renderImproveTips() {
    try {
      const sug = AI3D.Pipeline.suggestImprovements(state.result);
      $('impTips').textContent = 'مقترحات: ' + sug.tips.join(' • ');
    } catch (e) { $('impTips').textContent = ''; }
  }

  /* ---------------- العارض ---------------- */
  function ensureViewer() {
    if (state.viewer) return;
    state.viewer = new window.AI3DViewer($('gl'));
    const v = state.viewer;
    const seg = (ids, fn) => ids.forEach(id => {
      const el = $(id);
      if (!el) return;
      el.onclick = () => { ids.forEach(x => $(x).classList.remove('on')); el.classList.add('on'); fn(id); };
    });
    seg(['mTex', 'mSolid', 'mWire', 'mXray', 'mMat', 'mPoints'], id => {
      v.mode = { mTex: 'texture', mSolid: 'solid', mWire: 'wireframe', mXray: 'xray', mMat: 'material', mPoints: 'points' }[id];
    });
    seg(['lStudio', 'lSoft', 'lDrama', 'lTop'], id => {
      v.lightPreset = { lStudio: 'studio', lSoft: 'soft', lDrama: 'dramatic', lTop: 'top' }[id];
    });
    seg(['bDark', 'bLight', 'bBlue', 'bWarm'], id => {
      v.bgPreset = { bDark: 'dark', bLight: 'light', bBlue: 'blue', bWarm: 'warm' }[id];
    });
    $('rotBtn').onclick = () => { v.autoRotate = !v.autoRotate; $('rotBtn').classList.toggle('on', v.autoRotate); };
    $('resetBtn').onclick = () => v.resetCamera();
    $('gridBtn').onclick = () => { v.showGrid = !v.showGrid; $('gridBtn').classList.toggle('on', v.showGrid); };
    $('estBtn').onclick = () => {
      v.showEstimated = !v.showEstimated;
      $('estBtn').classList.toggle('on', v.showEstimated);
      $('estLegend').classList.toggle('show', v.showEstimated);
    };
    $('selBtn').onclick = () => {
      state.selecting = !state.selecting;
      v.lockInput = state.selecting;
      $('selBtn').classList.toggle('on', state.selecting);
      toast(state.selecting ? 'اسحب مستطيلًا على النموذج لتحديد منطقة (للحذف أو إعادة البناء)' : 'تم إيقاف التحديد');
    };
    $('shotBtn').onclick = () => {
      const a = document.createElement('a');
      a.href = v.screenshot(); a.download = 'ai3d-view.png'; a.click();
      toast('تم حفظ لقطة من العارض');
    };
    document.querySelectorAll('[data-view]').forEach(b => { b.onclick = () => v.setView(b.dataset.view); });
    initSelection();
  }

  /* تحديد منطقة بالسحب على العارض */
  function initSelection() {
    const canvas = $('gl');
    const layer = document.createElement('div');
    layer.className = 'sel-layer';
    canvas.parentElement.appendChild(layer);
    let start = null;
    const norm = e => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
    };
    canvas.addEventListener('pointerdown', e => {
      if (!state.selecting) return;
      start = norm(e);
      canvas.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });
    canvas.addEventListener('pointermove', e => {
      if (!state.selecting || !start) return;
      const p = norm(e);
      const x0 = Math.min(start.x, p.x), y0 = Math.min(start.y, p.y);
      const w = Math.abs(p.x - start.x), h = Math.abs(p.y - start.y);
      layer.style.display = 'block';
      layer.style.left = x0 + 'px'; layer.style.top = y0 + 'px';
      layer.style.width = w + 'px'; layer.style.height = h + 'px';
    });
    canvas.addEventListener('pointerup', e => {
      if (!state.selecting || !start) return;
      const p = norm(e);
      const rect = {
        x0: Math.min(start.x, p.x) / start.w, y0: Math.min(start.y, p.y) / start.h,
        x1: Math.max(start.x, p.x) / start.w, y1: Math.max(start.y, p.y) / start.h
      };
      layer.style.display = 'none';
      start = null;
      if (!state.viewer || !state.result) return;
      if (Math.abs(rect.x1 - rect.x0) < 0.02 || Math.abs(rect.y1 - rect.y0) < 0.02) return;
      const set = state.viewer.pickRect(rect);
      state.selectedVertices = set;
      state.selectionRect = rect;
      toast('تم تحديد ' + num(set.size) + ' رأس — يمكنك حذفها أو إعادة بناء المنطقة');
    });
  }

  /* ---------------- المقارنة ---------------- */
  function initCompare() {
    const apply = v => {
      const x = 100 - v;
      $('cmpAfterImg').style.clipPath = 'inset(0 0 0 ' + x + '%)';
      $('cmpHandle').style.right = x + '%';
    };
    $('cmpRange').addEventListener('input', e => apply(parseFloat(e.target.value)));
    apply(50);
    $('cmpRefresh').onclick = refreshCompareShot;
  }
  function renderCompare() {
    const r = state.result;
    if (!r) return;
    $('cmpBefore').src = (r.refCanvas || U.toCanvas(r.refImg)).toDataURL('image/jpeg', 0.85);
    setTimeout(refreshCompareShot, 700);
  }
  function refreshCompareShot() {
    try { $('cmpAfterImg').src = state.viewer.screenshot(); }
    catch (e) { toast('تعذّر أخذ لقطة من العارض'); }
  }

  /* ---------------- أدوات الشبكة ---------------- */
  function initMeshTools() {
    $('scaleRange').addEventListener('input', e => { $('scaleVal').textContent = e.target.value + '×'; });
    $('scaleRange').addEventListener('change', e => {
      if (!state.result) return;
      const s = parseFloat(e.target.value);
      AI3D.Geometry.transformMesh(state.result.mesh, { scale: [s, s, s] });
      state.result.stats = AI3D.Geometry.meshStats(state.result.mesh);
      state.viewer.refreshMesh(state.result.mesh, U.toCanvas(state.result.maps.albedo));
      renderInfo();
      e.target.value = 1; $('scaleVal').textContent = '1×';
    });
    $('rotYRange').addEventListener('input', e => { $('rotYVal').textContent = e.target.value + '°'; });
    $('rotYRange').addEventListener('change', e => {
      if (!state.result) return;
      AI3D.Geometry.transformMesh(state.result.mesh, { rotate: [0, parseFloat(e.target.value) * Math.PI / 180, 0] });
      state.viewer.refreshMesh(state.result.mesh, U.toCanvas(state.result.maps.albedo));
      e.target.value = 0; $('rotYVal').textContent = '0°';
    });
    const refreshAfter = (msg) => {
      const r = state.result;
      r.stats = AI3D.Geometry.meshStats(r.mesh);
      state.viewer.refreshMesh(r.mesh, U.toCanvas(r.maps.albedo));
      renderInfo();
      if (msg) toast(msg);
    };
    $('centerBtn').onclick = () => { if (state.result) { AI3D.Geometry.centerMesh(state.result.mesh); refreshAfter('تم توسيط النموذج'); } };
    $('normalsBtn').onclick = () => {
      if (!state.result) return;
      const m = state.result.mesh;
      m.normals = AI3D.Geometry.computeNormals(m.positions, m.indices);
      refreshAfter('تمت إعادة حساب النواميس');
    };
    $('smoothBtn').onclick = () => { if (state.result) { AI3D.Geometry.smoothMesh(state.result.mesh, 2, 0.4); refreshAfter('تم تنعيم النموذج'); } };
    $('decimateBtn').onclick = () => {
      if (!state.result) return;
      const ratio = parseFloat($('decimateSel').value);
      state.result.mesh = AI3D.Geometry.decimateMesh(state.result.mesh, ratio);
      refreshAfter('تم تبسيط الشبكة (احتفاظ ~' + Math.round(ratio * 100) + '%)');
    };
    $('repairBtn').onclick = () => {
      if (!state.result) return;
      state.result.mesh = AI3D.Geometry.repairMesh(state.result.mesh);
      refreshAfter('تم إصلاح الشبكة وإغلاق الثقوب الصغيرة');
    };
    $('delEstBtn').onclick = () => {
      if (!state.result) return;
      if (!confirm('سيتم حذف الأجزاء المُستنتَجة (الظهر والجوانب) والاحتفاظ بالهندسة المرصودة فقط. متابعة؟')) return;
      state.result.mesh = AI3D.Geometry.removeEstimated(state.result.mesh);
      refreshAfter('تم حذف الأجزاء المُستنتَجة');
    };
    $('delIsoBtn').onclick = () => {
      if (!state.result) return;
      state.result.mesh = AI3D.Geometry.removeIsolated(state.result.mesh, 0.02);
      refreshAfter('تم حذف الأجزاء المنفصلة الصغيرة');
    };
    $('delSelBtn').onclick = () => {
      if (!state.result) return;
      if (!state.selectedVertices || !state.selectedVertices.size) { toast('فعّل زر التحديد ▢ واسحب مستطيلًا على النموذج أولًا'); return; }
      state.result.mesh = AI3D.Geometry.deleteVertices(state.result.mesh, state.selectedVertices);
      state.selectedVertices = null;
      refreshAfter('تم حذف المنطقة المحددة');
    };
    $('reconSelBtn').onclick = async () => {
      if (!state.result) return;
      if (!state.selectionRect) { toast('فعّل زر التحديد ▢ واسحب مستطيلًا على النموذج أولًا'); return; }
      toast('إعادة بناء المنطقة المحددة بدقة أعلى…');
      await U.tick(60);
      try {
        const out = await AI3D.Pipeline.reconstructRegion(state.result, state.selectionRect, (stage, p) => {
          $('pipeHint').textContent = stageLabel(stage) + ' — ' + p + '%';
        });
        state.result.mesh = out.mesh;
        refreshAfter('تمت إعادة بناء المنطقة المحددة');
      } catch (e) { console.error(e); toast(friendlyError(e)); }
    };
    $('improveBtn').onclick = async () => {
      if (!state.result) return;
      const sug = AI3D.Pipeline.suggestImprovements(state.result);
      applyOptionPatch(sug.options);
      toast('إعادة بناء بتحسينات مقترحة…');
      await startPipeline();
    };
    $('impGeoBtn').onclick = () => patchAndRun({ geometry: 'detailed', quality: bumpQuality() }, 'تحسين الهندسة');
    $('impTexBtn').onclick = () => patchAndRun({ texture: 'ultra', enhance: true }, 'تحسين الـ Texture');
    $('impDetBtn').onclick = () => patchAndRun({ quality: bumpQuality(), geometry: 'detailed', texture: 'high' }, 'تحسين التفاصيل');
  }
  function bumpQuality() {
    return { low: 'medium', medium: 'high', high: 'ultra', ultra: 'ultra' }[$('qualitySel').value] || 'high';
  }
  function applyOptionPatch(patch) {
    const map = { quality: 'qualitySel', texture: 'texSel', geometry: 'geoSel' };
    for (const k in patch) {
      if (map[k]) $(map[k]).value = patch[k];
      else if (k === 'enhance') $('enhanceSw').checked = patch[k];
      else if (k === 'keepParts') $('partsSw').checked = patch[k];
    }
  }
  async function patchAndRun(patch, label) {
    if (!state.result) { toast('أنشئ نموذجًا أولًا'); return; }
    applyOptionPatch(patch);
    toast(label + '… جارٍ إعادة البناء');
    await startPipeline();
  }

  /* ---------------- التصدير ---------------- */
  function initExport() {
    $('expMain').onclick = async () => {
      const r = state.result;
      if (!r) return;
      const fmt = $('outSel').value;
      const name = 'ai3d-model';
      toast('جارٍ تجهيز ملف ' + fmt.toUpperCase() + '…');
      await U.tick(50);
      try {
        if (fmt === 'glb') {
          U.downloadBlob(await AI3D.Exporters.exportGLB(r.mesh, r.maps, r.material, { name }), name + '.glb');
        } else if (fmt === 'gltf') {
          const g = await AI3D.Exporters.exportGLTFSeparate(r.mesh, r.maps, r.material, { name });
          U.downloadBlob(g.gltf, name + '.gltf');
          setTimeout(() => U.downloadBlob(g.bin, name + '.bin'), 300);
          setTimeout(() => g.albedo && U.downloadBlob(g.albedo, name + '_albedo.png'), 700);
          setTimeout(() => g.normal && U.downloadBlob(g.normal, name + '_normal.png'), 1100);
          setTimeout(() => g.orm && U.downloadBlob(g.orm, name + '_orm.png'), 1500);
        } else if (fmt === 'obj') {
          const { obj, mtl } = AI3D.Exporters.exportOBJ(r.mesh, name, r.material);
          U.downloadBlob(obj, name + '.obj');
          setTimeout(() => U.downloadBlob(mtl, name + '.mtl'), 400);
          setTimeout(async () => U.downloadBlob(await AI3D.Exporters.imageToBlob(r.maps.albedo), name + '_albedo.png'), 800);
        } else if (fmt === 'stl') {
          U.downloadBlob(AI3D.Exporters.exportSTL(r.mesh), name + '.stl');
        } else if (fmt === 'ply') {
          U.downloadBlob(AI3D.Exporters.exportPLY(r.mesh, r.maps, true), name + '.ply');
        }
        toast('تم تنزيل النموذج ✓');
      } catch (e) { console.error(e); toast('تعذّر التصدير — جرّب صيغة أخرى'); }
    };
    $('expTex').onclick = async () => {
      if (!state.result) return;
      U.downloadBlob(await AI3D.Exporters.imageToBlob(state.result.maps.albedo), 'ai3d-albedo.png');
      setTimeout(async () => U.downloadBlob(await AI3D.Exporters.imageToBlob(state.result.maps.normal), 'ai3d-normal.png'), 400);
      setTimeout(async () => U.downloadBlob(await AI3D.Exporters.imageToBlob(state.result.maps.orm), 'ai3d-orm.png'), 800);
    };
    $('expMaps').onclick = async () => {
      if (!state.result) return;
      const r = state.result;
      const zip = await AI3D.Exporters.exportProjectZIP([
        { name: 'albedo.png', data: await AI3D.Exporters.imageToBlob(r.maps.albedo) },
        { name: 'normal.png', data: await AI3D.Exporters.imageToBlob(r.maps.normal) },
        { name: 'orm.png', data: await AI3D.Exporters.imageToBlob(r.maps.orm) },
        { name: 'material.json', data: JSON.stringify(r.material, null, 2) }
      ]);
      U.downloadBlob(zip, 'ai3d-maps.zip');
      toast('تم تنزيل الخرائط ✓');
    };
    $('expCloud').onclick = () => {
      if (!state.result) return;
      U.downloadBlob(AI3D.Exporters.exportPointCloudPLY(state.result.cloud), 'ai3d-pointcloud.ply');
      toast('تم تنزيل السحابة النقطية ✓');
    };
    $('expZip').onclick = async () => {
      const r = state.result;
      if (!r) return;
      toast('جارٍ تجهيز حزمة المشروع…');
      await U.tick(50);
      try {
        const name = 'ai3d-model';
        const glb = await AI3D.Exporters.exportGLB(r.mesh, r.maps, r.material, { name });
        const { obj, mtl } = AI3D.Exporters.exportOBJ(r.mesh, name, r.material);
        const stl = AI3D.Exporters.exportSTL(r.mesh);
        const refCanvas = r.refCanvas || U.toCanvas(r.refImg);
        const origBlob = await new Promise(res => refCanvas.toBlob(res, 'image/jpeg', 0.9));
        const depthC = AI3D.Texture.renderDepthPreview(r.depth.depth, r.segmentation.hard || r.segmentation.mask, r.workW, r.workH);
        const maskC = AI3D.Texture.renderMaskPreview(r.segmentation.hard || r.segmentation.mask, r.workW, r.workH, refCanvas);
        const depthBlob = await new Promise(res => depthC.toBlob(res, 'image/png'));
        const maskBlob = await new Promise(res => maskC.toBlob(res, 'image/png'));
        const report = {
          generator: 'MISTEKAWE AI-3D Engine ' + AI3D.version,
          created: new Date().toISOString(),
          object: { type: r.objectType, label: r.objectLabel },
          scores: r.scores, info: r.info, stats: r.stats,
          material: r.material, analysis: {
            light: r.analysis.light, perspective: r.analysis.perspective,
            sharpness: r.analysis.sharpness, noise: r.analysis.noise,
            intrinsics: r.analysis.intrinsics, quality: r.analysis.quality
          },
          segmentation: { method: r.segmentation.method, coverage: r.segmentation.coverage, confidence: r.segmentation.confidence },
          depth: { method: r.depth.method, stats: r.depthStats },
          mesh: { method: r.mesh.meta ? r.mesh.meta.method : 'TSDF', grid: r.mesh.meta ? r.mesh.meta.grid : null },
          settings: r.options,
          privacy: 'كل المعالجة تمت محليًا على جهاز المستخدم — لا توجد أي خدمة خارجية.'
        };
        const zip = await AI3D.Exporters.exportProjectZIP([
          { name: 'model/' + name + '.glb', data: glb },
          { name: 'model/' + name + '.obj', data: obj },
          { name: 'model/' + name + '.mtl', data: mtl },
          { name: 'model/' + name + '.stl', data: stl },
          { name: 'textures/albedo.png', data: await AI3D.Exporters.imageToBlob(r.maps.albedo) },
          { name: 'textures/normal.png', data: await AI3D.Exporters.imageToBlob(r.maps.normal) },
          { name: 'textures/orm.png', data: await AI3D.Exporters.imageToBlob(r.maps.orm) },
          { name: 'source/original.jpg', data: origBlob },
          { name: 'debug/depth.png', data: depthBlob },
          { name: 'debug/mask.png', data: maskBlob },
          { name: 'report.json', data: JSON.stringify(report, null, 2) },
          { name: 'README.txt', data: 'MISTEKAWE AI-3D — نموذج مُعاد بناؤه محليًا من صورة واحدة أو أكثر.\n' +
              'الأجزاء غير المرئية في الصورة هي هندسة مُستنتَجة بالذكاء الاصطناعي وليست مقيسة.\n' +
              'الصيغ: GLB/glTF/OBJ/STL/PLY — الخرائط: albedo / normal / orm.' }
        ]);
        U.downloadBlob(zip, name + '-project.zip');
        toast('تم تنزيل حزمة المشروع ✓');
      } catch (e) { console.error(e); toast('تعذّر تجهيز الحزمة'); }
    };
  }

  /* ---------------- المشاريع ---------------- */
  function initProjects() {
    renderProjects();
    $('saveProjBtn').onclick = () => saveProject(false);
    $('wipeBtn').onclick = async () => {
      if (!confirm('سيتم حذف كل المشاريع والصور المحفوظة على هذا الجهاز. متابعة؟')) return;
      try { await idbClear(); } catch (e) { console.warn(e); }
      store.set('ai3d-projects-meta', '[]');
      renderProjects();
      toast('تم حذف كل البيانات المحلية');
    };
  }
  async function saveProject(auto) {
    const r = state.result;
    if (!r) { if (!auto) toast('لا يوجد نموذج لحفظه'); return; }
    try {
      const name = ($('projName').value || '').trim() || ('نموذج ' + new Date().toLocaleString('ar'));
      const thumb = await makeThumb();
      const glb = await AI3D.Exporters.exportGLB(r.mesh, r.maps, r.material, { name });
      const srcCanvas = r.refCanvas || U.toCanvas(r.refImg);
      const srcBlob = await new Promise(res => srcCanvas.toBlob(res, 'image/jpeg', 0.8));
      const entry = {
        id: 'p' + Date.now().toString(36),
        name, date: new Date().toLocaleString('ar'),
        scores: r.scores, info: r.info, stats: r.stats,
        material: r.material, settings: r.options,
        objectLabel: r.objectLabel,
        thumb, glb, srcBlob
      };
      await idbPut(entry);
      renderProjects();
      if (!auto) toast('تم حفظ المشروع على جهازك ✓');
    } catch (e) {
      console.warn(e);
      toast('تعذّر الحفظ في المتصفح (مساحة/تخزين) — يمكنك تنزيل النموذج مباشرة');
    }
  }
  async function makeThumb() {
    const c = U.makeCanvas(320, 200);
    const x = c.getContext('2d');
    x.fillStyle = '#101623'; x.fillRect(0, 0, 320, 200);
    try {
      if (state.viewer) {
        const img = new Image();
        img.src = state.viewer.screenshot();
        await new Promise(res => { img.onload = res; img.onerror = res; });
        x.drawImage(img, 0, 0, 320, 200);
        return c.toDataURL('image/jpeg', 0.6);
      }
    } catch (e) { /* ignore */ }
    if (state.frames[0]) x.drawImage(state.frames[0].canvas, 0, 0, 320, 200);
    return c.toDataURL('image/jpeg', 0.6);
  }
  async function renderProjects() {
    const box = $('projGrid');
    box.innerHTML = '<div class="empty">جارٍ تحميل المشاريع…</div>';
    let projs = [];
    try { projs = await idbAll(); } catch (e) { projs = []; }
    projs.sort((a, b) => (b.id > a.id ? 1 : -1));
    box.innerHTML = '';
    if (!projs.length) {
      box.innerHTML = '<div class="empty">لا توجد مشاريع بعد — يُحفظ كل نموذج تنشئه تلقائيًا على جهازك.</div>';
      return;
    }
    projs.forEach(p => {
      const d = document.createElement('div');
      d.className = 'proj';
      d.innerHTML = '<img src="' + (p.thumb || '') + '" alt=""><div class="pb"><b></b><small></small></div><div class="pa"></div>';
      d.querySelector('b').textContent = p.name;
      d.querySelector('small').textContent = p.date + ' • ' + (p.scores ? p.scores.overall + '%' : '') +
        ' • ' + (p.info ? num(p.info.faces) + ' وجه' : '');
      const acts = d.querySelector('.pa');
      const mk = (label, fn, cls) => {
        const b = document.createElement('button');
        b.className = 'btn btn-ghost btn-sm'; b.textContent = label; b.onclick = fn; acts.appendChild(b);
      };
      mk('⬇️ GLB', () => p.glb && U.downloadBlob(p.glb, (p.name.replace(/[^\w\u0600-\u06FF-]+/g, '_') || 'model') + '.glb'));
      mk('🗑️ حذف', async () => {
        if (!confirm('حذف المشروع "' + p.name + '"؟')) return;
        await idbDelete(p.id); renderProjects();
      });
      box.appendChild(d);
    });
  }

  /* ---------------- معلومات المحرك ---------------- */
  function initEngineInfo() {
    $('ver').textContent = 'v' + AI3D.version;
    const caps = AI3D.Backends.detectCapabilities();
    const yn = v => (v ? '✓ متاح' : '✗ غير متاح');
    $('capsBox').innerHTML =
      kv('WebGL2', yn(caps.webgl2)) + kv('WebGPU', yn(caps.webgpu)) +
      kv('WebAssembly', yn(caps.wasm)) + kv('خيوط/نوى', caps.cores + ' نواة') +
      kv('OffscreenCanvas', yn(caps.offscreenCanvas)) + kv('CompressionStream', yn(caps.compression)) +
      kv('IndexedDB', yn(caps.indexedDB)) + kv('اللمس', yn(caps.touch)) +
      kv('الذاكرة', caps.memoryGB ? caps.memoryGB + ' GB' : 'غير معلوم');
    renderModels();
  }
  function renderModels() {
    const box = $('modelsBox');
    if (!box) return;
    const list = AI3D.Backends.describeModels();
    const builtin = ['analysis', 'detection', 'segmentation', 'depth', 'reconstruction', 'texture', 'material']
      .map(s => '<span class="chip">' + s + ': مدمج</span>').join(' ');
    const extra = list.length ? list.map(m => '<span class="chip on">' + m.stage + ': ' + (m.meta && m.meta.name || 'نموذج محلي') + '</span>').join(' ') : '';
    box.innerHTML = '<div class="chips">' + builtin + ' ' + extra + '</div>' +
      '<div class="hint">لتركيب نموذج عصبي محلي (ONNX/WebGPU) ضعه في <code>models/</code> مع ملف <code>manifest.json</code> — ' +
      'يُحمّل من جهازك دون أي اتصال خارجي، عبر <code>AI3D.Backends.install(\'depth\', {predict})</code>.</div>';
  }
})();
