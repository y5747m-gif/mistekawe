/* ============================================================
   رحيق RAHEEQ — مشغّل انيميشن البداية السينمائي والمؤثرات الصوتية
   - يولّد غبارًا ذهبيًا عائمًا وشرارات ضوئية لحظة التحام الشعار
   - يرسم خطّ الترند الذهبي فوق قمم الأعمدة البيانية بدقة عالية
   - يشغّل شريطًا صوتيًا سينمائيًا متزامنًا مع كل مرحلة من المشهد
   - يوفّر زر تشغيل/كتم صوت حي بموجات ذهبية + تخطي سريع + إعادة العرض
   ============================================================ */
(function (global) {
  'use strict';

  var initialOverlay = document.getElementById('raheeqIntro');
  if (!initialOverlay) return;

  /* نسخة نظيفة من قالب المشهد لإتاحة إعادة تشغيل العرض في أي وقت */
  var templateHTML = initialOverlay.outerHTML;
  var activeFinish = null;

  function T(str) {
    return global.RaheeqI18n && global.RaheeqI18n.t ? global.RaheeqI18n.t(str) : str;
  }

  function getSound() {
    return global.RaheeqSound || null;
  }

  function runIntro(overlay, isReplay) {
    if (!overlay) return;

    var reduceMotion = false;
    try {
      reduceMotion = !isReplay && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (err) { reduceMotion = false; }

    var startTime = Date.now();
    var finished = false;
    var sfxTimers = [];
    var autoFinishTimer = null;
    var safetyTimer = null;
    var introSoundPlayed = false;
    var needsUserTap = false;

    /* قفل التمرير أثناء عرض المشهد */
    document.body.classList.remove('raheeq-revealed');
    document.body.classList.add('raheeq-intro-lock');

    /* ---------- زر حالة الصوت داخل العرض ---------- */
    var soundBtn = overlay.querySelector('.intro-sound-btn');
    var soundLabel = soundBtn ? soundBtn.querySelector('.intro-sound-label') : null;

    function updateSoundUI() {
      if (!soundBtn) return;
      var S = getSound();
      var on = S ? S.isOn() : false;
      var playing = on && introSoundPlayed && !needsUserTap;
      soundBtn.classList.toggle('is-muted', !on);
      soundBtn.classList.toggle('needs-tap', on && needsUserTap);
      soundBtn.classList.toggle('is-playing', playing);
      soundBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      var aria = !on ? T('تشغيل صوت العرض') : (playing ? T('كتم صوت العرض') : T('صوت العرض'));
      soundBtn.setAttribute('aria-label', aria);
      soundBtn.title = aria;
      if (soundLabel) {
        if (!on) soundLabel.textContent = T('تشغيل الصوت');
        else if (needsUserTap) soundLabel.textContent = T('صوت العرض');
        else soundLabel.textContent = T('الصوت');
      }
    }

    /* ---------- مؤثرات صوتية متزامنة مع حركة الانيميشن ---------- */
    function clearSfxTimers() {
      sfxTimers.forEach(function (id) { global.clearTimeout(id); });
      sfxTimers = [];
    }

    function playSfx(name, vol, extra) {
      var S = getSound();
      if (!S || finished || !S.isOn()) return;
      var opts = Object.assign({ intro: true }, extra || {});
      if (vol != null) opts.vol = vol;
      try { S.play(name, opts); } catch (e) {}
    }

    function at(ms, fnOrName, vol, extra) {
      var id = global.setTimeout(function () {
        if (finished) return;
        if (typeof fnOrName === 'function') fnOrName();
        else playSfx(fnOrName, vol, extra);
      }, Math.max(0, ms));
      sfxTimers.push(id);
    }

    /* جدولة بقية الطبقات الصوتية حسب موضع المشهد الحالي */
    function scheduleTimelineCues(elapsed) {
      var cues = reduceMotion ? [
        { t: 180, name: 'chime', vol: 0.45 }
      ] : [
        { t: 360,  name: 'bar',     vol: 0.20, extra: { step: 0 } },
        { t: 500,  name: 'bar',     vol: 0.22, extra: { step: 1 } },
        { t: 640,  name: 'bar',     vol: 0.24, extra: { step: 2 } },
        { t: 760,  name: 'bar',     vol: 0.28, extra: { step: 3 } },
        { t: 1080, name: 'shard',   vol: 0.26 },
        { t: 2540, name: 'chime',   vol: 0.56 },
        { t: 2900, name: 'sparkle', vol: 0.28 },
        { t: 4540, name: 'curtain', vol: 0.24 }
      ];
      cues.forEach(function (c) {
        var remain = c.t - elapsed;
        if (remain >= -40) {
          at(Math.max(0, remain), c.name, c.vol, c.extra);
        }
      });
    }

    /* جدول المؤثرات الصوتية عند انطلاق المشهد:
       whoosh ملكي عند البدء، نغمات صعود الأعمدة، بريق الشظايا، ورنين القمة */
    function scheduleSfx() {
      var S = getSound();
      if (!S) {
        /* لو لم تُحمّل وحدة الصوت بعد ننتظر لحظة قصيرة */
        at(50, scheduleSfx);
        return;
      }
      if (!S.isOn()) {
        updateSoundUI();
        return;
      }
      at(reduceMotion ? 40 : 140, function () {
        var sNow = getSound();
        if (!sNow || finished || !sNow.isOn()) return;
        if (typeof sNow.playIntro === 'function') {
          sNow.playIntro('intro', { vol: 0.58 }).then(function (played) {
            if (finished) return;
            if (played) {
              introSoundPlayed = true;
              needsUserTap = false;
              updateSoundUI();
              scheduleTimelineCues(Date.now() - startTime);
            } else {
              needsUserTap = true;
              updateSoundUI();
            }
          });
        } else {
          playSfx('intro', 0.55);
          introSoundPlayed = true;
          scheduleTimelineCues(Date.now() - startTime);
        }
      });
    }

    /* المتصفحات التي تمنع الصوت قبل أول تفاعل: عند أول لمسة/ضغطة والعرض ظاهر
       نفتح الصوت فورًا ونشغّل المؤثرات متزامنة مع بقية المشهد */
    function catchUpSfx(ev) {
      if (introSoundPlayed || finished) return;
      if (ev && ev.target && ev.target.closest && ev.target.closest('.intro-skip')) return;
      var S = getSound();
      if (!S || !S.isOn()) return;
      introSoundPlayed = true;
      needsUserTap = false;
      try { S.unlock(); } catch (e) {}
      clearSfxTimers();
      var elapsed = Date.now() - startTime;
      playSfx('intro', 0.54);
      if (elapsed < 2350) {
        scheduleTimelineCues(elapsed);
      } else {
        /* لو ضغط المستخدم متأخرًا نسمعه رنين القمة الفاخر قبل انتهاء العرض */
        at(420, 'chime', 0.54);
        at(760, 'sparkle', 0.26);
        if (autoFinishTimer) {
          global.clearTimeout(autoFinishTimer);
          autoFinishTimer = global.setTimeout(function () { finish(false); }, 1850);
        }
      }
      updateSoundUI();
    }

    var gestureEvents = ['pointerdown', 'keydown', 'touchstart'];
    function removeGestureListeners() {
      gestureEvents.forEach(function (ev) {
        document.removeEventListener(ev, catchUpSfx, true);
      });
    }
    gestureEvents.forEach(function (ev) {
      document.addEventListener(ev, catchUpSfx, { passive: true, capture: true });
    });

    if (soundBtn) {
      soundBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var S = getSound();
        if (!S) return;
        try { S.unlock(); } catch (err) {}
        if (!S.isOn()) {
          if (S.setEnabled) S.setEnabled(true);
          introSoundPlayed = false;
          catchUpSfx(null);
          return;
        }
        if (needsUserTap || !introSoundPlayed) {
          introSoundPlayed = false;
          catchUpSfx(null);
          return;
        }
        /* الصوت يعمل بالفعل ← كتم فوري */
        clearSfxTimers();
        if (S.setEnabled) S.setEnabled(false);
        updateSoundUI();
      });
    }

    /* زر الصوت في الهيدر يغيّر الحالة ← نُحدّث زر صوت العرض فورًا */
    document.addEventListener('raheeq:soundchange', function () {
      if (finished) return;
      var S2 = getSound();
      if (S2 && S2.isOn() && !introSoundPlayed) {
        introSoundPlayed = false;
        catchUpSfx(null);
      }
      updateSoundUI();
    });

    if (isReplay) {
      var SR = getSound();
      if (SR) { try { SR.unlock(); } catch (e) {} }
    }
    updateSoundUI();
    scheduleSfx();

    /* ---------- غبار ذهبي عائم + شرارات لحظة التجمّع ---------- */
    try {
      var dust = overlay.querySelector('.intro-dust');
      if (dust && !reduceMotion) {
        var COUNT = 34;
        var html = '';
        for (var i = 0; i < COUNT; i++) {
          var size = (1.5 + Math.random() * 3.4).toFixed(2);
          var x = (Math.random() * 100).toFixed(2);
          var dx = ((Math.random() - 0.5) * 24).toFixed(2);
          var dur = (6 + Math.random() * 6).toFixed(2);
          var delay = (-Math.random() * 9).toFixed(2);
          var op = (0.45 + Math.random() * 0.52).toFixed(2);
          html += '<i style="--s:' + size + 'px;--x:' + x + '%;--dx:' + dx + 'vw;--t:' + dur + 's;--d:' + delay + 's;--o:' + op + '"></i>';
        }
        dust.innerHTML = html;
      }

      var stage = overlay.querySelector('.intro-mark-stage');
      if (stage && !reduceMotion && !stage.querySelector('.intro-sparks')) {
        var sparks = document.createElement('div');
        sparks.className = 'intro-sparks';
        sparks.setAttribute('aria-hidden', 'true');
        var spHtml = '';
        var SPARK_N = 16;
        for (var s = 0; s < SPARK_N; s++) {
          var ang = (Math.PI * 2 * s / SPARK_N) + (Math.random() - 0.5) * 0.22;
          var dist = 78 + Math.random() * 68;
          var bx = (Math.cos(ang) * dist).toFixed(1) + 'px';
          var by = (Math.sin(ang) * dist).toFixed(1) + 'px';
          var sw = (2.5 + Math.random() * 3).toFixed(1) + 'px';
          var spd = (2.55 + Math.random() * 0.12).toFixed(2) + 's';
          spHtml += '<b style="--bx:' + bx + ';--by:' + by + ';--sw:' + sw + ';--spd:' + spd + '"></b>';
        }
        sparks.innerHTML = spHtml;
        stage.appendChild(sparks);
      }
    } catch (err) { /* تفصيلة تجميلية — لا تُفشل الانيميشن */ }

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
    if (global.requestAnimationFrame) {
      global.requestAnimationFrame(layoutTrend);
    }
    global.addEventListener('resize', layoutTrend, { passive: true });

    /* ---------- إنهاء العرض وإزالته بانسيابية ---------- */
    function finish(skipped) {
      if (finished) return;
      finished = true;
      activeFinish = null;
      clearSfxTimers();
      if (autoFinishTimer) global.clearTimeout(autoFinishTimer);
      if (safetyTimer) global.clearTimeout(safetyTimer);
      removeGestureListeners();
      document.removeEventListener('keydown', onKey);
      global.removeEventListener('resize', layoutTrend);

      var S = getSound();
      if (skipped && S) {
        if (S.stopIntro) S.stopIntro();
        playSfx('click', 0.25);
      }

      overlay.classList.add('is-leaving');
      document.body.classList.remove('raheeq-intro-lock');
      document.body.classList.add('raheeq-revealed');
      try {
        if (typeof CustomEvent === 'function') {
          document.dispatchEvent(new CustomEvent('raheeq:intro-done'));
        }
      } catch (e) {}

      global.setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 720);
    }

    activeFinish = finish;

    var skipBtn = overlay.querySelector('.intro-skip');
    if (skipBtn) {
      skipBtn.addEventListener('click', function () { finish(true); });
    }

    function onKey(event) {
      if (event.key === 'Escape' || event.key === 'Esc') {
        finish(true);
      }
    }
    document.addEventListener('keydown', onKey);

    /* الاختفاء التلقائي بعد اكتمال المشهد (~4.85s) أو أسرع لو فُضّل تقليل الحركة */
    autoFinishTimer = global.setTimeout(function () { finish(false); }, reduceMotion ? 420 : 4850);

    /* مهلة أمان قصوى مهما حدث */
    safetyTimer = global.setTimeout(function () { finish(false); }, 7500);
  }

  /* إعادة تشغيل العرض السينمائي بالصوت الكامل في أي وقت */
  function replay() {
    if (activeFinish) activeFinish(true);
    var existing = document.getElementById('raheeqIntro');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    var holder = document.createElement('div');
    holder.innerHTML = templateHTML;
    var fresh = holder.firstElementChild;
    if (!fresh) return;
    document.body.insertBefore(fresh, document.body.firstChild);
    if (global.RaheeqI18n && global.RaheeqI18n.isEnglish && global.RaheeqI18n.isEnglish() && global.RaheeqI18n.apply) {
      global.RaheeqI18n.apply('en');
    }
    runIntro(fresh, true);
  }

  global.RaheeqIntro = {
    replay: replay,
    finish: function () { if (activeFinish) activeFinish(true); }
  };

  runIntro(initialOverlay, false);
})(typeof window !== 'undefined' ? window : this);
