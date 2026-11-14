/* حركة العرض فقط: لا يغيّر ردود البوت أو صلاحياته. يستضيف نفس شخصية رحيق،
 * ويحترم إعداد المدير، إيقاف البوت، وتفضيل تقليل الحركة في الجهاز.
 *
 * الشكل هو الشكل الأصلي ثنائي الأبعاد (صور assets/yaseen/*.webp) — لا WebGL
 * ولا محركات خارجية. فوق الشكل تتحرك طبقة حركات كثيرة بأنماط CSS: مشي وركض
 * بانتقال فعلي على الشاشة، قفز، رقص، دوران، شقلبة، نطّة، أرجحة، تمدد، طفو،
 * دوخة، إيماءة «نعم» وهزّ رأس «لا»، مع التعابير الأصلية (تلويح، إشارة،
 * تفكير، قلق، احتفال) باستخدام إطارات الصور نفسها. */
(function () {
  'use strict';

  /* الأزرار التسعة عشر في لوحة الحركات */
  var LABELS = [
    ['idle', 'استراحة'], ['walk', 'مشي'], ['run', 'ركض'], ['jump', 'قفز'],
    ['dance', 'رقص'], ['spin', 'دوران'], ['flip', 'شقلبة'], ['bounce', 'نطّة'],
    ['swing', 'أرجحة'], ['stretch', 'تمدد'], ['float', 'طفو'], ['dizzy', 'دوخة'],
    ['nod', 'أيوة'], ['shake', 'لا'], ['wave', 'تلويح'], ['point', 'إشارة'],
    ['thinking', 'تفكير'], ['worried', 'قلق'], ['celebrate', 'احتفال']
  ];

  /* حركات انتقال: تمشي/تركض فعلًا عبر الشاشة */
  var TRAVEL = { walk: true, run: true };

  /* تعابير بإطارات الصور الأصلية: الحركة تبدّل الإطار فترة قصيرة + لمسة CSS
     (نفس ترتيب POSES في js/yaseen.js حتى نجد الإطار بالرقم) */
  var POSES = ['idle', 'blink', 'talk', 'wave', 'point', 'worried', 'thinking', 'celebrate'];
  var FRAME_ACTIONS = {
    wave: { frame: 'wave', ms: 2600, cls: 'm-lean' },
    point: { frame: 'point', ms: 2400, cls: 'm-lean' },
    thinking: { frame: 'thinking', ms: 2800, cls: 'm-lean' },
    worried: { frame: 'worried', ms: 2600, cls: 'm-shiver' },
    celebrate: { frame: 'celebrate', ms: 3000, cls: 'm-hop' }
  };

  /* حركات الجسم كأنماط CSS على الشخصية، ومدة كل حركة بالمللي ثانية */
  var CLASS_ACTIONS = {
    jump: 1900, dance: 3400, spin: 1600, flip: 1800, bounce: 1500,
    swing: 2700, stretch: 2150, float: 2750, dizzy: 2250, nod: 1550, shake: 1550
  };

  /* عجلة الحركات التلقائية: أوزان حتى تتنوع الحركات ولا تتكرر الحركة نفسها */
  var AUTO_POOL = ['dance', 'spin', 'jump', 'float', 'bounce', 'swing', 'stretch', 'nod', 'shake', 'dizzy', 'flip', 'wave', 'thinking', 'celebrate', 'walk'];
  var AUTO_EVERY_MS = 11000;   // كم مرة نجرّب التشغيل التلقائي
  var AUTO_IDLE_MS = 9000;     // لا نتحرك تلقائيًا إلا بعد هدوء ولي الأمر قليلًا

  var ICONS = {
    idle: 'M5 11h12v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4v-6zm12 1h2a3 3 0 0 1 0 6h-2M8 3v4m4-4v4m4-4v4',
    walk: 'M13 4a2 2 0 1 0 0 .01M11 8l-2 5 4 3 2 5M9 13l-3 3-2 5M11 8l4 4h4M11 8l-4 3',
    run: 'M15 4a2 2 0 1 0 0 .01M13 8l-3 5 4 3 1 5M10 13l-4 4H3M13 8l4 3h3M13 8l-5 2-2 3M3 8h4M2 12h3',
    jump: 'M12 3a2 2 0 1 0 0 .01M12 7v7m0-5l-5-4m5 4l5-4m-5 9l-4 6m4-6l4 6M3 22h18',
    dance: 'M12 3a2 2 0 1 0 0 .01M12 7v7m0-5l-5-3-2-3m7 6l5-3 2-3m-7 11l-5 6m5-6l5 6M3 12v4m18-4v4',
    spin: 'M20 8a8 8 0 1 0 1 7M20 3v5h-5M12 8a2 2 0 1 0 0 .01M12 12v5',
    flip: 'M4 14a8 8 0 1 1 2 6M4 14l-2-2m2 2l3-1m-1 8l2 1m7-18l-1 2m8 6l-2 1',
    bounce: 'M12 3v5m-3-2l3 3 3-3M12 21v-5m-3 2l3-3 3 3M6 12a6 6 0 0 1 12 0',
    swing: 'M12 3a2 2 0 1 0 0 .01M12 7v8m0 0l6 5m-6-5l-6 5M5 20l-2 1M19 20l2 1',
    stretch: 'M12 3a2 2 0 1 0 0 .01M12 7v8m0-6L7 6 5 3m7 6l5-3 2-3m-7 12l-4 6m4-6l4 6',
    float: 'M12 2a6 6 0 0 1 6 6c0 4-3 7-6 8-3-1-6-4-6-8a6 6 0 0 1 6-6zm0 14v3l-2 3h4l-2-3M3 10H1m22 0h-2',
    dizzy: 'M12 4a8 8 0 1 0 8 8 6 6 0 0 1-6 6 4 4 0 0 1-4-4 2.5 2.5 0 0 1 5 0M4 4l1 2m14-2l-1 2',
    nod: 'M12 3a2 2 0 1 0 0 .01M12 7v4m-3 0l3 3 3-3M8 20l4 1 4-1M9 17l3 3 3-3',
    shake: 'M12 3a2 2 0 1 0 0 .01M12 7v6M6 12l-3 1 3 1m12-2l3 1-3 1M9 20l3-3 3 3',
    wave: 'M8 13V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v7c0 4-3 6-6 6-2 0-4-1-5-3l-4-5a1.5 1.5 0 0 1 2-2l1 1',
    point: 'M3 12h17m-5-5l5 5-5 5M4 8v8',
    thinking: 'M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 4H9c0-2 0-3-1-4M12 6v3l2 1',
    worried: 'M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9M9 10h.01M15 10h.01M9 15c1-1 2-1 3 0s2 1 3 0',
    celebrate: 'M5 9l-3 13 13-5L5 9zm5 0a3 3 0 0 1 3-3m2 7a3 3 0 0 1 3-3M14 3v3m5 1l2-2m-1 9h3M7 3l1 2'
  };

  function icon(name) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICONS[name] || ICONS.idle); svg.appendChild(path); return svg;
  }
  function node(tag, cls, text) {
    var n = document.createElement(tag); if (cls) n.className = cls;
    if (text != null) n.textContent = text; return n;
  }

  function mount(opts) {
    var mascot = opts.mascot, charBtn = opts.charBtn, root = opts.root;
    var scenes = charBtn.querySelectorAll('.ysn-f');    // إطارات الصور الأصلية بنفس ترتيب POSES
    var cfg = {}, dead = false, paused = false, reduced = false, held = false;
    var raf = 0, actionTimer = 0, fxTimer = 0, frameTimer = 0, autoTimer = 0, lastAuto = '';
    var x = 0, y = 0, dragged = false, suppressClick = false;
    var cleanups = [];
    function listen(target, type, fn, options) { target.addEventListener(type, fn, options); cleanups.push(function () { target.removeEventListener(type, fn, options); }); }
    try { paused = localStorage.getItem('yaseen_motion_paused') === '1'; } catch (e) {}
    var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    reduced = !!(mq && mq.matches);

    /* من يستطيع التحرّك؟ إعداد المدير أولًا */
    function allowed(name) {
      if (name === 'idle') return true;
      if (name === 'wave') return cfg.wave !== false;
      if (name === 'point') return cfg.point !== false;
      if (name === 'thinking' || name === 'worried' || name === 'celebrate') return cfg.expressions !== false;
      return cfg[name] !== false;
    }
    function mayMove() {
      return !dead && !paused && !reduced && !held && !document.hidden &&
        !root.classList.contains('is-chat-open') &&
        !document.body.classList.contains('raheeq-intro-lock') &&
        !document.querySelector('.modal:not([hidden]),.settings:not([hidden]),.doc-modal:not([hidden])');
    }
    function bounds() {
      var w = charBtn.getBoundingClientRect().width || 96, h = charBtn.getBoundingClientRect().height || 128;
      var left = parseFloat(getComputedStyle(mascot).left) || 14;
      var bottom = parseFloat(getComputedStyle(mascot).bottom) || 14;
      return { minX: 8 - left, maxX: Math.max(8 - left, innerWidth - w - left - 8), minY: 8 - (innerHeight - bottom - h), maxY: 0 };
    }
    function position(nx, ny) {
      var b = bounds(); x = Math.max(b.minX, Math.min(b.maxX, nx)); y = Math.max(b.minY, Math.min(b.maxY, ny));
      mascot.style.translate = x.toFixed(1) + 'px ' + y.toFixed(1) + 'px';
      mascot.classList.toggle('is-at-right', x > b.maxX / 2);
    }

    /* إطفاء أي حركة جارية قبل حركة جديدة أو عند الإيقاف */
    function clearFx() {
      clearTimeout(fxTimer); fxTimer = 0;
      mascot.className.split(/\s+/).forEach(function (c) { if (c.indexOf('m-') === 0) mascot.classList.remove(c); });
    }
    function runFx(cls, ms, done) {
      clearFx();
      if (cls) mascot.classList.add(cls);
      fxTimer = setTimeout(function () { fxTimer = 0; if (cls) mascot.classList.remove(cls); if (done && !dead) done(); }, ms);
    }

    /* تعابير الصور: إظهار إطار معيّن (موجة/تفكير/احتفال…) ثم الرجوع لما كان ظاهرًا */
    function showFrame(name, ms) {
      var idx = POSES.indexOf(name);
      if (idx < 0 || !scenes[idx]) return;
      var prev = charBtn.querySelector('.ysn-f.is-on');
      for (var i = 0; i < scenes.length; i++) scenes[i].classList.remove('is-on');
      scenes[idx].classList.add('is-on');
      clearTimeout(frameTimer);
      frameTimer = setTimeout(function () {
        scenes[idx].classList.remove('is-on');
        (prev && prev !== scenes[idx] ? prev : scenes[0]).classList.add('is-on');
      }, ms);
    }

    function stopTravel() { cancelAnimationFrame(raf); raf = 0; }
    function travel(tx, ty, mode, done) {
      stopTravel();
      if (!mayMove() || !allowed(mode)) { if (done) done(); return; }
      var sx = x, sy = y, distance = Math.hypot(tx - sx, ty - sy);
      if (distance < 3) { if (done) done(); return; }
      var duration = Math.max(650, distance / (mode === 'run' ? .48 : .16)), start = performance.now();
      mascot.classList.toggle('is-flip', tx < sx);   // الوجه يتبع اتجاه السير
      mascot.classList.add(mode === 'run' ? 'is-running' : 'is-walking');
      function finish() {
        stopTravel();
        mascot.classList.remove('is-running', 'is-walking', 'is-flip');
        if (done && !dead) done();
      }
      function tick(now) {
        if (!mayMove() || !allowed(mode)) { finish(); return; }
        var p = Math.min(1, (now - start) / duration), ease = p * p * (3 - 2 * p);
        position(sx + (tx - sx) * ease, sy + (ty - sy) * ease);
        if (p < 1) raf = requestAnimationFrame(tick); else finish();
      }
      raf = requestAnimationFrame(tick);
    }
    function goSide(mode, then) {
      var b = bounds(), target = x > (b.minX + b.maxX) / 2 ? b.minX : b.maxX;
      travel(target, 0, mode, then);
    }
    function home() { dragged = false; stopTravel(); clearFx(); position(0, 0); }

    function act(name, automatic) {
      if (dead || !allowed(name) || (automatic && !mayMove())) return;
      if (!automatic) {
        clearTimeout(actionTimer); stopTravel();
        if (opts.onAction) opts.onAction();
      }
      if (reduced || paused) return;
      if (TRAVEL[name]) {
        goSide(name, automatic ? function () { actionTimer = setTimeout(home, 1600); } : null);
      } else if (FRAME_ACTIONS[name]) {
        var p = FRAME_ACTIONS[name];
        showFrame(p.frame, p.ms);
        runFx(p.cls, Math.min(p.ms, 1600));
      } else if (CLASS_ACTIONS[name]) {
        runFx('m-' + name, CLASS_ACTIONS[name]);
      } else {
        clearFx();
      }
      if (!automatic) {
        panel.querySelectorAll('[data-motion]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.motion === name)); });
        status.textContent = 'الحركة: ' + (LABELS.filter(function (l) { return l[0] === name; })[0] || LABELS[0])[1];
      }
    }

    /* العجلة التلقائية: حركات كثيرة ومتنوعة طالما ولي الأمر هادئ ولا شيء مفتوح */
    function autoplay() {
      if (!mayMove() || dragged || held || cfg.roam === false || opts.busy()) return;
      if (Date.now() - opts.lastActivity() < AUTO_IDLE_MS) return;
      var pool = AUTO_POOL.filter(function (name) { return allowed(name) && name !== lastAuto; });
      if (!pool.length) return;
      if (innerWidth < 640) pool = pool.filter(function (n) { return !TRAVEL[n]; });
      if (!pool.length) return;
      var pick = pool[Math.floor(Math.random() * pool.length)];
      lastAuto = pick;
      status.textContent = 'الحركة: ' + (LABELS.filter(function (l) { return l[0] === pick; })[0] || LABELS[0])[1];
      act(pick, true);
    }

    /* ---------------- لوحة الحركات ---------------- */
    var launcher = node('button', 'ysn-motion-launch', 'حركات رحيق'); launcher.prepend(icon('celebrate')); launcher.type = 'button';
    launcher.setAttribute('aria-expanded', 'false'); launcher.setAttribute('aria-controls', 'ysnMotionPanel');
    var panel = node('section', 'ysn-motion-panel'); panel.id = 'ysnMotionPanel'; panel.hidden = true;
    panel.setAttribute('aria-label', 'حركات رحيق الكثيرة');
    var heading = node('strong', '', 'خلّينا نتحرّك!');
    var close = node('button', 'ysn-motion-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'إغلاق لوحة الحركات');
    var head = node('div', 'ysn-motion-head'); head.appendChild(heading); head.appendChild(close); panel.appendChild(head);
    panel.appendChild(node('p', 'ysn-motion-hint', 'كان نفسك تلعب؟ عندك ' + LABELS.length + ' حركة — اختَر أي واحدة، أو اسحب رحيق لمكان آخر.'));
    var grid = node('div', 'ysn-motion-grid');
    LABELS.forEach(function (item) {
      var b = node('button', 'ysn-motion-choice'); b.type = 'button'; b.dataset.motion = item[0];
      b.setAttribute('aria-pressed', 'false'); b.appendChild(icon(item[0])); b.appendChild(node('span', '', item[1]));
      listen(b, 'click', function () { act(item[0], false); }); grid.appendChild(b);
    });
    panel.appendChild(grid);
    var tools = node('div', 'ysn-motion-tools');
    var pause = node('button', '', 'إيقاف الحركة'); pause.type = 'button';
    var reset = node('button', '', 'العودة للمكان'); reset.type = 'button';
    tools.appendChild(pause); tools.appendChild(reset); panel.appendChild(tools);
    var status = node('p', 'ysn-motion-status', 'الحركة: استراحة'); status.setAttribute('role', 'status'); panel.appendChild(status);
    root.appendChild(launcher); root.appendChild(panel);

    function show(open) { panel.hidden = !open; launcher.setAttribute('aria-expanded', String(open)); if (open) { var first = panel.querySelector('button:not(:disabled)'); if (first) first.focus({ preventScroll: true }); } }
    listen(launcher, 'click', function () { show(panel.hidden); });
    listen(close, 'click', function () { show(false); launcher.focus({ preventScroll: true }); });
    listen(panel, 'keydown', function (e) { if (e.key === 'Escape') { show(false); launcher.focus(); } });
    listen(reset, 'click', function () { home(); act('idle', false); });

    function renderPause() {
      pause.textContent = reduced ? 'تقليل الحركة مفعّل' : paused ? 'تشغيل الحركة' : 'إيقاف الحركة';
      pause.setAttribute('aria-pressed', String(paused || reduced)); pause.disabled = reduced;
      root.classList.toggle('is-motion-paused', paused || reduced);
    }
    listen(pause, 'click', function () { paused = !paused; try { localStorage.setItem('yaseen_motion_paused', paused ? '1' : '0'); } catch (e) {} if (paused) { stopTravel(); home(); } renderPause(); });
    if (mq) listen(mq, 'change', function (e) { reduced = e.matches; if (reduced) { stopTravel(); home(); } renderPause(); });
    renderPause();

    /* ---------------- السحب بحرّية (عرض فقط، ولا يفتح المحادثة بالخطأ) ---------------- */
    var drag = null;
    listen(charBtn, 'pointerdown', function (e) {
      if (e.button !== 0 || paused || reduced) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: x, oy: y, moved: false };
    });
    listen(charBtn, 'pointermove', function (e) {
      if (!drag || drag.id !== e.pointerId) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 7) return;
      if (!drag.moved) { drag.moved = true; stopTravel(); clearFx(); try { charBtn.setPointerCapture(e.pointerId); } catch (err) {} mascot.classList.add('m-drag'); }
      e.preventDefault(); dragged = true; position(drag.ox + dx, drag.oy + dy);
    });
    function endDrag(e) {
      if (!drag || drag.id !== e.pointerId) return;
      suppressClick = drag.moved; drag = null; mascot.classList.remove('m-drag');
      if (suppressClick) setTimeout(function () { suppressClick = false; }, 0);
    }
    listen(charBtn, 'pointerup', endDrag); listen(charBtn, 'pointercancel', endDrag);
    listen(charBtn, 'click', function (e) { if (suppressClick) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    listen(charBtn, 'keydown', function (e) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) < 0 || paused || reduced) return;
      e.preventDefault(); dragged = true; stopTravel();
      position(x + (e.key === 'ArrowLeft' ? -20 : e.key === 'ArrowRight' ? 20 : 0), y + (e.key === 'ArrowUp' ? -20 : e.key === 'ArrowDown' ? 20 : 0));
    });
    listen(window, 'resize', function () { position(x, y); });
    listen(document, 'visibilitychange', function () { if (document.hidden) { stopTravel(); clearTimeout(actionTimer); } });

    autoTimer = setInterval(autoplay, AUTO_EVERY_MS);

    /* ---------------- الواجهة التي يستخدمها js/yaseen.js ---------------- */
    function configure(value) {
      cfg = value || {};
      panel.querySelectorAll('[data-motion]').forEach(function (b) { b.disabled = !allowed(b.dataset.motion); });
      if (cfg.roam === false) { stopTravel(); clearTimeout(actionTimer); }
      lastAuto = '';
    }
    return {
      configure: configure,
      action: act,
      /* js/yaseen.js نفسه يبدّل إطارات الصور؛ هنا نكتفي بلمسة خفيفة للاحتفال */
      pose: function (name, ms) { if (name === 'celebrate' && mayMove() && allowed('jump')) runFx('m-hop', ms || 1900); },
      hold: function (value) { held = !!value; if (held) { stopTravel(); clearTimeout(actionTimer); } },
      home: home,
      close: function () { show(false); },
      /* الثنائي الأبعاد يرمش ويحرّك فمه من js/yaseen.js ذاته — لا حاجة لتدخل هنا */
      talking: function () {},
      blink: function () {},
      destroy: function () {
        dead = true; stopTravel(); clearTimeout(actionTimer); clearTimeout(fxTimer); clearTimeout(frameTimer); clearInterval(autoTimer);
        cleanups.forEach(function (fn) { fn(); });
        launcher.remove(); panel.remove();
        clearFx();
        mascot.style.translate = ''; mascot.classList.remove('is-at-right', 'is-flip', 'is-walking', 'is-running', 'm-drag');
      }
    };
  }
  window.RaheeqMotion = { mount: mount };
})();
