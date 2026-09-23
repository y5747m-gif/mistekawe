/** مطابقة اسم جهاز البلوتوث مع مخرج الصوت في النظام. */

export function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/bluetooth|ble|audio|headphones?|headset|speaker|earbuds?|جهاز|سماعة|بلوتوث/g, ' ')
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchScore(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const shorter = Math.min(na.length, nb.length);
  if (shorter >= 3 && (na.includes(nb) || nb.includes(na))) return 0.86;
  const ta = new Set(na.split(' ').filter(t => t.length > 1));
  const tb = nb.split(' ').filter(t => t.length > 1);
  if (!ta.size || !tb.length) return 0;
  let hit = 0;
  for (const token of tb) if (ta.has(token)) hit++;
  return hit / Math.max(ta.size, tb.length);
}

export function bestMatch(name, outputs, threshold = 0.55) {
  let best = null;
  let score = 0;
  for (const output of outputs || []) {
    const s = Math.max(matchScore(name, output.label), matchScore(name, output.deviceId));
    if (s > score) {
      score = s;
      best = output;
    }
  }
  if (!best || score < threshold) return null;
  return { output: best, score };
}
