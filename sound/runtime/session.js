/**
 * الجلسة تربط الوكلاء بالقاعة.
 * أزرار المستخدم تطلب الإذن، والوكلاء بعدها يحافظون على الاتصال والصوت.
 */

import { createHall } from './hall.js';
import { demoTracks, decodeFile } from './library.js';
import {
  bluetoothAvailability,
  bluetoothSupported,
  inspectLink,
  knownDevices,
  readBattery,
  requestDevice,
  writeAbsoluteVolume,
  backoffMs
} from './bluetooth.js';
import { listOutputs, outputPickerSupported, pickOutput, sinkIdSupported, watchOutputs } from './outputs.js';
import { coordinate, AGENTS } from '../agents/brain.js';
import { explainError } from '../engine/errors.js';
import { normalizeName } from '../engine/match.js';
import { alignTrimsFromMeasurements } from '../engine/mix.js';
import { estimateDelaySeconds } from '../engine/correlate.js';

const MEM_KEY = 'nanjawi.majlis.v1';

function loadMemory() {
  try {
    return JSON.parse(localStorage.getItem(MEM_KEY)) || {};
  } catch {
    return {};
  }
}

export function createSession() {
  const hall = createHall();
  const links = new Map();
  const suggestions = new Map();
  const tracks = demoTracks();
  let index = 0;
  let loopMode = 'one';
  let outputsList = [];
  let notes = [];
  let agentState = {};
  let availability = null;
  const seen = new Map();
  const listeners = new Set();
  const measured = {};
  let memory = {};
  let timer = null;
  let batteryTimer = null;
  let calibrating = false;
  let started = false;

  function emit() {
    const snap = view();
    for (const fn of listeners) fn(snap);
  }

  function pushNote(note) {
    const key = note.agent + ':' + note.text;
    const t = Date.now();
    if (seen.get(key) && t - seen.get(key) < 6500) return;
    seen.set(key, t);
    notes.unshift({ ...note, t });
    if (notes.length > 12) notes.pop();
  }

  function saveMemory() {
    const trims = { ...(memory.trims || {}) };
    const gains = { ...(memory.gains || {}) };
    for (const s of hall.list()) {
      const key = normalizeName(s.label) || s.label;
      trims[key] = s.userTrim;
      gains[key] = s.userGain;
    }
    memory = { ...memory, trims, gains, master: hall.master, loopMode };
    try { localStorage.setItem(MEM_KEY, JSON.stringify(memory)); } catch { /* خاص */ }
  }

  function remembered(label, field, fallback) {
    const key = normalizeName(label) || label;
    const bag = memory[field] || {};
    return bag[key] ?? fallback;
  }

  function loopingNow() {
    return loopMode === 'one' || (loopMode === 'queue' && tracks.length <= 1);
  }

  function applyLoop() {
    hall.setLoopMode(loopMode);
    hall.setLooping(loopingNow());
  }

  function nextTrack() {
    if (tracks.length < 2) return null;
    return tracks[(index + 1) % tracks.length];
  }

  function brainSnapshot() {
    const live = hall.agentView();
    return {
      transport: { ...live.transport, loopMode, master: hall.master },
      sinks: live.sinks,
      links: [...links.values()].map(link => ({
        id: link.id,
        name: link.info?.name || 'جهاز بلوتوث',
        gatt: link.gatt,
        want: link.want,
        reconnectIn: Math.max(0, (link.nextTry || 0) - Date.now())
      })),
      outputs: outputsList.filter(o => o.label),
      queue: {
        length: tracks.length,
        nextReady: !!nextTrack(),
        nextId: nextTrack()?.id || null
      }
    };
  }

  function execute(plan) {
    for (const action of plan.actions || []) {
      if (!action || action.type === 'stop-all' || action.type === 'pause' || action.type === 'close-all') continue;
      if (action.type === 'rewind-master') hall.rewindMaster(action.by);
      else if (action.type === 'nudge-delay') hall.nudge(action.id, action.delta);
      else if (action.type === 'rejoin') hall.rejoin(action.id);
      else if (action.type === 'fill') hall.fill(action.id);
      else if (action.type === 'resume-context') hall.resumeSink(action.id);
      else if (action.type === 'gain') {
        const sink = hall.sink(action.id);
        if (sink) hall.setUserGain(action.id, sink.userGain);
      } else if (action.type === 'reconnect-gatt') retryLink(action.id);
      else if (action.type === 'suggest-route' && !suggestions.has(action.linkId)) {
        suggestions.set(action.linkId, action);
      } else if (action.type === 'schedule-handoff') {
        const nxt = nextTrack();
        if (nxt) hall.scheduleHandoff(nxt);
      }
    }
    for (const note of plan.notes || []) pushNote(note);
    agentState = plan.agentState || agentState;
  }

  function tick() {
    execute(coordinate(brainSnapshot()));
    publishSession();
    emit();
  }

  function devices() {
    const rows = [];
    const usedLinks = new Set();
    for (const sink of hall.list()) {
      const link = [...links.values()].find(item => item.id === sink.linkId)
        || [...links.values()].find(item => normalizeName(item.info?.name) && normalizeName(item.info.name) === normalizeName(sink.label));
      if (link) usedLinks.add(link.id);
      const suggestion = link ? suggestions.get(link.id) : null;
      rows.push({
        key: sink.id,
        sinkId: sink.id,
        linkId: link?.id || null,
        name: link?.info?.name || sink.label,
        route: sink.label,
        kind: link && sink.deviceId ? 'both' : (link ? 'both' : (sink.deviceId ? 'output' : 'default')),
        battery: link?.info?.battery ?? null,
        rssi: link?.info?.rssi ?? null,
        gatt: link?.gatt || null,
        manufacturer: link?.info?.manufacturer || '',
        model: link?.info?.model || '',
        bound: sink.bound,
        bindError: sink.bindError,
        present: sink.present !== false,
        level: 0,
        drift: null,
        userGain: sink.userGain,
        userTrimMs: Math.round(sink.userTrim * 1000),
        muted: sink.muted,
        solo: sink.solo,
        profile: sink.profile,
        suggestion: suggestion && !sink.deviceId ? suggestion : null
      });
    }
    for (const link of links.values()) {
      if (usedLinks.has(link.id)) continue;
      rows.push({
        key: link.id,
        sinkId: null,
        linkId: link.id,
        name: link.info?.name || 'جهاز بلوتوث',
        route: 'مراقبة بلوتوث',
        kind: 'bluetooth',
        battery: link.info?.battery ?? null,
        rssi: link.info?.rssi ?? null,
        gatt: link.gatt,
        manufacturer: link.info?.manufacturer || '',
        model: link.info?.model || '',
        bound: false,
        bindError: null,
        present: true,
        level: 0,
        drift: null,
        userGain: 1,
        userTrimMs: 0,
        muted: false,
        solo: false,
        profile: '',
        suggestion: suggestions.get(link.id) || null
      });
    }
    const live = hall.agentView();
    for (const row of rows) {
      const sink = live.sinks.find(s => s.id === row.sinkId);
      if (!sink) continue;
      row.level = sink.level;
      row.drift = sink.drift;
      row.bound = sink.bound;
      row.userGain = sink.userGain;
      row.userTrimMs = Math.round((sink.userTrim || 0) * 1000);
      row.muted = sink.muted;
      row.solo = sink.solo;
    }
    return rows;
  }

  function view() {
    const live = hall.agentView();
    const track = tracks[index] || null;
    return {
      playing: live.transport.playing,
      mediaTime: live.transport.mediaTime || 0,
      duration: track?.duration || live.transport.duration || 0,
      loopMode,
      master: hall.master,
      track,
      queue: tracks.map((item, i) => ({ id: item.id, title: item.title, artist: item.artist, active: i === index })),
      devices: devices(),
      agents: AGENTS.map(agent => ({ ...agent, state: agentState[agent.id] || 'يراقب' })),
      notes: notes.slice(0, 8),
      caps: {
        bluetooth: bluetoothSupported(),
        sinkId: sinkIdSupported(),
        picker: outputPickerSupported(),
        secure: globalThis.isSecureContext !== false,
        embedded: window.top !== window.self,
        availability
      },
      calibrating
    };
  }

  async function refreshOutputs() {
    try {
      outputsList = await listOutputs();
    } catch {
      outputsList = [];
    }
    const ids = new Set(outputsList.map(o => o.deviceId));
    if (ids.size) {
      for (const sink of hall.list()) {
        if (!sink.deviceId) continue;
        hall.setPresent(sink.id, ids.has(sink.deviceId));
      }
    }
  }

  async function ensureDefault() {
    if (hall.list().some(s => !s.deviceId)) return;
    await hall.addSink({
      id: 'out:default',
      deviceId: '',
      label: 'مخرج النظام',
      userGain: remembered('مخرج النظام', 'gains', 1),
      userTrim: remembered('مخرج النظام', 'trims', 0)
    });
  }

  function publishSession() {
    const track = tracks[index];
    const media = navigator.mediaSession;
    if (!media || !track) return;
    try {
      media.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: 'مجلس الصوت',
        artwork: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }]
      });
      media.playbackState = hall.playing ? 'playing' : 'paused';
      if (media.setPositionState && track.duration) {
        const pos = Math.min(track.duration, Math.max(0, hall.agentView().transport.mediaTime || 0));
        media.setPositionState({ duration: track.duration, playbackRate: 1, position: pos });
      }
    } catch { /* بعض المتصفحات ترفض الموضع عند الحافة */ }
  }

  function bindSessionHandlers() {
    const media = navigator.mediaSession;
    if (!media?.setActionHandler) return;
    const safe = (name, fn) => { try { media.setActionHandler(name, fn); } catch { /* غير مدعوم */ } };
    safe('play', () => { play().catch(() => {}); });
    safe('pause', () => pause());
    safe('previoustrack', () => selectDelta(-1));
    safe('nexttrack', () => selectDelta(1));
    safe('seekto', (details) => { if (details.fastSeek || details.seekTime != null) hall.seek(details.seekTime || 0); });
  }

  async function play() {
    await ensureDefault();
    applyLoop();
    if (!hall.track) hall.setTrack(tracks[index]);
    await hall.play();
    if (navigator.wakeLock?.request) {
      navigator.wakeLock.request('screen').catch(() => {});
    }
    publishSession();
    emit();
  }

  function pause() {
    hall.pause();
    publishSession();
    emit();
  }

  function selectIndex(next, crossfade = true) {
    if (!tracks.length) return;
    index = (next + tracks.length) % tracks.length;
    const was = hall.playing;
    if (crossfade) hall.setTrack(tracks[index]);
    applyLoop();
    if (was) hall.play();
    publishSession();
    emit();
  }

  function selectDelta(step) {
    selectIndex(index + step);
    pushNote({ agent: 'librarian', text: 'انتقال بتلاشي قصير. لم يُغلق أي مسار.' });
  }

  async function addOutputDevice(device, linkId = null) {
    const label = device.label || 'مخرج صوت';
    const id = 'out:' + (device.deviceId || 'default');
    const sink = await hall.addSink({
      id,
      deviceId: device.deviceId || '',
      label,
      linkId,
      userGain: remembered(label, 'gains', 1),
      userTrim: remembered(label, 'trims', 0)
    });
    if (linkId) suggestions.delete(linkId);
    pushNote({
      agent: sink.bound ? 'playback' : 'health',
      text: sink.bound
        ? `«${label}» التحقت. السماعات التي كانت تعمل لم تُعد تشغيلها.`
        : `تعذّر توجيه «${label}». البقية مستمرة.`
    });
    saveMemory();
    emit();
    return sink;
  }

  function attachDevice(device) {
    const id = 'bt:' + device.id;
    let link = links.get(id);
    if (link) return link;
    link = {
      id,
      device,
      info: { id: device.id, name: device.name || 'جهاز بلوتوث', battery: null },
      gatt: 'disconnected',
      want: true,
      attempt: 0,
      busy: false,
      nextTry: 0
    };
    links.set(id, link);
    device.addEventListener('gattserverdisconnected', () => {
      if (!link.want) return;
      link.gatt = 'disconnected';
      link.nextTry = Date.now() + 500;
      pushNote({ agent: 'link', text: `انفصل «${link.info.name}» عن المراقبة فقط. الصوت لا يمر من هذا الرابط، فلم يُقطع.` });
      emit();
    });
    return link;
  }

  async function adoptBluetooth(device) {
    const link = attachDevice(device);
    link.want = true;
    link.gatt = 'connecting';
    emit();
    try {
      const opened = await inspectLink(device);
      link.server = opened.server;
      link.info = { ...link.info, ...opened.info };
      link.gatt = 'connected';
      link.attempt = 0;
      link.busy = false;
      pushNote({ agent: 'link', text: `«${link.info.name}» مربوط. البطارية والحالة تُقرآن محليًا.` });
    } catch (err) {
      link.gatt = 'disconnected';
      link.attempt = 1;
      link.nextTry = Date.now() + backoffMs(1);
      emit();
      throw err;
    }
    emit();
    return link;
  }

  function retryLink(id) {
    const link = links.get(id);
    if (!link || link.busy || !link.want || link.gatt === 'connected') return;
    if (link.nextTry && Date.now() < link.nextTry) return;
    link.busy = true;
    link.attempt = link.attempt || 0;
    inspectLink(link.device).then((opened) => {
      link.server = opened.server;
      link.info = { ...link.info, ...opened.info, name: opened.info.name || link.info.name };
      link.gatt = 'connected';
      link.attempt = 0;
      link.busy = false;
      pushNote({ agent: 'link', text: `«${link.info.name}» عاد دون إيقاف القاعة.` });
      emit();
    }).catch(() => {
      link.gatt = 'disconnected';
      link.attempt += 1;
      link.busy = false;
      link.nextTry = Date.now() + backoffMs(link.attempt);
    });
  }

  async function pollBatteries() {
    for (const link of links.values()) {
      if (link.gatt !== 'connected') continue;
      const level = await readBattery(link.info);
      if (level != null) link.info.battery = level;
    }
  }

  function removeKey(key) {
    if (key.startsWith('bt:')) {
      const link = links.get(key);
      if (link) {
        link.want = false;
        try { link.device.gatt?.disconnect(); } catch { /* بالفعل منفصل */ }
        links.delete(key);
        suggestions.delete(key);
      }
    }
    const sink = hall.sink(key);
    if (sink) {
      hall.removeSink(key);
      pushNote({ agent: 'health', text: `أُخرجت «${sink.label}» وحدها. الباقي لم يتوقف.` });
    } else if (key.startsWith('bt:')) {
      const paired = hall.list().find(s => s.linkId === key);
      if (paired) hall.removeSink(paired.id);
    }
    emit();
  }

  async function calibrate(sinkId) {
    if (calibrating) return;
    const sink = hall.sink(sinkId);
    if (!sink?.bound) {
      const err = new Error('NO_MIC');
      err.code = 'NO_MIC';
      throw err;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new Error('NO_MIC');
      err.code = 'NO_MIC';
      throw err;
    }
    calibrating = true;
    emit();
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      hall.duck('__none__', 0);
      await sink.ctx.resume();
      await new Promise(resolve => setTimeout(resolve, 160));
      const delay = await measureClick(sink, stream);
      measured[sinkId] = delay;
      const trims = alignTrimsFromMeasurements(measured);
      const ids = Object.keys(trims);
      if (ids.length < 2) {
        pushNote({ agent: 'clock', text: `قياس «${sink.label}»: ${Math.round(delay * 1000)}مللي. قس سماعة ثانية لأحاذي بينهما.` });
      } else {
        for (const [id, trim] of Object.entries(trims)) hall.setUserTrim(id, trim);
        pushNote({ agent: 'clock', text: 'حُوذيت السماعات على أبطأها. الموسيقى كانت مخفوضة لا متوقفة.' });
      }
      saveMemory();
    } finally {
      hall.unduck();
      stream?.getTracks().forEach(track => track.stop());
      calibrating = false;
      emit();
    }
  }

  function measureClick(sink, stream) {
    return new Promise((resolve, reject) => {
      const ctx = sink.ctx;
      if (!ctx.createScriptProcessor) {
        reject(Object.assign(new Error('المعايرة غير متاحة في هذا المتصفح.'), { code: 'NO_MIC' }));
        return;
      }
      const mic = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const mute = ctx.createGain();
      mute.gain.value = 0;
      mic.connect(proc);
      proc.connect(mute);
      mute.connect(ctx.destination);
      const chunks = [];
      let recStart = null;
      let clickAt = null;
      let click = null;
      const timeout = setTimeout(() => done(new Error('لم تصل نقرة المعايرة.')), 2000);

      proc.onaudioprocess = (event) => {
        if (recStart == null) {
          recStart = typeof event.playbackTime === 'number' ? event.playbackTime : ctx.currentTime;
          const pulse = hall.pulse(sink.id);
          clickAt = pulse?.when ?? ctx.currentTime;
          click = pulse?.click || null;
        }
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
        const at = typeof event.playbackTime === 'number' ? event.playbackTime : ctx.currentTime;
        if (at - recStart > 1.05) done();
      };

      function done(err) {
        clearTimeout(timeout);
        try { proc.onaudioprocess = null; proc.disconnect(); mic.disconnect(); mute.disconnect(); } catch { /* أُغلق */ }
        if (err) {
          reject(err);
          return;
        }
        const recorded = concatFloats(chunks);
        const result = click ? estimateDelaySeconds(recorded, click, ctx.sampleRate) : null;
        if (!result || result.score < 0.08) {
          reject(Object.assign(new Error('لم أسمع النقرة بوضوح. قرّب السماعة من الميكروفون.'), { code: 'NO_MIC' }));
          return;
        }
        const expected = Math.max(0, clickAt - recStart);
        resolve(Math.max(0, result.delay - expected));
      }
    });
  }

  async function boot() {
    if (started) return;
    started = true;
    memory = loadMemory();
    loopMode = memory.loopMode || 'one';
    hall.setMaster(memory.master ?? 0.85);
    applyLoop();
    hall.setTrack(tracks[0]);
    hall.on('handoff', ({ id }) => {
      const found = tracks.findIndex(track => track.id === id);
      if (found >= 0) index = found;
      pushNote({ agent: 'librarian', text: `تسليم متصل إلى «${tracks[index]?.title || 'المقطع'}».` });
      publishSession();
      emit();
    });
    hall.on('ended', () => {
      publishSession();
      emit();
    });
    bindSessionHandlers();
    availability = await bluetoothAvailability();
    await refreshOutputs();
    watchOutputs(() => { refreshOutputs().then(emit); });
    const known = await knownDevices();
    for (const device of known) {
      try { await adoptBluetooth(device); } catch { /* الإذن القديم قد لا يكفي الآن */ }
    }
    if (known.length) pushNote({ agent: 'discovery', text: 'استعدت الأجهزة التي سمحت بها سابقًا، دون نافذة جديدة.' });
    pushNote({ agent: 'coordinator', text: 'الوكلاء الثمانية في الخدمة. لن يُوقف مجلسٌ لإصلاح سماعة.' });
    timer = setInterval(tick, 280);
    batteryTimer = setInterval(() => { pollBatteries().then(emit); }, 40000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && hall.playing) {
        execute(coordinate(brainSnapshot()));
        hall.resumeAll();
      }
    });
    emit();
  }

  return {
    boot,
    play,
    pause,
    seek: (t) => { hall.seek(t); emit(); },
    requestBluetooth: requestDevice,
    adoptBluetooth,
    pickOutput,
    addOutputDevice,
    async addVisibleOutputs() {
      await refreshOutputs();
      const usable = outputsList.filter(o => o.deviceId && o.deviceId !== 'default' && o.label);
      if (!usable.length) {
        const err = new Error('لم تظهر مخارج بعد. اختر مخرجًا واحدًا أولًا ليسمح المتصفح بالقائمة.');
        err.code = 'NO_OUTPUT_PICKER';
        throw err;
      }
      for (const output of usable) {
        if (hall.sink('out:' + output.deviceId)) continue;
        await addOutputDevice(output);
      }
    },
    async addFiles(files) {
      let count = 0;
      for (const file of files) {
        const pcm = await decodeFile(file);
        if (!tracks.some(track => track.id === pcm.id)) tracks.push(pcm);
        count += 1;
      }
      if (count) pushNote({ agent: 'librarian', text: 'أُضيف الملف إلى الطابور. ما يُعزف الآن لم يُقطع.' });
      emit();
    },
    setMaster(value) {
      hall.setMaster(value);
      saveMemory();
      emit();
    },
    setGain(id, value) {
      hall.setUserGain(id, value);
      const sink = hall.sink(id);
      const link = [...links.values()].find(item => item.id === sink?.linkId);
      if (link?.info) writeAbsoluteVolume(link.info, value);
      saveMemory();
    },
    setTrim(id, ms) {
      hall.setUserTrim(id, ms / 1000);
      saveMemory();
    },
    setMuted(id, value) { hall.setMuted(id, value); emit(); },
    setSolo(id, value) { hall.setSolo(id, value); emit(); },
    setNeutral(id) { hall.setNeutral(id); emit(); },
    removeKey,
    armSuggestion: async (linkId) => {
      const suggestion = suggestions.get(linkId);
      if (!suggestion) return null;
      return addOutputDevice({ deviceId: suggestion.deviceId, label: suggestion.label }, linkId);
    },
    setLoopMode(mode) {
      loopMode = mode;
      applyLoop();
      saveMemory();
      pushNote({
        agent: 'librarian',
        text: mode === 'queue' ? 'الطابور سيُسلَّم عند الحد بلا فجوة.' : mode === 'one' ? 'تكرار هذا المقطع بلا فاصل.' : 'سيتوقف عند نهاية المقطع، لا في وسطه.'
      });
      emit();
    },
    selectTrack(id) {
      const found = tracks.findIndex(track => track.id === id);
      if (found >= 0) selectIndex(found);
    },
    next: () => selectDelta(1),
    prev: () => selectDelta(-1),
    syncPing() { hall.syncPing(); },
    calibrate,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    view,
    explain: explainError
  };
}

function concatFloats(chunks) {
  let n = 0;
  for (const chunk of chunks) n += chunk.length;
  const out = new Float32Array(n);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
