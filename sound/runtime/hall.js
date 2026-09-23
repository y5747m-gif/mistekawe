/**
 * قاعة الصوت.
 * لكل مخرج AudioContext مستقل يُربط بـ setSinkId قبل أن يبدأ،
 * ثم تُجدول المقاطع على خيط الصوت مسبقًا. إصلاح سماعة لا يوقف الأخريات.
 */

import { createClock, joinOffset, planFill, wrapDelta } from '../engine/time.js';
import { nextAutoTrim } from '../engine/drift.js';
import { normalizeDelays, effectiveGain, profileForLabel } from '../engine/mix.js';
import { makeClick } from '../engine/correlate.js';

const LOOKAHEAD = 0.08;
const HORIZON = 20;

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function materialize(ctx, pcm) {
  const buffer = ctx.createBuffer(2, pcm.left.length, pcm.sampleRate);
  buffer.copyToChannel(pcm.left, 0);
  buffer.copyToChannel(pcm.right, 1);
  return buffer;
}

export function createHall() {
  const sinks = new Map();
  const clock = createClock();
  const listeners = new Map();
  let pcm = null;
  let looping = true;
  let loopMode = 'one';
  let playing = false;
  let master = 0.85;
  let pump = null;
  let gen = 1;
  let handoff = null;

  function emit(type, detail) {
    for (const fn of listeners.get(type) || []) fn(detail);
  }

  function on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
    return () => {
      const arr = listeners.get(type) || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  function futureEnd(sink) {
    let end = null;
    const now = sink.ctx.currentTime;
    for (const seg of sink.segments) {
      if (seg.stopping || seg.gen !== gen) continue;
      const e = seg.when + seg.playDuration;
      if (e < now - 0.05) continue;
      if (end == null || e > end) end = e;
    }
    return end;
  }

  function heardMedia(sink, ctxTime, delay) {
    const t = ctxTime - delay;
    for (let i = sink.segments.length - 1; i >= 0; i--) {
      const seg = sink.segments[i];
      if (seg.stopping || seg.gen !== gen) continue;
      const end = seg.when + seg.playDuration;
      if (t >= seg.when - 0.03 && t < end + 0.02) {
        return seg.mediaOffset + (t - seg.when);
      }
    }
    return null;
  }

  function fadeOut(sink, when, fade) {
    const t0 = Math.max(when, sink.ctx.currentTime);
    for (const seg of sink.segments) {
      if (seg.stopping) continue;
      seg.stopping = true;
      try {
        const p = seg.gain.gain;
        p.cancelScheduledValues(t0);
        p.setValueAtTime(Math.max(0.0001, p.value), t0);
        p.linearRampToValueAtTime(0.0001, t0 + fade);
        seg.source.stop(t0 + fade + 0.03);
      } catch { /* المصدر انتهى وحده */ }
    }
  }

  function startSegment(sink, spec) {
    const buffer = spec.buffer || sink.buffer;
    if (!buffer) return false;
    let when = spec.when;
    if (when < sink.ctx.currentTime + 0.004) {
      if (spec.reason === 'loop' || spec.reason === 'handoff') return false;
      when = sink.ctx.currentTime + LOOKAHEAD;
    }
    const offset = Math.min(Math.max(spec.offset || 0, 0), Math.max(0, buffer.duration - 0.001));
    const maxDur = Math.max(0.001, buffer.duration - offset);
    const playDuration = Math.min(spec.playDuration || maxDur, maxDur);
    const src = sink.ctx.createBufferSource();
    src.buffer = buffer;
    const g = sink.ctx.createGain();
    const fade = spec.fade || 0;
    if (fade > 0) {
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(1, when + fade);
    } else {
      g.gain.setValueAtTime(1, when);
    }
    src.connect(g);
    g.connect(sink.input);
    try {
      // لا نمرّر المدة إن كان التشغيل حتى نهاية المقطع: بعض المتصفحات ترمي خطأ عند التساوي،
      // والفجوة تُحسب من playDuration المحفوظ للجدولة المتلاصقة.
      if (offset + playDuration < buffer.duration - 0.0005) src.start(when, offset, playDuration);
      else src.start(when, offset);
    } catch {
      try { src.disconnect(); g.disconnect(); } catch { /* لا مسار بعد */ }
      return false;
    }
    const segmentGen = spec.reason === 'handoff' ? gen + 1 : gen;
    sink.segments.push({
      source: src,
      gain: g,
      when,
      offset,
      playDuration,
      mediaOffset: spec.mediaOffset ?? offset,
      gen: segmentGen,
      stopping: false
    });
    src.onended = () => {
      const seg = sink.segments.find(item => item.source === src);
      if (seg) seg.stopping = true;
    };
    return true;
  }

  function gc(sink) {
    const now = sink.ctx.currentTime;
    sink.segments = sink.segments.filter(seg => {
      if (seg.when + seg.playDuration > now - 0.15) return true;
      try { seg.source.disconnect(); seg.gain.disconnect(); } catch { /* سبق الفصل */ }
      return false;
    });
  }

  function anySolo() {
    for (const s of sinks.values()) if (s.solo) return true;
    return false;
  }

  function applyGains() {
    const solo = anySolo();
    for (const s of sinks.values()) {
      const value = effectiveGain({
        userGain: s.userGain,
        muted: s.muted,
        solo: s.solo,
        anySolo: solo,
        master
      });
      try { s.gain.gain.setTargetAtTime(Math.max(0.0001, value), s.ctx.currentTime, 0.03); } catch { /* سياق مغلق */ }
      if (value === 0) {
        try { s.gain.gain.setTargetAtTime(0.0001, s.ctx.currentTime, 0.02); } catch { /* ignore */ }
      }
    }
  }

  function applyDelays() {
    const plan = normalizeDelays([...sinks.values()].map(s => ({
      id: s.id,
      userTrim: s.userTrim,
      autoTrim: s.autoTrim
    })));
    for (const item of plan) {
      const s = sinks.get(item.id);
      if (!s) continue;
      try { s.trim.delayTime.setTargetAtTime(item.delay, s.ctx.currentTime, 0.08); } catch { /* ignore */ }
    }
  }

  function applyProfile(sink, profile) {
    const now = sink.ctx.currentTime;
    sink.low.gain.setTargetAtTime(profile.low, now, 0.05);
    sink.mid.gain.setTargetAtTime(profile.mid, now, 0.05);
    sink.high.gain.setTargetAtTime(profile.high, now, 0.05);
    sink.profile = profile.name;
  }

  function rejoinSink(sink, fade = 0.04) {
    if (!pcm || !playing || !sink.bound) return false;
    const now = nowMs();
    if (now < (sink.rejoinLock || 0)) return false;
    sink.rejoinLock = now + 800;
    sink.autoTrim = 0;
    sink.driftHoldUntil = now + 550;
    const when = sink.ctx.currentTime + LOOKAHEAD;
    fadeOut(sink, sink.ctx.currentTime, fade);
    sink.buffer = materialize(sink.ctx, pcm);
    const offset = joinOffset(clock.mediaTime(now) + LOOKAHEAD, pcm.duration, looping);
    return startSegment(sink, { when, offset, fade, reason: 'rejoin' });
  }

  function fillSink(sink) {
    if (!pcm || !playing || !sink.bound) return;
    if (!sink.buffer) sink.buffer = materialize(sink.ctx, pcm);
    const planned = planFill({
      scheduledEnd: futureEnd(sink),
      ctxNow: sink.ctx.currentTime,
      lookahead: LOOKAHEAD,
      horizon: HORIZON,
      bufferDuration: pcm.duration,
      loop: looping && !handoff,
      mediaNow: clock.mediaTime(),
      playing
    });
    for (const spec of planned) {
      if (spec.reason === 'rejoin') rejoinSink(sink, spec.fade);
      else {
        const ok = startSegment(sink, spec);
        if (!ok && spec.reason === 'loop') rejoinSink(sink, 0.03);
      }
    }
  }

  function pumpFn() {
    if (!playing) return;
    commitHandoff();
    const media = pcm ? clock.mediaTime() : 0;
    if (pcm && !looping && !handoff && media >= pcm.duration + 0.08) {
      playing = false;
      clock.pause(nowMs());
      clock.seek(pcm.duration, nowMs());
      emit('ended');
      emit('transport');
      return;
    }
    for (const s of sinks.values()) {
      if (!s.bound) continue;
      if (s.ctx.state === 'suspended' || s.ctx.state === 'interrupted') {
        s.ctx.resume().catch(() => {});
      }
      fillSink(s);
      gc(s);
    }
  }

  function startPump() {
    if (pump) return;
    pump = setInterval(pumpFn, 120);
  }

  function commitHandoff() {
    if (!handoff) return false;
    const ref = sinks.get(handoff.refId);
    if (!ref) {
      handoff = null;
      return false;
    }
    if (ref.ctx.currentTime < handoff.refEnd - 0.012) return false;
    const into = Math.max(0, ref.ctx.currentTime - handoff.refEnd);
    pcm = handoff.nextPcm;
    gen += 1;
    for (const s of sinks.values()) {
      if (s.nextBuffer) s.buffer = s.nextBuffer;
      s.nextBuffer = null;
      s.driftHoldUntil = nowMs() + 400;
      gc(s);
    }
    clock.seek(into, nowMs());
    const committed = handoff;
    handoff = null;
    emit('handoff', { id: committed.nextPcm.id, into });
    return true;
  }

  async function addSink({ id, deviceId = '', label = 'مخرج', linkId = null, userGain = 1, userTrim = 0 }) {
    if (sinks.has(id)) return sinks.get(id);
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) {
      const err = new Error('NO_AUDIO');
      err.code = 'NO_AUDIO';
      throw err;
    }
    let ctx;
    try {
      ctx = deviceId ? new Ctx({ latencyHint: 'playback', sinkId: deviceId }) : new Ctx({ latencyHint: 'playback' });
    } catch {
      ctx = new Ctx({ latencyHint: 'playback' });
    }

    let bound = !deviceId;
    let bindError = null;
    if (deviceId) {
      const already = ctx.sinkId === deviceId;
      if (already) bound = true;
      else if (ctx.setSinkId) {
        try {
          await ctx.setSinkId(deviceId);
          bound = true;
        } catch (err) {
          bindError = err?.message || 'تعذّر توجيه هذا المخرج';
          bound = false;
        }
      } else {
        bindError = 'المتصفح لا يوجّه الصوت إلى مخرج محدّد';
        bound = false;
      }
    }

    const input = ctx.createGain();
    const trim = ctx.createDelay(2);
    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf';
    low.frequency.value = 140;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 1100;
    mid.Q.value = 0.8;
    const high = ctx.createBiquadFilter();
    high.type = 'highshelf';
    high.frequency.value = 5200;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    const tap = ctx.createGain();
    tap.gain.value = 1;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.78;
    input.connect(trim);
    trim.connect(low);
    low.connect(mid);
    mid.connect(high);
    high.connect(gain);
    gain.connect(tap);
    tap.connect(analyser);
    analyser.connect(ctx.destination);

    const sink = {
      id,
      deviceId: deviceId || '',
      label,
      linkId,
      ctx,
      input,
      trim,
      low,
      mid,
      high,
      gain,
      tap,
      analyser,
      levelBuf: new Uint8Array(analyser.fftSize),
      segments: [],
      buffer: null,
      nextBuffer: null,
      userGain,
      userTrim,
      autoTrim: 0,
      muted: false,
      solo: false,
      bound,
      bindError,
      present: true,
      driftHoldUntil: 0,
      rejoinLock: 0,
      profile: 'محايد'
    };
    if (pcm) sink.buffer = materialize(ctx, pcm);
    sinks.set(id, sink);
    applyProfile(sink, profileForLabel(label));
    applyGains();
    applyDelays();
    if (playing && bound) {
      try { await ctx.resume(); } catch { /* يُستأنف من الحارس */ }
      fillSink(sink);
    }
    emit('sinks');
    return sink;
  }

  function removeSink(id) {
    const sink = sinks.get(id);
    if (!sink) return;
    fadeOut(sink, sink.ctx.currentTime, 0.04);
    sinks.delete(id);
    setTimeout(() => { try { sink.ctx.close(); } catch { /* مغلق */ } }, 140);
    emit('sinks');
  }

  function setTrack(next, { fade = 0.045 } = {}) {
    if (!next) return;
    const same = pcm && pcm.id === next.id;
    pcm = next;
    handoff = null;
    gen += 1;
    clock.seek(0, nowMs());
    for (const s of sinks.values()) {
      s.buffer = materialize(s.ctx, pcm);
      s.nextBuffer = null;
      if (playing && s.bound && !same) {
        fadeOut(s, s.ctx.currentTime, fade);
        s.driftHoldUntil = nowMs() + 400;
        const when = s.ctx.currentTime + LOOKAHEAD;
        startSegment(s, { when, offset: 0, fade, reason: 'join' });
      }
    }
    if (playing) startPump();
    emit('track');
  }

  async function play() {
    if (!pcm) return false;
    playing = true;
    if (!clock.running) clock.play(nowMs());
    const resumes = [];
    for (const s of sinks.values()) {
      if (!s.bound) continue;
      resumes.push(s.ctx.resume().catch(() => {}));
      fillSink(s);
    }
    startPump();
    emit('transport');
    await Promise.all(resumes);
    return true;
  }

  function pause() {
    if (!playing && !clock.running) return;
    clock.pause(nowMs());
    playing = false;
    if (pump) {
      clearInterval(pump);
      pump = null;
    }
    for (const s of sinks.values()) {
      fadeOut(s, s.ctx.currentTime, 0.03);
      s.segments = [];
    }
    emit('transport');
  }

  function seek(media) {
    if (!pcm) return;
    const target = joinOffset(media, pcm.duration, false);
    clock.seek(Math.min(target, Math.max(0, pcm.duration - 0.05)), nowMs());
    if (!playing) {
      emit('transport');
      return;
    }
    for (const s of sinks.values()) {
      if (!s.bound) continue;
      s.rejoinLock = 0;
      rejoinSink(s, 0.035);
    }
    emit('transport');
  }

  function scheduleHandoff(nextPcm) {
    if (!pcm || !nextPcm || handoff || !playing) return false;
    let refId = null;
    let refEnd = null;
    let scheduled = 0;
    for (const s of sinks.values()) {
      if (!s.bound) continue;
      const end = futureEnd(s);
      if (end == null || end < s.ctx.currentTime + 0.02) continue;
      const buf = materialize(s.ctx, nextPcm);
      s.nextBuffer = buf;
      const ok = startSegment(s, {
        when: end,
        offset: 0,
        fade: 0,
        reason: 'handoff',
        buffer: buf,
        playDuration: nextPcm.duration,
        mediaOffset: 0
      });
      if (ok) {
        scheduled += 1;
        if (refId == null) {
          refId = s.id;
          refEnd = end;
        }
      }
    }
    if (!scheduled || refId == null) return false;
    handoff = { refId, refEnd, nextPcm };
    emit('handoff-armed');
    return true;
  }

  function rewindMaster(by) {
    if (!pcm) return;
    let next = clock.mediaTime() + by;
    if (looping) next = joinOffset(next, pcm.duration, true);
    else next = Math.max(0, next);
    clock.seek(next, nowMs());
    const until = nowMs() + 700;
    for (const s of sinks.values()) s.driftHoldUntil = until;
  }

  function nudge(id, delta) {
    const s = sinks.get(id);
    if (!s) return;
    s.autoTrim = nextAutoTrim(s.autoTrim, delta);
    applyDelays();
  }

  function readLevel(s) {
    try {
      s.analyser.getByteTimeDomainData(s.levelBuf);
    } catch {
      return 0;
    }
    let sum = 0;
    const buf = s.levelBuf;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / buf.length);
  }

  function agentView() {
    const now = nowMs();
    const media = clock.mediaTime(now);
    const dur = pcm?.duration || 0;
    const list = [];
    for (const s of sinks.values()) {
      let drift = null;
      if (playing && s.bound && now >= s.driftHoldUntil) {
        const heard = heardMedia(s, s.ctx.currentTime, s.trim.delayTime.value);
        if (heard != null) {
          const masterPos = looping && dur > 0 ? media % dur : media;
          drift = wrapDelta(heard, masterPos, dur, looping);
        }
      } else if (playing && now < s.driftHoldUntil) {
        drift = 0;
      }
      const end = s.bound ? futureEnd(s) : null;
      list.push({
        id: s.id,
        label: s.label,
        deviceId: s.deviceId,
        linkId: s.linkId,
        state: s.ctx.state,
        bound: s.bound,
        bindError: s.bindError,
        present: s.present,
        drift,
        scheduledAhead: end == null ? 0 : end - s.ctx.currentTime,
        userGain: s.userGain,
        effectiveGain: s.gain.gain.value,
        userTrim: s.userTrim,
        autoTrim: s.autoTrim,
        muted: s.muted,
        solo: s.solo,
        running: s.ctx.state === 'running',
        profile: s.profile,
        level: readLevel(s)
      });
    }
    const position = looping && dur ? media % dur : media;
    return {
      transport: {
        playing,
        mediaTime: position,
        absolute: media,
        duration: dur,
        remaining: dur ? Math.max(0, dur - position) : 0,
        looping,
        loopMode,
        master,
        handoffScheduled: !!handoff,
        trackId: pcm?.id || null
      },
      sinks: list
    };
  }

  function syncPing() {
    for (const s of sinks.values()) {
      if (!s.bound) continue;
      const rate = s.ctx.sampleRate;
      const data = makeClick(rate, 0.045);
      const buffer = s.ctx.createBuffer(1, data.length, rate);
      buffer.copyToChannel(data, 0);
      const src = s.ctx.createBufferSource();
      src.buffer = buffer;
      const g = s.ctx.createGain();
      g.gain.value = 0.7;
      src.connect(g);
      g.connect(s.input);
      src.start(s.ctx.currentTime + 0.12);
    }
  }

  function duck(exceptId, amount) {
    for (const s of sinks.values()) {
      const keep = s.id === exceptId ? 1 : amount;
      const base = effectiveGain({
        userGain: s.userGain,
        muted: s.muted,
        solo: s.solo,
        anySolo: anySolo(),
        master
      });
      try { s.gain.gain.setTargetAtTime(Math.max(0.0001, base * keep), s.ctx.currentTime, 0.03); } catch { /* ignore */ }
    }
  }

  return {
    on,
    addSink,
    removeSink,
    setTrack,
    play,
    pause,
    seek,
    scheduleHandoff,
    rewindMaster,
    nudge,
    rejoin: (id) => {
      const s = sinks.get(id);
      if (s) rejoinSink(s, 0.04);
    },
    fill: (id) => {
      const s = sinks.get(id);
      if (s) fillSink(s);
    },
    resumeSink: async (id) => {
      const s = sinks.get(id);
      if (!s) return;
      try { await s.ctx.resume(); } catch { /* الحارس يعيد */ }
    },
    resumeAll: () => {
      for (const s of sinks.values()) s.ctx.resume().catch(() => {});
    },
    setLooping(value) { looping = !!value; },
    setLoopMode(mode) { loopMode = mode; },
    setMaster(value) {
      master = value;
      applyGains();
    },
    setUserGain(id, value) {
      const s = sinks.get(id);
      if (!s) return;
      s.userGain = value;
      applyGains();
    },
    setMuted(id, value) {
      const s = sinks.get(id);
      if (!s) return;
      s.muted = !!value;
      if (value) s.solo = false;
      applyGains();
    },
    setSolo(id, value) {
      const s = sinks.get(id);
      if (!s) return;
      s.solo = !!value;
      applyGains();
    },
    setUserTrim(id, seconds) {
      const s = sinks.get(id);
      if (!s) return;
      s.userTrim = Math.max(-0.35, Math.min(0.45, seconds));
      applyDelays();
    },
    setNeutral(id) {
      const s = sinks.get(id);
      if (!s) return;
      applyProfile(s, { low: 0, mid: 0, high: 0, name: 'محايد' });
    },
    setPresent(id, present) {
      const s = sinks.get(id);
      if (s) s.present = present;
    },
    linkSink(id, linkId) {
      const s = sinks.get(id);
      if (s) s.linkId = linkId;
    },
    syncPing,
    pulse(id) {
      const s = sinks.get(id);
      if (!s?.bound) return null;
      const rate = s.ctx.sampleRate;
      const data = makeClick(rate, 0.04);
      const buffer = s.ctx.createBuffer(1, data.length, rate);
      buffer.copyToChannel(data, 0);
      const src = s.ctx.createBufferSource();
      src.buffer = buffer;
      const g = s.ctx.createGain();
      g.gain.value = 0.92;
      src.connect(g);
      g.connect(s.tap);
      const when = s.ctx.currentTime + 0.1;
      src.start(when);
      return { when, sampleRate: rate, click: data };
    },
    duck,
    unduck: () => applyGains(),
    agentView,
    levels() {
      return [...sinks.values()].map(s => ({ id: s.id, level: readLevel(s) }));
    },
    get playing() { return playing; },
    get master() { return master; },
    get track() { return pcm; },
    sink(id) { return sinks.get(id) || null; },
    list() { return [...sinks.values()]; }
  };
}

function wrapDeltaLazy(heard, master, duration, loop) {
  let d = heard - master;
  if (!loop || !(duration > 0)) return d;
  d = ((d + duration / 2) % duration + duration) % duration - duration / 2;
  return round6(d);
}
