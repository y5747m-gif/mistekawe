/** قانون الكسب ومحاذاة التأخير. التأخير السالب يُزاح إلى بقية السماعات لأن DelayNode لا يتقدم بالزمن. */

import { clamp } from './time.js';

export function effectiveGain({ userGain = 1, muted = false, solo = false, anySolo = false, master = 1 } = {}) {
  if (muted) return 0;
  if (anySolo && !solo) return 0;
  return clamp(userGain * master, 0, 1.25);
}

/**
 * userTrim / autoTrim بالثواني، وقد يكونان سالبين (هذه السماعة متأخرة صوتيًا).
 * الناتج تأخير ≥ 0 يحفظ الفروق النسبية.
 */
export function normalizeDelays(entries, max = 1.85) {
  if (!entries?.length) return [];
  const raw = entries.map(e => (e.userTrim || 0) + (e.autoTrim || 0));
  const shift = Math.min(0, ...raw);
  return entries.map((e, i) => ({
    id: e.id,
    delay: clamp(raw[i] - shift, 0, max)
  }));
}

export function profileForLabel(label) {
  const s = String(label || '').toLowerCase();
  if (/buds|airpod|headphone|headset|earbud|earpods|سماعة أذن|ايربود/.test(s)) {
    return { low: -1.5, mid: 0.8, high: 1.6, name: 'أذنية' };
  }
  if (/soundbar|party|flip|boom|charge|speaker|pulse|مكبر|سبيكر/.test(s)) {
    return { low: 2.4, mid: 0, high: 0.6, name: 'غرفة' };
  }
  return { low: 0, mid: 0, high: 0, name: 'محايد' };
}

export function alignTrimsFromMeasurements(measured) {
  const ids = Object.keys(measured || {}).filter(id => Number.isFinite(measured[id]));
  if (ids.length < 2) return {};
  const max = Math.max(...ids.map(id => measured[id]));
  const trims = {};
  for (const id of ids) trims[id] = clamp(max - measured[id], 0, 0.45);
  return trims;
}
