/* ============================================================
 * studio.js — واجهة الاستوديو: رفع، إعدادات، تشغيل، نتائج،
 * أدوات شبكة، تصدير، مشاريع محلية، مقارنة، خصوصية.
 * ============================================================ */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const U = window.AI3D.util;
  // تخزين آمن (يعمل حتى مع تعطّل localStorage في الوضع الخاص)
  const store = {
    _m: {},
    get(k) { try { return window.localStorage.getItem(k); } catch (e) { return this._m[k] || null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { this._m[k] = String(v); } }
  };

  const state = {
    frames: [],          // [{canvas,w,h,name,file}]
    detection: null, analysis: null,
    selection: 'auto',
    result: null,
    viewer: null,
    previewTab: 'objects',
    theme: 'dark'
  };

  /* ---------------- تهيئة ---------------- */
  window.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initUpload();
    initSettings();
    initViewerUI();
    initCompare();
    initMeshTools();
    initExport();
    initProjects();
    renderStages('idle');
  });

  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), ms || 2600);
  }

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
  function initUpload() {
    const drop = $('drop'), input = $('fileInput');
    drop.addEventListener('click', e => {
      if (e.target.closest('button') && e.target.closest('button').dataset.act) return;
      input.click();
    });
    input.addEventListener('change', () => addFiles(input.files).then(() => { input.value = ''; }));
    ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));
    $('sampleBtn1').onclick = e => { e.stopPropagation(); addSample('bottle'); };
    $('sampleBtn2').onclick = e => { e.stopPropagation(); addSample('car'); };
    $('clearBtn').onclick = e => { e.stopPropagation(); state.frames = []; renderThumbs(); updateCTA(); };
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

  const ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff', 'image/x-tiff', 'image/gif'];
  async function addFiles(files) {
    const multi = $('modeSel').value === 'multi';
    const list = [...files].filter(f => f.type.startsWith('image/') || ACCEPT.includes(f.type));
    if (!list.length) { toast('اختر ملف صورة صالح (JPG / PNG / WEBP / BMP / TIFF)'); return; }
    for (const f of list) {
      if (!multi && state.frames.length >= 1) state.frames = [];
      if (multi && state.frames.length >= 5) { toast('الحد الأقصى 5 صور في وضع تعدد الصور'); break; }
      try {
        const loaded = await U.loadImageFile(f, 1400);
        state.frames.push({ canvas: loaded.canvas, w: loaded.width, h: loaded.height, name: loaded.name });
      } catch (err) { toast('تعذّر قراءة الصورة: ' + (f.name || '')); }
    }
    renderThumbs(); updateCTA();
    if (state.frames.length) quickPreAnalyze();
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
      x.onclick = () => { state.frames.splice(i, 1); renderThumbs(); updateCTA(); };
      d.appendChild(x);
      box.appendChild(d);
    });
  }

  function updateCTA() {
    $('startBtn').disabled = !state.frames.length;
    $('preBox').classList.toggle('hidden', !state.frames.length);
  }

  /* تحليل سريع مبكر: تحذيرات الجودة + اكتشاف الأجسام للاختيار */
  async function quickPreAnalyze() {
    const f = state.frames[0];
    if (!f) return;
    $('preWarn').innerHTML = '';
    const img = U.getImageData(f.canvas);
    state.analysis = window.AI3D.Analysis.analyzeImage(img, f.w, f.h);
    if (state.analysis.warnings.length) {
      const box = document.createElement('div');
      box.className = 'warnbox';
      box.innerHTML = '⚠️ ' + state.analysis.warnings.map(w => w.text).join('<br>⚠️ ');
      $('preWarn').appendChild(box);
    }
    renderAnalysisKV();
    // اكتشاف مبكر لاختيار الجسم قبل التشغيل الكامل
    await U.tick(30);
    try {
      state.detection = window.AI3D.Detection.detectObjects(img, f.w, f.h, state.analysis);
    } catch (e) { state.detection = { objects: [] }; }
    renderPreview();
    renderObjList();
  }

  function renderAnalysisKV() {
    const a = state.analysis;
    if (!a) return;
    const q = a.quality;
    $('kvBox').innerHTML =
      kv('الدقة', a.width + '×' + a.height + ' (' + a.megapixels.toFixed(2) + ' MP)') +
      kv('الأبعاد', a.aspect.toFixed(2) + ' : 1') +
      kv('الحدة', pct(a.sharpness)) + kv('التشويش', pct(a.noise)) +
      kv('التباين', pct(a.contrast * 3)) + kv('الإضاءة', pct(a.brightness * 1.4)) +
      kv('اتجاه الضوء', a.light.angle + '° — قوة ' + pct(a.light.strength)) +
      kv('المنظور', a.perspective.tiltHint + ' — انحراف ' + a.perspective.skew.toFixed(2)) +
      kv('الجودة الإجمالية', pct(q.overall));
    function kv(k, v) { return '<dt>' + k + '</dt><dd>' + v + '</dd>'; }
    function pct(v) { return Math.round(window.AI3D.util.clamp01(v) * 100) + '%'; }
  }

  /* ---------------- صور تجريبية مولّدة محليًا ---------------- */
  function addSample(kind) {
    const c = U.makeCanvas(640, 480);
    const x = c.getContext('2d');
    // خلفية متدرجة
    const bg = x.createLinearGradient(0, 0, 640, 480);
    bg.addColorStop(0, '#2b3550'); bg.addColorStop(1, '#1a2030');
    x.fillStyle = bg; x.fillRect(0, 0, 640, 480);
    const glow = x.createRadialGradient(320, 220, 40, 320, 220, 420);
    glow.addColorStop(0, 'rgba(120,150,255,.35)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = glow; x.fillRect(0, 0, 640, 480);
    // أرضية
    x.fillStyle = '#161b28'; x.fillRect(0, 380, 640, 100);
    x.fillStyle = 'rgba(255,255,255,.08)'; x.fillRect(0, 380, 640, 3);

    if (kind === 'bottle') {
      // زجاجة/منتج بتظليل واقعي
      const bx = 320, bw = 150;
      const bodyG = x.createLinearGradient(bx - bw / 2, 0, bx + bw / 2, 0);
      bodyG.addColorStop(0, '#0e5f8a'); bodyG.addColorStop(0.25, '#2fa8dd');
      bodyG.addColorStop(0.5, '#7fd4f7'); bodyG.addColorStop(0.75, '#1d7fb4'); bodyG.addColorStop(1, '#0a3d5c');
      x.fillStyle = bodyG;
      x.beginPath();
      x.moveTo(bx - bw / 2, 380);
      x.lineTo(bx - bw / 2, 190);
      x.quadraticCurveTo(bx - bw / 2, 150, bx - 34, 140);
      x.lineTo(bx - 34, 92); x.lineTo(bx + 34, 92); x.lineTo(bx + 34, 140);
      x.quadraticCurveTo(bx + bw / 2, 150, bx + bw / 2, 190);
      x.lineTo(bx + bw / 2, 380); x.closePath(); x.fill();
      // غطاء
      const capG = x.createLinearGradient(bx - 44, 0, bx + 44, 0);
      capG.addColorStop(0, '#5a6274'); capG.addColorStop(0.5, '#cfd6e6'); capG.addColorStop(1, '#4a5266');
      x.fillStyle = capG;
      x.fillRect(bx - 44, 58, 88, 34);
      x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(bx - 44, 58, 88, 6);
      // ملصق
      x.fillStyle = '#f2f5fb'; x.fillRect(bx - bw / 2 + 16, 230, bw - 32, 110);
      x.fillStyle = '#12324a'; x.font = 'bold 30px Arial'; x.textAlign = 'center';
      x.fillText('AQUA', bx, 272);
      x.fillStyle = '#2fa8dd'; x.font = '15px Arial';
      x.fillText('PURE WATER • 500ml', bx, 300);
      x.strokeStyle = '#12324a'; x.lineWidth = 3; x.strokeRect(bx - bw / 2 + 16, 230, bw - 32, 110);
      // ظل
      x.fillStyle = 'rgba(0,0,0,.35)';
      x.beginPath(); x.ellipse(bx, 388, 110, 14, 0, 0, 7); x.fill();
      // انعكاس لامع
      x.fillStyle = 'rgba(255,255,255,.5)'; x.fillRect(bx - bw / 2 + 22, 200, 12, 170);
    } else {
      // سيارة جانبية مبسطة بتظليل
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
      // نوافذ
      x.fillStyle = '#bcd6ea';
      x.beginPath();
      x.moveTo(225, 245); x.lineTo(395, 245); x.lineTo(435, 288); x.lineTo(190, 288); x.closePath(); x.fill();
      x.fillStyle = 'rgba(255,255,255,.5)';
      x.beginPath(); x.moveTo(250, 245); x.lineTo(300, 245); x.lineTo(270, 288); x.lineTo(225, 288); x.closePath(); x.fill();
      x.strokeStyle = '#3d0a0d'; x.lineWidth = 5;
      x.beginPath(); x.moveTo(310, 245); x.lineTo(310, 288); x.stroke();
      // تفاصيل
      x.fillStyle = '#ffd76a'; x.fillRect(545, 320, 14, 22); // مصباح
      x.fillStyle = '#7a0d11'; x.fillRect(90, 320, 12, 22);
      x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(100, 305, 440, 8);
      x.strokeStyle = '#2b0608'; x.lineWidth = 3;
      x.beginPath(); x.moveTo(310, 295); x.lineTo(310, 375); x.stroke();
      x.fillStyle = '#ddd'; x.fillRect(330, 300, 26, 6); x.fillRect(250, 300, 26, 6);
      // عجلات
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
    renderThumbs(); updateCTA(); quickPreAnalyze();
    toast('تم إنشاء صورة تجريبية محليًا — جاهزة للتحويل');
    document.getElementById('setupSec').scrollIntoView({ behavior: 'smooth' });
  }

  /* ---------------- الإعدادات والتشغيل ---------------- */
  function initSettings() {
    $('startBtn').onclick = startPipeline;
    ['qualitySel', 'texSel', 'geoSel', 'outSel'].forEach(id => {
      $(id).addEventListener('change', () => { if (state.result) toast('ستُطبَّق الإعدادات عند الضغط على "تحسين النموذج"'); });
    });
  }

  function collectOptions() {
    return {
      mode: $('modeSel').value,
      quality: $('qualitySel').value,
      texture: $('texSel').value,
      geometry: $('geoSel').value,
      output: $('outSel').value,
      enhance: $('enhanceSw').checked,
      perspective: $('perspSw').checked,
      selection: state.selection,
      depthScale: parseFloat($('depthRange').value),
      refWidthCm: parseFloat($('refInput').value) || null
    };
  }

  function renderStages(active, doneUpTo) {
    const box = $('stages');
    box.innerHTML = '';
    window.AI3D.Pipeline.STAGES.forEach(s => {
      const d = document.createElement('div');
      d.className = 'stage';
      d.id = 'st-' + s.id;
      d.innerHTML = '<span class="st-ic">○</span><span>' + s.ar + ' <small style="color:var(--faint)">' + s.en + '</small></span>';
      box.appendChild(d);
    });
    if (doneUpTo) markStages(doneUpTo, active);
  }
  function markStages(doneId, activeId) {
    const order = window.AI3D.Pipeline.STAGES.map(s => s.id);
    const di = order.indexOf(doneId), ai = order.indexOf(activeId);
    order.forEach((id, i) => {
      const el = $('st-' + id);
      if (!el) return;
      el.classList.remove('run', 'done');
      const ic = el.querySelector('.st-ic');
      if (i < di || (doneId === 'complete')) { el.classList.add('done'); ic.textContent = '✓'; }
      else if (id === activeId && activeId !== 'complete') { el.classList.add('run'); ic.textContent = '◌'; }
      else ic.textContent = '○';
    });
  }

  async function startPipeline() {
    if (!state.frames.length) { toast('ارفع صورة أولًا'); return; }
    if (state.analysis && state.analysis.blocking) {
      if (!confirm('الصورة غير مناسبة تمامًا (صغيرة جدًا). هل تريد المتابعة على أي حال؟')) return;
    }
    $('startBtn').disabled = true;
    $('errBox').classList.add('hidden');
    $('resultSec').classList.add('hidden');
    renderStages();
    $('pbarFill').style.width = '0%';
    $('pipeCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    const opts = collectOptions();
    try {
      const t0 = performance.now();
      const res = await window.AI3D.Pipeline.runPipeline(state.frames, opts, (stage, pct) => {
        markStages(stage, stage);
        $('pbarFill').style.width = pct + '%';
      });
      res.procMs = performance.now() - t0;
      res.info.processingTime = U.fmtTime(res.procMs);
      state.result = res;
      // عروض التحليل
      renderResultPreviews();
      // العارض
      ensureViewer();
      state.viewer._texCanvas = res.texture;
      state.viewer.setMesh(res.mesh, res.texture);
      if (res.textureSize.w < 10) state.viewer.mode = 'solid';
      renderScores();
      renderInfo();
      renderCompare();
      $('resultSec').classList.remove('hidden');
      $('resultSec').scrollIntoView({ behavior: 'smooth' });
      // حفظ تلقائي في المشاريع
      await saveProject(true);
      toast('اكتمل إنشاء النموذج ثلاثي الأبعاد ✓');
    } catch (err) {
      console.error(err);
      const box = $('errBox');
      box.classList.remove('hidden');
      box.textContent = friendlyError(err);
    } finally {
      $('startBtn').disabled = false;
    }
  }

  function friendlyError(err) {
    const m = String((err && err.message) || err);
    if (/too small|width|height/i.test(m)) return 'الصورة صغيرة جدًا — جرّب صورة أوضح.';
    if (/WebGL/i.test(m)) return 'تعذّر تشغيل العارض ثلاثي الأبعاد: WebGL غير مدعوم في هذا المتصفح.';
    if (/memory|length/i.test(m)) return 'نفدت الذاكرة أثناء المعالجة — جرّب جودة أقل (Low/Medium).';
    return 'حدث خطأ أثناء معالجة النموذج. جرّب صورة أوضح أو جودة أقل. (' + m.slice(0, 120) + ')';
  }

  /* ---------------- المعاينات والأجسام ---------------- */
  function initViewerUI() {
    document.querySelectorAll('#previewTabs .tab').forEach(t => {
      t.onclick = () => {
        document.querySelectorAll('#previewTabs .tab').forEach(x => x.classList.remove('on'));
        t.classList.add('on');
        state.previewTab = t.dataset.tab;
        renderPreview();
      };
    });
    $('allObjBtn').onclick = () => { state.selection = 'all'; renderObjList(); renderPreview(); };
  }

  function renderPreview() {
    const box = $('previewCanvasBox');
    box.innerHTML = '';
    $('bboxLayer').innerHTML = '';
    const f = state.frames[0];
    if (!f) return;
    const tab = state.previewTab;
    const show = c => {
      c.style.maxWidth = '100%';
      box.appendChild(c);
      requestAnimationFrame(drawBboxes);
    };
    if (tab === 'original' || !state.detection) {
      const c = document.createElement('canvas');
      c.width = f.w; c.height = f.h;
      c.getContext('2d').drawImage(f.canvas, 0, 0);
      show(c); return;
    }
    if (tab === 'objects') {
      const c = document.createElement('canvas');
      c.width = f.w; c.height = f.h;
      c.getContext('2d').drawImage(f.canvas, 0, 0);
      show(c); return;
    }
    if (tab === 'mask' && state.result) {
      const s = state.result.segmentation;
      show(window.AI3D.Texture.renderMaskPreview(s.mask, s.w, s.h, state.result.refCanvas));
      return;
    }
    if (tab === 'depth' && state.result) {
      const dp = state.result.depth, s = state.result.segmentation;
      const dw = Math.min(dp.w, 640), dh = Math.round(dw * dp.h / dp.w);
      const dField = window.AI3D.field.resampleField(dp.depth, dp.w, dp.h, dw, dh);
      const mField = window.AI3D.field.resampleField(s.mask, s.w, s.h, dw, dh);
      show(window.AI3D.Texture.renderDepthPreview(dField, mField, dw, dh));
      return;
    }
    // قبل اكتمال التشغيل: اعرض الأصل
    const c = document.createElement('canvas');
    c.width = f.w; c.height = f.h;
    c.getContext('2d').drawImage(f.canvas, 0, 0);
    show(c);
  }

  function drawBboxes() {
    const layer = $('bboxLayer');
    layer.innerHTML = '';
    if (state.previewTab !== 'objects' || !state.detection) return;
    const canvas = $('previewCanvasBox').querySelector('canvas');
    if (!canvas) return;
    const r = canvas.getBoundingClientRect(), pr = $('previewWrap').getBoundingClientRect();
    const ox = r.left - pr.left, oy = r.top - pr.top;
    state.detection.objects.forEach((o, i) => {
      const d = document.createElement('div');
      d.className = 'bbox' + (((state.selection === i) || (state.selection === 'auto' && i === 0)) ? ' sel' : '');
      d.style.right = (ox + o.bbox.x0 * r.width) + 'px';
      // ملاحظة RTL: نستخدم left محسوبًا
      d.style.left = (ox + o.bbox.x0 * r.width) + 'px';
      d.style.right = 'auto';
      d.style.top = (oy + o.bbox.y0 * r.height) + 'px';
      d.style.width = ((o.bbox.x1 - o.bbox.x0) * r.width) + 'px';
      d.style.height = ((o.bbox.y1 - o.bbox.y0) * r.height) + 'px';
      d.innerHTML = '<span>' + (i + 1) + ' • ' + o.typeAr + '</span>';
      d.onclick = () => { state.selection = i; renderObjList(); drawBboxes(); };
      layer.appendChild(d);
    });
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
      const c = document.createElement('div');
      const sel = (state.selection === i) || (state.selection === 'auto' && i === 0);
      c.className = 'objchip' + (sel ? ' sel' : '');
      c.innerHTML = '<b>' + (i + 1) + ' • ' + o.typeAr + '</b><small>ثقة ' + Math.round(o.score * 100) + '% • تغطية ' + Math.round(o.areaRatio * 100) + '%</small>';
      c.onclick = () => { state.selection = i; renderObjList(); drawBboxes(); };
      box.appendChild(c);
    });
    $('allObjBtn').classList.toggle('hidden', det.objects.length < 2);
    $('allObjBtn').classList.toggle('sel', state.selection === 'all');
  }

  function renderResultPreviews() {
    // فعّل تبويبي القناع والعمق
    document.querySelectorAll('#previewTabs .tab').forEach(t => {
      if (t.dataset.tab === 'mask' || t.dataset.tab === 'depth') t.classList.remove('hidden');
    });
  }

  /* ---------------- العارض ---------------- */
  function ensureViewer() {
    if (state.viewer) return;
    state.viewer = new window.AI3DViewer($('gl'));
    const v = state.viewer;
    const segBtns = (ids, fn) => ids.forEach(id => {
      $(id).onclick = () => {
        ids.forEach(x => $(x).classList.remove('on'));
        $(id).classList.add('on');
        fn(id);
      };
    });
    segBtns(['mTex', 'mSolid', 'mWire', 'mXray'], id => {
      v.mode = { mTex: 'texture', mSolid: 'solid', mWire: 'wireframe', mXray: 'xray' }[id];
    });
    segBtns(['lStudio', 'lSoft', 'lDrama', 'lTop'], id => {
      v.lightPreset = { lStudio: 'studio', lSoft: 'soft', lDrama: 'dramatic', lTop: 'top' }[id];
    });
    segBtns(['bDark', 'bLight', 'bBlue', 'bWarm'], id => {
      v.bgPreset = { bDark: 'dark', bLight: 'light', bBlue: 'blue', bWarm: 'warm' }[id];
    });
    $('rotBtn').onclick = () => { v.autoRotate = !v.autoRotate; $('rotBtn').classList.toggle('on', v.autoRotate); };
    $('resetBtn').onclick = () => v.resetCamera();
    $('estBtn').onclick = () => {
      v.showEstimated = !v.showEstimated;
      $('estBtn').classList.toggle('on', v.showEstimated);
      $('estLegend').classList.toggle('show', v.showEstimated);
    };
    $('shotBtn').onclick = () => {
      const a = document.createElement('a');
      a.href = v.screenshot();
      a.download = 'ai3d-view.png';
      a.click();
      toast('تم حفظ لقطة من العارض');
    };
    document.querySelectorAll('[data-view]').forEach(b => { b.onclick = () => v.setView(b.dataset.view); });
  }

  /* ---------------- الدرجات والمعلومات ---------------- */
  function renderScores() {
    const s = state.result.scores;
    $('scores').innerHTML =
      score(s.overall, 'الجودة الإجمالية', true) +
      score(s.geometry, 'الهندسة') + score(s.texture, 'الـ Texture') +
      score(s.integrity, 'سلامة الشبكة') + score(s.depth, 'ثقة العمق') +
      '<div class="hint" style="grid-column:1/-1">ℹ️ ' + s.disclaimer + '</div>';
    function score(v, k, hero) {
      return '<div class="score' + (hero ? ' hero-score' : '') + '"><b>' + v + '%</b><span>' + k + '</span></div>';
    }
  }

  function renderInfo() {
    const r = state.result, i = r.info, st = r.stats;
    const dims = dimsText();
    $('infoBox').innerHTML =
      kv('اسم النموذج', 'AI3D_' + Date.now().toString(36)) +
      kv('نوع الجسم', i.objectLabel) +
      kv('الرؤوس', fmtN(st.vertices)) + kv('الوجوه', fmtN(st.faces)) +
      kv('دقة الـ Texture', i.textureResolution) +
      kv('الخامة المقدّرة', r.material.materialAr + ' — خشونة ' + r.material.roughness + ' / معدنية ' + r.material.metallic + (r.material.transparency > 0 ? ' / شفافية ' + r.material.transparency : '')) +
      kv('زمن المعالجة', i.processingTime) +
      kv('الأبعاد', dims) +
      kv('الهندسة المرصودة', Math.round(st.observedRatio * 100) + '% مرصودة / ' + Math.round((1 - st.observedRatio) * 100) + '% مُستنتَجة') +
      '<div class="hint" style="grid-column:1/-1">⚠️ ' + i.estimatedNotice + '</div>';
    function kv(k, v) { return '<dt>' + k + '</dt><dd>' + v + '</dd>'; }
    function fmtN(n) { return Math.round(n).toLocaleString('en'); }
  }

  function dimsText() {
    const r = state.result;
    const b = r.stats.bounds.size;
    const ref = parseFloat($('refInput').value);
    if (ref && ref > 0) {
      // تحجيم تقديري: اعرض النسبة + المرجع
      const wCm = ref, hCm = ref * (b[1] / Math.max(1e-6, b[0])), dCm = ref * (b[2] / Math.max(1e-6, b[0]));
      return wCm.toFixed(1) + ' × ' + hCm.toFixed(1) + ' × ' + dCm.toFixed(1) + ' سم (تقديري بمرجع ' + ref + ' سم)';
    }
    const wu = parseFloat($('dimW').value), hu = parseFloat($('dimH').value), du = parseFloat($('dimD').value);
    if (wu || hu || du) {
      return (wu || b[0]).toFixed(2) + ' × ' + (hu || b[1]).toFixed(2) + ' × ' + (du || b[2]).toFixed(2) + ' وحدة (مخصصة/تقديرية)';
    }
    return b[0].toFixed(2) + ' × ' + b[1].toFixed(2) + ' × ' + b[2].toFixed(2) + ' وحدة (تقديرية)';
  }

  /* ---------------- المقارنة ---------------- */
  function initCompare() {
    $('cmpRange').addEventListener('input', e => {
      $('cmpAfter').style.width = (100 - parseFloat(e.target.value)) + '%';
    });
  }
  function renderCompare() {
    const r = state.result;
    $('cmpBefore').src = r.refCanvas.toDataURL('image/jpeg', 0.85);
    // لقطة حالية من العارض كصورة "بعد"
    setTimeout(() => {
      try { $('cmpAfterImg').src = state.viewer.screenshot(); }
      catch (e) { $('cmpAfterImg').src = ''; }
    }, 600);
    $('cmpRefresh').onclick = () => {
      try { $('cmpAfterImg').src = state.viewer.screenshot(); toast('تم تحديث لقطة المقارنة'); }
      catch (e) { toast('تعذّر أخذ لقطة'); }
    };
  }

  /* ---------------- أدوات الشبكة ---------------- */
  function initMeshTools() {
    const upd = () => {
      if (!state.result) return;
      const G = window.AI3D.Geometry;
      const m = state.result.mesh;
      // ملاحظة: التحجيم/التدوير تراكمي — نطبّق الفرق فقط عبر إعادة الضبط من نسخة؟ للتبسيط: تطبيق مباشر تراكمي مع زر توسيط
      G.transformMesh(m, {
        scale: [1, 1, 1],
        rotate: [0, 0, 0],
        translate: [0, 0, 0]
      });
    };
    $('scaleRange').addEventListener('input', e => { $('scaleVal').textContent = e.target.value + '×'; });
    $('scaleRange').addEventListener('change', e => {
      if (!state.result) return;
      const s = parseFloat(e.target.value);
      window.AI3D.Geometry.transformMesh(state.result.mesh, { scale: [s, s, s] });
      state.viewer.updatePositions(state.result.mesh);
      renderInfo();
      e.target.value = 1; $('scaleVal').textContent = '1×';
    });
    $('rotYRange').addEventListener('change', e => {
      if (!state.result) return;
      window.AI3D.Geometry.transformMesh(state.result.mesh, { rotate: [0, parseFloat(e.target.value) * Math.PI / 180, 0] });
      state.viewer.updatePositions(state.result.mesh);
      e.target.value = 0; $('rotYVal').textContent = '0°';
    });
    $('rotYRange').addEventListener('input', e => { $('rotYVal').textContent = e.target.value + '°'; });
    $('centerBtn').onclick = () => {
      if (!state.result) return;
      window.AI3D.Geometry.centerMesh(state.result.mesh);
      state.viewer.updatePositions(state.result.mesh);
      toast('تم توسيط النموذج');
    };
    $('normalsBtn').onclick = () => {
      if (!state.result) return;
      const m = state.result.mesh;
      m.normals = window.AI3D.Geometry.computeNormals(m.positions, m.indices);
      state.viewer.updatePositions(m);
      toast('تمت إعادة حساب الـ Normals');
    };
    $('smoothBtn').onclick = () => {
      if (!state.result) return;
      window.AI3D.Geometry.smoothMesh(state.result.mesh, 2, 0.4);
      state.viewer.refreshMesh(state.result.mesh, state.result.texture);
      state.result.stats = window.AI3D.Geometry.meshStats(state.result.mesh);
      renderInfo();
      toast('تم تنعيم النموذج');
    };
    $('decimateBtn').onclick = () => {
      if (!state.result) return;
      const ratio = parseFloat($('decimateSel').value);
      state.result.mesh = window.AI3D.Geometry.decimateMesh(state.result.mesh, ratio);
      state.viewer.refreshMesh(state.result.mesh, state.result.texture);
      state.result.stats = window.AI3D.Geometry.meshStats(state.result.mesh);
      renderInfo();
      toast('تم تبسيط الشبكة (احتفاظ ~' + Math.round(ratio * 100) + '%)');
    };
    $('repairBtn').onclick = () => {
      if (!state.result) return;
      state.result.mesh = window.AI3D.Geometry.repairMesh(state.result.mesh);
      state.viewer.refreshMesh(state.result.mesh, state.result.texture);
      state.result.stats = window.AI3D.Geometry.meshStats(state.result.mesh);
      renderInfo();
      toast('تم إصلاح الشبكة');
    };
    $('delEstBtn').onclick = () => {
      if (!state.result) return;
      if (!confirm('سيتم حذف الأجزاء المُستنتَجة (الظهر/الجوانب) والاحتفاظ بالهندسة المرصودة فقط. متابعة؟')) return;
      state.result.mesh = window.AI3D.Geometry.removeEstimated(state.result.mesh);
      state.viewer.refreshMesh(state.result.mesh, state.result.texture);
      state.result.stats = window.AI3D.Geometry.meshStats(state.result.mesh);
      renderInfo();
      toast('تم حذف الأجزاء المُستنتَجة');
    };
    $('delIsoBtn').onclick = () => {
      if (!state.result) return;
      state.result.mesh = window.AI3D.Geometry.removeIsolated(state.result.mesh, 0.02);
      state.viewer.refreshMesh(state.result.mesh, state.result.texture);
      state.result.stats = window.AI3D.Geometry.meshStats(state.result.mesh);
      renderInfo();
      toast('تم حذف الأجزاء المنفصلة الصغيرة');
    };
    $('improveBtn').onclick = async () => {
      if (!state.result) return;
      // إعادة بناء بإعدادات أعلى
      const order = ['low', 'medium', 'high', 'ultra'];
      const cur = $('qualitySel').value;
      const next = order[Math.min(order.length - 1, order.indexOf(cur) + 1)];
      $('qualitySel').value = next;
      if ($('geoSel').value === 'fast') $('geoSel').value = 'balanced';
      toast('إعادة بناء بجودة ' + next + '...');
      await startPipeline();
    };
    $('reDimBtn').onclick = () => { if (state.result) { renderInfo(); toast('تم تحديث الأبعاد التقديرية'); } };
  }

  /* ---------------- التصدير ---------------- */
  function initExport() {
    $('expMain').onclick = async () => {
      if (!state.result) return;
      const fmt = $('outSel').value;
      toast('جارٍ تجهيز ملف ' + fmt.toUpperCase() + '...');
      await U.tick(50);
      try {
        const r = state.result;
        const name = 'ai3d-model';
        if (fmt === 'glb') {
          const blob = await window.AI3D.Exporters.exportGLB(r.mesh, r.texture, r.material);
          U.downloadBlob(blob, name + '.glb');
        } else if (fmt === 'obj') {
          const { obj, mtl } = window.AI3D.Exporters.exportOBJ(r.mesh, name);
          U.downloadBlob(obj, name + '.obj');
          setTimeout(() => U.downloadBlob(mtl, name + '.mtl'), 400);
          setTimeout(() => r.texture.toBlob(b => U.downloadBlob(b, name + '_texture.png'), 'image/png'), 800);
        } else if (fmt === 'stl') {
          U.downloadBlob(window.AI3D.Exporters.exportSTL(r.mesh), name + '.stl');
        } else if (fmt === 'ply') {
          U.downloadBlob(window.AI3D.Exporters.exportPLY(r.mesh, r.texture), name + '.ply');
        }
        toast('تم تنزيل النموذج ✓');
      } catch (e) { console.error(e); toast('تعذّر التصدير — جرّب صيغة أخرى'); }
    };
    $('expTex').onclick = () => {
      if (!state.result) return;
      state.result.texture.toBlob(b => U.downloadBlob(b, 'ai3d-texture.png'), 'image/png');
    };
    $('expZip').onclick = async () => {
      if (!state.result) return;
      toast('جارٍ تجهيز حزمة المشروع...');
      await U.tick(50);
      try {
        const r = state.result;
        const name = 'ai3d-model';
        const glb = await window.AI3D.Exporters.exportGLB(r.mesh, r.texture, r.material);
        const { obj, mtl } = window.AI3D.Exporters.exportOBJ(r.mesh, name);
        const texBlob = await new Promise(res => r.texture.toBlob(res, 'image/png'));
        const origBlob = await new Promise(res => r.refCanvas.toBlob(res, 'image/jpeg', 0.9));
        // صور التصحيح
        const dp = r.depth, s = r.segmentation;
        const dw = Math.min(dp.w, 512), dh = Math.round(dw * dp.h / dp.w);
        const depthC = window.AI3D.Texture.renderDepthPreview(
          window.AI3D.field.resampleField(dp.depth, dp.w, dp.h, dw, dh),
          window.AI3D.field.resampleField(s.mask, s.w, s.h, dw, dh), dw, dh);
        const maskC = window.AI3D.Texture.renderMaskPreview(
          window.AI3D.field.resampleField(s.mask, s.w, s.h, dw, dh), dw, dh, null);
        const depthBlob = await new Promise(res => depthC.toBlob(res, 'image/png'));
        const maskBlob = await new Promise(res => maskC.toBlob(res, 'image/png'));
        const zip = await window.AI3D.Exporters.exportProjectZIP({
          name, settings: r.options, scores: r.scores, info: r.info, material: r.material,
          modelGLB: glb, modelOBJ: { obj, mtl }, texturePNG: texBlob,
          originalJPG: origBlob, depthPNG: depthBlob, maskPNG: maskBlob
        });
        U.downloadBlob(zip, name + '-project.zip');
        toast('تم تنزيل حزمة المشروع ✓');
      } catch (e) { console.error(e); toast('تعذّر تجهيز الحزمة'); }
    };
  }

  /* ---------------- المشاريع (تخزين محلي) ---------------- */
  const LS_KEY = 'ai3d-projects-v1';
  function getProjects() {
    try { return JSON.parse(store.get(LS_KEY) || '[]'); } catch (e) { return []; }
  }
  function setProjects(p) {
    try { store.set(LS_KEY, JSON.stringify(p)); } catch (e) { toast('مساحة التخزين المحلي ممتلئة'); }
  }
  function initProjects() {
    renderProjects();
    $('saveProjBtn').onclick = () => saveProject(false);
  }
  async function saveProject(auto) {
    if (!state.result) { if (!auto) toast('لا يوجد نموذج لحفظه'); return; }
    const r = state.result;
    const projs = getProjects();
    const name = ($('projName').value || '').trim() || ('نموذج ' + (projs.length + 1));
    // مصغّرة صغيرة فقط في localStorage (النموذج الكامل يُعاد بناؤه عند الحاجة)
    const thumb = document.createElement('canvas');
    thumb.width = 320; thumb.height = 200;
    const tctx = thumb.getContext('2d');
    tctx.fillStyle = '#101623'; tctx.fillRect(0, 0, 320, 200);
    try {
      const img = new Image();
      img.src = state.viewer.screenshot();
      await new Promise(res => { img.onload = res; img.onerror = res; });
      tctx.drawImage(img, 0, 0, 320, 200);
    } catch (e) {}
    const entry = {
      id: 'p' + Date.now().toString(36),
      name,
      date: new Date().toLocaleString('ar'),
      scores: r.scores, info: { objectLabel: r.info.objectLabel, vertices: r.info.vertices, faces: r.info.faces },
      settings: r.options,
      thumb: thumb.toDataURL('image/jpeg', 0.6)
    };
    // حدّ أقصى 12 مشروعًا (localStorage محدود)
    projs.unshift(entry);
    while (projs.length > 12) projs.pop();
    setProjects(projs);
    renderProjects();
    if (!auto) toast('تم حفظ المشروع محليًا ✓');
  }
  function renderProjects() {
    const projs = getProjects();
    const box = $('projGrid');
    box.innerHTML = '';
    if (!projs.length) {
      box.innerHTML = '<div class="empty">لا توجد مشاريع بعد — سيُحفظ كل نموذج تنشئه هنا تلقائيًا على جهازك.</div>';
      return;
    }
    projs.forEach(p => {
      const d = document.createElement('div');
      d.className = 'proj';
      d.innerHTML = '<img src="' + p.thumb + '" alt=""><div class="pb"><b></b><small></small></div><div class="pa"></div>';
      d.querySelector('b').textContent = p.name;
      d.querySelector('small').textContent = p.date + ' • ' + (p.scores ? p.scores.overall + '%' : '');
      const del = document.createElement('button');
      del.className = 'btn btn-ghost btn-sm'; del.textContent = 'حذف';
      del.onclick = () => {
        if (!confirm('حذف المشروع "' + p.name + '"؟')) return;
        setProjects(getProjects().filter(x => x.id !== p.id));
        renderProjects();
      };
      d.querySelector('.pa').appendChild(del);
      box.appendChild(d);
    });
  }
})();
