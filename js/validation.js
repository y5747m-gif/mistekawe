/* ============================================================
   رحيق RAHEEQ — قواعد التحقق من صحة البيانات
   ============================================================ */
(function () {
  'use strict';

  /* تحويل الأرقام العربية/الفارسية إلى أرقام لاتينية */
  function normalizeDigits(v) {
    return String(v == null ? '' : v)
      .replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
      .replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); });
  }
  function digitsOnly(v) { return normalizeDigits(v).replace(/\D/g, ''); }
  function wordsCount(v) { return String(v || '').trim().split(/\s+/).filter(Boolean).length; }
  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* النص العربي هو المفتاح: عند الإنجليزية يُترجم من قاموس js/i18n.js */
  function T(str) {
    var I = typeof window !== 'undefined' ? window.RaheeqI18n : null;
    return I && I.t ? I.t(str) : str;
  }

  /* ---------- قائمتان مختلفتان للبرنامج ----------
     «تأسيس»: قائمة المواد التي سيتأسس فيها الطالب.
     «منهج دراسي»: قائمة السنة الدراسية. */
  var PROGRAM_TYPES = ['تأسيس', 'منهج دراسي'];
  var FOUNDATION_LEVELS = ['تأسيس للصغار', 'تأسيس للكبار'];
  var FOUNDATION_SUBJECTS = ['اللغة العربية', 'اللغة الإنجليزية', 'الرياضيات', 'القراءة والكتابة'];
  var CURRICULUM_GRADES = [
    'KG1', 'KG2',
    'الصف الأول الابتدائي', 'الصف الثاني الابتدائي', 'الصف الثالث الابتدائي',
    'الصف الرابع الابتدائي', 'الصف الخامس الابتدائي', 'الصف السادس الابتدائي',
    'الصف الأول الإعدادي', 'الصف الثاني الإعدادي', 'الصف الثالث الإعدادي',
    'الصف الأول الثانوي', 'الصف الثاني الثانوي', '3 ثانوي'
  ];

  /* المواد المختارة فعليًا من قائمة التأسيس —values من القائمة البيضاء فقط */
  function checkedFoundationSubjects() {
    var out = [];
    var els = [];
    try { els = document.querySelectorAll('input[name="foundationSubjects"]:checked') || []; }
    catch (e) { els = []; }
    for (var i = 0; i < els.length; i++) {
      var v = els[i] && els[i].value;
      if (FOUNDATION_SUBJECTS.indexOf(v) >= 0 && out.indexOf(v) < 0) out.push(v);
    }
    return out;
  }

  var MSG_AR = {
    parentName: 'الاسم الرباعي يجب أن يتكون من 4 أجزاء على الأقل',
    nationalId: 'الرقم القومي يجب أن يكون 14 رقمًا بالضبط',
    mobile: 'رقم الموبايل يجب أن يكون 11 رقمًا',
    whatsapp: 'رقم الواتساب يجب أن يكون 11 رقمًا',
    email: 'أدخل بريدًا إلكترونيًا صحيحًا يحتوي على @',
    password: 'كلمة السر يجب ألا تقل عن 6 أحرف',
    confirmPassword: 'كلمتا السر غير متطابقتين',
    studentName: 'اسم الطالب يجب أن يتكون من 4 أجزاء على الأقل',
    dob: 'اختر تاريخ ميلاد صحيحًا',
    programType: 'اختر نوع البرنامج: تأسيس أو منهج دراسي',
    foundationLevel: 'اختر مستوى التأسيس',
    foundationSubjects: 'اختر مادة أو أكثر من قائمة مواد التأسيس',
    grade: 'اختر السنة الدراسية من القائمة',
    address: 'أدخل العنوان بالتفصيل',
    birthCert: 'ارفع صورة شهادة الميلاد',
    photo: 'ارفع الصورة الشخصية للطالب',
    parentCard: 'ارفع صورة بطاقة ولي الأمر',
    agree: 'يجب الموافقة على الشروط والأحكام',
    loginMobile: 'أدخل رقم موبايل صحيحًا (11 رقمًا)',
    loginPassword: 'أدخل كلمة السر'
  };
  /* رسائل جاهزة مترجمة حسب لغة الواجهة الحالية (العربية هي الأساس) */
  var MSG = {};
  Object.keys(MSG_AR).forEach(function (k) { MSG[k] = MSG_AR[k]; });
  function refreshMessages() {
    Object.keys(MSG_AR).forEach(function (k) { MSG[k] = T(MSG_AR[k]); });
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('raheeq:langchange', refreshMessages);
  }
  document.addEventListener && document.addEventListener('DOMContentLoaded', refreshMessages);

  /* الخطوة الأولى: ولي الأمر */
  function step1() {
    var errors = {};
    if (wordsCount(val('parentName')) < 4) errors.parentName = MSG.parentName;
    if (!/^\d{14}$/.test(digitsOnly(val('nationalId')))) errors.nationalId = MSG.nationalId;
    if (!/^\d{11}$/.test(digitsOnly(val('mobile')))) errors.mobile = MSG.mobile;
    var wa = digitsOnly(val('whatsapp'));
    if (wa && !/^\d{11}$/.test(wa)) errors.whatsapp = MSG.whatsapp;
    var email = val('email');
    // شرط المنصة: الإيميل لازم يحتوي على @
    if (!email.includes('@') || /^\s|@\s/.test(email) || !/^[^@\s]+@[^@\s]+$/.test(email)) errors.email = MSG.email;
    var pass = val('password');
    if (pass.length < 6) errors.password = MSG.password;
    var confirm = val('confirmPassword');
    if (!confirm || confirm !== pass) errors.confirmPassword = MSG.confirmPassword;
    return errors;
  }

  /* الخطوة الثانية: الطالب */
  function step2() {
    var errors = {};
    if (wordsCount(val('studentName')) < 4) errors.studentName = MSG.studentName;
    var dob = val('dob');
    var dobOk = false;
    if (dob) {
      var d = new Date(dob + 'T00:00:00');
      dobOk = !isNaN(d.getTime()) && d.getTime() <= Date.now() && d.getFullYear() > 1900;
    }
    if (!dobOk) errors.dob = MSG.dob;
    /* قائمتان مختلفتان حسب نوع البرنامج المختار */
    var programType = val('programType');
    if (PROGRAM_TYPES.indexOf(programType) < 0) {
      errors.programType = MSG.programType;
    } else if (programType === 'تأسيس') {
      /* قائمة مواد التأسيس: مادة أو أكثر إلزامية */
      if (!checkedFoundationSubjects().length) errors.foundationSubjects = MSG.foundationSubjects;
      var lvl = val('foundationLevel');
      if (lvl && FOUNDATION_LEVELS.indexOf(lvl) < 0) errors.foundationLevel = MSG.foundationLevel;
    } else {
      /* منهج دراسي: السنة الدراسية إلزامية ومن قائمة الصفوف فقط */
      var g = val('grade');
      if (!g || CURRICULUM_GRADES.indexOf(g) < 0) errors.grade = MSG.grade;
    }
    if (val('address').length < 5) errors.address = MSG.address;
    return errors;
  }

  /* الخطوة الثالثة: المستندات + الموافقة */
  function step3(uploadedFiles) {
    var errors = {};
    ['birthCert', 'photo', 'parentCard'].forEach(function (k) {
      if (!uploadedFiles || !uploadedFiles[k]) errors[k] = MSG[k];
    });
    var agree = document.getElementById('agreeTerms');
    if (!agree || !agree.checked) errors.agree = MSG.agree;
    return errors;
  }

  /* تسجيل الدخول */
  function login() {
    var errors = {};
    if (!/^\d{11}$/.test(digitsOnly(val('loginMobile')))) errors.loginMobile = MSG.loginMobile;
    if (!val('loginPassword')) errors.loginPassword = MSG.loginPassword;
    return errors;
  }

  window.RaheeqValidation = {
    normalizeDigits: normalizeDigits,
    digitsOnly: digitsOnly,
    wordsCount: wordsCount,
    esc: esc,
    val: val,
    PROGRAM_TYPES: PROGRAM_TYPES,
    FOUNDATION_LEVELS: FOUNDATION_LEVELS,
    FOUNDATION_SUBJECTS: FOUNDATION_SUBJECTS,
    CURRICULUM_GRADES: CURRICULUM_GRADES,
    checkedFoundationSubjects: checkedFoundationSubjects,
    messages: MSG,
    messagesAr: MSG_AR,
    refreshMessages: refreshMessages,
    step1: step1,
    step2: step2,
    step3: step3,
    login: login
  };
})();
