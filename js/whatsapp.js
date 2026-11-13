/* ============================================================
   رحيق RAHEEQ — إرسال الطلب إلى واتساب أكاديمية رحيق
   ------------------------------------------------------------
   المسار الأساسي (لا يعطي 404 أبدًا):
     wa.me/<رقم دولي>?text=<رسالة جاهزة>  ثم يلصق ولي الأمر الصور
     داخل المحادثة بضغطة واحدة.

   المسار الأفضل على الجوال: navigator.share مع ملفات الصور نفسها
   (WhatsApp يستقبل الصور + النص مباشرة في التطبيقات الداعمة).

   ملاحظة مهمة عن السبب الجذري لخطأ 404 السابق:
     لا يوجد «API» يمكن للمتصفح أن يرفع عليه الصور تلقائيًا إلى واتساب
     بدون WhatsApp Business API (خادم + توثيق Meta). المحاولات السابقة
     كانت تنادي مسارًا غير موجود على خادم الموقع فترجع 404. هنا لا يوجد
     أي نداء شبكي إطلاقًا — فقط فتح رابط wa.me الرسمي.

   واجهة عامة: window.RaheeqWhatsApp
   ============================================================ */
(function (global) {
  'use strict';

  var DEFAULT_NUMBER = '201151947735';   /* رقم أكاديمية رحيق الرسمي */
  var MAX_IMAGES_IN_SHARE = 4;
  var MAX_TEXT = 4000;

  function t(str) {
    return global.RaheeqI18n && global.RaheeqI18n.t ? global.RaheeqI18n.t(str) : str;
  }
  function isEn() {
    return !!(global.RaheeqI18n && global.RaheeqI18n.isEnglish && global.RaheeqI18n.isEnglish());
  }
  function digits(v) {
    return String(v == null ? '' : v).replace(/\D/g, '');
  }

  /* ---------- الرقم ---------- */
  function getNumber(override) {
    var fromOverride = digits(override);
    if (fromOverride) return fromOverride;
    var fromMeta = digits(getMeta('raheeq-whatsapp'));
    if (fromMeta) return fromMeta;
    try {
      if (global.localStorage) {
        var stored = digits(global.localStorage.getItem('raheeq_whatsapp_number'));
        if (stored) return stored;
      }
    } catch (e) { /* تجاهل */ }
    return DEFAULT_NUMBER;
  }
  function setNumber(num) {
    var n = digits(num);
    if (!n) return false;
    try { if (global.localStorage) global.localStorage.setItem('raheeq_whatsapp_number', n); } catch (e) {}
    return true;
  }
  function getMeta(name) {
    var meta = document.querySelector('meta[name="' + name + '"]');
    return meta ? meta.getAttribute('content') : '';
  }

  /* ---------- رسالة الطلب ---------- */
  function gradeEn(grade) {
    var K = global.RaheeqI18n && global.RaheeqI18n.DICT;
    if (K && K[grade]) return K[grade];
    return grade;
  }

  function buildMessage(data, opts) {
    if (!data) return '';
    var o = opts || {};
    var lines = [];
    lines.push(isEn() ? '🎓 Raheeq Academy — New registration request' : '🎓 أكاديمية رحيق — طلب تسجيل جديد');
    lines.push('————————————');
    lines.push('🧾 ' + (isEn() ? 'Order number: ' : 'رقم الطلب: ') + (data.orderNumber || '—'));
    if (data.createdAt) {
      var d = new Date(data.createdAt);
      if (!isNaN(d.getTime())) {
        lines.push('📅 ' + (isEn() ? 'Request date: ' : 'تاريخ الطلب: ') + d.toISOString().slice(0, 10));
      }
    }
    lines.push('');
    lines.push('👤 ' + (isEn() ? 'Parent: ' : 'ولي الأمر: ') + (data.parentName || '—'));
    lines.push('🪪 ' + (isEn() ? 'National ID: ' : 'الرقم القومي: ') + (data.nationalId || '—'));
    if (data.relation) lines.push('🔗 ' + (isEn() ? 'Relation: ' : 'صلة القرابة: ') + relationLabel(data.relation));
    lines.push('📱 ' + (isEn() ? 'Mobile: ' : 'الموبايل: ') + (data.mobile || '—'));
    if (data.whatsapp && data.whatsapp !== data.mobile) {
      lines.push('💬 ' + (isEn() ? 'WhatsApp: ' : 'واتساب: ') + data.whatsapp);
    }
    if (data.email) lines.push('✉️ ' + (isEn() ? 'Email: ' : 'البريد: ') + data.email);
    lines.push('');
    lines.push('🎒 ' + (isEn() ? 'Student: ' : 'الطالب: ') + (data.studentName || '—'));
    if (data.dob) lines.push('🎂 ' + (isEn() ? 'Date of birth: ' : 'تاريخ الميلاد: ') + data.dob);
    if (data.gender) lines.push('⚧ ' + (isEn() ? 'Gender: ' : 'النوع: ') + genderLabel(data.gender));
    if (data.grade) lines.push('📚 ' + (isEn() ? 'Grade: ' : 'الصف: ') + (isEn() ? gradeEn(data.grade) : data.grade));
    if (data.prevSchool) lines.push('🏫 ' + (isEn() ? 'Previous academy: ' : 'الأكاديمية السابقة: ') + data.prevSchool);
    if (data.address) lines.push('📍 ' + (isEn() ? 'Address: ' : 'العنوان: ') + data.address);
    if (data.healthNotes) lines.push('🩺 ' + (isEn() ? 'Health notes: ' : 'ملاحظات صحية: ') + data.healthNotes);
    lines.push('');
    var docs = savedDocs(data.docs);
    lines.push('📎 ' + (isEn() ? 'Documents to attach: ' : 'المستندات المرفقة للطلب: ') +
      (docs.length ? docs.join(' • ') : (isEn() ? 'birth certificate, personal photo, parent ID card' : 'شهادة الميلاد • الصورة الشخصية • بطاقة ولي الأمر')));
    if (!o.skipFooter) {
      lines.push('');
      lines.push(isEn()
        ? 'Sent from the Raheeq Academy parent portal.'
        : 'مُرسَل من بوابة ولي الأمر — أكاديمية رحيق.');
    }
    var text = lines.join('\n');
    return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT - 3) + '...' : text;
  }

  function relationLabel(v) {
    if (!isEn()) return v;
    var map = { 'أب': 'Father', 'أم': 'Mother', 'ولي أمر': 'Guardian' };
    return map[v] || v;
  }
  function genderLabel(v) {
    if (!isEn()) return v;
    var map = { 'ذكر': 'Male', 'أنثى': 'Female' };
    return map[v] || v;
  }
  function docLabel(key) {
    var U = global.RaheeqUploads;
    var K = global.RaheeqI18n && global.RaheeqI18n.DICT;
    var label = U && U.DOC_LABELS && U.DOC_LABELS[key] ? U.DOC_LABELS[key] : key;
    return K && K[label] ? K[label] : label;
  }
  function savedDocs(docs) {
    var U = global.RaheeqUploads;
    var keys = U && U.DOC_KEYS ? U.DOC_KEYS : ['birthCert', 'photo', 'parentCard', 'reportCard'];
    var norm = U && U.normalizeDocs ? U.normalizeDocs(docs) : (docs || {});
    return keys.filter(function (k) {
      var d = norm[k];
      return d && (d.dataUrl || d.name);
    }).map(function (k) { return docLabel(k); });
  }

  /* ---------- روابط واتساب ---------- */
  function buildLink(data, opts) {
    var num = getNumber(opts && opts.number);
    var text = buildMessage(data, opts);
    return 'https://wa.me/' + num + '?text=' + encodeURIComponent(text);
  }

  /* فتح الرابط: نافذة جديدة ثم بديل داخل نفس الصفحة (بلا any 404) */
  function openLink(url) {
    var win = null;
    try { win = global.open(url, '_blank', 'noopener'); } catch (e) { win = null; }
    if (!win) {
      try { global.location.href = url; return 'same-tab'; } catch (e) { return 'blocked'; }
    }
    return 'new-tab';
  }

  /* ---------- تجهيز ملفات الصور للمشاركة ---------- */
  function toFile(dataUrl, name) {
    if (!dataUrl || dataUrl.indexOf('data:') !== 0) return null;
    var m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    if (!m) return null;
    var type = m[1];
    var safeType = /^image\/(jpeg|png|webp|gif|bmp)$/i.test(type) ? type : 'image/jpeg';
    var bin;
    try {
      if (global.atob) bin = global.atob(m[2]);
      else if (typeof Buffer !== 'undefined') bin = Buffer.from(m[2], 'base64').toString('binary');
      else return null;
    } catch (e) { return null; }
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
    var ext = safeType.split('/')[1].replace('jpeg', 'jpg');
    var fileName = String(name || 'document').replace(/[\\/:*?"<>|]+/g, '-');
    if (!/\.[a-z0-9]{2,5}$/i.test(fileName)) fileName += '.' + ext;
    try {
      if (global.File) return new global.File([bytes], fileName, { type: safeType });
      if (global.Blob) return new global.Blob([bytes], { type: safeType });
    } catch (e) { return null; }
    return null;
  }

  function collectFiles(docs) {
    var U = global.RaheeqUploads;
    var keys = U && U.DOC_KEYS ? U.DOC_KEYS : ['birthCert', 'photo', 'parentCard', 'reportCard'];
    var norm = U && U.normalizeDocs ? U.normalizeDocs(docs) : (docs || {});
    var files = [];
    keys.forEach(function (k) {
      var d = norm[k];
      if (!d || d.kind !== 'image' || !d.dataUrl) return;
      var file = toFile(d.dataUrl, d.name || (docLabel(k) + '.jpg'));
      if (file) files.push(file);
    });
    return files.slice(0, MAX_IMAGES_IN_SHARE);
  }

  function canShareFiles(files) {
    if (!files || !files.length) return false;
    if (!global.navigator || typeof global.navigator.canShare !== 'function' || typeof global.navigator.share !== 'function') return false;
    try { return global.navigator.canShare({ files: files }); } catch (e) { return false; }
  }

  /* مشاركة الصور + النص عبر Web Share، مع رجوع آمن إلى الرابط */
  function shareWithImages(data, opts) {
    var files = collectFiles(data && data.docs);
    var text = buildMessage(data, opts);
    if (!canShareFiles(files)) return Promise.resolve({ shared: false, reason: 'unsupported' });
    return global.navigator.share({ files: files, text: text }).then(function () {
      return { shared: true, files: files.length };
    }, function (err) {
      var name = err && err.name ? err.name : '';
      return { shared: false, reason: name === 'AbortError' ? 'cancelled' : 'error' };
    });
  }

  /* ---------- نسخ النص ---------- */
  function copyText(text) {
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      return global.navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }

  global.RaheeqWhatsApp = {
    DEFAULT_NUMBER: DEFAULT_NUMBER,
    getNumber: getNumber,
    setNumber: setNumber,
    buildMessage: buildMessage,
    buildLink: buildLink,
    openLink: openLink,
    collectFiles: collectFiles,
    canShareFiles: canShareFiles,
    shareWithImages: shareWithImages,
    copyText: copyText
  };
})(typeof window !== 'undefined' ? window : this);
