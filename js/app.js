/* ============================================================
   رحيق RAHEEQ — منطق المنصة
   ثلاث خطوات • تحقق • رفع مستندات • LocalStorage • دخول • نجاح
   ============================================================ */
(function () {
  'use strict';

  var S = window.RaheeqSound;
  var V = window.RaheeqValidation;
  var C = window.RaheeqConfetti;
  var U = window.RaheeqUploads;
  var API = window.RaheeqApi;
  var WA = window.RaheeqWhatsApp;
  var I = window.RaheeqI18n;
  var SET = window.RaheeqSettings;
  function $(id) { return document.getElementById(id); }
  /* ترجمة نص عربي إلى لغة الواجهة الحالية (النص العربي هو المفتاح) */
  function T(str) { return I && I.t ? I.t(str) : str; }
  function play(n) { if (S) S.play(n); }
  function vibrate(p) { if (S) S.vibrate(p); }
  function esc(s) { return V.esc(s); }

  var LS_USERS = 'raheeq_users';
  var LS_SESSION = 'raheeq_session';
  var currentStep = 1;
  var mode = 'register';
  /* كل ملف يُحفظ كسجل يحوي بيانات الصورة الفعلية (dataUrl)، وليس الاسم فقط */
  var uploadedFiles = { birthCert: null, photo: null, parentCard: null, reportCard: null };
  var uploadSeq = {};          /* يمنع نتائج القراءة القديمة إن استُبدل الملف */
  var pendingUploads = {};
  var lastSubmission = null;
  var lastStorageError = '';
  var pendingSync = null;
  var missingServer = false;   /* آخر محاولة رفع فشلت بسبب غياب الخادم */
  var waSent = false;          /* هل فتح ولي الأمر واتساب من هذه الشاشة */
  var toastTimer;

  /* ---------------- أدوات واجهة ---------------- */
  function showToast(msg, isError) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast is-visible' + (isError ? ' is-error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-visible'); }, 3400);
  }

  function shake() {
    var card = $('registerCard');
    if (!card) return;
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
  }

  function setFieldErrors(errors) {
    document.querySelectorAll('.field.has-error').forEach(function (f) { f.classList.remove('has-error'); });
    Object.keys(errors).forEach(function (k) {
      var f = document.querySelector('[data-field="' + k + '"]');
      if (f) f.classList.add('has-error');
    });
  }

  function clearFieldError(name) {
    var f = document.querySelector('[data-field="' + name + '"]');
    if (f) f.classList.remove('has-error');
  }

  function showAlert(id, msg) {
    var el = $(id);
    if (!el) return;
    if (!msg) { el.classList.remove('is-visible'); el.textContent = ''; return; }
    el.textContent = '⚠ ' + msg;
    el.classList.add('is-visible');
  }

  function fail(msg, alertId) {
    play('error');
    vibrate([100, 50, 100]);   // اهتزاز الخطأ على الجوال
    shake();                    // اهتزاز خفيف للفورم
    /* رسائل التحقق قد تكون عربية أو إنجليزية حسب الاختيار داخل validation.js */
    var text = T(msg);
    var prefix = T('راجع البيانات المطلوبة وأكمل الحقول المميزة بعلامة * — ');
    if (text.indexOf(prefix) === 0) text = prefix + T(text.slice(prefix.length));
    showAlert(alertId || 'formAlert', text);
    var first = document.querySelector('.form-step.is-current .field.has-error input, .form-step.is-current .field.has-error select, .form-step.is-current .field.has-error textarea');
    if (first) { try { first.focus({ preventScroll: false }); } catch (e) { first.focus(); } }
  }

  function succeed() {
    play('success');
    vibrate(100);              // اهتزاز النجاح على الجوال
    if (C) C.launch();
  }

  /* ---------------- التبويبات: تسجيل / دخول ---------------- */
  function switchMode(next, opts) {
    if (!opts) opts = {};
    var changed = mode !== next;
    var isAuth = next === 'login' || next === 'register';
    mode = next;

    if (changed && isAuth) play('toggle');   // صوت التبديل بين الدخول والتسجيل

    $('tabRegister').classList.toggle('is-active', next === 'register');
    $('tabLogin').classList.toggle('is-active', next === 'login');
    $('tabRegister').setAttribute('aria-selected', next === 'register' ? 'true' : 'false');
    $('tabLogin').setAttribute('aria-selected', next === 'login' ? 'true' : 'false');

    var tabs = document.querySelector('.tabs');
    var isSuccess = next === 'success';
    if (tabs) tabs.hidden = isSuccess;

    $('registerView').hidden = next !== 'register';
    $('loginView').hidden = next !== 'login';
    $('successView').hidden = next !== 'success';

    if (next === 'register') {
      $('cardTitle').textContent = T('تسجيل ولي الأمر');
      $('cardSub').textContent = T('سجّل بياناتك في دقائق، ونصلك برقم طلبك لمتابعة القبول مع فريق أكاديمية رحيق');
    } else if (next === 'login') {
      $('cardTitle').textContent = T('تسجيل دخول ولي الأمر');
      $('cardSub').textContent = T('أدخل رقم موبايلك وكلمة السر للمتابعة');
    } else {
      $('cardTitle').textContent = T('طلبك لدينا');
      $('cardSub').textContent = T('شكرًا لثقتك في رحيق');
    }

    var card = $('registerCard');
    card.classList.remove('fade-up');
    void card.offsetWidth;
    card.style.animation = 'fadeUp .35s cubic-bezier(.22,.9,.3,1) both';

    if (opts.scroll && card.scrollIntoView) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  $('tabRegister').addEventListener('click', function () {
    if (mode !== 'register') switchMode('register');
  });
  $('tabLogin').addEventListener('click', function () {
    if (mode !== 'login') switchMode('login');
  });
  $('headerLoginBtn').addEventListener('click', function () {
    switchMode('login', { scroll: true });
    setTimeout(function () { var f = $('loginMobile'); if (f) f.focus({ preventScroll: true }); }, 480);
  });
  $('goRegisterBtn').addEventListener('click', function () { switchMode('register'); });
  $('successLoginBtn').addEventListener('click', function () { switchMode('login'); });

  /* ---------------- الخطوات الثلاث ---------------- */
  function renderStep(animate, backward) {
    document.querySelectorAll('.form-step').forEach(function (panel) {
      var active = parseInt(panel.getAttribute('data-step-panel'), 10) === currentStep;
      panel.classList.toggle('is-current', active);
      panel.hidden = !active;
      if (active && animate) {
        panel.classList.remove('slide-next', 'slide-back');
        void panel.offsetWidth;
        panel.classList.add(backward ? 'slide-back' : 'slide-next');
      }
    });
    document.querySelectorAll('.pstep').forEach(function (s) {
      var n = parseInt(s.getAttribute('data-step'), 10);
      s.classList.toggle('is-active', n === currentStep);
      s.classList.toggle('is-done', n < currentStep);
      var dot = s.querySelector('.dot');
      dot.textContent = n < currentStep ? '✓' : String(n);
    });
    var fill = $('progressFill');
    if (fill) fill.style.width = ((currentStep - 1) / 2 * 100) + '%';
    $('prevStepBtn').hidden = currentStep === 1;
    $('nextStepBtn').hidden = currentStep === 3;
    $('submitBtn').hidden = currentStep !== 3;
    showAlert('formAlert', '');
  }

  function goStep(n, backward) {
    var target = Math.max(1, Math.min(3, n));
    if (target === currentStep) return;
    currentStep = target;
    play('step');                 // صوت الانتقال بين الخطوات
    renderStep(true, backward);
    var card = $('registerCard');
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('nextStepBtn').addEventListener('click', function () {
    var errors = currentStep === 1 ? V.step1() : V.step2();
    setFieldErrors(errors);
    var keys = Object.keys(errors);
    if (keys.length) {
      fail('راجع البيانات المطلوبة وأكمل الحقول المميزة بعلامة * — ' + errors[keys[0]], 'formAlert');
      return;
    }
    goStep(currentStep + 1, false);
  });
  $('prevStepBtn').addEventListener('click', function () { goStep(currentStep - 1, true); });

  /* مسح الخطأ أثناء التصحيح + أرقام لاتينية فقط في الحقول الرقمية */
  document.querySelectorAll('#regForm input, #regForm select, #regForm textarea, #loginForm input').forEach(function (el) {
    ['input', 'change'].forEach(function (ev) {
      el.addEventListener(ev, function () {
        var f = el.closest('.field');
        if (f) f.classList.remove('has-error');
        showAlert(el.closest('#loginForm') ? 'loginAlert' : 'formAlert', '');
      });
    });
  });
  ['nationalId', 'mobile', 'whatsapp', 'loginMobile'].forEach(function (id) {
    var el = $(id);
    if (!el) return;
    el.addEventListener('input', function () {
      var clean = V.digitsOnly(el.value).slice(0, id === 'nationalId' ? 14 : 11);
      if (clean !== el.value) el.value = clean;
    });
  });
  var dobEl = $('dob');
  if (dobEl) dobEl.max = new Date().toISOString().slice(0, 10);

  /* زر الإدخال ينتقل للخطوة التالية بدل إرسال النموذج مبكرًا */
  $('regForm').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || currentStep === 3) return;
    if (e.target && e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    $('nextStepBtn').click();
  });

  /* ---------------- رفع المستندات: بيانات الصورة الفعلية ---------------- */
  var saving = false;
  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' بايت';
    if (bytes < 1048576) return Math.round(bytes / 1024) + ' كيلوبايت';
    return (bytes / 1048576).toFixed(1) + ' ميجابايت';
  }
  function isBusy() {
    return Object.keys(pendingUploads).some(function (k) { return !!pendingUploads[k]; });
  }
  function refreshSubmit() {
    var busy = isBusy();
    var status = $('uploadStatus');
    if (status) status.hidden = !busy;
    var btn = $('submitBtn');
    if (!btn) return;
    btn.disabled = busy || saving;
    btn.textContent = saving ? T('⏳ جارٍ حفظ الطلب والصور…') :
                      busy ? T('⏳ جارٍ قراءة الصور…') : T('إرسال طلب التسجيل ✓');
  }
  /* التحقق لا يقبل إلا سجلًا يحوي بيانات فعلية (ليس اسمًا فقط) */
  function readyFiles() {
    var out = { birthCert: null, photo: null, parentCard: null, reportCard: null };
    if (!U) return out;
    U.DOC_KEYS.forEach(function (k) {
      var d = uploadedFiles[k];
      out[k] = (d && U.safeDataUrl(d.dataUrl)) ? d : null;
    });
    return out;
  }
  function clearUpload(key) {
    uploadSeq[key] = (uploadSeq[key] || 0) + 1;   // إلغاء أي قراءة جارية لهذا الحقل
    delete pendingUploads[key];
    var box = document.querySelector('[data-upload="' + key + '"]');
    var input = document.querySelector('[data-file-input="' + key + '"]');
    if (input) input.value = '';
    if (box) {
      box.classList.remove('has-file', 'is-loading');
      var prev = box.querySelector('.upload-preview');
      if (prev) prev.classList.remove('no-image');
      var img = box.querySelector('.thumb');
      var name = box.querySelector('.file-name');
      var badge = box.querySelector('.file-badge');
      if (badge && badge.dataset.defaultText) badge.textContent = badge.dataset.defaultText;
      if (img) img.removeAttribute('src');
      if (name) name.textContent = '';
    }
    uploadedFiles[key] = null;
    clearFieldError(key);
    refreshSubmit();
  }
  function uploadFailed(key, msg) {
    clearUpload(key);
    var field = document.querySelector('[data-field="' + key + '"]');
    if (field) field.classList.add('has-error');
    showAlert('formAlert', T(msg));
    showToast('⚠ ' + T(msg), true);
    play('error');
    vibrate([100, 50, 100]);
  }
  function setUpload(key, file) {
    if (!file) return;
    if (!U) { showToast('⚠ محرك رفع الصور غير محمّل، أعد تحميل الصفحة', true); return; }
    var box = document.querySelector('[data-upload="' + key + '"]');
    if (!box) return;
    var seq = (uploadSeq[key] || 0) + 1;
    uploadSeq[key] = seq;
    pendingUploads[key] = true;
    uploadedFiles[key] = null;
    box.classList.add('has-file', 'is-loading');
    var prev = box.querySelector('.upload-preview');
    var img = box.querySelector('.thumb');
    var name = box.querySelector('.file-name');
    var badge = box.querySelector('.file-badge');
    if (prev) prev.classList.add('no-image');
    if (badge) { if (!badge.dataset.defaultText) badge.dataset.defaultText = badge.textContent || '📄 مستند مرفق'; badge.textContent = '⏳ جارٍ الحفظ'; }
    if (img) img.removeAttribute('src');
    if (name) name.textContent = '⏳ جارٍ قراءة «' + file.name + '» وحفظ الصورة…';
    showAlert('formAlert', '');
    clearFieldError(key);
    refreshSubmit();

    /* FileReader → Canvas → Data URL: هنا تُقرأ الصورة فعلًا */
    U.readDocument(file).then(function (doc) {
      if (uploadSeq[key] !== seq) return;
      uploadedFiles[key] = doc;
      box.classList.remove('is-loading');
      if (name) name.textContent = doc.name + ' • ' + formatSize(doc.size) +
        ' • محفوظ: ' + formatSize(U.estimateBytes(doc.storedSize));
      if (doc.kind === 'image') {
        if (img) img.src = doc.dataUrl;
        if (prev) prev.classList.remove('no-image');
      } else {
        if (img) img.removeAttribute('src');
        if (prev) prev.classList.add('no-image');
        if (badge) badge.textContent = badge.dataset.defaultText || '📄 مستند مرفق';
      }
      clearFieldError(key);
      play('upload');
      showToast(T('✓ تم حفظ «') + doc.name + T('» — الصورة جاهزة مع طلبك'));
    }, function (err) {
      if (uploadSeq[key] !== seq) return;
      uploadFailed(key, T((err && err.message) || 'تعذّر قراءة الملف'));
    }).then(function () {
      if (uploadSeq[key] !== seq) return;
      delete pendingUploads[key];
      refreshSubmit();
    });
  }
  document.querySelectorAll('[data-file-input]').forEach(function (input) {
    input.addEventListener('change', function () { setUpload(input.getAttribute('data-file-input'), input.files && input.files[0]); });
    input.addEventListener('click', function (e) { e.stopPropagation(); });
  });
  document.querySelectorAll('[data-remove]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      clearUpload(btn.getAttribute('data-remove'));
    });
  });
  document.querySelectorAll('.upload-box').forEach(function (box) {
    var key = box.getAttribute('data-upload');
    var initBadge = box.querySelector('.file-badge');
    if (initBadge) initBadge.dataset.defaultText = initBadge.textContent || '📄 مستند مرفق';
    var thumb = box.querySelector('.thumb');
    if (thumb) thumb.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      var doc = U.normalizeDoc(uploadedFiles[key]);
      if (doc && doc.dataUrl) openDoc(doc, U.DOC_LABELS[key]);
    });
    ['dragenter', 'dragover'].forEach(function (ev) { box.addEventListener(ev, function (e) { e.preventDefault(); box.style.background = '#F2E2C4'; }); });
    ['dragleave', 'drop'].forEach(function (ev) { box.addEventListener(ev, function (e) { e.preventDefault(); box.style.background = ''; }); });
    box.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) setUpload(key, f);
    });
  });

  /* ---------------- الشروط والأحكام ---------------- */
  function openTerms() {
    var m = $('termsModal');
    if (!m) return;
    m.hidden = false;
    document.body.classList.add('modal-open');
  }
  function closeTerms() {
    var m = $('termsModal');
    if (!m) return;
    m.hidden = true;
    document.body.classList.remove('modal-open');
  }
  var termsLink = $('termsLink');
  if (termsLink) termsLink.addEventListener('click', function (e) { e.preventDefault(); openTerms(); });
  document.querySelectorAll('[data-close-modal]').forEach(function (el) { el.addEventListener('click', closeTerms); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeTerms(); });
  var agree = $('agreeTerms');
  if (agree) agree.addEventListener('change', function () { if (agree.checked) clearFieldError('agree'); });

  /* ---------------- عرض المستندات المحفوظة بالفعل ---------------- */
  function openDoc(doc, label) {
    if (!doc || !U || !U.safeDataUrl(doc.dataUrl)) return;
    if (doc.kind === 'pdf') {
      var blob = U.dataUrlToBlob(doc.dataUrl);
      var url = blob ? URL.createObjectURL(blob) : doc.dataUrl;
      var win = window.open(url, '_blank', 'noopener');
      if (!win) showToast('اسمح بالنوافذ المنبثقة، أو استخدم زر «تنزيل»', true);
      if (blob) setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 60000);
      return;
    }
    var modal = $('docModal');
    if (!modal) return;
    $('docModalTitle').textContent = label + ' — ' + (doc.name || '');
    var img = $('docModalImg');
    img.src = doc.dataUrl;
    img.alt = label;
    var dl = $('docModalDownload');
    dl.href = doc.dataUrl;
    dl.setAttribute('download', doc.name || (label + '.jpg'));
    modal.hidden = false;
    document.body.classList.add('modal-open');
  }
  function closeDocModal() {
    var modal = $('docModal');
    if (!modal) return;
    modal.hidden = true;
    var img = $('docModalImg');
    if (img) img.removeAttribute('src');
    document.body.classList.remove('modal-open');
  }
  document.querySelectorAll('[data-close-doc-modal]').forEach(function (el) {
    el.addEventListener('click', closeDocModal);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('docModal') && !$('docModal').hidden) closeDocModal();
  });

  function renderDocsGallery(container, docs) {
    if (!container || !U) return;
    var norm = U.normalizeDocs(docs);
    var keys = U.DOC_KEYS.filter(function (k) { return !!norm[k]; });
    if (!keys.length) { container.hidden = true; container.innerHTML = ''; return; }
    container.hidden = false;
    var cards = keys.map(function (k) {
      var d = norm[k], label = U.DOC_LABELS[k];
      var thumb = (d.kind === 'image' && d.dataUrl)
        ? '<button class="doc-thumb" type="button" data-doc-view="' + k + '" title="' + esc(T('عرض الصورة بالحجم الكامل')) + '"><img src="' + esc(d.dataUrl) + '" alt="' + esc(T(label)) + '"></button>'
        : '<div class="doc-thumb doc-thumb--file">' + (d.legacy ? '⚠️' : '📄') + '</div>';
      var actions = d.dataUrl
        ? '<div class="doc-actions"><button class="doc-btn" type="button" data-doc-view="' + k + '">👁 ' + esc(T('عرض')) + '</button>' +
          '<a class="doc-btn" href="' + esc(d.dataUrl) + '" download="' + esc(d.name || (label + '.jpg')) + '">⬇ ' + esc(T('تنزيل')) + '</a></div>'
        : '<p class="doc-legacy">' + esc(T('سجل قديم بالاسم فقط — أعد رفع الصورة لحفظها فعليًا')) + '</p>';
      return '<figure class="doc-tile">' + thumb +
        '<figcaption><strong>' + esc(T(label)) + '</strong><small>' + esc(d.name || '—') + '</small></figcaption>' +
        actions + '</figure>';
    }).join('');
    container.innerHTML = '<h4 class="docs-title">' + esc(T('📎 المستندات المرفوعة (الصور الفعلية)')) + '</h4>' +
      '<div class="docs-grid">' + cards + '</div>' +
      '<p class="docs-hint">' + esc(T('صور مستنداتك محفوظة في حسابك، ويمكنك عرضها أو تنزيلها في أي وقت.')) + '</p>';
    container.querySelectorAll('[data-doc-view]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var k = btn.getAttribute('data-doc-view');
        openDoc(norm[k], U.DOC_LABELS[k]);
      });
    });
  }

  /* ---------------- LocalStorage ---------------- */
  function readUsers() {
    try {
      var u = JSON.parse(localStorage.getItem(LS_USERS) || '[]');
      return Array.isArray(u) ? u : [];
    } catch (e) { return []; }
  }
  function writeUsers(users) {
    lastStorageError = '';
    try { localStorage.setItem(LS_USERS, JSON.stringify(users)); return true; }
    catch (e) { lastStorageError = String((e && (e.name || e.message)) || 'unknown'); return false; }
  }
  function storageMessage() {
    return T(/quota|exceed|NS_ERROR_DOM_QUOTA|capacity/i.test(lastStorageError)
      ? 'امتلأت مساحة التخزين في المتصفح. قلّل حجم الصور أو احذف مستندًا اختياريًا ثم أعد المحاولة.'
      : 'تعذّر حفظ البيانات على الجهاز. تأكد من تفعيل التخزين في المتصفح وتوفّر مساحة.');
  }
  function makeOrderNumber(users) {
    var n, exists;
    do {
      n = 'RHQ-' + String(1000 + Math.floor(Math.random() * 9000));
      exists = users.some(function (u) { return u.orderNumber === n; });
    } while (exists);
    return n;
  }

  /* ---------------- إرسال طلب التسجيل ---------------- */
  function collectData() {
    return {
      parentName: V.val('parentName'),
      nationalId: V.digitsOnly(V.val('nationalId')),
      relation: V.val('relation') || 'ولي أمر',
      mobile: V.digitsOnly(V.val('mobile')),
      whatsapp: V.digitsOnly(V.val('whatsapp')) || V.digitsOnly(V.val('mobile')),
      email: V.val('email'),
      password: V.val('password'),
      studentName: V.val('studentName'),
      dob: V.val('dob'),
      gender: V.val('gender'),
      grade: V.val('grade'),
      foundationSubjects: Array.prototype.map.call(document.querySelectorAll('input[name="foundationSubjects"]:checked'), function (el) { return el.value; }),
      prevSchool: V.val('prevSchool'),
      address: V.val('address'),
      healthNotes: V.val('healthNotes'),
      /* المستندات كاملة: الاسم + نوع الملف + بيانات الصورة الفعلية (dataUrl) */
      docs: readyFiles()
    };
  }

  function row(label, value) {
    return '<div class="row"><span>' + esc(T(label)) + '</span><span>' + esc(value || '—') + '</span></div>';
  }
  function gradeText(v) { return esc(I && I.isEnglish && I.isEnglish() ? T(v) : v); }

  /* ---------------- مزامنة الرفع مع الخادم ---------------- */
  function syncStatusUI(state, html) {
    var el = $('syncStatus');
    if (el) {
      if (!state) { el.hidden = true; el.className = 'sync-status'; el.innerHTML = ''; }
      else { el.hidden = false; el.className = 'sync-status is-' + state; el.innerHTML = html || ''; }
    }
    var retry = $('retryUploadBtn');
    if (retry) retry.hidden = state !== 'warn';
  }
  function markServerUpload(mobile, info) {
    try {
      var users = readUsers();
      var idx = users.findIndex(function (u) { return u.mobile === mobile; });
      if (idx >= 0) {
        users[idx].server = info;
        users[idx].serverUploadedAt = info.savedAt;
        writeUsers(users);
      }
    } catch (e) { /* الحفظ المحلي أساسي، وفشل تحديث العلامة لا يعطّل شيئًا */ }
  }
  /* إرسال فعلي إلى /api/registrations — والصور نفسها داخل الحمولة */
  function syncToServer(data) {
    if (!data) return Promise.resolve(false);
    if (!API) {
      syncStatusUI('info', 'ℹ ' + esc(T('أرسل طلبك الآن إلى أكاديمية رحيق على واتساب من الزر الأخضر — وطلبك ومستنداته جاهزة للإرسال.')));
      return Promise.resolve(false);
    }
    pendingSync = data;
    syncStatusUI('busy', esc(T('⏳ جارٍ إرسال طلبك ومستنداتك إلى الأكاديمية…')));
    return API.submit(data).then(function (result) {
      pendingSync = null;
      markServerUpload(data.mobile, {
        orderNumber: result.orderNumber,
        savedAt: result.savedAt,
        files: result.files
      });
      syncStatusUI('ok', esc(T('✅ وصل طلبك ومستنداتك إلى الأكاديمية — رقم الطلب ')) + result.orderNumber);
      showToast(T('✅ تم إرسال الطلب والمستندات إلى الخادم'));
      return true;
    }, function (err) {
      var msg = T(API.errorMessage(err));
      var staticHost = err && (err.status === 404 || err.status === 405);
      if (staticHost) {
        /* النسخة الثابتة: لا يوجد خادم أصلًا — لا نعرض أي خطأ، فقط نوجّه لواتساب */
        syncStatusUI('info', 'ℹ ' + esc(msg));
        missingServer = true;
        return false;
      }
      syncStatusUI('warn', '⚠ ' + esc(msg) + '<br><small>' + esc(T('لا يزال طلبك ومستنداتك جاهزين — أرسلهما الآن على واتساب من الزر الأخضر.')) + '</small>');
      showToast('⚠ ' + msg, true);
      missingServer = true;
      /* بدل شاشة خطأ 404 جافة: نوضح الحل اليدوي المضمون */
      if (!waSent) openManualModal();
      return false;
    });
  }
  var retryUploadBtn = $('retryUploadBtn');
  if (retryUploadBtn) {
    retryUploadBtn.addEventListener('click', function () {
      if (pendingSync) syncToServer(pendingSync);
    });
  }

  function savedDocsCount(docs) {
    var norm = U ? U.normalizeDocs(docs) : {};
    return U ? U.DOC_KEYS.filter(function (k) { return !!norm[k]; }).length : 0;
  }

  function showSuccess(data) {
    lastSubmission = data;
    waSent = false;
    $('orderNumber').textContent = data.orderNumber;
    $('successBox').innerHTML =
      row('اسم ولي الأمر', data.parentName) +
      row('اسم الطالب', data.studentName) +
      row('الصف', I && I.isEnglish && I.isEnglish() ? T(data.grade) : data.grade) +
      (data.foundationSubjects && data.foundationSubjects.length ? row('مواد التأسيس', data.foundationSubjects.map(T).join('، ')) : '') +
      row('رقم الطلب', data.orderNumber) +
      row('رقم الموبايل', data.mobile) +
      row('المستندات المحفوظة', savedDocsCount(data.docs) + ' ' + T('من 4'));
    renderDocsGallery($('successDocs'), data.docs);
    syncStatusUI(null);
    switchMode('success');
    prepareWhatsApp(data);
    succeed();
    showToast(T('🎓 تم استلام طلبك وحفظ الصور فعليًا — رقم الطلب ') + data.orderNumber);
  }

  /* ---------------- واتساب: إرسال الطلب إلى الأكاديمية ---------------- */
  function prepareWhatsApp(data) {
    if (!WA) return;
    var link = WA.buildLink(data);
    var anchor = $('whatsappLink');
    if (anchor) anchor.setAttribute('href', link);
    var fallback = $('waFallback');
    if (fallback) fallback.hidden = false;
    var shareBtn = $('whatsappShareBtn');
    if (shareBtn) {
      var files = WA.collectFiles(data && data.docs);
      /* زر المشاركة بالصور يظهر فقط عندما يدعم المتصفح إرفاق الملفات فعليًا */
      shareBtn.hidden = !WA.canShareFiles(files);
    }
  }

  function sendToWhatsApp() {
    if (!WA) return;
    var data = lastSubmission;
    if (!data) { showToast(T('لا يوجد طلب جاهز على هذه الصفحة'), true); return; }
    var link = WA.buildLink(data);
    var anchor = $('whatsappLink');
    if (anchor) anchor.setAttribute('href', link);
    play('success');
    WA.openLink(link);
    waSent = true;
    closeManualModal();
    showToast(T('📤 فتحنا واتساب أكاديمية رحيق برسالة الطلب — أرفق الصور إن لم تُرفق تلقائيًا'));
  }

  function shareToWhatsApp() {
    if (!WA) return;
    var data = lastSubmission;
    if (!data) { showToast(T('لا يوجد طلب جاهز على هذه الصفحة'), true); return; }
    var link = WA.buildLink(data);
    WA.shareWithImages(data).then(function (res) {
      if (res.shared) {
        waSent = true;
        closeManualModal();
        showToast(T('📎 تم تجهيز الرسالة مع الصور — اختر واتساب من قائمة المشاركة'));
        return;
      }
      if (res.reason === 'cancelled') return;
      /* المتصفح لا يدعم مشاركة الملفات: نكمل بالمسار الأساسي بلا أي خطأ */
      if (!res.shared) {
        showToast(T('هذا المتصفح لا يشارك الصور تلقائيًا — فتحنا واتساب برسالة الطلب، أرفق الصور من 📎'), true);
        WA.openLink(link);
        waSent = true;
      }
    }, function () {
      WA.openLink(link);
      waSent = true;
    });
  }

  function copyWhatsAppMessage() {
    if (!WA) return;
    var data = lastSubmission;
    if (!data) return;
    WA.copyText(WA.buildMessage(data)).then(function (ok) {
      showToast(ok
        ? T('📋 تم نسخ رسالة الطلب — الصقها في محادثة واتساب أكاديمية رحيق')
        : T('⚠ تعذّر النسخ التلقائي؛ افتح واتساب من الزر الأخضر'), !ok);
    });
  }

  /* ---------------- نافذة النسخة اليدوية بدل 404 ---------------- */
  function openManualModal() {
    var modal = $('manualModal');
    if (!modal) return;
    var link = $('manualDocsLink');
    if (link) {
      link.onclick = function (e) {
        e.preventDefault();
        closeManualModal();
        var gallery = $('successDocs');
        if (gallery && gallery.scrollIntoView) gallery.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    }
    modal.hidden = false;
    document.body.classList.add('modal-open');
  }
  function closeManualModal() {
    var modal = $('manualModal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  /* حفظ المستخدم مع الصور، مع ضغط تلقائي إضافي عند امتلاء التخزين */
  function saveSubmission(data, users, idx) {
    saving = true;
    refreshSubmit();
    return U.fitDocs(data.docs, U.LIMITS.totalChars).then(function (docs) {
      data.docs = docs;
      function put() { if (idx >= 0) users[idx] = data; else if (users.indexOf(data) < 0) users.push(data); }
      put();
      if (writeUsers(users)) return true;
      /* المحاولة الثانية: ضغط أقوى للمستندات ثم إعادة الحفظ */
      return U.shrinkDocs(docs, 140000).then(function (smaller) {
        data.docs = smaller;
        put();
        return writeUsers(users);
      });
    });
  }

  $('regForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (saving) return;
    if (isBusy()) {
      fail('انتظر لحظة حتى يكتمل حفظ الصور المرفوعة ثم أرسل الطلب', 'formAlert');
      return;
    }
    var ready = readyFiles();
    var errors = V.step3(ready);
    var nameOnly = ['birthCert', 'photo', 'parentCard'].filter(function (k) {
      return uploadedFiles[k] && !ready[k];
    });
    if (nameOnly.length && !Object.keys(errors).length) {
      errors[nameOnly[0]] = 'الصورة لم تُحفظ فعليًا — أعد رفع الملف';
    }
    setFieldErrors(errors);
    var keys = Object.keys(errors);
    if (keys.length) {
      fail('راجع البيانات المطلوبة وأكمل الحقول المميزة بعلامة * — ' + errors[keys[0]], 'formAlert');
      return;
    }

    // إعادة التحقق من كل الخطوات قبل الحفظ (حماية من الرجوع والتعديل)
    var all = {};
    [V.step1(), V.step2()].forEach(function (obj) { Object.keys(obj).forEach(function (k) { all[k] = obj[k]; }); });
    if (Object.keys(all).length) {
      setFieldErrors(all);
      fail('يوجد خطأ في بيانات الخطوات السابقة، راجعها قبل الإرسال', 'formAlert');
      return;
    }

    var data = collectData();
    var users = readUsers();
    // تحديث الحساب إن كان الرقم مسجّلًا مسبقًا، وإلا إنشاء حساب جديد
    var idx = users.findIndex(function (u) { return u.mobile === data.mobile; });
    var previous = idx >= 0 ? users[idx] : null;
    data.orderNumber = previous && previous.orderNumber ? previous.orderNumber : makeOrderNumber(users);
    data.createdAt = previous && previous.createdAt ? previous.createdAt : new Date().toISOString();

    saveSubmission(data, users, idx).then(function (ok) {
      saving = false;
      refreshSubmit();
      if (!ok) {
        fail(storageMessage(), 'formAlert');
        showToast('⚠ ' + storageMessage(), true);
        return;
      }
      try { localStorage.setItem(LS_SESSION, data.mobile); } catch (err) {}
      lastSubmission = data;
      showSuccess(data);
      syncToServer(data);            // رفع فعلي إلى /api/registrations
    }).catch(function () {
      saving = false;
      refreshSubmit();
      fail('تعذّر حفظ الصور على الجهاز، جرّب صورًا أصغر', 'formAlert');
    });
  });

  /* تسجيل طالب آخر */
  $('newRegBtn').addEventListener('click', function () {
    $('regForm').reset();
    ['birthCert', 'photo', 'parentCard', 'reportCard'].forEach(clearUpload);
    setFieldErrors({});
    showAlert('formAlert', '');
    currentStep = 1;
    renderStep(true, false);
    pendingSync = null;
    syncStatusUI(null);
    switchMode('register', { scroll: true });
  });

  /* نسخ رقم الطلب */
  $('copyOrderBtn').addEventListener('click', function () {
    var num = $('orderNumber').textContent;
    function done(ok) { showToast(ok ? T('📋 تم نسخ رقم الطلب: ') + num : T('⚠ انسخ الرقم يدويًا: ') + num, !ok); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(num).then(function () { done(true); }).catch(function () { done(false); });
    } else {
      try {
        var ta = document.createElement('textarea');
        ta.value = num; document.body.appendChild(ta); ta.select();
        var ok = document.execCommand('copy'); document.body.removeChild(ta);
        done(ok);
      } catch (e) { done(false); }
    }
  });

  /* ---------------- تسجيل الدخول ---------------- */
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var errors = V.login();
    setFieldErrors(errors);
    var keys = Object.keys(errors);
    if (keys.length) {
      fail(errors[keys[0]], 'loginAlert');
      return;
    }
    var mobile = V.digitsOnly(V.val('loginMobile'));
    var password = V.val('loginPassword');
    var user = readUsers().find(function (u) { return u.mobile === mobile && u.password === password; });
    if (!user) {
      fail('رقم الموبايل أو كلمة السر غير صحيحة. لو ليس لديك حساب، أنشئ حسابًا جديدًا.', 'loginAlert');
      return;
    }
    try { localStorage.setItem(LS_SESSION, mobile); } catch (err) {}
    showAlert('loginAlert', '');

    $('welcomeName').textContent = T('أهلًا بك ') + user.parentName;
    $('welcomeDetails').innerHTML =
      row('اسم الطالب', user.studentName) +
      row('الصف', I && I.isEnglish && I.isEnglish() ? T(user.grade) : user.grade) +
      (user.foundationSubjects && user.foundationSubjects.length ? row('مواد التأسيس', user.foundationSubjects.map(T).join('، ')) : '') +
      row('رقم الطلب', user.orderNumber) +
      row('رقم الموبايل', user.mobile);
    /* الصور الفعلية المحفوظة مع الحساب تظهر هنا بعد تسجيل الدخول */
    renderDocsGallery($('welcomeDocs'), user.docs);
    document.querySelector('.login-box').hidden = true;
    $('welcomeBox').hidden = false;
    succeed();                       // نغمة النجاح عند الدخول + اهتزاز
    showToast(T('🎓 أهلًا بك مجددًا في رحيق'));
  });

  $('logoutBtn').addEventListener('click', function () {
    try { localStorage.removeItem(LS_SESSION); } catch (e) {}
    $('welcomeBox').hidden = true;
    document.querySelector('.login-box').hidden = false;
    $('loginForm').reset();
    setFieldErrors({});
    showAlert('loginAlert', '');
  });

  /* ---------------- بدء التشغيل ---------------- */
  if (S) {
    S.preload();                                   // تحميل مسبق لملفات /sounds/
    S.bindToggle($('soundToggle'), function (msg) { showToast(msg); });
  }
  renderStep(false, false);
  switchMode('register');

  /* فحص توفّر خادم الرفع لتوضيح مصير الطلب لولي الأمر */
  if (API) {
    API.probe().then(function (available) {
      var hint = $('syncHint');
      if (!hint) return;
      hint.className = 'sync-hint ' + (available ? 'is-ok' : 'is-offline');
      hint.textContent = T(available
        ? '✓ خدمة الاستلام جاهزة — سيصل طلبك ومستنداته إلى فريق الأكاديمية فور الإرسال.'
        : 'أكمل بياناتك ومستنداتك، وسيصل طلبك كاملًا إلى فريق أكاديمية رحيق على واتساب فور الإرسال.');
    });
  }

  /* ظل الهيدر عند التمرير */
  var header = $('siteHeader');
  window.addEventListener('scroll', function () {
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 12);
  }, { passive: true });

  /* ---------------- واتساب: أزرار الإرسال ---------------- */
  function on(id, evt, fn) {
    var el = $(id);
    if (el) el.addEventListener(evt, fn);
  }
  on('whatsappSendBtn', 'click', sendToWhatsApp);
  on('whatsappShareBtn', 'click', shareToWhatsApp);
  on('copyWaBtn', 'click', copyWhatsAppMessage);
  on('manualWhatsappBtn', 'click', sendToWhatsApp);
  document.querySelectorAll('[data-close-manual]').forEach(function (el) {
    el.addEventListener('click', closeManualModal);
  });
  var manualModal = $('manualModal');
  if (manualModal) {
    manualModal.addEventListener('click', function (e) {
      if (e.target === manualModal) closeManualModal();
    });
  }

  /* ---------------- لوحة الإعدادات: الألوان والخط واللغة ---------------- */
  function renderThemeGrid() {
    var grid = $('themeGrid');
    if (!grid || !SET) return;
    var current = SET.read();
    grid.innerHTML = SET.THEMES.map(function (th) {
      var active = current.theme === th.id && !current.custom;
      return '<button class="theme-opt' + (active ? ' is-active' : '') + '" type="button" data-theme-id="' + th.id + '"' +
        ' title="' + esc(T(th.nameEn)) + '">' +
        '<span class="theme-swatch"><i style="background:' + th.maroon + '"></i><i style="background:' + th.gold + '"></i></span>' +
        '<span>' + esc(T(th.nameAr)) + '</span></button>';
    }).join('');
    grid.querySelectorAll('[data-theme-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        SET.setTheme(btn.getAttribute('data-theme-id'));
        renderThemeGrid();
        showToast(T('🎨 تم تغيير ألوان الموقع'));
      });
    });
  }

  function syncSettingsControls() {
    if (!SET) return;
    var s = SET.read();
    var palette = SET.resolvePalette(s).theme;
    var brand = $('customBrand'), gold = $('customGold'), cream = $('customCream');
    if (brand) brand.value = s.custom && s.custom.maroon ? s.custom.maroon : palette.maroon;
    if (gold) gold.value = s.custom && s.custom.gold ? s.custom.gold : palette.gold;
    if (cream) cream.value = s.custom && s.custom.creamLight ? s.custom.creamLight : palette.creamLight;
    var range = $('scaleRange'), out = $('scaleValue');
    if (range) range.value = String(Math.round(s.scale * 100));
    if (out) out.textContent = Math.round(s.scale * 100) + '%';
    var display = $('displayFontToggle');
    if (display) display.checked = !!s.display;
    var ar = $('langArOpt'), en = $('langEnOpt');
    if (ar) ar.classList.toggle('is-active', s.lang === 'ar');
    if (en) en.classList.toggle('is-active', s.lang === 'en');
    var radios = document.querySelectorAll('input[name="uiLang"]');
    radios.forEach(function (r) { r.checked = r.value === s.lang; });
    var langBtn = $('langToggle');
    if (langBtn) {
      langBtn.textContent = s.lang === 'ar' ? 'EN' : 'ع';
      langBtn.setAttribute('aria-label', T('تغيير اللغة'));
    }
  }

  function openSettings() {
    var panel = $('settingsPanel');
    if (!panel) return;
    renderThemeGrid();
    syncSettingsControls();
    panel.hidden = false;
    document.body.classList.add('modal-open');
    var first = panel.querySelector('.settings-close');
    if (first && first.focus) { try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); } }
  }
  function closeSettings() {
    var panel = $('settingsPanel');
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    document.body.classList.remove('modal-open');
  }

  on('settingsBtn', 'click', openSettings);
  document.querySelectorAll('[data-close-settings]').forEach(function (el) {
    el.addEventListener('click', closeSettings);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if ($('settingsPanel') && !$('settingsPanel').hidden) closeSettings();
      if ($('manualModal') && !$('manualModal').hidden) closeManualModal();
    }
  });

  on('langToggle', 'click', function () {
    if (!SET) return;
    var next = SET.read().lang === 'ar' ? 'en' : 'ar';
    SET.setLang(next);
    syncSettingsControls();
    refreshDynamicTexts();
    showToast(next === 'en' ? 'Language: English' : 'تم التحويل إلى العربية');
  });

  document.querySelectorAll('input[name="uiLang"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      if (!SET) return;
      SET.setLang(radio.value);
      syncSettingsControls();
      refreshDynamicTexts();
    });
  });

  on('scaleRange', 'input', function (e) {
    if (!SET) return;
    var pct = Number(e.target.value);
    SET.setScale(pct / 100);
    var out = $('scaleValue');
    if (out) out.textContent = pct + '%';
  });

  on('displayFontToggle', 'change', function (e) {
    if (SET) SET.setDisplayFont(e.target.checked);
  });

  on('applyCustom', 'click', function () {
    if (!SET) return;
    SET.setCustom({
      maroon: $('customBrand') ? $('customBrand').value : null,
      gold: $('customGold') ? $('customGold').value : null,
      creamLight: $('customCream') ? $('customCream').value : null
    });
    renderThemeGrid();
    syncSettingsControls();
    showToast(T('🎨 تم تطبيق اللون الحر على الموقع'));
  });

  on('resetSettings', 'click', function () {
    if (!SET) return;
    SET.reset();
    renderThemeGrid();
    syncSettingsControls();
    refreshDynamicTexts();
    showToast(T('↺ تم استعادة الإعدادات الافتراضية'));
  });

  /* إعادة رسم النصوص التي يبنيها السكربت حسب اللغة الحالية */
  function refreshDynamicTexts() {
    switchMode(mode);
    if (lastSubmission && mode === 'success') {
      showSuccess(lastSubmission);
    }
    if (!I || !I.apply) return;
    I.apply(I.lang ? I.lang() : 'ar');
  }
  if (I && I.apply) I.apply();

  /* دعم تقليل الحركة */
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches && C) {
    C.launch = function () {};
  }
})();
