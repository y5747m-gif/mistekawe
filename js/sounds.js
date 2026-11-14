/* ============================================================
   رحيق RAHEEQ — محرك الأصوات
   ملفات MP3 حقيقية من مجلد /sounds/ + Web Audio API كبديل
   التحميل المسبق عند فتح الصفحة، والتشغيل عند تفاعل المستخدم فقط
   ============================================================ */
(function () {
  'use strict';

  var DEFS = {
    click:   { file: 'sounds/click.mp3',   vol: 0.3 },
    hover:   { file: 'sounds/hover.mp3',   vol: 0.1 },
    typing:  { file: 'sounds/typing.mp3',  vol: 0.05 },
    success: { file: 'sounds/success.mp3', vol: 0.6 },
    error:   { file: 'sounds/error.mp3',   vol: 0.5 },
    step:    { file: 'sounds/step.mp3',    vol: 0.4 },
    upload:  { file: 'sounds/upload.mp3',  vol: 0.4 },
    toggle:  { file: 'sounds/toggle.mp3',  vol: 0.3 },
    /* أصوات عرض البداية (العرض الذي يبدأ عند دخول الموقع) */
    intro:   { file: 'sounds/intro.wav',   vol: 0.5 },
    chime:   { file: 'sounds/chime.wav',   vol: 0.45 }
  };

  var LS_KEY = 'raheeq_sound';
  var soundOn = true;
  try { soundOn = localStorage.getItem(LS_KEY) !== '0'; } catch (e) { /* متصفح مقيد */ }

  var audioEls = {};      // عناصر <audio> محمّلة مسبقًا
  var buffers = {};       // AudioBuffer جاهزة عبر Web Audio API
  var ctx = null;
  var unlocked = false;
  var preloaded = false;
  var lastHover = 0, lastTyping = 0, lastClick = 0, lastHoverEl = null;

  function getCtx() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
    }
    return ctx;
  }

  /* فتح سياق الصوت عند أول تفاعل حقيقي (required على الجوال) */
  function unlock() {
    if (unlocked) return;
    var c = getCtx();
    unlocked = true;
    if (c && c.state === 'suspended' && c.resume) { try { c.resume(); } catch (e) {} }
  }

  /* ---------- تحميل مسبق لكل الملفات الثمانية عند فتح الصفحة ---------- */
  function preload() {
    if (preloaded) return;
    preloaded = true;
    Object.keys(DEFS).forEach(function (name) {
      var def = DEFS[name];
      // 1) عنصر Audio تقليدي (يعمل على كل المتصفحات)
      try {
        var a = new Audio();
        a.preload = 'auto';
        a.src = def.file;
        a.volume = def.vol;
        a.load();
        audioEls[name] = a;
      } catch (e) {}

      // 2) فك التشفير إلى AudioBuffer لتشغيل متزامن سريع (نقرات متتالية)
      if (window.fetch && getCtx()) {
        fetch(def.file)
          .then(function (r) { return r.ok ? r.arrayBuffer() : null; })
          .then(function (ab) { return ab ? ctx.decodeAudioData(ab) : null; })
          .then(function (buf) { if (buf) buffers[name] = buf; })
          .catch(function () {});
      }
    });
  }

  /* ---------- مولّد نغمات احتياطي (Web Audio API) ---------- */
  function synth(name, vol) {
    var c = getCtx();
    if (!c) return;
    unlock();
    var t = c.currentTime;
    function tone(freq, start, dur, type, v) {
      var o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0002), start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      o.connect(g); g.connect(c.destination);
      o.start(start); o.stop(start + dur + 0.04);
    }
    function noise(start, dur, v) {
      var len = Math.max(1, Math.floor(c.sampleRate * dur));
      var buf = c.createBuffer(1, len, c.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = c.createBufferSource(); src.buffer = buf;
      var g = c.createGain(); g.gain.value = v;
      src.connect(g); g.connect(c.destination); src.start(start);
    }
    if (name === 'click') { tone(1400, t, 0.08, 'sine', vol); noise(t, 0.03, vol * 0.5); }
    else if (name === 'hover') tone(2000, t, 0.05, 'sine', vol);
    else if (name === 'typing') { tone(2600, t, 0.04, 'sine', vol); noise(t, 0.02, vol * 0.4); }
    else if (name === 'success') {
      tone(523, t, 0.5, 'sine', vol); tone(659, t + 0.12, 0.5, 'sine', vol);
      tone(784, t + 0.24, 0.5, 'sine', vol); tone(1047, t + 0.36, 0.7, 'sine', vol);
    }
    else if (name === 'error') { tone(150, t, 0.35, 'square', vol * 0.6); tone(110, t, 0.35, 'square', vol * 0.4); }
    else if (name === 'step') { noise(t, 0.4, vol * 0.7); tone(420, t + 0.04, 0.3, 'sine', vol * 0.5); }
    else if (name === 'upload') { tone(900, t, 0.18, 'sine', vol); tone(500, t + 0.06, 0.12, 'sine', vol * 0.7); }
    else if (name === 'toggle') { tone(1000, t, 0.05, 'sine', vol); tone(1500, t + 0.07, 0.05, 'sine', vol); }
    else if (name === 'intro') {  // whoosh تصاعدي احتياطي لو تعذّر ملف الصوت
      noise(t, 0.9, vol * 0.8);
      tone(300, t, 0.7, 'sine', vol * 0.4);
      tone(700, t + 0.35, 0.5, 'sine', vol * 0.5);
      tone(1200, t + 0.7, 0.35, 'sine', vol * 0.4);
    }
    else if (name === 'chime') {  // رنين عند قمة العرض
      tone(523, t, 0.9, 'sine', vol); tone(659, t + 0.1, 0.9, 'sine', vol * 0.9);
      tone(784, t + 0.2, 1.0, 'sine', vol * 0.8); tone(1047, t + 0.32, 1.2, 'sine', vol * 0.6);
    }
  }

  /* ---------- التشغيل ---------- */
  function play(name, opts) {
    if (!soundOn || !DEFS[name] || !unlocked) return;
    var def = DEFS[name];
    unlock();

    // الأفضل: Web Audio buffer (لا يقطع الأصوات المتتالية)
    if (buffers[name] && ctx && ctx.state === 'running') {
      try {
        var src = ctx.createBufferSource();
        var gain = ctx.createGain();
        gain.gain.value = (opts && opts.vol != null) ? opts.vol : def.vol;
        src.buffer = buffers[name];
        src.connect(gain); gain.connect(ctx.destination);
        src.start(0);
        return;
      } catch (e) {}
    }

    // بديل: نسخة من عنصر Audio محمّل مسبقًا
    var base = audioEls[name];
    if (base) {
      try {
        var node = base.cloneNode(true);
        node.volume = def.vol;
        node.currentTime = 0;
        var p = node.play();
        if (p && p.catch) p.catch(function () { synth(name, def.vol); });
        return;
      } catch (e) {}
    }
    synth(name, def.vol);
  }

  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  }

  /* ---------- زر الصوت 🔊 / 🔇 ---------- */
  function renderButton(btn) {
    if (!btn) return;
    btn.textContent = soundOn ? '🔊' : '🔇';
    btn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    btn.setAttribute('aria-label', soundOn ? 'كتم الصوت' : 'تشغيل الصوت');
    btn.title = soundOn ? 'إيقاف الأصوات' : 'تشغيل الأصوات';
    btn.classList.toggle('is-muted', !soundOn);
  }

  function bindToggle(btn, onToast) {
    if (!btn) return;
    renderButton(btn);
    btn.addEventListener('click', function () {
      soundOn = !soundOn;
      try { localStorage.setItem(LS_KEY, soundOn ? '1' : '0'); } catch (e) {}
      renderButton(btn);
      unlock();
      if (soundOn) play('click');
      if (onToast) onToast(soundOn ? '🔊 تم تشغيل الأصوات' : '🔇 تم كتم الأصوات');
    });
  }

  /* ---------- أصوات تلقائية لكل تفاعل ---------- */
  function bindInteractions() {
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
      document.addEventListener(ev, unlock, { passive: true, capture: true });
    });

    // كل ضغطة زر / تبويب / رابط / مربع رفع / موافقة
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest && t.closest('button, a, .upload-box, .agree, [role="tab"]')) {
        var now = Date.now();
        if (now - lastClick > 35) { lastClick = now; play('click'); }
      }
    }, true);

    // نغمة خفيفة جدًا عند المرور على أي زر أو بطاقة
    document.addEventListener('pointerover', function (e) {
      if (e.pointerType === 'touch') return;
      var t = e.target;
      var el = t.closest ? t.closest('button, .btn, .feature-card, .hbadge, .reg-card, .upload-box, .agree, .logo, .sound-btn') : null;
      if (el) {
        var now = Date.now();
        if (el !== lastHoverEl && now - lastHover > 90) {
          lastHoverEl = el; lastHover = now; play('hover');
        }
      } else {
        lastHoverEl = null;
      }
    }, true);

    // نقرة لوحة مفاتيح خفيفة عند الكتابة في أي حقل
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if (t && t.matches && t.matches('input, textarea, select')) {
        var now = Date.now();
        if (now - lastTyping > 110) { lastTyping = now; play('typing'); }
      }
    }, true);
    document.addEventListener('input', function (e) {
      var t = e.target;
      if (t && t.matches && t.matches('input[type="text"], input[type="tel"], input[type="email"], input[type="password"], textarea')) {
        var now = Date.now();
        if (now - lastTyping > 110) { lastTyping = now; play('typing'); }
      }
    }, true);
  }

  window.RaheeqSound = {
    play: play,
    vibrate: vibrate,
    unlock: unlock,
    preload: preload,
    bindToggle: bindToggle,
    bindInteractions: bindInteractions,
    isOn: function () { return soundOn; },
    defs: DEFS
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { preload(); bindInteractions(); });
  } else {
    preload(); bindInteractions();
  }
})();
