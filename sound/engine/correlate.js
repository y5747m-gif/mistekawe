/** تقدير تأخر السماعة من تسجيل ميكروفون محلي. لا يُحفظ التسجيل، الناتج رقم بالثواني فقط. */

export function estimateDelaySeconds(recorded, reference, sampleRate) {
  if (!recorded?.length || !reference?.length || !(sampleRate > 0)) return null;
  const maxLag = Math.min(recorded.length - reference.length, Math.floor(sampleRate * 0.8));
  if (maxLag < 1) return null;

  let refEnergy = 0;
  for (let i = 0; i < reference.length; i++) refEnergy += reference[i] * reference[i];
  if (refEnergy < 1e-8) return null;

  const step = recorded.length > 20000 ? 2 : 1;
  let best = -Infinity;
  let bestLag = 0;
  for (let lag = 0; lag <= maxLag; lag += step) {
    let dot = 0;
    for (let i = 0; i < reference.length; i += step) dot += recorded[lag + i] * reference[i];
    if (dot > best) {
      best = dot;
      bestLag = lag;
    }
  }

  const from = Math.max(0, bestLag - step);
  const to = Math.min(maxLag, bestLag + step);
  for (let lag = from; lag <= to; lag++) {
    let dot = 0;
    for (let i = 0; i < reference.length; i++) dot += recorded[lag + i] * reference[i];
    if (dot > best) {
      best = dot;
      bestLag = lag;
    }
  }

  return { delay: bestLag / sampleRate, lag: bestLag, score: best / refEnergy };
}

export function makeClick(sampleRate, seconds = 0.04) {
  const n = Math.floor(sampleRate * seconds);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * 90) * (t < 0.0015 ? t / 0.0015 : 1);
    data[i] = Math.sin(2 * Math.PI * 1450 * t) * env * 0.85;
  }
  return data;
}
