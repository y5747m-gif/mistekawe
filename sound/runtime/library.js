/**
 * مكتبة محلية: مقطوعتان تُولَّدان على الجهاز، وملفات المستخدم تُفكّ مرة واحدة
 * قبل أن تدخل المسار المسموع حتى لا يحدث فراغ عند التسليم.
 */

function loopFreq(ideal, seconds) {
  return Math.round(ideal * seconds) / seconds;
}

function noteHz(midi, seconds) {
  return loopFreq(440 * 2 ** ((midi - 69) / 12), seconds);
}

function noteEnv(t, dur) {
  const attack = 0.012;
  const release = 0.07;
  if (t < 0 || t > dur) return 0;
  if (t < attack) return t / attack;
  if (t > dur - release) return Math.max(0, (dur - t) / release);
  return 1;
}

function hash(i) {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function softClip(x) {
  const y = Math.tanh(x);
  return y;
}

export function renderPiece(kind = 'gold', sampleRate = 44100) {
  const seconds = 8;
  const n = Math.floor(sampleRate * seconds);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const beat = seconds / 16;
  const melody = kind === 'horizon'
    ? [67, 66, 63, 62, 63, 66, 69, 70, 69, 67, 66, 63, 62, 63, 62, 62]
    : [62, 63, 66, 67, 69, 67, 66, 63, 62, 69, 67, 66, 63, 62, 62, 62];
  const d2 = noteHz(38, seconds);
  const a2 = noteHz(45, seconds);
  const d3 = noteHz(50, seconds);
  const shimmer = noteHz(62, seconds);

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let s = 0;
    s += Math.sin(2 * Math.PI * d2 * t) * 0.15;
    s += Math.sin(2 * Math.PI * a2 * t) * 0.065;
    s += Math.sin(2 * Math.PI * d3 * t) * 0.045;
    s += Math.sin(2 * Math.PI * shimmer * t) * 0.02;

    const bi = Math.min(15, Math.floor(t / beat + 1e-9));
    const bt = t - bi * beat;
    const fr = noteHz(melody[bi], seconds);
    const env = noteEnv(bt, beat * 0.9);
    const pluck = Math.exp(-bt * 3.1);
    s += Math.sin(2 * Math.PI * fr * t) * 0.2 * env * (0.62 + 0.38 * pluck);
    s += Math.sin(2 * Math.PI * fr * 2 * t) * 0.05 * env * pluck;

    if (bi < 16) {
      const accent = bi % 4 === 0 ? 0.22 : (bi % 2 === 0 ? 0.09 : 0);
      if (accent && bt < 0.08) {
        const attack = Math.min(1, bt / 0.002);
        const pe = Math.exp(-bt * 46) * attack;
        s += hash(i) * pe * accent;
        s += Math.sin(2 * Math.PI * 168 * t) * pe * accent * 0.45;
      }
    }

    const wide = Math.sin(2 * Math.PI * a2 * t) * 0.018;
    left[i] = softClip(s);
    right[i] = softClip(s * 0.94 + wide);
  }

  return {
    id: kind === 'horizon' ? 'majlis-horizon' : 'majlis-gold',
    title: kind === 'horizon' ? 'أفق العود' : 'مجلس الذهب',
    artist: 'وكلاء ننجاوي',
    sampleRate,
    left,
    right,
    duration: seconds,
    kind: 'pcm'
  };
}

export function demoTracks() {
  return [renderPiece('gold'), renderPiece('horizon')];
}

export function boundaryStep(channel) {
  if (!channel?.length) return 0;
  return Math.abs(channel[0] - channel[channel.length - 1]);
}

export async function decodeFile(file) {
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctx) {
    const err = new Error('NO_AUDIO');
    err.code = 'NO_AUDIO';
    throw err;
  }
  const raw = await file.arrayBuffer();
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(raw.slice(0));
    const left = audio.getChannelData(0).slice();
    const right = audio.numberOfChannels > 1 ? audio.getChannelData(1).slice() : left.slice();
    const base = String(file.name || 'مقطع').replace(/\.[^.]+$/, '');
    return {
      id: `file:${base}:${file.size}:${file.lastModified}`,
      title: base,
      artist: 'من جهازك',
      sampleRate: audio.sampleRate,
      left,
      right,
      duration: audio.duration,
      kind: 'pcm'
    };
  } catch (err) {
    const wrapped = new Error(err?.message || 'DECODE');
    wrapped.code = 'DECODE';
    throw wrapped;
  } finally {
    try { await ctx.close(); } catch { /* سياق فك الترميز فقط */ }
  }
}
