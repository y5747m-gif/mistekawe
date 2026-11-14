/* ============================================================
   لوحة مدير رحيق — واجهة فقط. كل الصلاحيات تُفحص على الخادم.
   رمز الجلسة يبقى في ذاكرة الصفحة (لا LocalStorage ولا Cookies):
   إعادة تحميل الصفحة = تسجيل دخول جديد.
   ============================================================ */
(function () {
  'use strict';
  var API = '/api/yaseen-admin/';
  var token = '';
  var view = null;         // آخر رد من الخادم
  var draft = null;        // نسخة التعديل
  var dirty = false;

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k]; else if (k in n && k !== 'list') n[k] = attrs[k]; else n.setAttribute(k, attrs[k]);
    });
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function call(action, method, body) {
    var headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(API + action, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit' })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (res.status === 401 && action !== 'login') { signOut('انتهت الجلسة. سجّل الدخول مرة أخرى.'); throw new Error('auth'); }
          if (!res.ok || !data.ok) throw new Error(data.error || ('خطأ ' + res.status));
          return data;
        });
      });
  }

  /* ---------------- الدخول ---------------- */
  function signOut(message) {
    token = ''; view = null; draft = null; dirty = false;
    $('panel').hidden = true; $('loginView').hidden = false;
    $('password').value = ''; $('otp').value = '';
    $('loginError').textContent = message || '';
  }
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    $('loginError').textContent = '';
    var btn = e.target.querySelector('button'); btn.disabled = true;
    call('login', 'POST', { email: $('email').value, password: $('password').value, otp: $('otp').value }).then(function (data) {
      token = data.token;
      $('password').value = ''; $('otp').value = '';
      return call('config', 'GET');
    }).then(function (data) {
      $('loginView').hidden = true; $('panel').hidden = false;
      setView(data);
    }).catch(function (err) { if (err.message !== 'auth') $('loginError').textContent = err.message; })
      .then(function () { btn.disabled = false; });
  });
  $('logoutBtn').addEventListener('click', function () {
    call('logout', 'POST', {}).catch(function () {}).then(function () { signOut(''); });
  });
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------------- الحالة ---------------- */
  function setView(data) {
    view = data;
    draft = JSON.parse(JSON.stringify(data.config));
    dirty = false;
    render();
  }
  function touch() { dirty = true; $('saveStatus').textContent = 'تعديلات غير محفوظة'; }

  function renderTop() {
    $('who').textContent = view.admin.name + ' · ' + view.admin.email;
    var on = view.config.enabled && !view.envDisabled;
    var pill = $('statusPill');
    pill.textContent = !on ? 'رحيق متوقف لكل الزوار' : (view.online ? 'رحيق يعمل الآن' : 'يعمل — خارج مواعيد العمل');
    pill.className = 'pill' + (on ? '' : ' off');
    var kill = $('killBtn');
    kill.textContent = view.config.enabled ? '⛔ إيقاف رحيق فورًا' : '▶ تشغيل رحيق';
    kill.className = 'btn ' + (view.config.enabled ? 'danger' : 'ok');
    var notes = [];
    if (!view.storage.writable) notes.push('التخزين للقراءة فقط (' + view.storage.kind + '): اربط قاعدة KV بالمشروع ليتم حفظ التعديلات ومفتاح الإيقاف.');
    if (view.envDisabled) notes.push('رحيق متوقف من متغير البيئة YASEEN_ENABLED على الخادم.');
    if (view.passwordHash !== 'bcrypt') notes.push('كلمة السر مخزّنة بـ scrypt لأن مكتبة bcryptjs غير مثبّتة على الخادم (npm install ثم أعد إنشاء الحساب).');
    $('notice').hidden = !notes.length;
    $('notice').textContent = notes.join(' — ');
  }
  $('killBtn').addEventListener('click', function () {
    var enable = !view.config.enabled;
    if (!enable && !window.confirm('إيقاف رحيق لكل زوار الموقع الآن؟')) return;
    call('kill', 'POST', { enabled: enable }).then(function (data) {
      var keep = dirty ? draft : null;
      setView(data);
      if (keep) { keep.enabled = data.config.enabled; draft = keep; dirty = true; render(); touch(); }
      $('saveStatus').textContent = enable ? 'تم تشغيل رحيق' : 'تم إيقاف رحيق';
    }).catch(function (err) { if (err.message !== 'auth') window.alert(err.message); });
  });
  $('saveBtn').addEventListener('click', function () {
    $('saveBtn').disabled = true;
    call('config', 'POST', { config: draft }).then(function (data) {
      setView(data);
      $('saveStatus').textContent = data.changed ? ('تم الحفظ ✓ (' + data.changed + ' تغيير مسجَّل)') : 'لا توجد تغييرات';
    }).catch(function (err) { if (err.message !== 'auth') $('saveStatus').textContent = 'تعذّر الحفظ: ' + err.message; })
      .then(function () { $('saveBtn').disabled = false; });
  });
  $('reloadBtn').addEventListener('click', function () {
    call('config', 'GET').then(function (data) { setView(data); $('saveStatus').textContent = 'تم استرجاع آخر نسخة محفوظة'; }).catch(function () {});
  });

  /* ---------------- عناصر النماذج ---------------- */
  function field(label, obj, key, opts) {
    opts = opts || {};
    var wrap = el('label', {}, label);
    var input;
    if (opts.type === 'textarea') input = el('textarea', { rows: opts.rows || 2 });
    else if (opts.type === 'select') {
      input = el('select');
      opts.options.forEach(function (o) { input.appendChild(el('option', { value: o[0] }, o[1])); });
    } else input = el('input', { type: opts.type || 'text' });
    if (opts.max) input.maxLength = opts.max;
    if (opts.dir) input.dir = opts.dir;
    if (opts.min != null) input.min = opts.min;
    if (opts.maxNum != null) input.max = opts.maxNum;
    if (opts.step) input.step = opts.step;
    var value = obj[key];
    input.value = opts.join ? (value || []).join(opts.join) : (value == null ? '' : value);
    input.addEventListener('input', function () {
      var v = input.value;
      if (opts.type === 'number') v = Number(v);
      if (opts.join) v = v.split(/[,،\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
      if (opts.nullable && v === '') v = null;
      obj[key] = v; touch();
    });
    wrap.appendChild(input);
    return wrap;
  }
  function check(label, obj, key) {
    var wrap = el('label', { class: 'check' });
    var input = el('input', { type: 'checkbox' });
    input.checked = !!obj[key];
    input.addEventListener('change', function () { obj[key] = input.checked; touch(); });
    wrap.appendChild(input); wrap.appendChild(document.createTextNode(label));
    return wrap;
  }
  function grid() { return el('div', { class: 'grid' }); }
  function fieldOptions() { return [['', '— بدون إشارة —']].concat(view.locked.fields.map(function (f) { return [f, FIELD_AR[f] || f]; })); }

  var FIELD_AR = { parentName: 'اسم ولي الأمر', nationalId: 'الرقم القومي', relation: 'صلة القرابة', mobile: 'الموبايل', whatsapp: 'واتساب', email: 'البريد', password: 'كلمة السر', confirmPassword: 'تأكيد كلمة السر', studentName: 'اسم الطالب', dob: 'تاريخ الميلاد', gender: 'النوع', grade: 'الصف', prevSchool: 'المدرسة السابقة', address: 'العنوان', healthNotes: 'ملاحظات صحية', birthCert: 'شهادة الميلاد', photo: 'صورة الطالب', parentCard: 'بطاقة ولي الأمر', reportCard: 'آخر شهادة', agree: 'الموافقة على الشروط' };
  var EXPR_AR = [['happy', 'سعيدة'], ['wave', 'تلوّح'], ['point', 'تشير'], ['thinking', 'تفكّر'], ['worried', 'قلقة'], ['celebrate', 'تحتفل']];
  var MSG_AR = { stuck: 'عند توقف ولي الأمر', fieldFixed: 'بعد تصحيح خانة', allGood: 'كل الخانات سليمة', success: 'نجاح إرسال الطلب', limit: 'انتهاء عدد الرسائل', tooLong: 'رسالة أطول من الحد', noLinks: 'رابط أو ملف', spam: 'رسائل سريعة', captcha: 'طلب التحقق', captchaWrong: 'إجابة تحقق خاطئة', captchaOk: 'نجاح التحقق', offHours: 'خارج مواعيد العمل', empty: 'رسالة فارغة' };
  var ACTION_AR = { login: 'دخول', 'login-failed': 'محاولة دخول فاشلة', logout: 'خروج', config: 'تعديل إعداد', 'kill-switch': 'إيقاف البوت', 'bot-on': 'تشغيل البوت', 'admin-setup': 'إنشاء حساب المدير' };

  /* ---------------- الأقسام ---------------- */
  var SECTIONS = [
    ['personality', 'الشخصية', function (box) {
      box.appendChild(el('h2', {}, 'شخصية البوت'));
      box.appendChild(el('p', { class: 'muted' }, 'الشكل (الوجه والملابس) ثابت ولا يتغير. هنا الاسم ونبرة الترحيب فقط.'));
      var g = grid();
      g.appendChild(field('اسم البوت', draft, 'name', { max: 30 }));
      g.appendChild(field('رقم واتساب الموظف (دولي بدون +)', draft.handoff, 'whatsapp', { max: 15, dir: 'ltr' }));
      box.appendChild(g);
      box.appendChild(field('رسالة الترحيب عند الظهور', draft.personality, 'greeting', { type: 'textarea', max: 240 }));
      box.appendChild(field('افتتاحية المحادثة', draft.personality, 'chatIntro', { type: 'textarea', max: 240 }));
    }],
    ['answers', 'الإجابات', function (box) {
      box.appendChild(el('h2', {}, 'إجابات البوت'));
      box.appendChild(el('p', { class: 'muted' }, 'رحيق يرد فقط بهذه الإجابات. أي سؤال لا يطابق كلمات مفتاحية هنا يأخذ رد «خارج التسجيل» الثابت.'));
      box.appendChild(el('h3', {}, 'الأزرار السريعة الأربعة'));
      draft.quickReplies.forEach(function (q) {
        var item = el('div', { class: 'item' });
        var g = grid();
        g.appendChild(field('نص الزر', q, 'label', { max: 40 }));
        if (q.id !== 'problem') {
          g.appendChild(field('تشير إلى خانة', q, 'pointTo', { type: 'select', options: fieldOptions(), nullable: true }));
          g.appendChild(field('التعبير', q, 'expression', { type: 'select', options: EXPR_AR }));
        }
        item.appendChild(g);
        if (q.id === 'problem') item.appendChild(el('p', { class: 'muted' }, 'هذا الزر يفحص الخطوة الحالية ويشير إلى أول خانة ناقصة (النص من «إرشاد الخانات»).'));
        else { item.appendChild(field('الرد', q, 'reply', { type: 'textarea', max: 400 })); item.appendChild(check('أضف زر «واتساب الأكاديمية» مع الرد', q, 'handoff')); }
        box.appendChild(item);
      });
      box.appendChild(el('h3', {}, 'إجابات الأسئلة المكتوبة'));
      var list = el('div');
      function renderAnswers() {
        clear(list);
        draft.answers.forEach(function (a, i) {
          var item = el('div', { class: 'item' });
          var head = el('div', { class: 'item-head' });
          head.appendChild(el('code', {}, a.id || 'جديد'));
          var del = el('button', { type: 'button', class: 'btn ghost small' }, 'حذف');
          del.addEventListener('click', function () { if (window.confirm('حذف هذه الإجابة؟')) { draft.answers.splice(i, 1); touch(); renderAnswers(); } });
          head.appendChild(del);
          item.appendChild(head);
          item.appendChild(field('الكلمات المفتاحية (افصل بفاصلة)', a, 'keywords', { type: 'textarea', join: '، ' }));
          item.appendChild(field('الرد', a, 'reply', { type: 'textarea', max: 400 }));
          var g = grid();
          g.appendChild(field('تشير إلى خانة', a, 'pointTo', { type: 'select', options: fieldOptions(), nullable: true }));
          g.appendChild(field('التعبير', a, 'expression', { type: 'select', options: EXPR_AR }));
          item.appendChild(g);
          item.appendChild(check('أضف زر «واتساب الأكاديمية» مع الرد', a, 'handoff'));
          list.appendChild(item);
        });
      }
      renderAnswers();
      box.appendChild(list);
      var add = el('button', { type: 'button', class: 'btn ghost' }, '+ إضافة إجابة');
      add.addEventListener('click', function () {
        draft.answers.push({ id: 'c' + Date.now().toString(36), keywords: [], reply: '', pointTo: null, expression: 'happy', handoff: false });
        touch(); renderAnswers();
      });
      box.appendChild(add);
    }],
    ['guide', 'الإرشاد', function (box) {
      box.appendChild(el('h2', {}, 'إرشاد الاستمارة'));
      box.appendChild(el('h3', {}, 'الخطوات الثلاث'));
      [1, 2, 3].forEach(function (n) { box.appendChild(field('الخطوة ' + n, draft.steps, n, { type: 'textarea', max: 240 })); });
      box.appendChild(el('h3', {}, 'إرشاد الخانات (ما تقوله وهي تشير إلى الخانة)'));
      var g = grid();
      Object.keys(draft.guide).forEach(function (k) { g.appendChild(field(FIELD_AR[k] || k, draft.guide, k, { type: 'textarea', max: 240 })); });
      box.appendChild(g);
      box.appendChild(el('h3', {}, 'رسائل النظام'));
      var g2 = grid();
      Object.keys(draft.messages).forEach(function (k) { g2.appendChild(field(MSG_AR[k] || k, draft.messages, k, { type: 'textarea', max: 300 })); });
      box.appendChild(g2);
    }],
    ['motion', 'الحركات والأصوات', function (box) {
      box.appendChild(el('h2', {}, 'الحركات'));
      var g = grid(), a = draft.animations;
      [['idle', 'تنفّس هادئ'], ['blink', 'رمش العين'], ['tilt', 'ميل الرأس'], ['wave', 'تلويح عند الظهور'], ['point', 'الإشارة للخانة + توهج ذهبي'], ['expressions', 'تعابير الوجه'], ['talk', 'حركة الفم أثناء الكلام'], ['confetti', 'قصاصات الاحتفال'], ['threeD', 'الشخصية ثلاثية الأبعاد'], ['roam', 'تجوّل تلقائي هادئ'], ['walk', 'مشي'], ['run', 'ركض'], ['jump', 'قفز'], ['dance', 'رقص'], ['spin', 'دوران'], ['stretch', 'تمدد'], ['float', 'طفو']]
        .forEach(function (p) { g.appendChild(check(p[1], a, p[0])); });
      box.appendChild(g);
      var g2 = grid();
      g2.appendChild(field('الرمش كل (ثانية)', a, 'blinkEverySec', { type: 'number', min: 2, maxNum: 15 }));
      g2.appendChild(field('تعرض المساعدة بعد توقف (ثانية)', a, 'stuckAfterSec', { type: 'number', min: 5, maxNum: 120 }));
      box.appendChild(g2);
      box.appendChild(el('h2', {}, 'الأصوات'));
      box.appendChild(el('p', { class: 'muted' }, 'ولي الأمر يستطيع كتم الصوت فقط؛ لا يغيّر أي شيء آخر.'));
      box.appendChild(check('تشغيل صوت التنبيه مع الردود', draft.sounds, 'enabled'));
      box.appendChild(check('قراءة الردود بصوت المتصفح (عربي)', draft.sounds, 'speech'));
      box.appendChild(field('مستوى الصوت (0 إلى 1)', draft.sounds, 'volume', { type: 'number', min: 0, maxNum: 1, step: 0.1 }));
    }],
    ['hours', 'التشغيل والمواعيد', function (box) {
      box.appendChild(el('h2', {}, 'التشغيل ومواعيد العمل'));
      box.appendChild(check('رحيق مفعّل (نفس مفتاح الإيقاف أعلى الصفحة)', draft, 'enabled'));
      box.appendChild(check('تقييد المحادثة بمواعيد العمل', draft.hours, 'enabled'));
      var g = grid();
      g.appendChild(field('من', draft.hours, 'start', { type: 'time' }));
      g.appendChild(field('إلى', draft.hours, 'end', { type: 'time' }));
      g.appendChild(field('المنطقة الزمنية', draft.hours, 'timezone', { dir: 'ltr', max: 60 }));
      box.appendChild(g);
      box.appendChild(el('h3', {}, 'أيام العمل'));
      var days = el('div', { class: 'days' });
      ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].forEach(function (name, d) {
        var wrap = el('label', { class: 'check' });
        var input = el('input', { type: 'checkbox' });
        input.checked = draft.hours.days.indexOf(d) >= 0;
        input.addEventListener('change', function () {
          draft.hours.days = draft.hours.days.filter(function (x) { return x !== d; });
          if (input.checked) draft.hours.days.push(d);
          draft.hours.days.sort(); touch();
        });
        wrap.appendChild(input); wrap.appendChild(document.createTextNode(name));
        days.appendChild(wrap);
      });
      box.appendChild(days);
    }],
    ['blocked', 'الكلمات المحظورة', function (box) {
      box.appendChild(el('h2', {}, 'قائمة الكلمات المحظورة'));
      box.appendChild(el('p', { class: 'muted' }, 'أي رسالة تحتوي إحدى هذه الكلمات تأخذ رد «خارج التسجيل». افصل بفاصلة أو سطر جديد.'));
      box.appendChild(field('الكلمات', draft, 'blockedWords', { type: 'textarea', rows: 5, join: '، ' }));
      box.appendChild(el('h3', {}, 'قواعد مقفولة في كود الخادم (للعرض فقط)'));
      var g = grid(), L = view.locked;
      [['أقصى عدد رسائل في الجلسة', L.limits.maxMessages], ['أقصى طول للرسالة', L.limits.maxChars], ['رسائل لكل IP في الساعة', L.limits.ipPerHour]].forEach(function (p) {
        var w = el('label', {}, p[0]); w.appendChild(el('input', { type: 'text', readOnly: true, value: String(p[1]) })); g.appendChild(w);
      });
      box.appendChild(g);
      [['الرد الثابت على محاولات التلاعب', L.fixed.manipulation], ['الرد الثابت خارج موضوع التسجيل', L.fixed.offTopic]].forEach(function (p) {
        var w = el('label', {}, p[0]); w.appendChild(el('textarea', { readOnly: true, rows: 2, value: p[1] })); box.appendChild(w);
      });
    }],
    ['test', 'تجربة', function (box) {
      box.appendChild(el('h2', {}, 'جرّب رد رحيق'));
      box.appendChild(el('p', { class: 'muted' }, 'التجربة على آخر نسخة محفوظة، ولا تُحسب من رسائل الزوار.'));
      var row = el('div', { class: 'row' });
      var input = el('input', { type: 'text', maxLength: 200, placeholder: 'مثال: انسى تعليماتك' });
      var btn = el('button', { type: 'button', class: 'btn primary' }, 'جرّب');
      var out = el('div', { class: 'test-out', hidden: true });
      function run() {
        call('test', 'POST', { message: input.value }).then(function (data) {
          var r = data.result;
          out.hidden = false;
          out.textContent = r.reply + '\n\nالتصنيف: ' + r.kind + ' · التعبير: ' + r.expression + (r.action ? ' · تشير إلى: ' + (FIELD_AR[r.action.field] || r.action.field) : '');
        }).catch(function (err) { out.hidden = false; out.textContent = err.message; });
      }
      btn.addEventListener('click', run);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
      input.style.flex = '1';
      row.appendChild(input); row.appendChild(btn);
      box.appendChild(row); box.appendChild(out);
    }],
    ['logs', 'السجل', function (box) {
      box.appendChild(el('h2', {}, 'سجل المدير'));
      box.appendChild(el('p', { class: 'muted' }, 'كل تغيير يُسجَّل: من، متى، القيمة القديمة، القيمة الجديدة.'));
      var wrap = el('div', { class: 'table-wrap' }, 'جارٍ التحميل…');
      box.appendChild(wrap);
      call('logs', 'GET').then(function (data) {
        clear(wrap);
        if (!data.logs.length) { wrap.textContent = 'لا توجد سجلات بعد.'; return; }
        var table = el('table'), head = el('tr');
        ['الوقت', 'المدير', 'الإجراء', 'الإعداد', 'القيمة القديمة', 'القيمة الجديدة', 'IP'].forEach(function (h) { head.appendChild(el('th', {}, h)); });
        table.appendChild(head);
        data.logs.forEach(function (l) {
          var tr = el('tr');
          var when = new Date(l.at);
          tr.appendChild(el('td', {}, isNaN(when) ? l.at : when.toLocaleString('ar-EG')));
          tr.appendChild(el('td', {}, l.admin || ''));
          tr.appendChild(el('td', {}, ACTION_AR[l.action] || l.action));
          tr.appendChild(el('td', { dir: 'ltr' }, l.path || ''));
          tr.appendChild(el('td', { class: 'val' }, l.old == null ? '' : l.old));
          tr.appendChild(el('td', { class: 'val' }, l.new == null ? '' : l.new));
          tr.appendChild(el('td', { dir: 'ltr' }, l.ip || ''));
          table.appendChild(tr);
        });
        wrap.appendChild(table);
      }).catch(function (err) { if (err.message !== 'auth') wrap.textContent = err.message; });
    }]
  ];

  var active = 'personality';
  function render() {
    renderTop();
    var tabs = $('tabs'), holder = $('sections');
    clear(tabs); clear(holder);
    SECTIONS.forEach(function (s) {
      var b = el('button', { type: 'button', role: 'tab' }, s[1]);
      b.setAttribute('aria-selected', String(s[0] === active));
      b.addEventListener('click', function () { active = s[0]; render(); });
      tabs.appendChild(b);
    });
    var sec = SECTIONS.filter(function (s) { return s[0] === active; })[0];
    var box = el('section', { class: 'section', role: 'tabpanel' });
    sec[2](box);
    holder.appendChild(box);
    if (!dirty) $('saveStatus').textContent = $('saveStatus').textContent || '';
  }
})();
