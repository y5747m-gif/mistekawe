/* ============================================================
   رحيق — مساعدة التسجيل في أكاديمية رحيق (واجهة العرض فقط)
   ------------------------------------------------------------
   هذا الملف «دمية عرض»: حركات + نافذة محادثة. لا يحتوي أي قواعد
   أو إجابات أو إعدادات للبوت. كل شيء يأتي من الخادم:
     GET  /api/yaseen-config  النصوص النهائية المسموح عرضها
     POST /api/yaseen-chat    رسالة ولي الأمر => رد معتمد من الخادم
   لا توجد أي دالة عامة لتغيير رحيق، ولا إعدادات لولي الأمر سوى
   كتم الصوت. إن لم يُجب الخادم أو أوقف المدير البوت لا تظهر رحيق.
   ============================================================ */
(function () {
  'use strict';
  if (window.__ysn) return;
  Object.defineProperty(window, '__ysn', { value: true });

  var CONFIG_URL = '/api/yaseen-config';
  var CHAT_URL = '/api/yaseen-chat';
  var ASSETS = 'assets/yaseen/';
  var POSES = ['idle', 'blink', 'talk', 'wave', 'point', 'worried', 'thinking', 'celebrate'];
  var EXPRESSION_POSE = { happy: 'idle', worried: 'worried', thinking: 'thinking', celebrate: 'celebrate', point: 'point', wave: 'wave' };
  var REFRESH_MS = 45000;
  var POINT_MS = 7000;

  var cfg = null;
  var root = null, mascot = null, charBtn = null, bubble = null, chat = null;
  var logEl = null, inputEl = null, quickEl = null, captchaEl = null, captchaInput = null, metaLeft = null, metaCount = null, dotEl = null, statusEl = null, soundBtn = null;
  var frames = {};
  var timers = [];
  var observers = [];
  var listeners = [];

  var pose = 'idle', poseTimer = 0, blinkOn = false, mouthShut = false, talkTimer = 0, bubbleTimer = 0;
  var pointing = null, pointRaf = 0, lastPointed = '', lastErrorField = '', lastErrorAt = 0;
  var lastActivity = Date.now(), interacted = false, stuckShown = false;
  var currentStepSeen = 0, celebrated = false;
  var chatOpen = false, chatGreeted = false, busy = false, locked = false, needCaptcha = false;
  var sid = '', muted = false, audioCtx = null;

  try { muted = window.localStorage.getItem('yaseen_muted') === '1'; } catch (e) {}
  try { sid = window.sessionStorage.getItem('yaseen_sid') || ''; } catch (e) {}

  /* ---------------- أدوات ---------------- */
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;      // نص فقط — لا HTML من أي مصدر
    return node;
  }
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    listeners.push([target, type, fn, opts]);
  }
  function later(fn, ms) {
    var id = setTimeout(function () { var i = timers.indexOf(id); if (i >= 0) timers.splice(i, 1); fn(); }, ms);
    timers.push(id);
    return id;
  }
  function stopEvery(id) { clearInterval(id); var i = timers.indexOf(id); if (i >= 0) timers.splice(i, 1); }
  function every(fn, ms) { var id = setInterval(fn, ms); timers.push(id); return id; }
  function anim(name) { return !!(cfg && cfg.animations && cfg.animations[name]); }
  function freeze(obj) {
    if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) { Object.freeze(obj); Object.keys(obj).forEach(function (k) { freeze(obj[k]); }); }
    return obj;
  }

  function request(url, options) {
    if (typeof window.fetch !== 'function') return Promise.reject(new Error('unsupported'));
    var ctrl = typeof window.AbortController === 'function' ? new window.AbortController() : null;
    var opts = Object.assign({ credentials: 'omit', cache: 'no-store' }, options || {});
    if (ctrl) opts.signal = ctrl.signal;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, 9000);
    return window.fetch(url, opts).then(function (res) {
      clearTimeout(t);
      return res.json().then(function (body) { return { status: res.status, body: body }; });
    }, function (err) { clearTimeout(t); throw err; });
  }

  /* ---------------- تحميل الإعدادات الظاهرة من الخادم ---------------- */
  function loadConfig() {
    return request(CONFIG_URL, { method: 'GET' }).then(function (res) {
      var body = res.body;
      if (res.status !== 200 || !body || body.ok !== true || body.enabled !== true) { destroy(); return; }
      cfg = freeze(body);
      if (!root) build(); else applyConfig();
    }, function () {
      if (!root) return;            // لا خادم => لا رحيق
      /* فشل مؤقت في الشبكة بعد الظهور: نبقيها كما هي ونحاول لاحقًا */
    });
  }

  /* ---------------- البناء ---------------- */
  function build() {
    root = el('div', 'ysn-root');
    root.id = 'yaseenAssistant';

    mascot = el('div', 'ysn');
    bubble = el('div', 'ysn-bubble');
    bubble.hidden = true;
    bubble.setAttribute('role', 'status');
    bubble.setAttribute('aria-live', 'polite');

    charBtn = el('button', 'ysn-char');
    charBtn.type = 'button';
    var shadow = el('span', 'ysn-shadow');
    var tilt = el('span', 'ysn-tilt'), body = el('span', 'ysn-body'), flip = el('span', 'ysn-flip');
    POSES.forEach(function (name) {
      var img = el('img', 'ysn-f' + (name === 'idle' ? ' is-on' : ''));
      img.src = ASSETS + name + '.webp';
      img.alt = '';
      img.draggable = false;
      img.decoding = 'async';
      frames[name] = img;
      flip.appendChild(img);
    });
    body.appendChild(flip); tilt.appendChild(body);
    charBtn.appendChild(shadow); charBtn.appendChild(tilt);
    mascot.appendChild(bubble); mascot.appendChild(charBtn);

    chat = buildChat();
    root.appendChild(mascot); root.appendChild(chat);
    document.body.appendChild(root);

    on(charBtn, 'click', function () { toggleChat(); });
    on(bubble, 'click', function () { openChat(bubble.getAttribute('data-quick') || ''); });
    on(root, 'contextmenu', function (e) { e.preventDefault(); });
    ['dragover', 'drop'].forEach(function (t) { on(root, t, function (e) { e.preventDefault(); }); });   // لا رفع ملفات للبوت

    applyConfig();
    startIdle();
    watchForm();

    var tries = 0;
    (function greet() {                                // ننتظر انتهاء انيميشن البداية ثم تلوّح وترحّب
      if (!cfg || !root) return;
      if (document.body.classList.contains('raheeq-intro-lock') && tries++ < 30) { later(greet, 400); return; }
      later(function () { if (cfg && root && !chatOpen) say(cfg.greeting, { expression: 'wave', hold: 5600 }); }, 900);
    })();
  }

  function buildChat() {
    var box = el('section', 'ysn-chat');
    box.hidden = true;
    box.setAttribute('role', 'dialog');

    var head = el('header', 'ysn-head');
    var avatar = el('span', 'ysn-avatar');
    var avImg = el('img'); avImg.src = ASSETS + 'avatar.webp'; avImg.alt = '';
    dotEl = el('span', 'ysn-dot');
    avatar.appendChild(avImg); avatar.appendChild(dotEl);
    var title = el('div', 'ysn-title');
    title.appendChild(el('strong', 'ysn-name'));
    statusEl = el('span');
    title.appendChild(statusEl);
    soundBtn = el('button', 'ysn-icon'); soundBtn.type = 'button';
    var closeBtn = el('button', 'ysn-icon', '✕'); closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'إغلاق المحادثة');
    head.appendChild(avatar); head.appendChild(title); head.appendChild(soundBtn); head.appendChild(closeBtn);

    logEl = el('div', 'ysn-log');
    logEl.setAttribute('role', 'log');
    logEl.setAttribute('aria-live', 'polite');

    quickEl = el('div', 'ysn-quick');

    captchaEl = el('div', 'ysn-captcha');
    captchaEl.hidden = true;
    captchaEl.appendChild(el('span', 'ysn-captcha-q'));
    captchaInput = el('input');
    captchaInput.type = 'text'; captchaInput.inputMode = 'numeric'; captchaInput.maxLength = 3;
    captchaInput.setAttribute('aria-label', 'إجابة سؤال التحقق');
    captchaEl.appendChild(captchaInput);

    var form = el('form', 'ysn-form');
    form.noValidate = true;
    inputEl = el('input');
    inputEl.type = 'text';
    inputEl.autocomplete = 'off';
    inputEl.placeholder = 'اكتب سؤالك عن التسجيل…';
    inputEl.setAttribute('aria-label', 'سؤالك عن التسجيل');
    var sendBtn = el('button', null, 'إرسال'); sendBtn.type = 'submit';
    form.appendChild(inputEl); form.appendChild(sendBtn);

    var meta = el('div', 'ysn-meta');
    metaLeft = el('span'); metaCount = el('span');
    meta.appendChild(metaLeft); meta.appendChild(metaCount);

    box.appendChild(head); box.appendChild(logEl); box.appendChild(quickEl); box.appendChild(captchaEl); box.appendChild(form); box.appendChild(meta);

    on(closeBtn, 'click', function () { closeChat(); });
    on(soundBtn, 'click', function () {
      muted = !muted;                               // كتم فقط — لا يغيّر أي سلوك للبوت
      try { window.localStorage.setItem('yaseen_muted', muted ? '1' : '0'); } catch (e) {}
      if (muted && window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) {} }
      renderSound();
    });
    on(form, 'submit', function (e) {
      e.preventDefault();
      var text = inputEl.value.replace(/\s+/g, ' ').trim();
      if (needCaptcha) { sendMessage({ captcha: captchaInput.value }, null); return; }
      if (!text) return;
      inputEl.value = ''; renderCount();
      sendMessage({ message: text }, text);
    });
    on(captchaInput, 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); sendMessage({ captcha: captchaInput.value }, null); } });
    on(inputEl, 'input', renderCount);
    on(inputEl, 'paste', function (e) {
      var data = e.clipboardData;
      if (data && data.files && data.files.length) e.preventDefault();      // لا ملفات
    });
    on(box, 'keydown', function (e) { if (e.key === 'Escape') closeChat(); });
    return box;
  }

  function applyConfig() {
    if (!root || !cfg) return;
    var max = cfg.limits.maxChars;
    inputEl.maxLength = max;
    charBtn.setAttribute('aria-label', 'افتح محادثة ' + cfg.name + ' — مساعد التسجيل');
    chat.setAttribute('aria-label', 'محادثة ' + cfg.name);
    chat.querySelector('.ysn-name').textContent = cfg.name;
    dotEl.classList.toggle('is-off', !cfg.online);
    statusEl.textContent = cfg.online ? 'متصل الآن · مساعد التسجيل' : 'خارج مواعيد العمل';
    mascot.classList.toggle('a-idle', anim('idle'));
    mascot.classList.toggle('a-tilt', anim('tilt'));

    while (quickEl.firstChild) quickEl.removeChild(quickEl.firstChild);
    cfg.quickReplies.forEach(function (q) {
      var b = el('button', null, q.label);
      b.type = 'button';
      b.addEventListener('click', function () { sendMessage({ quickReply: q.id }, q.label); });
      quickEl.appendChild(b);
    });
    renderSound(); renderCount(); renderLock();
  }

  function renderSound() {
    var off = muted || !cfg.sounds.enabled;
    soundBtn.textContent = off ? '🔇' : '🔊';
    soundBtn.setAttribute('aria-pressed', String(muted));
    soundBtn.setAttribute('aria-label', muted ? 'تشغيل الصوت' : 'كتم الصوت');
    soundBtn.hidden = !cfg.sounds.enabled;
  }
  function renderCount() {
    if (!cfg) return;
    metaCount.textContent = inputEl.value.length + ' / ' + cfg.limits.maxChars;
  }
  function renderLock() {
    var off = locked || !cfg.online || busy;
    inputEl.disabled = locked || !cfg.online;
    Array.prototype.forEach.call(chat.querySelectorAll('.ysn-quick button, .ysn-form button'), function (b) { b.disabled = off; });
  }

  /* ---------------- الحركات ---------------- */
  function renderPose() {
    var show = pose;
    if (pose === 'idle') {
      if (blinkOn) show = 'blink';
      else if (mouthShut) show = 'talk';
    }
    POSES.forEach(function (name) { frames[name].classList.toggle('is-on', name === show); });
  }
  function setPose(name, ms) {
    clearTimeout(poseTimer);
    pose = POSES.indexOf(name) >= 0 ? name : 'idle';
    renderPose();
    if (ms) poseTimer = later(function () { pose = pointing ? 'point' : 'idle'; renderPose(); }, ms);
  }
  function express(expression, ms) {
    var name = anim('expressions') ? (EXPRESSION_POSE[expression] || 'idle') : 'idle';
    if (name === 'wave' && !anim('wave')) name = 'idle';
    if (name === 'point' && !pointing) name = 'idle';
    setPose(name, ms || 3200);
  }
  function startIdle() {
    var sec = Math.max(2, Number(cfg.animations.blinkEverySec) || 3);
    every(function () {                               // رمشة كل 3 ثوانٍ
      if (!anim('blink') || pose !== 'idle' || document.hidden) return;
      blinkOn = true; renderPose();
      later(function () { blinkOn = false; renderPose(); }, 150);
    }, sec * 1000);
    every(checkStuck, 1000);
  }
  function talk(ms) {                                 // الفم يتحرك أثناء الكلام
    stopEvery(talkTimer);
    mouthShut = false;
    mascot.classList.remove('is-bob');
    if (!anim('talk')) return;
    mascot.classList.add('is-bob');
    var end = Date.now() + ms;
    talkTimer = every(function () {
      mouthShut = !mouthShut;
      if (Date.now() >= end) { stopEvery(talkTimer); mouthShut = false; if (mascot) mascot.classList.remove('is-bob'); }
      renderPose();
    }, 140);
  }
  function nudge(cls, ms) {
    mascot.classList.remove(cls); void mascot.offsetWidth; mascot.classList.add(cls);
    later(function () { if (mascot) mascot.classList.remove(cls); }, ms);
  }

  /* ---------------- الصوت (يكتمه ولي الأمر فقط) ---------------- */
  function blip() {
    if (muted || !cfg.sounds.enabled) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      audioCtx = audioCtx || new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var t0 = audioCtx.currentTime, vol = Math.min(1, Math.max(0, cfg.sounds.volume)) * 0.25;
      [660, 880].forEach(function (freq, i) {
        var osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0 + i * 0.09);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + i * 0.09 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.09 + 0.16);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(t0 + i * 0.09); osc.stop(t0 + i * 0.09 + 0.18);
      });
    } catch (e) {}
  }
  function speakAloud(text) {
    if (muted || !cfg.sounds.enabled || !cfg.sounds.speech || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    try {
      window.speechSynthesis.cancel();
      var u = new window.SpeechSynthesisUtterance(String(text).replace(/[^\p{L}\p{N}\s.,؟!،:]/gu, ' '));
      u.lang = 'ar-EG'; u.volume = cfg.sounds.volume; u.rate = 1;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  /* ---------------- الكلام (بالون فوق الشخصية) ---------------- */
  function say(text, opts) {
    if (!root || !text) return;
    opts = opts || {};
    var dur = Math.min(3400, Math.max(1000, String(text).length * 48));
    talk(dur);
    if (opts.expression) express(opts.expression, Math.max(dur, 2600));
    blip(); speakAloud(text);
    if (chatOpen) { addMessage(text, 'bot'); return; }
    clearTimeout(bubbleTimer);
    while (bubble.firstChild) bubble.removeChild(bubble.firstChild);
    bubble.appendChild(document.createTextNode(text));
    if (opts.quick) {
      bubble.setAttribute('data-quick', opts.quick);
      bubble.appendChild(el('span', 'ysn-bubble-cta', 'أيوه، ساعدني ←'));
    } else bubble.removeAttribute('data-quick');
    bubble.hidden = true; void bubble.offsetWidth; bubble.hidden = false;
    bubbleTimer = later(function () { if (bubble) bubble.hidden = true; }, opts.hold || dur + 3600);
  }

  /* ---------------- الإشارة إلى الخانة + التوهج الذهبي ---------------- */
  function fieldTarget(name) {
    var wrap = document.querySelector('[data-field="' + String(name).replace(/[^a-zA-Z0-9]/g, '') + '"]');
    if (!wrap) return null;
    return wrap.querySelector('.upload-box') || wrap.querySelector('input:not([type=file]):not([type=checkbox]),select,textarea') || wrap;
  }
  function visible(node) {
    if (!node || !node.getClientRects) return false;
    return node.getClientRects().length > 0;
  }
  function placeAtTarget() {
    if (!pointing || !mascot) return;
    var r = pointing.el.getBoundingClientRect();
    var m = charBtn.getBoundingClientRect();
    var w = m.width || 96, h = m.height || 126;
    var vw = window.innerWidth, vh = window.innerHeight;
    var style = window.getComputedStyle(mascot);
    var homeLeft = parseFloat(style.left) || 14;
    var homeTop = vh - (parseFloat(style.bottom) || 14) - h;
    var x = r.left - w - 4, y = r.top + r.height / 2 - h * 0.6;
    if (x < 4) { x = Math.max(4, r.left + 6); y = r.top - h + 14; }       // لا مساحة بجانب الخانة: تقف فوق طرفها
    y = Math.min(vh - h - 6, Math.max(6, y));
    x = Math.min(vw - w - 6, x);
    mascot.style.transform = 'translate(' + Math.round(x - homeLeft) + 'px,' + Math.round(y - homeTop) + 'px)';
    mascot.classList.toggle('is-below', y < 110);
  }
  function trackTarget() {
    cancelAnimationFrame(pointRaf);
    if (!pointing) return;
    if (!visible(pointing.el) || Date.now() > pointing.until) { release(); return; }
    placeAtTarget();
    pointRaf = requestAnimationFrame(trackTarget);
  }
  function release() {
    cancelAnimationFrame(pointRaf);
    if (pointing) pointing.el.classList.remove('ysn-glow');
    pointing = null;
    if (mascot) { mascot.style.transform = ''; mascot.classList.remove('is-below'); }
    if (pose === 'point') setPose('idle');
  }
  function pointTo(name, text, expression) {
    var target = fieldTarget(name);
    if (!anim('point') || !target || !visible(target)) { say(text, { expression: expression === 'point' ? 'happy' : expression }); return; }
    release();
    lastPointed = name;
    target.classList.add('ysn-glow');
    pointing = { el: target, name: name, until: Date.now() + POINT_MS };
    try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    if (expression === 'worried' && anim('expressions')) {
      setPose('worried');
      later(function () { if (pointing) setPose('point'); }, 750);
    } else setPose('point');
    trackTarget();
    say(text);
  }

  /* ---------------- متابعة الاستمارة ---------------- */
  function currentStep() {
    var panel = document.querySelector('.form-step.is-current');
    var n = panel ? parseInt(panel.getAttribute('data-step-panel'), 10) : 0;
    return n >= 1 && n <= 3 ? n : 0;
  }
  function formActive() {
    var view = document.getElementById('registerView');
    var form = document.getElementById('regForm');
    var done = document.getElementById('successView');
    if (!view || !form || view.hidden || !visible(form) || (done && !done.hidden)) return false;
    var r = form.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  }
  function stepErrors() {                              // أسماء الخانات غير المكتملة (بيانات فقط تُرسل للخادم)
    var V = window.RaheeqValidation, step = currentStep(), out = [];
    try {
      if (step === 1 && V) out = Object.keys(V.step1());
      else if (step === 2 && V) out = Object.keys(V.step2());
      else if (step === 3) {
        ['birthCert', 'photo', 'parentCard'].forEach(function (k) {
          var box = document.querySelector('[data-upload="' + k + '"]');
          if (!box || !box.classList.contains('has-file')) out.push(k);
        });
        var agree = document.getElementById('agreeTerms');
        if (agree && !agree.checked) out.push('agree');
      }
    } catch (e) { out = []; }
    return out;
  }
  function fieldNameOf(node) {
    var wrap = node && node.closest ? node.closest('[data-field]') : null;
    return wrap ? wrap.getAttribute('data-field') : '';
  }
  function guideFor(name) { return (cfg.guide && cfg.guide[name]) || ''; }

  function checkStuck() {
    if (!cfg || chatOpen || stuckShown || !interacted || document.hidden) return;
    var limit = Math.max(5, Number(cfg.animations.stuckAfterSec) || 10) * 1000;
    if (Date.now() - lastActivity < limit || !formActive()) return;
    stuckShown = true;
    say(cfg.lines.stuck, { expression: 'thinking', quick: 'problem', hold: 9000 });
  }

  function celebrate() {
    if (celebrated) return;
    celebrated = true;
    release();
    setPose(anim('expressions') ? 'celebrate' : 'idle', 4200);
    nudge('is-jump', 2600);
    if (anim('confetti') && window.RaheeqConfetti) { try { window.RaheeqConfetti.launch(); } catch (e) {} }
    say(cfg.lines.success, { hold: 8000 });
  }

  function watchForm() {
    var form = document.getElementById('regForm');
    if (!form) return;
    currentStepSeen = currentStep();

    ['input', 'keydown', 'pointerdown', 'change'].forEach(function (type) {
      on(document, type, function (e) {
        lastActivity = Date.now();
        stuckShown = false;
        if (e.target && e.target.closest && e.target.closest('#regForm')) interacted = true;
      }, true);
    });

    /* خطأ في خانة بعد مغادرتها: مثلًا الرقم القومي أقل من 14 رقم */
    on(form, 'focusout', function (e) {
      var name = fieldNameOf(e.target);
      if (!name || !cfg || chatOpen) return;
      var value = e.target.value;
      if (typeof value !== 'string' || !value.trim()) return;
      later(function () {
        if (!cfg || !root) return;
        var bad = stepErrors().indexOf(name) >= 0;
        if (bad && guideFor(name)) { lastErrorField = name; lastErrorAt = Date.now(); pointTo(name, guideFor(name), 'worried'); }
        else if (!bad && lastPointed === name) {
          lastPointed = '';
          release();
          say(cfg.lines.fieldFixed, { expression: 'happy', hold: 2600 });
        }
      }, 60);
    });

    /* تصحيح الخانة أثناء الكتابة يطفئ التوهج */
    on(form, 'input', function (e) {
      var name = fieldNameOf(e.target);
      if (pointing && name === pointing.name && stepErrors().indexOf(name) < 0) {
        lastPointed = '';
        release();
        say(cfg.lines.fieldFixed, { expression: 'happy', hold: 2600 });
      }
    });

    if (typeof window.MutationObserver !== 'function') return;
    var pending = 0;
    var mo = new window.MutationObserver(function () {
      clearTimeout(pending);
      pending = later(function () {
        if (!cfg || !root) return;
        var step = currentStep();
        if (step && step !== currentStepSeen) {          // انتقال بين الخطوات الثلاث
          currentStepSeen = step;
          release();
          lastErrorField = '';
          if (formActive() && !chatOpen) say(cfg.steps[step], { expression: 'happy' });
          return;
        }
        var err = document.querySelector('.form-step.is-current .field.has-error');
        var name = err ? err.getAttribute('data-field') : '';
        if (name && !chatOpen && (name !== lastErrorField || Date.now() - lastErrorAt > 4000) && guideFor(name)) {
          lastErrorField = name; lastErrorAt = Date.now();
          pointTo(name, guideFor(name), 'worried');
        }
      }, 90);
    });
    mo.observe(form, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    observers.push(mo);

    var done = document.getElementById('successView');
    if (done) {
      var mo2 = new window.MutationObserver(function () {
        if (!cfg || !root) return;
        if (!done.hidden) celebrate(); else celebrated = false;
      });
      mo2.observe(done, { attributes: true, attributeFilter: ['hidden'] });
      observers.push(mo2);
    }
  }

  /* ---------------- المحادثة ---------------- */
  function addMessage(text, who) {
    var msg = el('div', 'ysn-msg ' + (who === 'user' ? 'is-user' : 'is-bot'), text);
    logEl.appendChild(msg);
    logEl.scrollTop = logEl.scrollHeight;
    return msg;
  }
  function addTyping() {
    var msg = el('div', 'ysn-msg is-bot');
    var dots = el('span', 'ysn-typing');
    dots.appendChild(el('i')); dots.appendChild(el('i')); dots.appendChild(el('i'));
    msg.appendChild(dots);
    logEl.appendChild(msg);
    logEl.scrollTop = logEl.scrollHeight;
    return msg;
  }
  function openChat(quick) {
    if (!root || !cfg) return;
    chatOpen = true;
    release();
    bubble.hidden = true;
    chat.hidden = false;
    root.classList.add('is-chat-open');
    charBtn.setAttribute('aria-expanded', 'true');
    if (!chatGreeted) {
      chatGreeted = true;
      addMessage(cfg.greeting, 'bot');
      addMessage(cfg.online ? cfg.chatIntro : cfg.lines.offHours, 'bot');
    }
    renderLock();
    if (quick && cfg.online && !locked) {
      var q = cfg.quickReplies.filter(function (x) { return x.id === quick; })[0];
      if (q) sendMessage({ quickReply: q.id }, q.label);
    } else if (window.innerWidth > 600 && !inputEl.disabled) {
      try { inputEl.focus({ preventScroll: true }); } catch (e) {}
    }
  }
  function closeChat() {
    if (!root) return;
    chatOpen = false;
    chat.hidden = true;
    root.classList.remove('is-chat-open');
    charBtn.setAttribute('aria-expanded', 'false');
  }
  function toggleChat() { if (chatOpen) closeChat(); else openChat(''); }

  function setCaptcha(question) {
    needCaptcha = !!question;
    captchaEl.hidden = !needCaptcha;
    if (needCaptcha) {
      captchaEl.querySelector('.ysn-captcha-q').textContent = question;
      captchaInput.value = '';
      try { captchaInput.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  function sendMessage(payload, shownText) {
    if (!cfg || busy || locked || !cfg.online) return;
    if (needCaptcha && payload.captcha == null) { try { captchaInput.focus(); } catch (e) {} return; }
    busy = true; renderLock();
    if (shownText) addMessage(shownText, 'user');
    var typing = addTyping();
    setPose(anim('expressions') ? 'thinking' : 'idle');
    var body = { sid: sid, context: { step: currentStep(), invalid: stepErrors() } };
    if (payload.quickReply) body.quickReply = payload.quickReply;
    if (payload.message) body.message = String(payload.message).slice(0, cfg.limits.maxChars);
    if (payload.captcha != null) body.captcha = String(payload.captcha).slice(0, 6);
    var started = Date.now();

    request(CHAT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (res) {
      return new Promise(function (resolve) { later(function () { resolve(res); }, Math.max(0, 550 - (Date.now() - started))); });
    }).then(function (res) {
      if (!root) return;
      var data = res.body || {};
      if (typing.parentNode) typing.parentNode.removeChild(typing);
      busy = false;
      if (data.disabled) { destroy(); return; }             // المدير أوقف البوت
      if (typeof data.sid === 'string') { sid = data.sid; try { window.sessionStorage.setItem('yaseen_sid', sid); } catch (e) {} }
      if (typeof data.reply !== 'string') { addMessage('الاتصال ضعيف دلوقتي، جرّب تاني بعد شوية.', 'bot'); setPose('idle'); renderLock(); return; }

      var msg = addMessage(data.reply, 'bot');
      if (data.handoff && /^\d{8,15}$/.test(String(data.handoff.whatsapp))) {
        var a = el('a', 'ysn-wa', 'افتح واتساب الأكاديمية');
        a.href = 'https://wa.me/' + data.handoff.whatsapp;
        a.target = '_blank'; a.rel = 'noopener noreferrer';
        msg.appendChild(document.createElement('br'));
        msg.appendChild(a);
      }
      locked = !!data.locked;
      setCaptcha(data.captcha && typeof data.captcha.question === 'string' ? data.captcha.question : '');
      if (typeof data.remaining === 'number') metaLeft.textContent = 'باقي ' + data.remaining + ' رسالة';
      talk(Math.min(3000, Math.max(900, data.reply.length * 45)));
      blip(); speakAloud(data.reply);
      express(data.expression, 3600);
      renderLock();

      var act = data.action;
      if (act && act.type === 'point' && typeof act.field === 'string' && anim('point')) {
        var target = fieldTarget(act.field);
        if (target && visible(target)) {
          if (window.innerWidth <= 600) closeChat();        // على الجوال نفسح المجال لرؤية الخانة
          pointTo(act.field, '', 'point');
          if (!chatOpen) say(data.reply);
        }
      }
    }, function () {
      if (!root) return;
      if (typing.parentNode) typing.parentNode.removeChild(typing);
      busy = false;
      addMessage('الاتصال ضعيف دلوقتي، جرّب تاني بعد شوية.', 'bot');
      setPose(anim('expressions') ? 'worried' : 'idle', 2500);
      renderLock();
    });
  }

  /* ---------------- الإزالة (مفتاح الإيقاف) ---------------- */
  function destroy() {
    cfg = null;
    if (!root) return;
    release();
    timers.forEach(function (id) { clearTimeout(id); clearInterval(id); });
    timers = [];
    observers.forEach(function (o) { o.disconnect(); });
    observers = [];
    listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); });
    listeners = [];
    Array.prototype.forEach.call(document.querySelectorAll('.ysn-glow'), function (n) { n.classList.remove('ysn-glow'); });
    if (root.parentNode) root.parentNode.removeChild(root);
    root = mascot = charBtn = bubble = chat = null;
    frames = {};
    chatOpen = false; chatGreeted = false; busy = false; pointing = null;
  }

  function start() {
    loadConfig();
    setInterval(function () { if (!document.hidden) loadConfig(); }, REFRESH_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) loadConfig(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
