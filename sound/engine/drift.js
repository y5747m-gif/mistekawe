/**
 * سياسة الانحراف: إصلاح ناعم، وقطع مسار واحد فقط عند الضرورة القصوى.
 * إن تجمّد التبويب وتأخرت كل السماعات معًا نُرجع الساعة، ولا نُعيد جدولة الصوت.
 */

import { clamp } from './time.js';

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * @param {{id:string, drift:number|null, running:boolean}[]} drifts
 * @returns {{global: object|null, perSink: object[]}}
 */
export function classifyDrift(drifts, {
  rejoinAt = 0.18,
  nudgeAt = 0.008,
  freezeSpread = 0.08
} = {}) {
  const active = (drifts || []).filter(d => d && d.running && d.drift != null && Number.isFinite(d.drift));
  if (!active.length) return { global: null, perSink: [] };

  const allBehind = active.every(d => d.drift < -0.05);
  const spread = Math.max(...active.map(d => d.drift)) - Math.min(...active.map(d => d.drift));
  if (active.length >= 1 && allBehind && spread < freezeSpread) {
    return {
      global: { type: 'rewind-master', by: median(active.map(d => d.drift)) },
      perSink: []
    };
  }

  const perSink = [];
  for (const d of active) {
    if (Math.abs(d.drift) >= rejoinAt) {
      perSink.push({ type: 'rejoin', id: d.id, reason: 'drift' });
    } else if (Math.abs(d.drift) > nudgeAt) {
      perSink.push({
        type: 'nudge-delay',
        id: d.id,
        delta: clamp(d.drift * 0.3, -0.012, 0.012)
      });
    }
  }
  return { global: null, perSink };
}

export function nextAutoTrim(autoTrim, delta, cap = 0.04) {
  return clamp((autoTrim || 0) + delta, -cap, cap);
}
