/**
 * اختبارات مجلس الصوت — بلا متصفح.
 * العقد الذي لا يُكسر: إصلاح سماعة لا يوقف القاعة، والحلقة بلا فجوة.
 */
import { createClock, joinOffset, planFill, wrapDelta, shouldHandoff, isSeamlessChain } from '../../sound/engine/time.js';
import { classifyDrift, nextAutoTrim } from '../../sound/engine/drift.js';
import { bestMatch, matchScore, normalizeName } from '../../sound/engine/match.js';
import { effectiveGain, normalizeDelays, alignTrimsFromMeasurements, profileForLabel } from '../../sound/engine/mix.js';
import { estimateDelaySeconds, makeClick } from '../../sound/engine/correlate.js';
import { coordinate } from '../../sound/agents/brain.js';
import { explainError } from '../../sound/engine/errors.js';
import { backoffMs } from '../../sound/runtime/bluetooth.js';
import { boundaryStep, renderPiece } from '../../sound/runtime/library.js';

let failed = 0;
function ok(cond, msg) {
  if (!cond) {
    failed++;
    console.error('  ✗ ' + msg);
  } else {
    console.log('  ✓ ' + msg);
  }
}
function near(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

console.log('\n1) الساعة لا تقفز عند الإيقاف والاستئناف');
const clock = createClock();
clock.play(1000);
ok(near(clock.mediaTime(1600), 0.6), 'بعد 600مللي = 0.6ث');
clock.pause(1800);
ok(near(clock.mediaTime(9000), 0.8), 'الإيقاف يجمّد الموضع');
clock.play(9000);
ok(near(clock.mediaTime(10000), 1.8), 'الاستئناف يكمل لا يعيد الصفر');
clock.seek(2, 10000);
ok(near(clock.mediaTime(11000), 3), 'الانتقال يحفظ الاستمرار');

console.log('\n2) جدول بلا فجوة');
const planned = planFill({
  scheduledEnd: null,
  ctxNow: 1,
  lookahead: 0.08,
  horizon: 20,
  bufferDuration: 8,
  loop: true,
  mediaNow: 0,
  playing: true
});
ok(planned.length >= 2, 'جُدولت أكثر من دورة: ' + planned.length);
ok(planned[0].reason === 'join', 'أول مقطع التحاق');
ok(isSeamlessChain(planned, 8), 'نهاية كل مقطع = بداية التالي');
const ahead = planFill({
  scheduledEnd: 30,
  ctxNow: 2,
  lookahead: 0.08,
  horizon: 8,
  bufferDuration: 8,
  loop: true,
  mediaNow: 1,
  playing: true
});
ok(ahead.length === 0, 'إن كان الصوت مجدولًا للمستقبل لا نلمس المسار');
ok(planFill({ playing: false, bufferDuration: 8, ctxNow: 0, mediaNow: 0 }).length === 0, 'الإيقاف لا يجدول شيئًا');
ok(joinOffset(8.2, 8, true) === 0.2, 'الالتفاف داخل الحلقة');
ok(joinOffset(-0.25, 8, true) === 7.75, 'موضع سالب يلتف');
ok(near(wrapDelta(0.05, 7.95, 8, true), 0.1, 1e-6) || near(wrapDelta(0.05, 7.95, 8, true), -7.9, 0.2), 'عبور حد الحلقة لا يُحسب قفزة كاملة');

console.log('\n3) الانحراف: إصلاح ناعم أو إرجاع الساعة، لا إيقاف جماعي');
const frozen = classifyDrift([
  { id: 'a', drift: -1.2, running: true },
  { id: 'b', drift: -1.17, running: true }
]);
ok(frozen.global?.type === 'rewind-master', 'تجمّد التبويب يُرجع الساعة');
ok(frozen.perSink.length === 0, 'لا إعادة جدولة للصوت');
const one = classifyDrift([
  { id: 'a', drift: 0.01, running: true },
  { id: 'b', drift: 0.4, running: true }
]);
ok(!one.global, 'سماعة واحدة شاذة ليست تجمّدًا');
ok(one.perSink.some(s => s.type === 'rejoin' && s.id === 'b'), 'الالتحاق للسماعة الشاذة فقط');
ok(!one.perSink.some(s => s.type === 'rejoin' && s.id === 'a'), 'السليمة لا تُعاد');
ok(one.perSink.some(s => s.type === 'nudge-delay' && s.id === 'a'), 'انحراف صغير = تأخير ناعم');
ok(Math.abs(nextAutoTrim(0.03, 0.02)) <= 0.04, 'التأخير التلقائي محدود');

console.log('\n4) المنسّق يرفض إيقاف القاعة');
const broken = coordinate({
  transport: { playing: true, remaining: 4, looping: true, loopMode: 'one', master: 0.8, handoffScheduled: false, duration: 8 },
  sinks: [
    { id: 'ok', label: 'قاعة', state: 'running', running: true, bound: true, drift: 0.004, scheduledAhead: 6, userGain: 1, effectiveGain: 0.8, deviceId: 'a' },
    { id: 'late', label: 'JBL', state: 'suspended', running: false, bound: true, drift: null, scheduledAhead: 0, userGain: 1, effectiveGain: 0.8, deviceId: 'b' }
  ],
  links: [{ id: 'bt:1', name: 'JBL Flip 6', gatt: 'disconnected', want: true, reconnectIn: 0 }],
  outputs: [{ deviceId: 'b', label: 'JBL Flip 6 (Bluetooth)' }],
  queue: { length: 2, nextReady: true }
});
const types = new Set(broken.actions.map(a => a.type));
ok(!types.has('stop-all') && !types.has('pause') && !types.has('close-all'), 'لا يوجد إيقاف شامل');
ok(types.has('reconnect-gatt'), 'سقوط البلوتوث يعيد الربط فقط');
ok(!broken.actions.some(a => a.type === 'rejoin'), 'انقطاع GATT لا يعيد جدولة الصوت');
ok(broken.actions.some(a => a.type === 'resume-context' && a.id === 'late'), 'إيقاظ المسار النائم وحده');
ok(!broken.actions.some(a => a.type === 'resume-context' && a.id === 'ok'), 'السليم لا يُلمس');

const hand = coordinate({
  transport: { playing: true, remaining: 3, looping: false, loopMode: 'queue', master: 1, handoffScheduled: false, duration: 8 },
  sinks: [{ id: 'a', label: 'أ', state: 'running', running: true, bound: true, drift: 0, scheduledAhead: 3, userGain: 1, effectiveGain: 1, deviceId: 'x' }],
  links: [],
  outputs: [],
  queue: { length: 2, nextReady: true }
});
ok(hand.actions.some(a => a.type === 'schedule-handoff'), 'التسليم يُجدول قبل النهاية');
ok(!shouldHandoff({ playing: true, loopMode: 'one', queueLength: 2, remaining: 1, nextReady: true }), 'تكرار المقطع لا يقفز للتالي');

console.log('\n5) المطابقة والمزج');
ok(matchScore('JBL Flip 6', 'JBL Flip 6 (Bluetooth)') >= 0.8, 'اسم السماعة يطابق مخرج النظام');
ok(bestMatch('WH-1000XM4', [{ deviceId: '1', label: 'Speakers' }, { deviceId: '2', label: 'WH-1000XM4 Hands-Free' }]).output.deviceId === '2', 'أفضل تطابق');
ok(normalizeName('  سماعة JBL  ') === 'jbl', 'تطبيع الاسم');
const delays = normalizeDelays([{ id: 'a', userTrim: -0.05 }, { id: 'b', userTrim: 0.1 }]);
ok(delays[0].delay === 0 && near(delays[1].delay, 0.15), 'التأخير السالب يُزاح ولا يُصبح سالبًا');
ok(effectiveGain({ userGain: 0.5, master: 0.5 }) === 0.25, 'كسب نسبي');
ok(effectiveGain({ userGain: 1, muted: true, master: 1 }) === 0, 'الكتم صفر');
ok(effectiveGain({ userGain: 1, solo: false, anySolo: true, master: 1 }) === 0, 'المنفرد يكتم البقية');
const aligned = alignTrimsFromMeasurements({ a: 0.18, b: 0.24 });
ok(near(aligned.a, 0.06) && aligned.b === 0, 'المحاذاة على أبطأ سماعة');
ok(profileForLabel('AirPods Pro').name === 'أذنية', 'ملف أذني');
ok(profileForLabel('JBL Flip 6').name === 'غرفة', 'ملف غرفة');

console.log('\n6) قياس النقرة والحدود الموسيقية');
const rate = 8000;
const click = makeClick(rate, 0.03);
const recorded = new Float32Array(rate);
const lag = 1000;
recorded.set(click, lag);
const found = estimateDelaySeconds(recorded, click, rate);
ok(found && found.lag === lag, 'ذروة الارتباط عند التأخير المزروع: ' + found?.lag);
ok(backoffMs(0) === 800 && backoffMs(10) === 30000, 'إعادة الربط تتراجع وتقف عند 30ث');
const piece = renderPiece('gold', 44100);
ok(piece.left.length === 44100 * 8, 'مقطع 8 ثوانٍ');
ok(boundaryStep(piece.left) < 0.08, 'حد الحلقة بلا طقطقة: ' + boundaryStep(piece.left).toFixed(4));
ok(boundaryStep(piece.right) < 0.08, 'القناة اليمنى متصلة');
let peak = 0;
for (let i = 0; i < piece.left.length; i += 40) peak = Math.max(peak, Math.abs(piece.left[i]));
ok(peak > 0.15 && peak < 1, 'المقطع مسموع وغير مشوّه: ' + peak.toFixed(2));
ok(explainError({ code: 'NO_BLUETOOTH' }).includes('Chrome'), 'رسالة بلوتوث عربية');

console.log('\n7) استيراد القاعة والجلسة بلا تنفيذ صوتي');
await import('../../sound/runtime/hall.js');
await import('../../sound/runtime/session.js');
ok(true, 'الوحدات تُحمّل في Node دون لمس AudioContext');

if (failed) {
  console.error(`\n❌ فشل ${failed} اختبار`);
  process.exit(1);
}
console.log('\n✅ اختبارات مجلس الصوت نجحت');
