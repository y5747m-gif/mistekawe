/* ============================================================
   رحيق RAHEEQ — مشغّل انيميشن البداية
   - يولّد غبارًا ذهبيًا داخل المشهد
   - يرسم خطّ الترند الذهبي فوق قمم الأعمدة البيانية (SVG يُقاس بعد التخطيط)
   - يتيح التخطي بزر «تخطي» أو بمفتاح Escape
   - يُزيل الغطاء نهائيًا بعد اكتمال المشهد (مع مهلة أمان)
   ============================================================ */
(function () {
  'use strict';

  var overlay = document.getElementById('raheeqIntro');
  if (!overlay) return;

  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (err) { reduceMotion = false; }

  /* قفل التمرير أثناء عرض المشهد */
  document.body.classList.add('raheeq-intro-lock');

  /* ---------- غبار ذهبي عائم ---------- */
  try {
    var dust = overlay.querySelector('.intro-dust');
    if (dust && !reduceMotion) {
      var COUNT = 26;
      var html = '';
      for (var i = 0; i < COUNT; i++) {
        var size = (1.4 + Math.random() * 3.2).toFixed(2);
        var x = (Math.random() * 100).toFixed(2);
        var dx = ((Math.random() - 0.5) * 22).toFixed(2);
        var dur = (6.5 + Math.random() * 6).toFixed(2);
        var delay = (-Math.random() * 9).toFixed(2);
        var op = (0.45 + Math.random() * 0.5).toFixed(2);
        html += '<i style="--s:' + size + 'px;--x:' + x + '%;--dx:' + dx + 'vw;--t:' + dur + 's;--d:' + delay + 's;--o:' + op + '"></i>';
      }
      dust.innerHTML = html;
    }
  } catch (err) { /* الغبار تفصيلة تجميلية — لا تُفشل الانيميشن */ }

  /* ---------- خط الترند فوق قمم الأعمدة ---------- */
  function layoutTrend() {
    var chart = overlay.querySelector('.intro-chart');
    var svg = overlay.querySelector('.intro-trend');
    if (!chart || !svg) return;
    var bars = chart.querySelectorAll('.intro-bar');
    if (!bars.length) return;

    var width = chart.clientWidth;
    var height = chart.clientHeight;
    if (!width || !height) return;

    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

    var pts = [];
    for (var i = 0; i < bars.length; i++) {
      var b = bars[i];
      var cx = b.offsetLeft + b.offsetWidth / 2;
      var cy = height - b.offsetHeight;
      pts.push([cx, cy]);
    }
    var toStr = function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); };

    var line = svg.querySelector('.intro-trend__line');
    if (line) line.setAttribute('points', pts.map(toStr).join(' '));

    var area = svg.querySelector('.intro-trend__area');
    if (area) {
      var last = pts[pts.length - 1];
      var first = pts[0];
      area.setAttribute('points', pts.map(toStr).join(' ') + ' ' + last[0].toFixed(1) + ',' + height + ' ' + first[0].toFixed(1) + ',' + height);
    }

    var dots = svg.querySelectorAll('.intro-trend__dot');
    for (var d = 0; d < dots.length && d < pts.length; d++) {
      dots[d].setAttribute('cx', pts[d][0].toFixed(1));
      dots[d].setAttribute('cy', pts[d][1].toFixed(1));
    }
  }

  layoutTrend();
  window.addEventListener('resize', layoutTrend, { passive: true });

  /* ---------- إنهاء العرض وإزالته ---------- */
  var finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    overlay.classList.add('is-leaving');
    document.body.classList.remove('raheeq-intro-lock');
    window.removeEventListener('resize', layoutTrend);
    window.setTimeout(function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 750);
  }

  var skipBtn = overlay.querySelector('.intro-skip');
  if (skipBtn) skipBtn.addEventListener('click', finish);

  function onKey(event) {
    if (event.key === 'Escape' || event.key === 'Esc') {
      finish();
      document.removeEventListener('keydown', onKey);
    }
  }
  document.addEventListener('keydown', onKey);

  /* الاختفاء التلقائي بعد اكتمال المشهد (~4.6s) أو أسرع لو فُضّل تقليل الحركة */
  window.setTimeout(finish, reduceMotion ? 420 : 4650);

  /* مهلة أمان قصوى مهما حدث */
  window.setTimeout(finish, 7000);
})();
