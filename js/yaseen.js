/* ============================================================
   رحيق — المساعد الذكي لأكاديمية رحيق (واجهة العرض فقط)
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
  var RETRY_MS = 8000;
  /* مهلة الطلب الواحد أقل من مهلة دالة Vercel (30 ث) حتى يصل رد واضح لولي الأمر */
  var REQ_TIMEOUT_MS = 20000;
  var RETRY_DELAY_MS = 400;      // انتظار قصير قبل المحاولة التلقائية الثانية

  /* ------------------------------------------------------------
     الشكل الأساسي لرحيق (BASE)
     ------------------------------------------------------------
     نفس النصوص الافتراضية التي يرسلها الخادم، لكنها محليّة هنا
     حتى تظهر الشخصية فورًا مع أول رسم للصفحة، بدل أن تختفي لو
     تأخّر الخادم أو فشل الطلب الأول (شبكة بطيئة / حجب / بدء بارد).

     القاعدة لم تتغيّر: الخادم هو المرجع. أوّل رد من الخادم يستبدل
     هذه القيم كلها (applyConfig)، ولو قال الخادم إن المدير أوقف
     البوت تُزال رحيق بالكامل (destroy). هذه القيم شكل ونصوص عرض
     فقط — لا قواعد ولا إجابات ولا كلمات مفتاحية.
     ------------------------------------------------------------ */
  var BASE = freeze({
    ok: true, enabled: true, online: true,
    name: 'رحيق',
    greeting: 'أهلًا بيك في أكاديمية رحيق 👋 أنا رحيق، مساعدك الذكي — اسألني أي سؤال.',
    chatIntro: 'اسألني أي سؤال — عن التسجيل أو أي حاجة تانية، وأنا معاك 👇',
    quickReplies: [
      { id: 'problem', label: 'فين المشكلة؟' },
      { id: 'upload', label: 'عايز أرفع مستند' },
      { id: 'password', label: 'نسيت كلمة السر' },
      { id: 'human', label: 'عايز أكلم موظف' }
    ],
    steps: {
      1: 'الخطوة 1: بيانات ولي الأمر. ابدأ بالاسم الرباعي ورقم الموبايل.',
      2: 'الخطوة 2: بيانات الطالب. اكتب اسم ابنك وتاريخ ميلاده والصف.',
      3: 'الخطوة 3: المستندات. ارفع شهادة الميلاد وصورة الطالب.'
    },
    guide: {
      parentName: 'اكتب اسمك رباعي: 4 أسماء على الأقل.',
      relation: 'اختار صلة القرابة بالطالب.',
      mobile: 'اكتب رقم الموبايل 11 رقمًا وراجع الأرقام الناقصة أو الزائدة.',
      whatsapp: 'رقم الواتساب لازم 11 رقم، أو سيبه فاضي لو هو نفس الموبايل.',
      email: 'اكتب البريد بدون مسافات، مع علامة @ واحدة وبينها نص قبلها وبعدها.',
      password: 'كلمة السر لازم 6 حروف أو أرقام على الأقل.',
      confirmPassword: 'اكتب نفس كلمة السر مرة تانية بالظبط.',
      studentName: 'اكتب اسم الطالب رباعي: 4 أسماء على الأقل.',
      dob: 'اختار تاريخ ميلاد صحيح للطالب، بعد سنة 1900 وليس في المستقبل.',
      gender: 'اختار نوع الطالب.',
      programType: 'اختار نوع البرنامج أولًا: تأسيس أو منهج دراسي.',
      foundationLevel: 'اختار مستوى التأسيس: للصغار أو للكبار.',
      foundationSubjects: 'علّم على مادة واحدة على الأقل من قائمة مواد التأسيس.',
      grade: 'اختار الصف الدراسي المطلوب.',
      prevSchool: 'اسم المدرسة السابقة اختياري.',
      address: 'اكتب عنوانًا من 5 أحرف على الأقل، مثل المحافظة والمدينة والشارع.',
      healthNotes: 'لو فيه ملاحظات صحية اكتبها هنا، وده اختياري.',
      birthCert: 'ارفع صورة واضحة لشهادة الميلاد من هنا.',
      photo: 'ارفع صورة شخصية حديثة للطالب من هنا.',
      reportCard: 'آخر شهادة دراسية اختيارية، ارفعها لو موجودة.',
      agree: 'علّم على الموافقة على الشروط والأحكام عشان تقدر تبعت الطلب.'
    },
    lines: {
      stuck: 'تحب أساعدك في الخطوة دي؟',
      fieldFixed: 'تمام كده 👌',
      success: 'مبروك! 🎉 طلب التسجيل اتبعت بنجاح، احتفظ برقم الطلب.',
      offHours: 'أنا متاح في مواعيد العمل بس. تقدر تكمّل الاستمارة عادي، ولو محتاج حاجة كلّم الأكاديمية على واتساب.'
    },
    animations: { idle: true, blink: true, blinkEverySec: 3, tilt: true, wave: true, point: true, expressions: true, talk: true, confetti: true, stuckAfterSec: 10, roam: true, walk: true, run: true, jump: true, dance: true, spin: true, stretch: true, float: true, nod: true, shake: true, swing: true, flip: true, bounce: true, dizzy: true },
    sounds: { enabled: true, volume: 0.4, speech: false },
    limits: { maxMessages: 40, maxChars: 800 }
  });

  var cfg = null;
  var root = null, mascot = null, charBtn = null, bubble = null, chat = null, motion = null;
  var logEl = null, inputEl = null, quickEl = null, captchaEl = null, captchaInput = null, metaLeft = null, metaCount = null, dotEl = null, statusEl = null, soundBtn = null;
  var micBtn, voiceNote, listening = null, voiceDraft = false, voiceSeq = 0;
  var nativeVoice = window.MajlisVoice;
  var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var frames = {};
  var timers = [];
  var observers = [];
  var listeners = [];

  var pose = 'idle', poseTimer = 0, blinkOn = false, mouthShut = false, talkTimer = 0, bubbleTimer = 0;
  var pointing = null, pointRaf = 0, lastPointed = '', lastErrorField = '', lastErrorAt = 0;
  var lastActivity = Date.now(), interacted = false, stuckShown = false;
  var currentStepSeen = 0, celebrated = false;
  var chatOpen = false, chatGreeted = false, busy = false, locked = false, needCaptcha = false;
  var sid = '', ctxToken = '', muted = false, audioCtx = null, offlineRetry = 0, offlineTries = 0, revealTimer = 0;
  var serverSeen = false;      // هل وصل إعداد الخادم مرة واحدة على الأقل؟

  try { muted = window.localStorage.getItem('yaseen_muted') === '1'; } catch (e) {}
  try { sid = window.sessionStorage.getItem('yaseen_sid') || ''; } catch (e) {}
  try {
    ctxToken = window.sessionStorage.getItem('yaseen_ctx') || '';
    if (ctxToken.length > 6000) {
      ctxToken = '';
      window.sessionStorage.removeItem('yaseen_ctx');
    }
  } catch (e) {}

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
    /* same-origin: تُحفظ كوكيز Vercel (فحص WAF/checkpoint) أثناء الاتصال بشبكة خاصة */
    var opts = Object.assign({ credentials: 'same-origin', cache: 'no-store' }, options || {});
    if (ctrl) opts.signal = ctrl.signal;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, REQ_TIMEOUT_MS);
    return window.fetch(url, opts).then(function (res) {
      clearTimeout(t);
      return res.json().then(
        function (body) { return { status: res.status, body: body }; },
        /* صفحة خطأ HTML (بوابة/حجب) ليست ردًا صالحًا: نعتبرها فشلًا عابرًا قابلًا للإعادة */
        function () { return { status: res.status, body: {}, badBody: true }; }
      );
    }, function (err) { clearTimeout(t); throw err; });
  }

  /* هل الخطأ عابر ويستحق محاولة تلقائية ثانية؟ */
  function transient(res) {
    if (!res) return true;
    if (res.badBody) return true;
    var s = Number(res.status) || 0;
    return s === 0 || s === 408 || s === 425 || s === 429 || s >= 500;
  }

  /* محاولة ثانية واحدة تلقائيًا للأخطاء العابرة (شبكة/بوابة/ضغط) بلا أي تدخل من ولي الأمر */
  function requestWithRetry(url, options) {
    return request(url, options).then(function (res) {
      if (!transient(res)) return res;
      return new Promise(function (resolve, reject) {
        later(function () {
          request(url, options).then(resolve, reject);
        }, RETRY_DELAY_MS);
      });
    }, function (err) {
      return new Promise(function (resolve, reject) {
        later(function () {
          request(url, options).then(resolve, reject);
        }, RETRY_DELAY_MS);
      }).then(null, function () { throw err; });
    });
  }

  /* ---------------- تحميل الإعدادات الظاهرة من الخادم ---------------- */
  function loadConfig() {
    return request(CONFIG_URL, { method: 'GET' }).then(function (res) {
      var body = res.body;
      /* الخادم قال صراحةً إن المدير أوقف البوت => تُزال رحيق فورًا */
      if (body && (body.disabled === true || body.enabled === false)) { destroy(); return; }
      if (res.status !== 200 || !body || body.ok !== true || body.enabled !== true) { offline(); return; }
      cfg = freeze(body);
      serverSeen = true;
      offlineTries = 0;
      clearTimeout(offlineRetry);
      if (!root) build(); else applyConfig();
      reveal();                     // الخادم رد: نُظهر رحيق بإعداد المدير فورًا
    }, offline);                    // تعذّر الوصول للخادم: لا تُخفى الشخصية
  }

  /* ------------------------------------------------------------
     الخادم غير متاح الآن (شبكة / حجب / بدء بارد / استضافة ثابتة):
     تظهر رحيق بشكلها الأساسي، وتُستبدل نصوصها بإعداد المدير أول ما
     يرد الخادم. لا تُخفى الشخصية ولا يبقى ولي الأمر بلا مساعد.
     ------------------------------------------------------------ */
  function offline() {
    if (!root) { cfg = BASE; build(); reveal(); }   // ظاهرة بالفعل؟ لا نلمس ما يراه ولي الأمر
    clearTimeout(offlineRetry);
    offlineRetry = later(function () { loadConfig(); }, retryDelay());
  }
  /* إظهار رحيق: فورًا مع رد الخادم، أو بعد مهلة قصيرة لو تأخّر/فشل.
     الغرض: ألا تظهر ولو للحظة لو أمر المدير بإيقافها. */
  function reveal() {
    clearTimeout(revealTimer);
    if (root) root.classList.remove('is-pending');
  }

  /* تأخير متزايد بين المحاولات حتى لا يتحول انقطاع الخادم إلى وابل طلبات */
  function retryDelay() {
    var ms = Math.min(60000, RETRY_MS * Math.pow(2, Math.min(3, offlineTries)));
    offlineTries += 1;
    return ms;
  }

  /* ---------------- البناء ---------------- */
  function build() {
    if (root) return;
    if (!cfg) cfg = BASE;
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
      img.addEventListener('error', function () {        // لو تلف إطار: نرجع للصورة الأصلية بدل شخصية فارغة
        if (img.getAttribute('data-fallback') === '1') return;
        img.setAttribute('data-fallback', '1');
        img.classList.add('is-raw');
        img.src = ASSETS + 'src/base.jpg';
      });
      frames[name] = img;
      flip.appendChild(img);
    });
    body.appendChild(flip); tilt.appendChild(body);
    charBtn.appendChild(shadow); charBtn.appendChild(tilt);
    mascot.appendChild(bubble); mascot.appendChild(charBtn);

    chat = buildChat();
    root.appendChild(mascot); root.appendChild(chat);
    document.body.appendChild(root);
    if (window.RaheeqMotion) {
      motion = window.RaheeqMotion.mount({ root: root, mascot: mascot, charBtn: charBtn, busy: function () { return busy || chatOpen || !!pointing; }, lastActivity: function () { return lastActivity; }, onAction: function () { release(); lastActivity = Date.now(); }, onDrag: dropPoint });
    }

    on(charBtn, 'click', function () { toggleChat(); });
    on(bubble, 'click', function () { openChat(bubble.getAttribute('data-quick') || ''); });
    on(root, 'contextmenu', function (e) { e.preventDefault(); });
    ['dragover', 'drop'].forEach(function (t) { on(root, t, function (e) { e.preventDefault(); }); });   // لا رفع ملفات للبوت

    applyConfig();
    startIdle();
    watchForm();
    watchViewport();
    on(document, 'visibilitychange', releaseOnHide);
    on(window, 'pagehide', releaseOnHide);
    var voiceEntry = document.querySelector('.ysn-open-voice');
    if (voiceEntry) on(voiceEntry, 'click', function () { openChat(''); });

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
    inputEl.placeholder = 'اكتب أي سؤال…';
    inputEl.setAttribute('aria-label', 'اكتب أي سؤال');
    var sendBtn = el('button', null, 'إرسال'); sendBtn.type = 'submit';
    micBtn = el('button', 'ysn-mic', '🎙'); micBtn.type = 'button';
    voiceNote = el('div', 'ysn-voice-note');
    voiceNote.setAttribute('role', 'status');
    form.appendChild(inputEl); form.appendChild(micBtn); form.appendChild(sendBtn);

    var meta = el('div', 'ysn-meta');
    metaLeft = el('span'); metaCount = el('span');
    meta.appendChild(metaLeft); meta.appendChild(metaCount);

    box.appendChild(head); box.appendChild(logEl); box.appendChild(quickEl); box.appendChild(captchaEl); box.appendChild(form); box.appendChild(voiceNote); box.appendChild(meta);

    on(closeBtn, 'click', function () { closeChat(); });
    on(soundBtn, 'click', function () {
      muted = !muted;                               // كتم فقط — لا يغيّر أي سلوك للبوت
      try { window.localStorage.setItem('yaseen_muted', muted ? '1' : '0'); } catch (e) {}
      if (muted) stopSpeech();
      renderSound();
    });
    on(micBtn, 'click', toggleMic);
    on(form, 'submit', function (e) {
      e.preventDefault();
      var text = inputEl.value.replace(/\s+/g, ' ').trim();
      if (needCaptcha) { sendMessage({ captcha: captchaInput.value }, null); return; }
      if (!text) return;
      var readReply = voiceDraft; voiceDraft = false;
      inputEl.value = ''; renderCount();
      sendMessage({ message: text }, text, readReply);
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
    charBtn.setAttribute('aria-label', 'افتح محادثة ' + cfg.name + ' — المساعد الذكي. اسحبني لأي مكان في الشاشة، أو حرّكني بالأسهم');
    charBtn.setAttribute('title', 'اسحبني لأي مكان في الشاشة · نقرة قصيرة تفتح المحادثة');
    chat.setAttribute('aria-label', 'محادثة ' + cfg.name);
    chat.querySelector('.ysn-name').textContent = cfg.name;
    dotEl.classList.toggle('is-off', !cfg.online);
    statusEl.textContent = !cfg.online ? 'خارج مواعيد العمل' : (cfg.ai === true ? 'متصل · الذكاء الاصطناعي مُعدّ' : (serverSeen ? 'متصل · إرشاد التسجيل بدون ذكاء اصطناعي' : 'جارٍ الاتصال…'));
    mascot.classList.toggle('a-idle', anim('idle'));
    mascot.classList.toggle('a-tilt', anim('tilt'));
    if (motion) motion.configure(cfg.animations);

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
    Array.prototype.forEach.call(chat.querySelectorAll('.ysn-quick button, .ysn-form button'), function (b) { b.disabled = off || !!listening; });
    micBtn.disabled = off || needCaptcha || !canListen();
    micBtn.setAttribute('aria-label', listening ? 'إلغاء الاستماع' : 'استخدم الميكروفون للإملاء بالعربية');
    micBtn.setAttribute('aria-pressed', String(!!listening));
    micBtn.title = canListen() ? 'الإملاء بالعربية' : 'الإملاء غير متاح في هذا المتصفح';
  }

  /* ---------------- الحركات ---------------- */
  function renderPose() {
    var show = pose;
    if (pose === 'idle') {
      if (blinkOn) show = 'blink';
      else if (mouthShut) show = 'talk';
    }
    POSES.forEach(function (name) { frames[name].classList.toggle('is-on', name === show); });
    if (motion) motion.blink(blinkOn);
  }
  function setPose(name, ms) {
    clearTimeout(poseTimer);
    pose = POSES.indexOf(name) >= 0 ? name : 'idle';
    renderPose();
    if (motion) motion.pose(pose, ms);
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
    if (motion) motion.talking(false);
    if (!anim('talk')) return;
    mascot.classList.add('is-bob');
    if (motion) motion.talking(true);
    var end = Date.now() + ms;
    talkTimer = every(function () {
      mouthShut = !mouthShut;
      if (Date.now() >= end) { stopEvery(talkTimer); mouthShut = false; if (mascot) { mascot.classList.remove('is-bob'); } if (motion) motion.talking(false); }
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
  function canListen() { return !!(nativeVoice || (Recognition && window.isSecureContext !== false)); }
  function canSpeak() { return !!(nativeVoice || (window.speechSynthesis && window.SpeechSynthesisUtterance)); }
  function voiceStatus(text) { if (voiceNote) voiceNote.textContent = text; }
  function voiceHelp() {
    return canListen() ? 'المايك بيستخدم خدمة الإملاء وقد ترسل الصوت لمزوّدها. راجع النص قبل الإرسال.' : 'الإملاء غير متاح هنا. جرّب Chrome أو تطبيق أندرويد، أو اكتب سؤالك.';
  }
  function stopSpeech() {
    try { if (nativeVoice) nativeVoice.postMessage(JSON.stringify({ action: 'stopSpeech' })); } catch (e) {}
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
  }
  function speakAloud(text, requested) {
    if (!cfg || muted || !cfg.sounds.enabled || (!requested && !cfg.sounds.speech) || !canSpeak()) return;
    try {
      var plain = String(text).replace(/[^\p{L}\p{N}\s.,؟!،:]/gu, ' ');
      if (nativeVoice) {
        nativeVoice.postMessage(JSON.stringify({ action: 'speak', text: plain, volume: cfg.sounds.volume }));
        return;
      }
      window.speechSynthesis.cancel();
      var u = new window.SpeechSynthesisUtterance(plain);
      var voices = window.speechSynthesis.getVoices();
      var arabic = voices.find(function (v) { return /^ar[-_]EG$/i.test(v.lang); }) || voices.find(function (v) { return /^ar(?:[-_]|$)/i.test(v.lang); });
      if (voices.length && !arabic) { voiceStatus('مفيش صوت عربي متاح. أضف صوت عربي من إعدادات الجهاز.'); return; }
      if (arabic) u.voice = arabic;
      u.lang = arabic ? arabic.lang : 'ar-EG'; u.volume = cfg.sounds.volume;
      u.onerror = function (e) {
        if (chatOpen && e.error !== 'canceled' && e.error !== 'interrupted') voiceStatus('تعذّر تشغيل الصوت. جرّب زر «اسمع الرد» أو راجع إعدادات الصوت العربي.');
      };
      window.speechSynthesis.speak(u);
    } catch (e) { if (chatOpen) voiceStatus('تعذّر تشغيل الصوت على هذا الجهاز.'); }
  }
  function cancelMic() {
    var run = listening;
    if (!run) return;
    listening = null;
    clearTimeout(run.timer);
    try {
      if (run.rec) run.rec.abort();
      else nativeVoice.postMessage(JSON.stringify({ action: 'cancel', id: run.id }));
    } catch (e) {}
    if (root && cfg) renderLock();
    voiceStatus(voiceHelp());
  }
  function finishMic(run, text, error) {
    if (listening !== run) return;
    listening = null;
    clearTimeout(run.timer);
    renderLock();
    var value = String(text || '').trim();
    if (!value) {
      voiceStatus(error === 'not-allowed' || error === 'service-not-allowed' ? 'إذن الميكروفون مرفوض. فعّله من إعدادات الموقع أو التطبيق.'
        : error === 'unsupported' ? 'خدمة التعرّف على الكلام غير متاحة على جهازك. اكتب سؤالك بدلًا منها.'
        : 'ما قدرناش نميّز الكلام. جرّب تاني أو اكتب سؤالك.');
      return;
    }
    inputEl.value = (inputEl.value.trim() ? inputEl.value.trim() + ' ' + value : value).slice(0, cfg.limits.maxChars);
    voiceDraft = true;
    renderCount();
    voiceStatus('راجع الكلام واضغط «إرسال»؛ الرد هيتقري لو الصوت متاح ومش مكتوم.');
  }
  if (nativeVoice) {
    nativeVoice.onmessage = function (event) {
      try {
        var msg = JSON.parse(event.data);
        if (msg.action === 'speech-error' && chatOpen) voiceStatus('الصوت العربي مش متاح. راجع إعدادات تحويل النص إلى كلام في أندرويد.');
        if (msg.action === 'result' && listening && msg.id === listening.id) finishMic(listening, msg.text, msg.error);
      } catch (e) {}
    };
  }
  function toggleMic() {
    if (listening) { cancelMic(); return; }
    if (!chatOpen || micBtn.disabled || !canListen()) return;
    stopSpeech();
    var run = { id: ++voiceSeq };
    listening = run;
    renderLock();
    voiceStatus('جاري الاستماع… اتكلم بالعربي. اضغط المايك تاني للإلغاء.');
    run.timer = setTimeout(function () {
      if (listening === run) { cancelMic(); voiceStatus('انتهت مهلة الاستماع. اضغط المايك للمحاولة مرة أخرى.'); }
    }, 30000);
    try {
      if (nativeVoice) { nativeVoice.postMessage(JSON.stringify({ action: 'listen', id: run.id })); return; }
      var rec = run.rec = new Recognition();
      rec.lang = 'ar-EG'; rec.continuous = false; rec.interimResults = false;
      rec.onresult = function (event) {
        var item = event.results[event.resultIndex || 0];
        finishMic(run, item && item[0] && item[0].transcript);
      };
      rec.onerror = function (event) { finishMic(run, '', event.error); };
      rec.onend = function () { finishMic(run, ''); };
      rec.start();
    } catch (e) { finishMic(run, '', 'unsupported'); }
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
  /* رحيق تنتقل فعلًا إلى الخانة نفسها (في أي مكان بالصفحة) وتقف بجانبها:
     داخل حدود الشاشة دائمًا، وتتبعها لو تحرّكت — مع موجّه في بالون الكلام
     لأنها قد تكون في أعلى الصفحة أو أسفلها. */
  function placeAtTarget() {
    if (!pointing || !mascot) return;
    var r = pointing.el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    if (motion) { motion.follow(pointing.el); return; }        // طبقة الحركة تتولى الموضع كاملًا
    var m = charBtn.getBoundingClientRect();
    var w = m.width || 96, h = m.height || 126;
    var vw = window.innerWidth, vh = window.innerHeight;
    var style = window.getComputedStyle(mascot);
    var homeLeft = parseFloat(style.left) || 14;
    var homeTop = vh - (parseFloat(style.bottom) || 14) - h;
    var x = r.left - w - 4, y = r.top + r.height / 2 - h * 0.6;
    if (x < 4) { x = Math.max(4, r.left + 6); y = r.top - h + 14; }       // لا مساحة بجانب الخانة: تقف فوق طرفها
    if (y < 4) y = r.bottom + 8;
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
    var wasPointing = !!pointing;
    pointing = null;
    if (mascot) { mascot.style.transform = ''; mascot.classList.remove('is-below'); }
    if (motion) { motion.hold(false); if (wasPointing) motion.bringBack(); }   // تعود لمكانها المختار
    if (pose === 'point') setPose('idle');
  }
  /* إفلات الإشارة دون سحب الشخصية إلى مكانها السابق (عند السحب باليد) */
  function dropPoint() {
    cancelAnimationFrame(pointRaf);
    if (pointing) { try { pointing.el.classList.remove('ysn-glow'); } catch (e) {} }
    pointing = null;
    if (mascot) { mascot.style.transform = ''; mascot.classList.remove('is-below'); }
    if (pose === 'point') setPose('idle');
    if (motion) motion.hold(false);
  }
  function pointTo(name, text, expression) {
    var target = fieldTarget(name);
    if (!anim('point') || !target || !visible(target)) { say(text, { expression: expression === 'point' ? 'happy' : expression }); return; }
    release();
    if (motion) { motion.hold(true); motion.follow(target, true); }   // تنزلق إلى الخانة في أي مكان
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
        ['birthCert', 'photo'].forEach(function (k) {
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

    /* خطأ في خانة بعد مغادرتها: مثلًا الاسم ناقص أجزاء أو الموبايل غير مكتمل */
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
  function whatsappHref() {
    var num = '';
    var meta = document.querySelector('meta[name="raheeq-whatsapp"]');
    if (meta) num = String(meta.getAttribute('content') || '');
    if (window.RaheeqWhatsApp && typeof window.RaheeqWhatsApp.number === 'function') {
      try { num = String(window.RaheeqWhatsApp.number() || num); } catch (e) {}
    }
    num = num.replace(/[^0-9]/g, '');
    return /^\d{8,15}$/.test(num) ? 'https://wa.me/' + num : '';
  }

  /* إرشاد محلي فوري للأزرار السريعة: يظهر لحظيًا حتى لو تأخر الرد الذكي،
     ويُغطّى بالرد الكامل أول ما يصل. لا يحتوي أي قواعد أو إجابات من الخادم. */
  var LOCAL_QUICK = {
    problem: 'قولّي فين واقف دلوقتي في الاستمارة (ولي الأمر/الطالب/المستندات) وإيه الرسالة اللي ظهرتلك، وأنا أوجّهك للخانة بالظبط.',
    upload: 'المستندات المطلوبة: شهادة الميلاد + صورة شخصية للطالب، وبيان النجاح اختياري. ارفعها صورًا واضحة (JPG/PNG) من خطوة «المستندات».',
    password: 'لو نسيت كلمة السر: من صفحة الدخول اضغط «تسجيل جديد» بنفس رقم الموبايل لتحديث بياناتك، أو كلّم فريق التسجيل على واتساب لتأكيد حسابك بأمان.',
    human: 'تمام، فريق تسجيل أكاديمية رحيق على واتساب جاهز لمساعدتك — اضغط الزر الأخضر تحت وهنكمل معاك على طول.'
  };

  function whatsappLink() {
    var href = whatsappHref();
    if (!href) return null;
    var link = el('a', 'ysn-wa', 'افتح واتساب الأكاديمية');
    link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    return link;
  }

  /* زر إعادة المحاولة داخل المحادثة: يعيد نفس الطلب فورًا دون كتابة أي شيء */
  function addRetry(msg, payload) {
    if (!msg || !payload) return;
    var btn = el('button', 'ysn-retry', 'إعادة المحاولة ↻');
    btn.type = 'button';
    btn.addEventListener('click', function () {
      if (busy || locked || !root) return;
      /* نمسح الرسالة الفاشلة وزرها ثم نعيد الإرسال نفسه */
      if (btn.parentNode) btn.parentNode.removeChild(btn);
      if (msg.parentNode) msg.parentNode.removeChild(msg);
      if (payload.quickReply) sendMessage({ quickReply: payload.quickReply }, null);
      else if (payload.message) sendMessage({ message: payload.message }, null);
      else if (payload.captcha != null) sendMessage({ captcha: payload.captcha }, null);
    });
    msg.appendChild(document.createElement('br'));
    msg.appendChild(btn);
    logEl.scrollTop = logEl.scrollHeight;
  }

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
    if (motion) motion.close();
    release();
    bubble.hidden = true;
    chat.hidden = false;
    root.classList.add('is-chat-open');
    try { document.body.classList.add('ysn-chat-open'); } catch (e) {}   // يخفي شريط الاتصال العائم
    fitChatViewport();
    charBtn.setAttribute('aria-expanded', 'true');
    if (!chatGreeted) {
      chatGreeted = true;
      addMessage(cfg.greeting, 'bot');
      addMessage(cfg.online ? cfg.chatIntro : cfg.lines.offHours, 'bot');
    }
    if (!voiceNote.textContent) voiceStatus(voiceHelp());
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
    cancelMic(); stopSpeech();
    chat.hidden = true;
    root.classList.remove('is-chat-open');
    try { document.body.classList.remove('ysn-chat-open'); } catch (e) {}
    cssVar(root, '--ysn-chat-max', '');
    cssVar(root, '--ysn-chat-bottom', '');
    charBtn.setAttribute('aria-expanded', 'false');
  }

  /* ------------------------------------------------------------
     لوحة المفاتيح على الجوال + الشاشات القصيرة:
     نضبط ارتفاع نافذة المحادثة على المساحة المرئية الفعلية
     (visualViewport) حتى لا يختفي حقل الكتابة أو زر الإرسال
     تحت لوحة المفاتيح، ونرفع النافذة مع إزاحة العرض عند الحاجة.
     ------------------------------------------------------------ */
  function fitChatViewport() {
    if (!root || !chat) return;
    var vv = window.visualViewport;
    var layoutH = window.innerHeight || 0;
    var vh = (vv && vv.height) || layoutH;
    var top = (vv && vv.offsetTop) || 0;
    if (!vh) return;
    /* الارتفاع المتاح داخل الجزء المرئي فقط */
    var max = Math.max(240, Math.round(vh - 16));
    cssVar(root, '--ysn-chat-max', max + 'px');
    /* لوحة المفاتيح مفتوحة (iOS لا يصغّر layout viewport): نرفع النافذة فوقها */
    var hiddenBelow = Math.max(0, layoutH - vh - top);
    cssVar(root, '--ysn-chat-bottom', hiddenBelow ? Math.round(hiddenBelow + 8) + 'px' : '');
  }

  /* تعيين متغيّر CSS بأمان (بيئات الاختبار المصغّرة قد لا توفّر style API) */
  function cssVar(node, name, value) {
    var st = node && node.style;
    if (!st) return;
    try {
      if (typeof st.setProperty === 'function') {
        if (value === '' || value == null) { if (typeof st.removeProperty === 'function') st.removeProperty(name); }
        else st.setProperty(name, value);
      } else if (value === '' || value == null) { delete st[name]; }
      else st[name] = value;
    } catch (e) {}
  }

  function watchViewport() {
    var vv = window.visualViewport;
    if (vv && typeof vv.addEventListener === 'function') {
      on(vv, 'resize', function () { if (chatOpen) fitChatViewport(); });
      on(vv, 'scroll', function () { if (chatOpen) fitChatViewport(); });
    }
    on(window, 'resize', function () { if (chatOpen) fitChatViewport(); });
    on(window, 'orientationchange', function () { later(function () { if (chatOpen) fitChatViewport(); }, 260); });
  }
  function toggleChat() { if (chatOpen) closeChat(); else openChat(''); }

  /* مغادرة الصفحة/إخفاؤها أثناء انتظار الرد: نحرّر الحالة حتى لا تعود المحادثة مجمّدة */
  function releaseOnHide(event) {
    if (event && event.type === 'visibilitychange' && !document.hidden) return;
    cancelMic(); stopSpeech();
    if (!busy) return;
    busy = false;
    if (root && chat) {
      var dots = chat.querySelector('.ysn-typing');
      if (dots && dots.parentNode) dots.parentNode.remove();
      renderLock();
    }
  }

  function setCaptcha(question) {
    needCaptcha = !!question;
    captchaEl.hidden = !needCaptcha;
    if (needCaptcha) {
      captchaEl.querySelector('.ysn-captcha-q').textContent = question;
      captchaInput.value = '';
      try { captchaInput.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  function sendMessage(payload, shownText, readReply) {
    if (listening || !cfg || busy || locked || !cfg.online) return;
    if (needCaptcha && payload.captcha == null) { try { captchaInput.focus(); } catch (e) {} return; }
    busy = true; renderLock();
    if (shownText) addMessage(shownText, 'user');
    var typing = addTyping();
    setPose(anim('expressions') ? 'thinking' : 'idle');
    var body = { sid: sid, context: { step: currentStep(), invalid: stepErrors() } };
    if (ctxToken && ctxToken.length <= 6000) {
      body.ctxToken = ctxToken;
    } else if (ctxToken) {
      ctxToken = '';
      try { window.sessionStorage.removeItem('yaseen_ctx'); } catch (e) {}
    }
    if (payload.quickReply) body.quickReply = payload.quickReply;
    if (payload.message) body.message = String(payload.message).slice(0, cfg.limits.maxChars);
    if (payload.captcha != null) body.captcha = String(payload.captcha).slice(0, 6);
    var started = Date.now();

    function postChat(reqBody) {
      return requestWithRetry(CHAT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody) });
    }

    /* مسار واحد للفشل: يضمن تحرير busy دائمًا ويعطي ولي الأمر مخرجًا فوريًا
       (إرشاد محلي + واتساب + إعادة المحاولة) بدل رسالة نهاية مسدودة. */
    function softFail() {
      if (!root) { busy = false; return; }
      if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
      busy = false;
      if (!serverSeen) {
        /* لا خادم إطلاقًا (استضافة ثابتة/انقطاع كامل): نفس المسار المعتمد سابقًا */
        var m0 = addMessage('مش قادر أوصل بمساعد رحيق الذكي دلوقتي 🙏 تقدر تكمّل الاستمارة عادي، ولو محتاج مساعدة كلّم فريق الأكاديمية على واتساب.', 'bot');
        var l0 = whatsappLink();
        if (l0) { m0.appendChild(document.createElement('br')); m0.appendChild(l0); }
        addRetry(m0, payload);
      } else {
        var guide = payload && payload.quickReply ? LOCAL_QUICK[payload.quickReply] : '';
        var m1 = addMessage(guide || 'الرد الذكي اتأخر شوية ومش هسيبك مستني 🙏 اضغط «إعادة المحاولة» تحت، أو كلّم فريق التسجيل على واتساب وهنرد عليك فورًا.', 'bot');
        var l1 = whatsappLink();
        if (l1) { m1.appendChild(document.createElement('br')); m1.appendChild(l1); }
        addRetry(m1, payload);
      }
      setPose(anim('expressions') ? 'worried' : 'idle', 2500);
      renderLock();
    }

    postChat(body).then(function (res) {
      if ((res.status === 413 || res.status === 400) && body.ctxToken) {
        ctxToken = '';
        try { window.sessionStorage.removeItem('yaseen_ctx'); } catch (e) {}
        delete body.ctxToken;
        return postChat(body);
      }
      return res;
    }).then(function (res) {
      return new Promise(function (resolve) { later(function () { resolve(res); }, Math.max(0, 400 - (Date.now() - started))); });
    }).then(function (res) {
      if (!root) return;
      var data = res.body || {};
      if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
      busy = false;
      if (data.disabled) { destroy(); return; }             // المدير أوقف البوت
      if (typeof data.sid === 'string') { sid = data.sid; try { window.sessionStorage.setItem('yaseen_sid', sid); } catch (e) {} }
      if (typeof data.ctxToken === 'string' && data.ctxToken) { ctxToken = data.ctxToken; try { window.sessionStorage.setItem('yaseen_ctx', ctxToken); } catch (e) {} }
      if (typeof data.reply !== 'string') { softFail(); return; }

      var msg = addMessage(data.reply, 'bot');
      if (data.ai === true) msg.appendChild(el('span', 'ysn-ai-label', 'رد بالذكاء الاصطناعي'));
      if (cfg.sounds.enabled && canSpeak()) {
        var replay = el('button', 'ysn-retry', '🔊 اسمع الرد');
        replay.type = 'button';
        replay.addEventListener('click', function () {
          cancelMic();
          if (muted) { voiceStatus('الصوت مكتوم. فعّله من زر الصوت فوق.'); return; }
          speakAloud(data.reply, true);
        });
        msg.appendChild(document.createElement('br'));
        msg.appendChild(replay);
      }
      if (data.handoff && /^\d{8,15}$/.test(String(data.handoff.whatsapp))) {
        var a = el('a', 'ysn-wa', 'افتح واتساب الأكاديمية');
        a.href = 'https://wa.me/' + data.handoff.whatsapp;
        a.target = '_blank'; a.rel = 'noopener noreferrer';
        msg.appendChild(document.createElement('br'));
        msg.appendChild(a);
      }
      if (Array.isArray(data.followUps) && data.followUps.length) {
        var chips = el('div', 'ysn-followups');
        data.followUps.slice(0, 3).forEach(function (qText) {
          if (typeof qText !== 'string' || !qText.trim()) return;
          var chip = el('button', 'ysn-chip', qText.trim());
          chip.type = 'button';
          chip.addEventListener('click', function () {
            if (busy || locked) return;
            sendMessage({ message: qText.trim() }, qText.trim());
          });
          chips.appendChild(chip);
        });
        if (chips.firstChild) {
          logEl.appendChild(chips);
          logEl.scrollTop = logEl.scrollHeight;
        }
      }
      locked = !!data.locked;
      setCaptcha(data.captcha && typeof data.captcha.question === 'string' ? data.captcha.question : '');
      if (typeof data.remaining === 'number') metaLeft.textContent = 'باقي ' + data.remaining + ' رسالة';
      talk(Math.min(3000, Math.max(900, data.reply.length * 45)));
      blip();
      if (chatOpen && !document.hidden) speakAloud(data.reply, readReply);
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
      softFail();
    });
  }

  /* ---------------- الإزالة (مفتاح الإيقاف) ---------------- */
  function destroy() {
    cancelMic(); stopSpeech(); voiceDraft = false;
    cfg = null;
    clearTimeout(offlineRetry);
    if (!root) return;
    release();
    if (motion) { motion.destroy(); motion = null; }
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
    try { document.body.classList.remove('ysn-chat-open'); } catch (e) {}
  }

  function start() {
    if (!root && !cfg) {                          // شكل رحيق الأساسي فورًا — قبل أي طلب للخادم
      cfg = BASE;
      build();
      root.classList.add('is-pending');
      revealTimer = later(reveal, 700);           // مهلة قصيرة: لو الخادم لم يرد بعد نُظهرها بأساسها
    }
    loadConfig();
    setInterval(function () { if (!document.hidden) loadConfig(); }, REFRESH_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) loadConfig(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
