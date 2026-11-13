/* ============================================================
   رحيق RAHEEQ — قصاصات الاحتفال بألوان الماروني والذهبي
   ============================================================ */
(function () {
  'use strict';

  function launch() {
    var canvas = document.getElementById('confettiCanvas');
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = window.innerWidth, h = window.innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // ماروني + ذهبي فقط (مع تدرجاتهما)
    var colors = ['#881234', '#5E0C24', '#A6193F', '#C9A86A', '#E3C98F', '#881234', '#C9A86A'];
    var pieces = [];
    var count = Math.min(150, Math.max(80, Math.round(w / 9)));
    for (var i = 0; i < count; i++) {
      pieces.push({
        x: Math.random() * w,
        y: -20 - Math.random() * h * 0.6,
        w: 6 + Math.random() * 8,
        h: 9 + Math.random() * 12,
        c: colors[Math.floor(Math.random() * colors.length)],
        vy: 2.1 + Math.random() * 3.3,
        vx: -1.5 + Math.random() * 3,
        rot: Math.random() * Math.PI * 2,
        vr: -0.14 + Math.random() * 0.28,
        round: Math.random() > 0.75
      });
    }

    var start = null, duration = 4200;
    function frame(ts) {
      if (!start) start = ts;
      var elapsed = ts - start;
      ctx.clearRect(0, 0, w, h);
      for (var j = 0; j < pieces.length; j++) {
        var p = pieces[j];
        p.y += p.vy;
        p.x += p.vx + Math.sin(elapsed / 320 + p.rot) * 0.7;
        p.rot += p.vr;
        if (p.y > h + 30) { p.y = -20; p.x = Math.random() * w; }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        if (p.round) {
          ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
      }
      if (elapsed < duration) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    }
    requestAnimationFrame(frame);
  }

  window.RaheeqConfetti = { launch: launch };
})();
