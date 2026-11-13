/* ============================================================
   رحيق RAHEEQ — واجهة الاتصال بخادم الرفع (API)
   ------------------------------------------------------------
   POST /api/registrations : يرسل بيانات الطلب مع صور المستندات
                             (Data URL مضمّنة بعد ضغطها في المتصفح).
   GET  /api/health        : فحص توفّر الخادم قبل الإرسال.

   • إن لم يكن الخادم متاحًا (فتح الملف مباشرة/GitHub Pages) يبقى الحفظ
     المحلي في LocalStorage هو الخطة البديلة، ولا يفشل التسجيل.
   • لا تُرسل الصور إلى أي جهة غير الخادم الرسمي لأكاديمية رحيق.
   ============================================================ */
(function (global) {
  'use strict';

  var HEALTH = '/api/health';
  var ENDPOINT = '/api/registrations';
  var PROBE_TIMEOUT = 4000;
  var UPLOAD_TIMEOUT = 45000;
  var MAX_PAYLOAD_CHARS = 8 * 1024 * 1024;

  var cached = { checked: false, available: false, at: 0, admin: false };
  var lastPayload = null;
  var lastError = '';

  function request(url, options, timeoutMs) {
    if (typeof global.fetch !== 'function') {
      return Promise.reject(makeError('هذا المتصفح لا يدعم الاتصال بالخادم', 'unsupported'));
    }
    var controller = typeof global.AbortController === 'function' ? new global.AbortController() : null;
    var timer = null;
    var opts = Object.assign({ credentials: 'same-origin', cache: 'no-store' }, options || {});
    if (controller) opts.signal = controller.signal;
    var timerPromise = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        if (controller) { try { controller.abort(); } catch (e) {} }
        reject(makeError('انتهت مهلة الاتصال بالخادم', 'timeout'));
      }, timeoutMs || UPLOAD_TIMEOUT);
    });
    var fetchPromise = global.fetch(url, opts).then(function (response) {
      return response.text().then(function (text) {
        var body = null;
        try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
        if (!response.ok) {
          var msg = (body && body.error) || ('فشل الاتصال بالخادم (HTTP ' + response.status + ')');
          var err = makeError(msg, 'http');
          err.status = response.status;
          err.fields = (body && body.fields) || null;
          throw err;
        }
        return body;
      });
    });
    fetchPromise.catch(function () {});
    return Promise.race([fetchPromise, timerPromise]).then(function (value) {
      clearTimeout(timer);
      return value;
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  function makeError(message, code) {
    var err = new Error(message || 'خطأ غير معروف');
    err.code = code || 'error';
    return err;
  }

  /* فحص الخادم (مع كاش دقيقة واحدة) */
  function probe(force) {
    var now = Date.now();
    if (!force && cached.checked && now - cached.at < 60000) {
      return Promise.resolve(cached.available);
    }
    return request(HEALTH, { method: 'GET' }, PROBE_TIMEOUT).then(function (body) {
      cached = {
        checked: true,
        available: !!(body && body.ok),
        at: Date.now(),
        admin: !!(body && body.adminReadEnabled)
      };
      return cached.available;
    }, function (err) {
      cached = { checked: true, available: false, at: Date.now(), admin: false };
      lastError = err.status === 404 || err.status === 405
        ? 'الاستلام المباشر غير مفعّل — الإرسال يتم عبر واتساب أكاديمية رحيق'
        : err.message;
      return false;
    });
  }

  function isAvailable() {
    return !!cached.available;
  }

  /* تجهيز الحمولة: بيانات الحساب + كل مستند مع محتواه الفعلي */
  function buildPayload(data) {
    var docsIn = (data && data.docs) || {};
    var docs = {};
    Object.keys(docsIn).forEach(function (key) {
      var doc = docsIn[key];
      if (!doc || !doc.dataUrl) return;
      docs[key] = {
        name: doc.name || '',
        type: doc.type || '',
        dataUrl: doc.dataUrl,
        width: doc.width || 0,
        height: doc.height || 0
      };
    });
    return {
      orderNumber: data.orderNumber || '',
      createdAt: data.createdAt || '',
      parentName: data.parentName || '',
      nationalId: data.nationalId || '',
      relation: data.relation || '',
      mobile: data.mobile || '',
      whatsapp: data.whatsapp || '',
      email: data.email || '',
      password: data.password || '',
      studentName: data.studentName || '',
      dob: data.dob || '',
      gender: data.gender || '',
      grade: data.grade || '',
      foundationSubjects: Array.isArray(data.foundationSubjects) ? data.foundationSubjects : [],
      prevSchool: data.prevSchool || '',
      address: data.address || '',
      healthNotes: data.healthNotes || '',
      docs: docs
    };
  }

  /* إرسال الطلب إلى الخادم؛ يعيد {orderNumber, savedAt, files} */
  function submit(data) {
    var payload = buildPayload(data);
    var body = JSON.stringify(payload);
    if (body.length > MAX_PAYLOAD_CHARS) {
      return Promise.reject(makeError('حجم الطلب مع الصور كبير جدًا؛ اختر صورًا أصغر ثم أعد الإرسال', 'too-large'));
    }
    lastPayload = payload;
    return request(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body
    }, UPLOAD_TIMEOUT).then(function (result) {
      if (!result || !result.ok) throw makeError((result && result.error) || 'لم يؤكد الخادم حفظ الطلب', 'rejected');
      cached = { checked: true, available: true, at: Date.now(), admin: cached.admin };
      return result;
    }, function (err) {
      lastError = err.message;
      if (!err.status || err.code === 'timeout' || err.code === 'unsupported') {
        cached = { checked: true, available: false, at: Date.now(), admin: false };
      }
      throw err;
    });
  }

  function errorMessage(err) {
    if (!err) return 'تعذّر الاتصال بالخادم';
    if (err.code === 'too-large') return err.message;
    if (err.code === 'unsupported') return 'متصفحك لا يدعم الاتصال المباشر — أرسل طلبك على واتساب أكاديمية رحيق من الزر الأخضر';
    if (err.code === 'timeout') return 'انتهت مهلة الاتصال بالخادم؛ تحقّق من الشبكة وأعد المحاولة';
    if (!err.status) return 'تعذّر الاتصال بالخادم؛ تحقّق من الشبكة أو من تشغيل الخادم ثم أعد المحاولة';
    /* 404/405 = الموقع منشور كملفات ثابتة بلا واجهة رفع (Vercel Pages مثلًا):
       لا نعرض «HTTP 404» لولي الأمر، بل نوضح المسار اليدوي المضمون. */
    if (err.status === 404 || err.status === 405) {
      return 'أرسل طلبك الآن إلى أكاديمية رحيق على واتساب من الزر الأخضر — رسالة جاهزة بكل البيانات.';
    }
    if (err.status === 413) return 'حجم المستندات أكبر من المسموح؛ صغّر الصور ثم أعد الإرسال';
    if (err.status === 429) return 'عدد محاولات كبير على الخادم؛ انتظر دقيقة ثم أعد المحاولة';
    if (err.status === 401 || err.status === 403) return 'الخادم رفض الطلب (صلاحيات)؛ تواصل مع إدارة أكاديمية رحيق';
    if (err.status >= 500) return 'تعذّر إتمام الإرسال الآن؛ أعد المحاولة، أو أرسل طلبك على واتساب أكاديمية رحيق';
    if (err.code === 'timeout') return 'انتهت مهلة الاتصال بالخادم؛ تحقّق من الشبكة وأعد المحاولة';
    if (err.fields) {
      var keys = Object.keys(err.fields);
      if (keys.length) return err.fields[keys[0]];
    }
    return err.message || 'تعذّر إرسال الطلب إلى الخادم';
  }

  global.RaheeqApi = {
    HEALTH: HEALTH,
    ENDPOINT: ENDPOINT,
    probe: probe,
    isAvailable: isAvailable,
    buildPayload: buildPayload,
    submit: submit,
    errorMessage: errorMessage,
    lastError: function () { return lastError; },
    lastPayload: function () { return lastPayload; }
  };
})(typeof window !== 'undefined' ? window : this);
