/**
 * مجلس الوكلاء — قرار محلي بلا أي خدمة خارجية.
 *
 * كل وكيل يرى اللوحة ويقترح. المنسّق يقبل ما لا يقطع القاعة:
 *   - لا إيقاف شامل، ولا إغلاق لكل المسارات، كإجراء إصلاح.
 *   - عطل سماعة يُصلح مسارها وحدها.
 *   - سقوط رابط البلوتوث لا يمس الصوت (الرابط للمراقبة، والمخرج للصوت).
 *   - انحراف صغير = تأخير ناعم. انحراف كبير على سماعة واحدة = التحاقها بتلاشي.
 *   - إن تأخر الجميع معًا (تبويب نام) تُرجع الساعة ويُترك الصوت كما هو.
 */

import { classifyDrift } from '../engine/drift.js';
import { bestMatch } from '../engine/match.js';
import { effectiveGain } from '../engine/mix.js';
import { shouldHandoff } from '../engine/time.js';

export const AGENTS = [
  { id: 'coordinator', name: 'المنسّق', role: 'يحسم الخطة دون أن يوقف المجلس' },
  { id: 'discovery', name: 'المستكشف', role: 'يطابق البلوتوث بمخرج الصوت' },
  { id: 'link', name: 'الرابط', role: 'يعيد الاتصال دون لمس الصوت' },
  { id: 'clock', name: 'الساعة', role: 'يمتص الانحراف بسلاسة' },
  { id: 'playback', name: 'العازف', role: 'يجدول قبل أن ينفد الصوت' },
  { id: 'mixer', name: 'المازج', role: 'مستوى كل سماعة على حدة' },
  { id: 'health', name: 'الحارس', role: 'يوقظ مسارًا نائمًا وحده' },
  { id: 'librarian', name: 'أمين المكتبة', role: 'يمهّد المقطع التالي بلا فجوة' }
];

const FORBIDDEN = new Set(['stop-all', 'pause', 'close-all', 'suspend-all']);

export function coordinate(snapshot = {}) {
  const actions = [];
  const notes = [];
  const transport = snapshot.transport || {};
  const sinks = snapshot.sinks || [];
  const links = snapshot.links || [];
  const outputs = snapshot.outputs || [];
  const queue = snapshot.queue || {};
  const playing = !!transport.playing;

  for (const link of links) {
    if (link.want && link.gatt === 'disconnected' && (link.reconnectIn || 0) <= 0) {
      actions.push({ type: 'reconnect-gatt', id: link.id });
      notes.push({ agent: 'link', text: `أعيد ربط «${link.name || 'جهاز'}» . مسار الصوت لا يُلمس.` });
    }
  }

  if (playing) {
    const driftPlan = classifyDrift(sinks.map(s => ({
      id: s.id,
      drift: s.bound === false ? null : s.drift,
      running: s.state === 'running' || s.running === true
    })));
    if (driftPlan.global?.type === 'rewind-master') {
      actions.push(driftPlan.global);
      const ms = Math.round(Math.abs(driftPlan.global.by) * 1000);
      notes.push({ agent: 'clock', text: `عاد التبويب بعد ${ms}مللي. أرجعت الساعة إلى الصوت بدل إعادة تشغيله.` });
    } else {
      for (const step of driftPlan.perSink) {
        actions.push(step);
        const sink = sinks.find(s => s.id === step.id);
        const label = sink?.label || 'سماعة';
        if (step.type === 'rejoin') {
          const ms = Math.round(Math.abs(sink?.drift || 0) * 1000);
          notes.push({ agent: 'clock', text: `«${label}» انحرفت ${ms}مللي. تلتحق وحدها بتلاشي قصير، والبقية مستمرة.` });
        } else if (Math.abs(sink?.drift || 0) > 0.02) {
          const ms = Math.round((sink?.drift || 0) * 1000);
          notes.push({ agent: 'clock', text: `أضبط تأخير «${label}» بسلاسة (${ms > 0 ? '+' : ''}${ms}مللي) دون قطع.` });
        }
      }
    }

    for (const sink of sinks) {
      if (!sink.bound) continue;
      if (sink.state === 'suspended' || sink.state === 'interrupted') {
        actions.push({ type: 'resume-context', id: sink.id });
        notes.push({ agent: 'health', text: `أيقظت مسار «${sink.label || 'سماعة'}» بعد أن أوقفه المتصفح. لم أوقف أحدًا غيرها.` });
      } else if ((sink.scheduledAhead || 0) < 0.35 && transport.looping && sink.state === 'running') {
        actions.push({ type: 'fill', id: sink.id });
        notes.push({ agent: 'playback', text: `جدولت حلقة «${sink.label || 'سماعة'}» قبل أن تنفد، بلا فجوة.` });
      }
    }
  }

  for (const link of links) {
    if (link.gatt !== 'connected') continue;
    if (sinks.some(s => s.linkId === link.id && s.bound)) continue;
    const match = bestMatch(link.name, outputs);
    if (!match) continue;
    if (sinks.some(s => s.deviceId && s.deviceId === match.output.deviceId)) continue;
    actions.push({
      type: 'suggest-route',
      linkId: link.id,
      deviceId: match.output.deviceId,
      label: match.output.label,
      score: match.score
    });
    notes.push({ agent: 'discovery', text: `«${link.name}» يطابق مخرج «${match.output.label}». التوجيه بيدك حتى لا يذهب الصوت لغير مكانه.` });
  }

  if (playing && shouldHandoff({
    playing,
    loopMode: transport.loopMode,
    queueLength: queue.length || 0,
    remaining: transport.remaining ?? 99,
    nextReady: !!queue.nextReady,
    handoffScheduled: !!transport.handoffScheduled
  })) {
    actions.push({ type: 'schedule-handoff' });
    notes.push({ agent: 'librarian', text: 'المقطع التالي مجدول على كل السماعات عند الحد تمامًا — بلا فجوة.' });
    notes.push({ agent: 'playback', text: 'التسليم سيكون على خيط الصوت، لا بعد أن يصمت.' });
  }

  const anySolo = sinks.some(s => s.solo);
  for (const sink of sinks) {
    const target = effectiveGain({
      userGain: sink.userGain ?? 1,
      muted: sink.muted,
      solo: sink.solo,
      anySolo,
      master: transport.master ?? 1
    });
    if (Math.abs(target - (sink.effectiveGain ?? target)) > 0.02) {
      actions.push({ type: 'gain', id: sink.id, value: target });
    }
  }

  const namedOutputs = sinks.filter(s => s.deviceId && s.bound);
  const openDefault = sinks.find(s => !s.deviceId && !s.muted && s.bound);
  if (playing && namedOutputs.length && openDefault) {
    notes.push({ agent: 'mixer', text: 'مخرج النظام يعمل مع سماعات مخصّصة. اكتمه إن سمعت صدى — غالبًا هو نفس الجهاز.' });
  }

  const safe = actions.filter(a => a && !FORBIDDEN.has(a.type));
  const state = {
    coordinator: safe.length ? 'يحسم' : 'يراقب',
    discovery: safe.some(a => a.type === 'suggest-route') ? 'يطابق' : 'يمسح',
    link: safe.some(a => a.type === 'reconnect-gatt') ? 'يعيد الربط' : 'ثابت',
    clock: safe.some(a => a.type === 'rewind-master' || a.type === 'nudge-delay') ? 'يضبط' : 'مستقر',
    playback: safe.some(a => a.type === 'fill' || a.type === 'schedule-handoff' || a.type === 'rejoin') ? 'يجدول' : 'متصل',
    mixer: safe.some(a => a.type === 'gain') ? 'يمزج' : 'متوازن',
    health: safe.some(a => a.type === 'resume-context' || a.type === 'rejoin') ? 'يُصلح' : 'ساهر',
    librarian: safe.some(a => a.type === 'schedule-handoff') ? 'يمهّد' : 'جاهز'
  };

  return { actions: safe, notes, agentState: state };
}
