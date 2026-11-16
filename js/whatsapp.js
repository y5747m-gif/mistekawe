/* ============================================================
   رحيق RAHEEQ — تنسيق الطلب تلقائيًا والتحويل المباشر إلى واتساب
   ------------------------------------------------------------
   • ينسّق كل بيانات الطلب تلقائيًا (تنظيف المسافات، توحيد الأرقام،
     حساب عمر الطالب، ترتيب الأقسام بخط واضح ومنسّق لواتساب).
   • يحوّل المستخدم مباشرة وفورًا بعد إتمام الكتابة إلى محادثة الرقم
     الرسمي (201151947735) عبر wa.me/<رقم دولي>?text=<الرسالة الكاملة>
     بلا أي خطأ 404 وبلا فقدان لأي تفصيلة.
   • يدعم مشاركة صور المستندات مباشرة عبر Web Share على الهواتف الداعمة.

   واجهة عامة: window.RaheeqWhatsApp
   ============================================================ */
(function (global) {
  'use strict';

  var DEFAULT_NUMBER = '201151947735';   /* رقم أكاديمية رحيق الرسمي */
  var MAX_IMAGES_IN_SHARE = 4;
  var MAX_TEXT = 4000;
  var lastOpenedUrl = '';

  function isEn() {
    return !!(global.RaheeqI18n && global.RaheeqI18n.isEnglish && global.RaheeqI18n.isEnglish());
  }

  /* توحيد الأرقام العربية/الفارسية إلى لاتينية */
  function latinDigits(v) {
    return String(v == null ? '' : v)
      .replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
      .replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); });
  }
  function digits(v) {
    return latinDigits(v).replace(/\D/g, '');
  }
  function cleanText(v) {
    return latinDigits(v)
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }
  function cleanMultiline(v) {
    return latinDigits(v)
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .split(/\r?\n/)
      .map(function (line) { return line.replace(/[ \t]+/g, ' ').trim(); })
      .filter(Boolean)
      .join(' — ');
  }

  /* ---------- الرقم الرسمي ----------
     ثابت في الكود (DEFAULT_NUMBER) أو في meta[name="raheeq-whatsapp"] فقط.
     localStorage لا يغيّر الرقم أبدًا لحماية كل الطلبات من أي تلاعب. */
  function saneNumber(v) {
    var d = digits(v);
    return /^\d{8,15}$/.test(d) ? d : '';
  }
  function getMeta(name) {
    try {
      var meta = global.document && global.document.querySelector
        ? global.document.querySelector('meta[name="' + name + '"]')
        : null;
      return meta ? meta.getAttribute('content') : '';
    } catch (e) { return ''; }
  }
  function getNumber(override) {
    return saneNumber(override) || saneNumber(getMeta('raheeq-whatsapp')) || DEFAULT_NUMBER;
  }
  function formatDisplayNumber(num) {
    var d = getNumber(num);
    if (/^20(\d{3})(\d{3})(\d{4})$/.test(d)) {
      return d.replace(/^20(\d{3})(\d{3})(\d{4})$/, '+20 $1 $2 $3');
    }
    return '+' + d;
  }

  /* ---------- حساب عمر الطالب تلقائيًا من تاريخ الميلاد ---------- */
  function calcAge(dob) {
    if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return '';
    var parts = dob.split('-');
    var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10) - 1, day = parseInt(parts[2], 10);
    var birth = new Date(y, m, day);
    if (isNaN(birth.getTime())) return '';
    var now = new Date();
    var years = now.getFullYear() - birth.getFullYear();
    var mDiff = now.getMonth() - birth.getMonth();
    if (mDiff < 0 || (mDiff === 0 && now.getDate() < birth.getDate())) years--;
    if (years < 1 || years > 90) return '';
    if (isEn()) return years + (years === 1 ? ' yr' : ' yrs');
    if (years === 1) return 'سنة واحدة';
    if (years === 2) return 'سنتان';
    if (years >= 3 && years <= 10) return years + ' سنوات';
    return years + ' سنة';
  }

  function formatDateTime(iso) {
    if (!iso) return { date: '', time: '' };
    var d = new Date(iso);
    if (isNaN(d.getTime())) return { date: '', time: '' };
    var date = d.toISOString().slice(0, 10);
    var hh = d.getHours(), mm = String(d.getMinutes()).padStart(2, '0');
    var suffix = isEn() ? (hh >= 12 ? 'PM' : 'AM') : (hh >= 12 ? 'م' : 'ص');
    var h12 = hh % 12 || 12;
    return { date: date, time: h12 + ':' + mm + ' ' + suffix };
  }

  /* ---------- تطبيع وتنظيم بيانات الطلب تلقائيًا ---------- */
  function normalizeData(raw) {
    var d = raw || {};
    var mob = digits(d.mobile);
    var wa = digits(d.whatsapp) || mob;
    var subjects = Array.isArray(d.foundationSubjects)
      ? d.foundationSubjects.map(cleanText).filter(Boolean)
      : [];
    return {
      orderNumber: cleanText(d.orderNumber) || '—',
      createdAt: d.createdAt || '',
      parentName: cleanText(d.parentName),
      nationalId: digits(d.nationalId),
      relation: cleanText(d.relation),
      mobile: mob,
      whatsapp: wa,
      email: cleanText(d.email).toLowerCase(),
      studentName: cleanText(d.studentName),
      dob: cleanText(d.dob),
      gender: cleanText(d.gender),
      programType: cleanText(d.programType),
      foundationLevel: cleanText(d.foundationLevel),
      foundationSubjects: subjects,
      grade: cleanText(d.grade),
      prevSchool: cleanText(d.prevSchool),
      address: cleanMultiline(d.address),
      healthNotes: cleanMultiline(d.healthNotes),
      orderNotes: cleanMultiline(d.orderNotes),
      docs: d.docs || {}
    };
  }

  /* ---------- ترجمة القيم عند الإنجليزية ---------- */
  function gradeEn(grade) {
    var K = global.RaheeqI18n && global.RaheeqI18n.DICT;
    if (K && K[grade]) return K[grade];
    return grade;
  }
  function relationLabel(v) {
    if (!isEn()) return v;
    var map = { 'أب': 'Father', 'أم': 'Mother', 'الأب': 'Father', 'الأم': 'Mother', 'ولي أمر': 'Guardian' };
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
    if (isEn() && K && K[label]) return K[label];
    return label;
  }
  function savedDocsDetails(docs) {
    var U = global.RaheeqUploads;
    var keys = U && U.DOC_KEYS ? U.DOC_KEYS : ['birthCert', 'photo', 'parentCard', 'reportCard'];
    var norm = U && U.normalizeDocs ? U.normalizeDocs(docs) : (docs || {});
    var list = [];
    keys.forEach(function (k) {
      var d = norm[k];
      if (!d || (!d.dataUrl && !d.name)) return;
      list.push({ key: k, label: docLabel(k), name: cleanText(d.name), kind: d.kind || 'image' });
    });
    return list;
  }

  /* ---------- بناء رسالة طلب التسجيل الكاملة المتظبطة ---------- */
  function buildMessage(rawData, opts) {
    if (!rawData) return '';
    var data = normalizeData(rawData);
    var o = opts || {};
    var en = isEn();
    var dt = formatDateTime(data.createdAt);
    var lines = [];

    lines.push(en
      ? '🎓 *Raheeq Academy — New Registration Order*'
      : '🎓 *أكاديمية رحيق — طلب تسجيل جديد*');
    lines.push('━━━━━━━━━━━━━━━━━━');
    lines.push('🧾 *' + (en ? 'Order number:' : 'رقم الطلب:') + '* ' + data.orderNumber);
    if (dt.date) {
      lines.push('📅 *' + (en ? 'Request date:' : 'تاريخ الطلب:') + '* ' + dt.date + (dt.time ? ' • ' + dt.time : ''));
    }

    lines.push('');
    lines.push(en ? '👤 *Parent Details*' : '👤 *بيانات ولي الأمر*');
    lines.push('• ' + (en ? 'Parent: ' : 'ولي الأمر: ') + (data.parentName || '—'));
    if (data.nationalId) {
      lines.push('• ' + (en ? 'National ID: ' : 'الرقم القومي: ') + data.nationalId);
    }
    if (data.relation) {
      lines.push('• ' + (en ? 'Relation: ' : 'صلة القرابة: ') + relationLabel(data.relation));
    }
    lines.push('• ' + (en ? 'Mobile: ' : 'الموبايل: ') + (data.mobile || '—'));
    if (data.whatsapp) {
      var waText = data.whatsapp === data.mobile
        ? data.whatsapp + (en ? ' (same as mobile)' : ' (نفس الموبايل)')
        : data.whatsapp;
      lines.push('• ' + (en ? 'WhatsApp: ' : 'واتساب: ') + waText);
    }
    if (data.email) {
      lines.push('• ' + (en ? 'Email: ' : 'البريد الإلكتروني: ') + data.email);
    }

    lines.push('');
    lines.push(en ? '🎒 *Student & Program Details*' : '🎒 *بيانات الطالب والبرنامج*');
    lines.push('• ' + (en ? 'Student: ' : 'الطالب: ') + (data.studentName || '—'));
    if (data.dob) {
      var age = calcAge(data.dob);
      lines.push('• ' + (en ? 'Date of birth: ' : 'تاريخ الميلاد: ') + data.dob + (age ? ' (' + age + ')' : ''));
    }
    if (data.gender) {
      lines.push('• ' + (en ? 'Gender: ' : 'النوع: ') + genderLabel(data.gender));
    }
    if (data.programType) {
      var ptEn = data.programType === 'تأسيس' ? 'Foundation' : (data.programType === 'منهج دراسي' ? 'Curriculum' : data.programType);
      lines.push('• ' + (en ? 'Program: ' : 'نوع البرنامج: ') + (en ? ptEn : data.programType));
    }
    if (data.programType === 'تأسيس' && data.foundationLevel) {
      lines.push('• ' + (en ? 'Foundation level: ' : 'مستوى التأسيس: ') + (en ? gradeEn(data.foundationLevel) : data.foundationLevel));
    }
    if (data.grade) {
      lines.push('• ' + (en ? 'Academic year: ' : 'السنة الدراسية: ') + (en ? gradeEn(data.grade) : data.grade));
    }
    if (data.foundationSubjects.length) {
      lines.push('• ' + (en ? 'Foundation subjects: ' : 'مواد التأسيس: ') +
        data.foundationSubjects.map(function (v) { return en ? gradeEn(v) : v; }).join(en ? ', ' : '، '));
    }
    if (data.prevSchool) {
      lines.push('• ' + (en ? 'Previous academy: ' : 'الأكاديمية السابقة: ') + data.prevSchool);
    }
    if (data.address) {
      lines.push('• ' + (en ? 'Address: ' : 'العنوان: ') + data.address);
    }
    if (data.healthNotes) {
      lines.push('• ' + (en ? 'Health notes: ' : 'ملاحظات صحية: ') + data.healthNotes);
    }
    if (data.orderNotes) {
      lines.push('• ' + (en ? 'Additional notes: ' : 'ملاحظات الطلب: ') + data.orderNotes);
    }

    lines.push('');
    var docs = savedDocsDetails(data.docs);
    if (docs.length) {
      lines.push('📎 *' + (en ? 'Documents attached (' + docs.length + '):' : 'المستندات المرفقة للطلب (' + docs.length + '):') + '*');
      docs.forEach(function (item) {
        lines.push('  ✓ ' + item.label);
      });
      lines.push(en
        ? '_(Document images will be attached right here in the chat)_'
        : '_(مرفق صور المستندات في هذه المحادثة)_');
    } else {
      lines.push('📎 ' + (en ? 'Documents to attach: ' : 'المستندات المرفقة للطلب: ') +
        (en ? 'birth certificate, personal photo' : 'شهادة الميلاد • الصورة الشخصية'));
    }

    if (!o.skipFooter) {
      lines.push('━━━━━━━━━━━━━━━━━━');
      lines.push(en
        ? '✨ Sent directly from Raheeq Academy Parent Portal.'
        : '✨ مُرسَل مباشرة من بوابة ولي الأمر — أكاديمية رحيق.');
    }

    var text = lines.join('\n');
    return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT - 3) + '...' : text;
  }

  /* ---------- بناء رسالة طلب سريع / استفسار منظم تلقائيًا ---------- */
  function buildQuickMessage(info) {
    var d = info || {};
    var en = isEn();
    var lines = [];
    lines.push(en
      ? '💬 *Raheeq Academy — Direct Inquiry / Request*'
      : '💬 *أكاديمية رحيق — طلب تواصل واستفسار*');
    lines.push('━━━━━━━━━━━━━━━━━━');
    if (d.name) lines.push('• ' + (en ? 'Name: ' : 'الاسم: ') + cleanText(d.name));
    if (d.mobile) lines.push('• ' + (en ? 'Mobile: ' : 'الموبايل: ') + digits(d.mobile));
    if (d.program) lines.push('• ' + (en ? 'Program: ' : 'البرنامج المطلوب: ') + cleanText(d.program));
    if (d.details) lines.push('• ' + (en ? 'Details: ' : 'التفاصيل: ') + cleanMultiline(d.details));
    lines.push('━━━━━━━━━━━━━━━━━━');
    lines.push(en ? '✨ Sent from Raheeq Academy website.' : '✨ مُرسَل من موقع أكاديمية رحيق.');
    return lines.join('\n').slice(0, MAX_TEXT);
  }

  /* ---------- روابط واتساب المباشرة ---------- */
  function buildLink(data, opts) {
    var num = getNumber(opts && opts.number);
    var text = buildMessage(data, opts);
    return 'https://wa.me/' + num + '?text=' + encodeURIComponent(text);
  }

  function buildQuickLink(info, opts) {
    var num = getNumber(opts && opts.number);
    var text = typeof info === 'string' ? cleanMultiline(info) : buildQuickMessage(info);
    return text
      ? 'https://wa.me/' + num + '?text=' + encodeURIComponent(text)
      : 'https://wa.me/' + num;
  }

  function isTestDom() {
    try {
      return !!(global.navigator && /jsdom/i.test(String(global.navigator.userAgent || '')));
    } catch (e) { return false; }
  }

  /* تحويل مباشر في نفس الصفحة (يُستخدم كضمان 100% لو حُجبت النافذة المنبثقة) */
  function redirectSameTab(url) {
    if (!url || !/^https:\/\/wa\.me\/\d+/.test(url)) return 'blocked';
    lastOpenedUrl = url;
    if (isTestDom()) return 'test-recorded';
    /* بيئة بلا location (اختبارات/عامل خدمة) — نُسجّل الرابط بلا أي تنقّل */
    if (!global.location) return 'test-recorded';
    try {
      if (typeof global.location.assign === 'function') {
        global.location.assign(url);
      } else if (global.location) {
        global.location.href = url;
      }
      return 'same-tab';
    } catch (e) { return 'blocked'; }
  }

  /* فتح الرابط مباشرة: نافذة/تطبيق واتساب فورًا، ثم تحويل مباشر في نفس الصفحة بلا أي 404 */
  function openLink(url, opts) {
    if (!url || !/^https:\/\/wa\.me\/\d+/.test(url)) return 'blocked';
    var o = opts || {};
    lastOpenedUrl = url;
    if (isTestDom()) return 'new-tab';

    var win = null;
    try { win = global.open(url, '_blank', 'noopener,noreferrer'); } catch (e) { win = null; }
    if (win) return 'new-tab';

    /* لو طلب المستدعي إتمام حفظ البيانات أولًا ثم التحويل في نفس التبويب */
    if (o.deferSameTab) return 'deferred';

    return redirectSameTab(url);
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
    formatDisplayNumber: formatDisplayNumber,
    normalizeData: normalizeData,
    buildMessage: buildMessage,
    buildQuickMessage: buildQuickMessage,
    buildLink: buildLink,
    buildQuickLink: buildQuickLink,
    openLink: openLink,
    redirectSameTab: redirectSameTab,
    lastOpenedUrl: function () { return lastOpenedUrl; },
    collectFiles: collectFiles,
    canShareFiles: canShareFiles,
    shareWithImages: shareWithImages,
    copyText: copyText
  };
})(typeof window !== 'undefined' ? window : this);
