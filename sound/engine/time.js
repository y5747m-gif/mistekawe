/**
 * زمن المجلس — ساعة رئيسية وجدول بلا فجوة.
 * هذه الدوال نقية: لا تلمس Web Audio، وتُختبر في Node.
 * العقد: مقطع الحلقة التالي يبدأ عند نهاية السابق تمامًا، بلا صمت ولا قفزة.
 */

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

export function createClock() {
  let originPerf = 0;
  let pausedMedia = 0;
  let running = false;

  function mediaTime(now) {
    if (!running) return pausedMedia;
    return pausedMedia + (now - originPerf) / 1000;
  }

  return {
    mediaTime,
    get running() { return running; },
    play(now) {
      if (running) return;
      originPerf = now;
      running = true;
    },
    pause(now) {
      if (!running) return;
      pausedMedia = mediaTime(now);
      running = false;
    },
    seek(media, now) {
      pausedMedia = media;
      originPerf = now;
    }
  };
}

/** موضع الالتحاق داخل المقطع. في التكرار يلفّ، وخارجَه يُثبَّت قرب النهاية دون تجاوزها. */
export function joinOffset(mediaTime, duration, loop) {
  if (!(duration > 0)) return 0;
  if (!loop) return round6(clamp(mediaTime, 0, Math.max(0, duration - 0.01)));
  let m = mediaTime % duration;
  if (m < 0) m += duration;
  if (m > duration - 0.01) m = 0;
  return round6(m);
}

/**
 * فرق مسموع بين موضع السماعة والساعة.
 * موجب = السماعة متقدمة. عند التكرار يُطوى الفرق حتى لا يُحسب عبور الحد انحرافًا.
 */
export function wrapDelta(heard, master, duration, loop) {
  let d = heard - master;
  if (!loop || !(duration > 0)) return d;
  d = ((d + duration / 2) % duration + duration) % duration - duration / 2;
  return d;
}

/**
 * ما الذي يجب جدولته على خيط الصوت الآن؟
 * إن كان هناك صوت مجدول للمستقبل لا نلمس المسار.
 * الحلقة تُضاف بتلاصق رياضي (when التالي = نهاية السابق).
 * الالتحاق يُستخدم فقط إذا سقط الجدول — وهو لمسار واحد، لا لكل القاعة.
 */
export function planFill({
  scheduledEnd = null,
  ctxNow,
  lookahead = 0.08,
  horizon = 20,
  bufferDuration,
  loop = false,
  mediaNow = 0,
  playing = false
} = {}) {
  if (!playing || !(bufferDuration > 0)) return [];
  if (!loop && mediaNow >= bufferDuration - 0.001 && (scheduledEnd == null || scheduledEnd <= ctxNow + 0.001)) {
    return [];
  }

  const out = [];
  let end = scheduledEnd;
  if (end == null || end < ctxNow + lookahead) {
    const offset = joinOffset(mediaNow + lookahead, bufferDuration, loop);
    const when = round6(ctxNow + lookahead);
    out.push({
      when,
      offset,
      fade: 0.03,
      reason: end == null ? 'join' : 'rejoin',
      playDuration: round6(bufferDuration - offset)
    });
    end = round6(when + (bufferDuration - offset));
  }

  let guard = 0;
  while (loop && end < ctxNow + horizon && guard++ < 32) {
    out.push({
      when: round6(end),
      offset: 0,
      fade: 0,
      reason: 'loop',
      playDuration: round6(bufferDuration)
    });
    end = round6(end + bufferDuration);
  }
  return out;
}

/** تسليم المقطع التالي قبل نهايته، لا بعدها. */
export function shouldHandoff({
  playing = false,
  loopMode = 'one',
  queueLength = 1,
  remaining = 0,
  nextReady = false,
  handoffScheduled = false
} = {}) {
  if (!playing || handoffScheduled || !nextReady) return false;
  if (loopMode === 'one' || loopMode === 'off') return false;
  if (queueLength <= 1) return false;
  return remaining < 12;
}

export function isSeamlessChain(segments, duration) {
  for (let i = 0; i < segments.length - 1; i++) {
    const end = round6(segments[i].when + (duration - segments[i].offset));
    if (end !== segments[i + 1].when) return false;
  }
  return true;
}
