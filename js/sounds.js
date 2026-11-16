/* ============================================================
   رحيق RAHEEQ — محرك الأصوات والمؤثرات السينمائية
   ملفات MP3/WAV حقيقية من مجلد /sounds/ + Web Audio API احترافي
   التحميل المسبق الفوري + تشغيل تلقائي ذكي لعرض البداية مع
   تفعيل فوري عند أول لمسة لو قيّد المتصفح التشغيل التلقائي
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
    /* أصوات عرض البداية السينمائي (الافتتاحية عند دخول الموقع) */
    intro:   { file: 'sounds/intro.wav',   vol: 0.58 },
    chime:   { file: 'sounds/chime.wav',   vol: 0.56 },
    /* طبقات صوتية إضافية متزامنة مع مراحل عرض البداية عبر Web Audio */
    bar:     { synthOnly: true,            vol: 0.22 },
    shard:   { synthOnly: true,            vol: 0.28 },
    sparkle: { synthOnly: true,            vol: 0.30 },
    curtain: { synthOnly: true,            vol: 0.26 }
  };

  var LS_KEY = 'raheeq_sound';
  var soundOn = true;
  try { soundOn = localStorage.getItem(LS_KEY) !== '0'; } catch (e) { /* متصفح مقيد */ }

  var audioEls = {};      // عناصر <audio> محمّلة مسبقًا
  var buffers = {};       // AudioBuffer جاهزة عبر Web Audio API
  var activeNodes = [];   // أصوات العرض الجارية (لإيقافها بنعومة عند التخطي)
  var ctx = null;
  var unlocked = false;
  var preloaded = false;
  var bound = false;
  var toggleBtns = [];
  var lastHover = 0, lastTyping = 0, lastClick = 0, lastHoverEl = null;

  function clampVol(v) {
    var n = Number(v);
    if (!isFinite(n)) return 0.3;
    return Math.max(0, Math.min(1, n));
  }

  function getCtx() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
    }
    return ctx;
  }

  /* فتح سياق الصوت عند أول تفاعل حقيقي (مطلوب على الجوال والمتصفحات الصارمة) */
  function unlock() {
    var c = getCtx();
    unlocked = true;
    if (c && c.state === 'suspended' && c.resume) {
      try {
        var p = c.resume();
        if (p && p.catch) p.catch(function () {});
      } catch (e) {}
    }
    /* فك تشفير الملفات الصوتية إن لم تُفك بعد */
    decodeAll();
  }

  var decodedStarted = false;
  function decodeAll() {
    if (decodedStarted || !window.fetch) return;
    var c = getCtx();
    if (!c) return;
    decodedStarted = true;
    Object.keys(DEFS).forEach(function (name) {
      var def = DEFS[name];
      if (!def.file || buffers[name]) return;
      try {
        fetch(def.file)
          .then(function (r) { return r && r.ok ? r.arrayBuffer() : null; })
          .then(function (ab) {
            if (!ab || !c.decodeAudioData) return null;
            return new Promise(function (resolve) {
              try {
                var pr = c.decodeAudioData(ab, resolve, function () { resolve(null); });
                if (pr && pr.catch) pr.catch(function () { resolve(null); });
              } catch (e) { resolve(null); }
            });
          })
          .then(function (buf) { if (buf) buffers[name] = buf; })
          .catch(function () {});
      } catch (e) {}
    });
  }

  /* ---------- تحميل مسبق لكل ملفات الصوت عند فتح الصفحة ---------- */
  function preload() {
    if (preloaded) return;
    preloaded = true;
    Object.keys(DEFS).forEach(function (name) {
      var def = DEFS[name];
      if (!def.file) return;
      try {
        var a = new Audio();
        a.preload = 'auto';
        a.src = def.file;
        a.volume = clampVol(def.vol);
        if (a.load) a.load();
        audioEls[name] = a;
      } catch (e) {}
    });
    decodeAll();
  }

  /* ---------- مولّد نغمات ومؤثرات سينمائية (Web Audio API) ---------- */
  function synth(name, vol, opts) {
    var c = getCtx();
    if (!c) return false;
    if (c.state === 'suspended' && c.resume) {
      try { var pr = c.resume(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
    }
    if (c.state && c.state !== 'running') return false;
    var t = c.currentTime;
    var v = clampVol(vol);

    function tone(freq, start, dur, type, gainVal, glideTo) {
      try {
        var o = c.createOscillator(), g = c.createGain();
        o.type = type || 'sine';
        o.frequency.setValueAtTime(Math.max(20, freq), start);
        if (glideTo) {
          o.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), start + dur);
        }
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(Math.max(gainVal, 0.0002), start + 0.014);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        o.connect(g); g.connect(c.destination);
        o.start(start); o.stop(start + dur + 0.05);
      } catch (e) {}
    }

    function filteredNoise(start, dur, gainVal, fStart, fEnd, qVal) {
      try {
        var len = Math.max(1, Math.floor(c.sampleRate * dur));
        var buf = c.createBuffer(1, len, c.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < len; i++) {
          var env = Math.sin(Math.PI * (i / len));
          d[i] = (Math.random() * 2 - 1) * env;
        }
        var src = c.createBufferSource();
        src.buffer = buf;
        var g = c.createGain();
        g.gain.setValueAtTime(gainVal, start);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        if (c.createBiquadFilter && fStart) {
          var flt = c.createBiquadFilter();
          flt.type = 'bandpass';
          flt.Q.value = qVal || 1.8;
          flt.frequency.setValueAtTime(fStart, start);
          if (fEnd) flt.frequency.exponentialRampToValueAtTime(fEnd, start + dur);
          src.connect(flt); flt.connect(g);
        } else {
          src.connect(g);
        }
        g.connect(c.destination);
        src.start(start);
      } catch (e) {}
    }

    if (name === 'click') {
      tone(1400, t, 0.08, 'sine', v);
      filteredNoise(t, 0.03, v * 0.45, 1800, 900, 1.2);
    } else if (name === 'hover') {
      tone(2000, t, 0.05, 'sine', v);
    } else if (name === 'typing') {
      tone(2600, t, 0.04, 'sine', v);
      filteredNoise(t, 0.02, v * 0.35, 2400, 1200, 1.4);
    } else if (name === 'success') {
      tone(523.25, t, 0.5, 'sine', v);
      tone(659.25, t + 0.11, 0.5, 'sine', v * 0.92);
      tone(783.99, t + 0.22, 0.55, 'sine', v * 0.88);
      tone(1046.5, t + 0.34, 0.75, 'sine', v * 0.82);
    } else if (name === 'error') {
      tone(155, t, 0.32, 'triangle', v * 0.65);
      tone(116, t + 0.08, 0.34, 'triangle', v * 0.5);
    } else if (name === 'step') {
      filteredNoise(t, 0.26, v * 0.5, 420, 1400, 2.0);
      tone(440, t + 0.03, 0.24, 'sine', v * 0.45, 587.33);
    } else if (name === 'upload') {
      tone(660, t, 0.16, 'sine', v * 0.8, 990);
      tone(880, t + 0.07, 0.18, 'sine', v * 0.65);
    } else if (name === 'toggle') {
      tone(980, t, 0.05, 'sine', v);
      tone(1470, t + 0.06, 0.06, 'sine', v * 0.85);
    } else if (name === 'intro') {
      // whoosh سينمائي دافئ متصاعد عند بدء العرض
      filteredNoise(t, 1.35, v * 0.68, 190, 2200, 2.2);
      tone(73.42, t, 0.95, 'sine', v * 0.52);
      tone(146.83, t + 0.04, 0.9, 'sine', v * 0.34, 293.66);
      tone(293.66, t + 0.18, 0.95, 'sine', v * 0.36);
      tone(440.0, t + 0.34, 0.85, 'sine', v * 0.32);
      tone(587.33, t + 0.52, 0.78, 'sine', v * 0.28);
    } else if (name === 'chime') {
      // رنين ملكي متلألئ عند التحام شعار رحيق فوق القمة
      tone(98.0, t, 0.45, 'sine', v * 0.4, 73.42);
      tone(587.33, t + 0.02, 1.15, 'sine', v * 0.72);
      tone(739.99, t + 0.09, 1.12, 'sine', v * 0.62);
      tone(880.0, t + 0.17, 1.18, 'sine', v * 0.56);
      tone(1174.66, t + 0.25, 1.28, 'sine', v * 0.52);
      tone(1479.98, t + 0.34, 1.10, 'sine', v * 0.36);
    } else if (name === 'bar') {
      // نغمة بلورية رقيقة متصاعدة مع صعود كل عمود بياني
      var stepIdx = (opts && typeof opts.step === 'number') ? opts.step : 0;
      var scale = [293.66, 369.99, 440.0, 587.33]; // D4, F#4, A4, D5
      var f = scale[Math.max(0, Math.min(scale.length - 1, stepIdx))];
      tone(f, t, 0.34, 'sine', v * 0.75);
      tone(f * 2, t + 0.01, 0.20, 'sine', v * 0.28);
    } else if (name === 'shard') {
      // هفيف ذهبي متلألئ أثناء تجمّع شظايا الشعار ثلاثية الأبعاد
      filteredNoise(t, 1.05, v * 0.48, 650, 3200, 3.4);
      var shNotes = [587.33, 739.99, 880.0, 1108.73, 1174.66, 1479.98];
      for (var s = 0; s < shNotes.length; s++) {
        tone(shNotes[s], t + s * 0.13, 0.38, 'sine', v * 0.32);
      }
    } else if (name === 'sparkle') {
      // بريق ذهبي ناعم عند ظهور اسم «رحيق · RAHEEQ»
      var sp = [1174.66, 1479.98, 1760.0, 2349.32, 2959.96];
      for (var k = 0; k < sp.length; k++) {
        tone(sp[k], t + k * 0.075, 0.48, 'sine', v * (0.42 - k * 0.05));
      }
    } else if (name === 'curtain') {
      // نسمة ختامية ناعمة لحظة انكشاف الموقع
      filteredNoise(t, 0.55, v * 0.42, 1600, 340, 2.0);
      tone(587.33, t, 0.45, 'sine', v * 0.24, 440.0);
    }
    return true;
  }

  function trackNode(item) {
    activeNodes.push(item);
    if (activeNodes.length > 24) activeNodes.shift();
  }

  /* إيقاف أصوات العرض بنعومة عند ضغط «تخطي» */
  function stopIntro() {
    while (activeNodes.length) {
      var item = activeNodes.pop();
      try {
        if (item.gain && ctx) {
          item.gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
          if (item.src && item.src.stop) item.src.stop(ctx.currentTime + 0.14);
        } else if (item.audio) {
          item.audio.pause();
          item.audio.currentTime = 0;
        }
      } catch (e) {}
    }
  }

  /* ---------- التشغيل العادي (عند التفاعل) ---------- */
  function play(name, opts) {
    var def = DEFS[name];
    if (!soundOn || !def) return;
    var force = !!(opts && opts.force);
    if (!unlocked && !force) return;
    var vol = clampVol((opts && opts.vol != null) ? opts.vol : def.vol);
    var isIntroCue = !!(opts && opts.intro);

    if (def.synthOnly) {
      synth(name, vol, opts);
      return;
    }

    var c = getCtx();
    // الأفضل: Web Audio buffer (لا يقطع الأصوات المتتالية ويتحكم بالصوت بدقة)
    if (buffers[name] && c && c.state === 'running') {
      try {
        var src = c.createBufferSource();
        var gain = c.createGain();
        gain.gain.value = vol;
        src.buffer = buffers[name];
        src.connect(gain); gain.connect(c.destination);
        src.start(0);
        if (isIntroCue) trackNode({ src: src, gain: gain });
        return;
      } catch (e) {}
    }

    // بديل: نسخة من عنصر Audio محمّل مسبقًا
    var base = audioEls[name];
    if (base) {
      try {
        var node = base.cloneNode(true);
        node.volume = vol;
        try { node.currentTime = 0; } catch (e) {}
        if (isIntroCue) trackNode({ audio: node });
        var p = node.play();
        if (p && p.catch) p.catch(function () { if (unlocked) synth(name, vol, opts); });
        return;
      } catch (e) {}
    }
    synth(name, vol, opts);
  }

  /* ---------- تشغيل تلقائي ذكي لعرض البداية ----------
     يحاول التشغيل الفوري ويعيد Promise<boolean>:
     true = اشتغل الصوت تلقائيًا بنجاح
     false = المتصفح ينتظر أول لمسة/ضغطة من المستخدم */
  function playIntro(name, opts) {
    var def = DEFS[name];
    if (!soundOn || !def) return Promise.resolve(false);
    if (!preloaded) preload();
    var vol = clampVol((opts && opts.vol != null) ? opts.vol : def.vol);

    if (def.synthOnly) {
      var okSynth = synth(name, vol, opts);
      if (okSynth) unlocked = true;
      return Promise.resolve(!!okSynth);
    }

    var c = getCtx();
    function tryBuffer() {
      if (buffers[name] && c && c.state === 'running') {
        try {
          var src = c.createBufferSource();
          var gain = c.createGain();
          gain.gain.value = vol;
          src.buffer = buffers[name];
          src.connect(gain); gain.connect(c.destination);
          src.start(0);
          unlocked = true;
          trackNode({ src: src, gain: gain });
          return true;
        } catch (e) {}
      }
      return false;
    }

    if (tryBuffer()) return Promise.resolve(true);

    // محاولة تشغيل عنصر Audio الحقيقي مباشرة (أوسع توافقًا مع التشغيل التلقائي)
    var base = audioEls[name];
    if (base) {
      try {
        var node = base.cloneNode(true);
        node.volume = vol;
        var pr = node.play();
        if (pr && typeof pr.then === 'function') {
          return pr.then(function () {
            unlocked = true;
            trackNode({ audio: node });
            if (c && c.state === 'suspended' && c.resume) {
              try { c.resume().catch(function () {}); } catch (e) {}
            }
            return true;
          }, function () {
            // محاولة أخيرة عبر Web Audio إن كان السياق مفتوحًا
            if (c && c.state === 'running') {
              unlocked = true;
              return synth(name, vol, opts);
            }
            return false;
          });
        }
        unlocked = true;
        trackNode({ audio: node });
        return Promise.resolve(true);
      } catch (e) {}
    }

    if (c && c.resume) {
      try {
        var r = c.resume();
        if (r && r.then) {
          return r.then(function () {
            if (c.state === 'running') {
              unlocked = true;
              return tryBuffer() || synth(name, vol, opts);
            }
            return false;
          }, function () { return false; });
        }
      } catch (e) {}
    }
    return Promise.resolve(false);
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

  function setEnabled(next) {
    soundOn = !!next;
    try { localStorage.setItem(LS_KEY, soundOn ? '1' : '0'); } catch (e) {}
    if (!soundOn) stopIntro();
    toggleBtns.forEach(renderButton);
    try {
      if (typeof CustomEvent === 'function') {
        document.dispatchEvent(new CustomEvent('raheeq:soundchange', { detail: { on: soundOn } }));
      }
    } catch (e) {}
  }

  function bindToggle(btn, onToast) {
    if (!btn) return;
    if (toggleBtns.indexOf(btn) < 0) toggleBtns.push(btn);
    renderButton(btn);
    if (btn.dataset && btn.dataset.soundBound === '1') return;
    if (btn.dataset) btn.dataset.soundBound = '1';
    btn.addEventListener('click', function () {
      unlock();
      setEnabled(!soundOn);
      if (soundOn) play('click');
      if (onToast) onToast(soundOn ? '🔊 تم تشغيل الأصوات' : '🔇 تم كتم الأصوات');
    });
  }

  /* ---------- أصوات تلقائية لكل تفاعل ---------- */
  function bindInteractions() {
    if (bound) return;
    bound = true;
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
      document.addEventListener(ev, unlock, { passive: true, capture: true });
    });

    // كل ضغطة زر / تبويب / رابط / مربع رفع / موافقة
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('.intro-sound-btn')) return; // له صوته السينمائي الخاص
      if (t.closest('button, a, .upload-box, .agree, [role="tab"], .program-card, .foundation-options label')) {
        var now = Date.now();
        if (now - lastClick > 35) { lastClick = now; play('click'); }
      }
    }, true);

    // نغمة خفيفة جدًا عند المرور على أي زر أو بطاقة
    document.addEventListener('pointerover', function (e) {
      if (e.pointerType === 'touch') return;
      var t = e.target;
      var el = t && t.closest ? t.closest('button, .btn, .feature-card, .program-track, .hbadge, .reg-card, .upload-box, .agree, .logo, .sound-btn, .program-card') : null;
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
    playIntro: playIntro,
    stopIntro: stopIntro,
    setEnabled: setEnabled,
    vibrate: vibrate,
    unlock: unlock,
    preload: preload,
    bindToggle: bindToggle,
    bindInteractions: bindInteractions,
    isOn: function () { return soundOn; },
    isUnlocked: function () { return unlocked; },
    defs: DEFS
  };

  /* تحميل مسبق فوري حتى تكون أصوات عرض البداية جاهزة منذ اللحظة الأولى */
  preload();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindInteractions);
  } else {
    bindInteractions();
  }
})();
