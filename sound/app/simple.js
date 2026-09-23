/**
 * واجهة بسيطة لمجلس الصوت.
 * ثلاث خطوات: أضف مخرجًا، فعّله، اضغط تشغيل.
 * المحرك نفسه (runtime/hall.js) يعمل كما هو، هذه الطبقة تخفي تعقيده فقط.
 */

import { createSession } from '../runtime/session.js';

const session = createSession();
const $ = (id) => document.getElementById(id);
const rack = $('rack');
let seeking = false;
let lastSig = '';
let lastQueue = '';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function fmt(t) {
  if (!Number.isFinite(t) || t < 0) t = 0;
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
}

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3600);
}

async function guard(work) {
  try {
    await work();
  } catch (err) {
    if (err?.name === 'NotFoundError' || err?.code === 'NO_OUTPUT_PICKER' && !err.message) return;
    toast(session.explain(err));
  }
}

function meta(d) {
  const bits = [];
  if (d.gatt === 'connected') bits.push('بلوتوث متصل');
  if (d.battery != null) bits.push(`بطارية ${d.battery}%`);
  if (d.sinkId) bits.push(d.route);
  else bits.push('لم يُوجَّه إليه مخرج بعد');
  if (d.bindError) bits.push(d.bindError);
  return bits.join(' · ');
}

function card(d) {
  return `<div class="speaker ${d.bound ? 'live' : ''} ${d.muted ? 'off' : ''}" data-key="${esc(d.key)}">
    <div class="head">
      <span class="led"></span>
      <span class="name">${esc(d.name)}</span>
      <button class="mini ${d.muted ? '' : 'on'}" type="button" data-act="mute">${d.muted ? 'مكتوم' : 'يعمل'}</button>
      <button class="mini danger" type="button" data-act="remove">إزالة</button>
    </div>
    <div class="meta">${esc(meta(d))}</div>
    <div class="row">
      <span>المستوى</span>
      <input data-gain type="range" min="0" max="100" value="${Math.round((d.userGain ?? 1) * 100)}" aria-label="مستوى ${esc(d.name)}">
    </div>
    ${d.sinkId ? '' : '<div class="row"><button class="mini" type="button" data-act="pick">اختيار مخرج لهذه السماعة</button></div>'}
  </div>`;
}

function sig(view) {
  return view.devices.map((d) => [
    d.key, d.bound, d.muted, Math.round((d.userGain ?? 1) * 100), d.gatt || '', d.bindError || ''
  ].join('~')).join('|');
}

function render(view) {
  const next = sig(view);
  if (next !== lastSig) {
    lastSig = next;
    rack.innerHTML = view.devices.length
      ? view.devices.map(card).join('')
      : '<div class="empty">لا سماعة بعد. الصوت يخرج من مخرج النظام عند التشغيل مباشرة.</div>';
  }
  const qsig = view.queue.map((q) => q.id + (q.active ? '*' : '')).join(',');
  if (qsig !== lastQueue) {
    lastQueue = qsig;
    $('queue').innerHTML = view.queue.map((q) =>
      `<li><button type="button" data-track="${esc(q.id)}" class="${q.active ? 'active' : ''}">${esc(q.title)}<small>${esc(q.artist)}</small></button></li>`
    ).join('');
  }
}

function paint(view) {
  $('playBtn').classList.toggle('on', view.playing);
  $('playBtn').textContent = view.playing ? 'إيقاف' : 'تشغيل';
  $('title').textContent = view.track?.title || 'مجلس الصوت';
  $('artist').textContent = view.track?.artist || 'ننجاوي';
  $('timeNow').textContent = fmt(view.mediaTime);
  $('timeDur').textContent = fmt(view.duration);
  if (!seeking && view.duration) {
    $('seek').value = String(Math.round((view.mediaTime / view.duration) * 1000));
  }
}

$('playBtn').addEventListener('click', () => guard(async () => {
  const view = session.view();
  if (view.playing) session.pause();
  else {
    await session.play();
    const routed = session.view().devices.filter((d) => d.bound && d.sinkId).length;
    toast(routed > 1
      ? `يعزف الآن على ${routed} مسارات معًا.`
      : 'بدأ التشغيل على مخرج النظام. أضف سماعة لتسمعها معه.');
  }
}));

$('outBtn').addEventListener('click', () => guard(async () => {
  const output = await session.pickOutput();
  await session.addOutputDevice(output);
  toast(`«${output.label}» أُضيف. كرّرها لكل سماعة، أو اضغط «إضافة الباقي تلقائيًا».`);
}));

$('allBtn').addEventListener('click', () => guard(async () => {
  await session.addVisibleOutputs();
  toast('أُضيفت كل المخارج الظاهرة. اكتم ما لا تريد سماعه.');
}));

$('btBtn').addEventListener('click', () => guard(async () => {
  const device = await session.requestBluetooth();
  await session.adoptBluetooth(device);
  toast('تم الربط: الاسم والبطارية. ثم اختر مخرج الصوت نفسه لتسمعه.');
}));

$('fileBtn').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', () => guard(async () => {
  if ($('fileInput').files?.length) await session.addFiles($('fileInput').files);
  $('fileInput').value = '';
}));

rack.addEventListener('click', (event) => guard(async () => {
  const btn = event.target.closest('[data-act]');
  if (!btn) return;
  const key = btn.closest('[data-key]')?.dataset.key;
  if (!key) return;
  if (btn.dataset.act === 'mute') session.setMuted(key, !btn.classList.contains('on'));
  else if (btn.dataset.act === 'remove') session.removeKey(key);
  else if (btn.dataset.act === 'pick') {
    const output = await session.pickOutput();
    await session.addOutputDevice(output, key.startsWith('bt:') ? key : null);
  }
}));

rack.addEventListener('input', (event) => {
  const cardEl = event.target.closest('[data-key]');
  if (!cardEl) return;
  if (event.target.matches('[data-gain]')) {
    session.setGain(cardEl.dataset.key, Number(event.target.value) / 100);
  }
});

$('queue').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-track]');
  if (btn) session.selectTrack(btn.dataset.track);
});

$('seek').addEventListener('pointerdown', () => { seeking = true; });
$('seek').addEventListener('change', () => {
  const view = session.view();
  session.seek((Number($('seek').value) / 1000) * (view.duration || 0));
  seeking = false;
});

$('master').addEventListener('input', () => {
  session.setMaster(Number($('master').value) / 100);
});

document.addEventListener('keydown', (event) => {
  if (event.target.matches('input, textarea') || event.metaKey || event.ctrlKey) return;
  if (event.code === 'Space') {
    event.preventDefault();
    $('playBtn').click();
  }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

session.subscribe((view) => {
  render(view);
  paint(view);
});

session.boot().then(() => {
  const view = session.view();
  $('master').value = String(Math.round(view.master * 100));
  const caps = view.caps;
  const notes = [];
  if (!caps.sinkId) {
    notes.push('هذا المتصفح لا يدعم توجيه الصوت إلى أكثر من مخرج — استخدم Chrome على الحاسوب، أو حمّل تطبيق APK على الهاتف.');
  }
  if (!caps.secure) notes.push('الصفحة في سياق غير آمن: بعض المتصفح يخفي أسماء المخارج. افتحها عبر https أو localhost.');
  if (caps.embedded) notes.push('الأذونات تعمل في نافذة كاملة فقط، لا داخل إطار.');
  $('capsHint').textContent = notes.join(' ');
  $('btBtn').disabled = !caps.bluetooth;
  $('outBtn').disabled = !caps.picker;
  if (!caps.picker) {
    const link = $('apkLink');
    link.textContent = 'تحميل تطبيق APK (الصوت من كل السماعات)';
  }
  render(view);
  paint(view);
  setInterval(() => paint(session.view()), 250);
}).catch((err) => toast(session.explain(err)));
