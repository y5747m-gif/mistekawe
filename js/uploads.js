/* ============================================================
   رحيق RAHEEQ — محرك رفع المستندات (الصورة الفعلية لا اسمها فقط)
   ------------------------------------------------------------
   • يقرأ محتوى الملف بـ FileReader (Data URL) وليس اسمه فقط.
   • يضغط الصور على Canvas لتناسب مساحة LocalStorage (~5MB).
   • يعيد سجلًا {name, kind, type, dataUrl, size, ...} يُحفظ مع الحساب
     ويُعرض لاحقًا في شاشة النجاح وبعد تسجيل الدخول.
   • كل المعالجة محلية 100%: لا يُرسل أي ملف إلى الخارج.
   ============================================================ */
(function (global) {
  'use strict';

  var LIMITS = {
    maxFileBytes: 12 * 1024 * 1024,   // أقصى حجم ملف قبل المعالجة
    maxPdfBytes: 700 * 1024,          // ملفات PDF تُحفظ كما هي (بلا ضغط)
    perDocChars: 620000,              // ≈ 465KB لكل مستند بعد الترميز
    totalChars: 2600000               // ≈ 2MB إجمالي المستندات لكل طلب
  };

  var DOC_KEYS = ['birthCert', 'photo', 'parentCard', 'reportCard'];
  var DOC_LABELS = {
    birthCert: 'شهادة الميلاد',
    photo: 'الصورة الشخصية',
    parentCard: 'بطاقة ولي الأمر',
    reportCard: 'بيان النجاح'
  };

  /* فقط صور نقطية و PDF — لا SVG ولا HTML ولا أنواع قابلة للتنفيذ */
  var SAFE_DATA = /^data:(image\/(?:jpeg|png|webp|gif|bmp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/;
  var IMG_EXT = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif|tiff?)$/i;
  var PDF_EXT = /\.pdf$/i;
  var BASE64_ONLY = /^[A-Za-z0-9+/=]+$/;

  /* خطوات الضغط: [أقصى بُعد، جودة JPEG] — أول نتيجة تناسب الميزانية تُعتمد */
  var STEPS = [
    [1400, 0.82], [1200, 0.74], [1000, 0.66],
    [800, 0.58], [640, 0.50], [480, 0.42]
  ];

  function kindOf(file) {
    var t = String((file && file.type) || '').toLowerCase();
    var n = String((file && file.name) || '');
    if (t === 'application/pdf' || PDF_EXT.test(n)) return 'pdf';
    if (/svg/.test(t) || /\.svgz?$/i.test(n)) return 'unsupported';
    if (/^image\//.test(t) || IMG_EXT.test(n)) return 'image';
    return 'unsupported';
  }

  function safeDataUrl(v) {
    return typeof v === 'string' && v.length > 40 && v.length < 2000000 && SAFE_DATA.test(v);
  }

  function mimeOf(url) {
    var m = /^data:([^;]+);base64,/.exec(String(url || ''));
    return m ? m[1] : '';
  }

  /* سجل قديم (اسم فقط) أو سجل تالف → يُميّز بدل أن يُعرض كصورة وهمية */
  function legacyDoc(name) {
    return {
      name: String(name || ''), kind: 'legacy', legacy: true, type: '',
      dataUrl: '', size: 0, storedSize: 0, width: 0, height: 0, uploadedAt: ''
    };
  }

  function normalizeDoc(doc) {
    if (!doc) return null;
    if (typeof doc === 'string') return legacyDoc(doc);
    if (typeof doc !== 'object') return null;
    var name = String(doc.name || '');
    if (!safeDataUrl(doc.dataUrl)) return legacyDoc(name);
    var mime = mimeOf(doc.dataUrl);
    return {
      name: name,
      kind: mime === 'application/pdf' ? 'pdf' : 'image',
      legacy: false,
      type: mime,
      dataUrl: doc.dataUrl,
      size: Number(doc.size) || 0,
      storedSize: doc.dataUrl.length,
      width: Number(doc.width) || 0,
      height: Number(doc.height) || 0,
      uploadedAt: String(doc.uploadedAt || '')
    };
  }

  function normalizeDocs(docs) {
    var out = {};
    DOC_KEYS.forEach(function (k) { out[k] = normalizeDoc(docs && docs[k]); });
    return out;
  }

  function docsChars(docs) {
    return DOC_KEYS.reduce(function (sum, k) {
      var d = docs && docs[k];
      var n = d && d.storedSize != null ? Number(d.storedSize) : (d && d.dataUrl ? String(d.dataUrl).length : 0);
      return sum + (isFinite(n) ? n : 0);
    }, 0);
  }

  function estimateBytes(chars) { return Math.max(0, Math.round(chars * 3 / 4)); }

  function readRaw(file) {
    return new Promise(function (resolve, reject) {
      if (!global.FileReader) { reject(new Error('هذا المتصفح لا يدعم قراءة الملفات')); return; }
      var reader = new global.FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('تعذّر قراءة الملف، جرّب ملفًا آخر')); };
      try { reader.readAsDataURL(file); }
      catch (e) { reject(new Error('تعذّر قراءة الملف')); }
    });
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new global.Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('تعذّر فتح الصورة على هذا المتصفح، حوّلها إلى JPG أو PNG وأعد المحاولة')); };
      img.src = url;
    });
  }

  function encodeImage(img, maxSide, quality) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('أبعاد الصورة غير صالحة');
    var scale = Math.min(1, maxSide / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));
    var canvas = global.document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) throw new Error('المتصفح لا يدعم معالجة الصور على Canvas');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, cw, ch);  // خلفية بيضاء بدل الشفافية السوداء في JPEG
    ctx.drawImage(img, 0, 0, cw, ch);
    var url = canvas.toDataURL('image/jpeg', quality);
    if (!safeDataUrl(url)) throw new Error('تعذّر إنتاج صورة صالحة');
    return { dataUrl: url, width: cw, height: ch, maxSide: maxSide, quality: quality };
  }

  function compressImage(raw, budgetChars, capSide) {
    var steps = STEPS.filter(function (s) { return !capSide || s[0] <= capSide; });
    if (!steps.length) steps = [STEPS[STEPS.length - 1]];
    return loadImage(raw).then(function (img) {
      var smallest = null;
      for (var i = 0; i < steps.length; i++) {
        var enc = encodeImage(img, steps[i][0], steps[i][1]);
        if (!smallest || enc.dataUrl.length < smallest.dataUrl.length) smallest = enc;
        if (enc.dataUrl.length <= budgetChars) return enc;
      }
      throw new Error('الصورة كبيرة جدًا حتى بعد الضغط؛ استخدم صورة أصغر أو أقل تفاصيل');
    });
  }

  /* توحيد بادئة PDF: بعض المتصفحات تعطي application/octet-stream */
  function pdfDataUrl(raw) {
    var idx = String(raw).indexOf('base64,');
    if (idx < 0 || String(raw).indexOf('data:') !== 0) throw new Error('تعذّر قراءة ملف PDF');
    var payload = String(raw).slice(idx + 7).replace(/\s/g, '');
    if (!payload || !BASE64_ONLY.test(payload)) throw new Error('محتوى ملف PDF غير صالح');
    return 'data:application/pdf;base64,' + payload;
  }

  function makeRecord(file, kind, enc) {
    return {
      name: String(file.name || 'مستند'),
      kind: kind,
      legacy: false,
      type: kind === 'pdf' ? 'application/pdf' : 'image/jpeg',
      dataUrl: enc.dataUrl,
      size: Number(file.size) || 0,
      storedSize: enc.dataUrl.length,
      width: enc.width || 0,
      height: enc.height || 0,
      uploadedAt: new Date().toISOString()
    };
  }

  /* الواجهة العامة: File → سجل يحوي بيانات الصورة الفعلية */
  function readDocument(file, opts) {
    if (!opts) opts = {};
    var budget = opts.budgetChars || LIMITS.perDocChars;
    return Promise.resolve().then(function () {
      if (!file || typeof file !== 'object') throw new Error('لم يتم اختيار ملف');
      var kind = kindOf(file);
      if (kind === 'unsupported') {
        throw new Error('صيغة الملف غير مدعومة — اختر صورة JPG/PNG/WEBP أو ملف PDF');
      }
      var size = Number(file.size) || 0;
      if (size > LIMITS.maxFileBytes) {
        throw new Error('حجم الملف يتجاوز 12 ميجابايت؛ اختر صورة أصغر');
      }
      if (kind === 'pdf' && size > LIMITS.maxPdfBytes) {
        throw new Error('حجم ملف PDF يتجاوز 700 كيلوبايت؛ حوّله إلى صورة أو صغّره');
      }
      return readRaw(file).then(function (raw) {
        if (kind === 'pdf') {
          var url = pdfDataUrl(raw);
          if (!safeDataUrl(url)) throw new Error('محتوى ملف PDF غير صالح');
          if (url.length > budget * 2) {
            throw new Error('ملف PDF كبير جدًا على مساحة التخزين؛ حوّله إلى صورة');
          }
          return makeRecord(file, 'pdf', { dataUrl: url, width: 0, height: 0 });
        }
        return compressImage(raw, budget).then(function (enc) {
          return makeRecord(file, 'image', enc);
        });
      });
    });
  }

  /* إعادة ضغط الصور عند امتلاء LocalStorage (PDF يُترك كما هو) */
  function shrinkDocs(docs, perBudget) {
    var norm = normalizeDocs(docs);
    var jobs = DOC_KEYS.map(function (k) {
      var d = norm[k];
      if (!d || d.kind !== 'image' || !d.dataUrl || d.storedSize <= perBudget) {
        return Promise.resolve(d);
      }
      return compressImage(d.dataUrl, perBudget, d.width || 1400)
        .then(function (enc) {
          return {
            name: d.name, kind: 'image', legacy: false, type: 'image/jpeg',
            dataUrl: enc.dataUrl, size: d.size, storedSize: enc.dataUrl.length,
            width: enc.width, height: enc.height, uploadedAt: d.uploadedAt
          };
        })
        .catch(function () { return d; });
    });
    return Promise.all(jobs).then(function (list) {
      var out = {};
      DOC_KEYS.forEach(function (k, i) { out[k] = list[i]; });
      return out;
    });
  }

  function fitDocs(docs, totalBudget) {
    var budget = totalBudget || LIMITS.totalChars;
    var norm = normalizeDocs(docs);
    if (docsChars(norm) <= budget) return Promise.resolve(norm);
    return shrinkDocs(norm, Math.max(80000, Math.floor(budget / 5)));
  }

  /* تحويل Data URL إلى Blob لفتح PDF في تبويب جديد (روابط data: محجوبة) */
  function dataUrlToBlob(url) {
    if (!safeDataUrl(url) || !global.atob || !global.Blob) return null;
    var m = /^data:([^;]+);base64,(.*)$/.exec(url);
    if (!m) return null;
    var bin = global.atob(m[2]);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new global.Blob([arr], { type: m[1] });
  }

  global.RaheeqUploads = {
    LIMITS: LIMITS,
    DOC_KEYS: DOC_KEYS,
    DOC_LABELS: DOC_LABELS,
    kindOf: kindOf,
    safeDataUrl: safeDataUrl,
    mimeOf: mimeOf,
    normalizeDoc: normalizeDoc,
    normalizeDocs: normalizeDocs,
    docsChars: docsChars,
    estimateBytes: estimateBytes,
    readDocument: readDocument,
    shrinkDocs: shrinkDocs,
    fitDocs: fitDocs,
    dataUrlToBlob: dataUrlToBlob
  };
})(typeof window !== 'undefined' ? window : this);
