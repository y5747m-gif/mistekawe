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
  function $(id) { return document.getElementById(id); }
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
    showAlert(alertId || 'formAlert', msg);
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
      $('cardTitle').textContent = 'تسجيل ولي الأمر';
      $('cardSub').textContent = API
        ? 'يُرسل الطلب وصور المستندات إلى خادم المدرسة عند توفره، ويُحفظ نسخة على جهازك'
        : 'نسخة محلية على جهازك فقط؛ لا تدخل بيانات حقيقية أو حساسة';
    } else if (next === 'login') {
      $('cardTitle').textContent = 'تسجيل دخول ولي الأمر';
      $('cardSub').textContent = 'أدخل رقم موبايلك وكلمة السر للمتابعة';
    } else {
      $('cardTitle').textContent = 'طلبك لدينا';
      $('cardSub').textContent = 'شكرًا لثقتك في رحيق';
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
    btn.textContent = saving ? '⏳ جارٍ حفظ الطلب والصور…' :
                      busy ? '⏳ جارٍ قراءة الصور…' : 'إرسال طلب التسجيل ✓';
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
    showAlert('formAlert', msg);
    showToast('⚠ ' + msg, true);
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
      showToast('✓ تم حفظ «' + doc.name + '» كصورة فعلية على هذا الجهاز');
    }, function (err) {
      if (uploadSeq[key] !== seq) return;
      uploadFailed(key, (err && err.message) || 'تعذّر قراءة الملف');
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
        ? '<button class="doc-thumb" type="button" data-doc-view="' + k + '" title="عرض الصورة بالحجم الكامل"><img src="' + esc(d.dataUrl) + '" alt="' + esc(label) + '"></button>'
        : '<div class="doc-thumb doc-thumb--file">' + (d.legacy ? '⚠️' : '📄') + '</div>';
      var actions = d.dataUrl
        ? '<div class="doc-actions"><button class="doc-btn" type="button" data-doc-view="' + k + '">👁 عرض</button>' +
          '<a class="doc-btn" href="' + esc(d.dataUrl) + '" download="' + esc(d.name || (label + '.jpg')) + '">⬇ تنزيل</a></div>'
        : '<p class="doc-legacy">سجل قديم بالاسم فقط — أعد رفع الصورة لحفظها فعليًا</p>';
      return '<figure class="doc-tile">' + thumb +
        '<figcaption><strong>' + esc(label) + '</strong><small>' + esc(d.name || '—') + '</small></figcaption>' +
        actions + '</figure>';
    }).join('');
    container.innerHTML = '<h4 class="docs-title">📎 المستندات المرفوعة (الصور الفعلية)</h4>' +
      '<div class="docs-grid">' + cards + '</div>' +
      '<p class="docs-hint">الصور محفوظة داخل هذا المتصفح على جهازك فقط، ويمكن عرضها أو تنزيلها بعد تسجيل الدخول.</p>';
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
    return /quota|exceed|NS_ERROR_DOM_QUOTA|capacity/i.test(lastStorageError)
      ? 'امتلأت مساحة التخزين في المتصفح. قلّل حجم الصور أو احذف مستندًا اختياريًا ثم أعد المحاولة.'
      : 'تعذّر حفظ البيانات على الجهاز. تأكد من تفعيل التخزين في المتصفح وتوفّر مساحة.';
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
      prevSchool: V.val('prevSchool'),
      address: V.val('address'),
      healthNotes: V.val('healthNotes'),
      /* المستندات كاملة: الاسم + نوع الملف + بيانات الصورة الفعلية (dataUrl) */
      docs: readyFiles()
    };
  }

  function row(label, value) {
    return '<div class="row"><span>' + esc(label) + '</span><span>' + esc(value || '—') + '</span></div>';
  }

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
      syncStatusUI('warn', '⚠ لا يمكن الاتصال بالخادم من هذه النسخة — الطلب وصوره محفوظة على هذا الجهاز فقط.');
      return Promise.resolve(false);
    }
    pendingSync = data;
    syncStatusUI('busy', '⏳ جارٍ إرسال الطلب وصور المستندات إلى خادم المدرسة…');
    return API.submit(data).then(function (result) {
      pendingSync = null;
      markServerUpload(data.mobile, {
        orderNumber: result.orderNumber,
        savedAt: result.savedAt,
        files: result.files
      });
      syncStatusUI('ok', '✅ تم رفع الطلب وصور المستندات إلى خادم المدرسة — رقم الطلب ' + result.orderNumber);
      showToast('✅ تم إرسال الطلب والمستندات إلى الخادم');
      return true;
    }, function (err) {
      var msg = API.errorMessage(err);
      syncStatusUI('warn', '⚠ ' + esc(msg) + '<br><small>الطلب وصوره محفوظة على هذا الجهاز، ويمكنك إعادة المحاولة.</small>');
      showToast('⚠ ' + msg, true);
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
    $('orderNumber').textContent = data.orderNumber;
    $('successBox').innerHTML =
      row('اسم ولي الأمر', data.parentName) +
      row('اسم الطالب', data.studentName) +
      row('الصف', data.grade) +
      row('رقم الطلب', data.orderNumber) +
      row('رقم الموبايل', data.mobile) +
      row('المستندات المحفوظة', savedDocsCount(data.docs) + ' من 4');
    renderDocsGallery($('successDocs'), data.docs);
    syncStatusUI(null);
    switchMode('success');
    succeed();
    showToast('🎓 تم استلام طلبك وحفظ الصور فعليًا — رقم الطلب ' + data.orderNumber);
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
    function done(ok) { showToast(ok ? '📋 تم نسخ رقم الطلب: ' + num : '⚠ انسخ الرقم يدويًا: ' + num, !ok); }
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

    $('welcomeName').textContent = 'أهلًا بك ' + user.parentName;
    $('welcomeDetails').innerHTML =
      row('اسم الطالب', user.studentName) +
      row('الصف', user.grade) +
      row('رقم الطلب', user.orderNumber) +
      row('رقم الموبايل', user.mobile);
    /* الصور الفعلية المحفوظة مع الحساب تظهر هنا بعد تسجيل الدخول */
    renderDocsGallery($('welcomeDocs'), user.docs);
    document.querySelector('.login-box').hidden = true;
    $('welcomeBox').hidden = false;
    succeed();                       // نغمة النجاح عند الدخول + اهتزاز
    showToast('🎓 أهلًا بك مجددًا في رحيق');
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
      hint.textContent = available
        ? '✓ خادم المدرسة متاح الآن — سيُرسل الطلب وصور المستندات إليه عند الإرسال.'
        : 'الخادم غير متاح الآن — سيُحفظ الطلب وصوره على هذا الجهاز فقط.';
    });
  }

  /* ظل الهيدر عند التمرير */
  var header = $('siteHeader');
  window.addEventListener('scroll', function () {
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 12);
  }, { passive: true });

  /* دعم تقليل الحركة */
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches && C) {
    C.launch = function () {};
  }
})();
