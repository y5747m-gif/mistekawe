import { createSession } from '../runtime/session.js';
import { AGENTS } from '../agents/brain.js';

const session = createSession();
const $ = (id) => document.getElementById(id);
const playBtn = $('playBtn');
const seek = $('seek');
const rack = $('rack');
const viz = $('viz');
const stage = $('stage');
let seeking = false;
let lastSig = '';
let lastQueue = '';
let reduce = false;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function fmt(t) {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3400);
}

function sig(view) {
  return view.devices.map(d => [
    d.key, d.bound, d.gatt, d.sinkId || '', d.suggestion?.deviceId || '', d.bindError || '', d.present, d.muted, d.solo
  ].join('~')).join('|');
}

function card(d) {
  const bits = [d.route];
  if (d.gatt === 'connected') bits.push('بلوتوث متصل');
  else if (d.gatt === 'connecting') bits.push('يتصل');
  else if (d.gatt === 'disconnected') bits.push('المراقبة منقطعة');
  if (d.battery != null) bits.push(`بطارية ${d.battery}%`);
  if (d.rssi != null) bits.push(`${d.rssi} dBm`);
  if (d.manufacturer) bits.push(d.manufacturer);
  const drift = d.drift == null ? '—' : `${d.drift > 0 ? '+' : ''}${Math.round(d.drift * 1000)} مللي`;
  const suggestion = d.suggestion
    ? `<button class="mini" type="button" data-act="arm">توجيه الصوت إلى ${esc(d.suggestion.label)}</button>`
    : '';
  const controls = d.sinkId ? `
    <label class="slider"><span>المستوى</span><input data-gain type="range" min="0" max="100" value="${Math.round((d.userGain ?? 1) * 100)}" aria-label="مستوى ${esc(d.name)}"></label>
    <label class="slider"><span>تأخير <b data-trim-read>${d.userTrimMs}</b> مللي</span><input data-trim type="range" min="-200" max="300" value="${d.userTrimMs}" aria-label="تأخير ${esc(d.name)}"></label>
    <div class="row">
      <button type="button" data-act="mute" class="${d.muted ? 'on' : ''}" aria-pressed="${d.muted}">كتم</button>
      <button type="button" data-act="solo" class="${d.solo ? 'on' : ''}" aria-pressed="${d.solo}">منفرد</button>
      <button type="button" data-act="neutral">محايد</button>
      <button type="button" data-act="cal">معايرة</button>
      <button type="button" data-act="remove" class="danger">إزالة</button>
    </div>` : `<button class="mini" type="button" data-act="pick">اختيار مخرج لهذه السماعة</button>`;
  return `<article class="card ${d.bound ? 'live' : ''}" data-key="${esc(d.key)}">
    <header>
      <span class="led" data-led></span>
      <div><h3>${esc(d.name)}</h3><p data-meta>${esc(bits.join(' · '))}</p></div>
      <span class="drift" data-drift>${drift}</span>
    </header>
    <div class="meter"><span data-meter></span></div>
    ${d.bindError ? `<p class="warn">${esc(d.bindError)}</p>` : ''}
    ${d.present === false ? '<p class="warn">هذا المخرج غاب عن النظام. البقية لم تتوقف.</p>' : ''}
    ${suggestion}
    ${controls}
  </article>`;
}

function renderStructure(view) {
  const next = sig(view);
  if (next !== lastSig) {
    lastSig = next;
    rack.innerHTML = view.devices.length
      ? view.devices.map(card).join('')
      : '<div class="empty">لا سماعة بعد. التشغيل يستخدم مخرج النظام، ثم تضيف الباقي دون قطع.</div>';
  }
  const qsig = view.queue.map(q => q.id + (q.active ? '*' : '')).join(',');
  if (qsig !== lastQueue) {
    lastQueue = qsig;
    $('queue').innerHTML = view.queue.map(q =>
      `<li><button type="button" data-track="${esc(q.id)}" class="${q.active ? 'active' : ''}">${esc(q.title)}<br><small>${esc(q.artist)}</small></button></li>`
    ).join('');
  }
  $('agentRow').innerHTML = view.agents.map(agent =>
    `<article class="agent"><b>${esc(agent.name)}</b><small>${esc(agent.role)}</small><em>${esc(agent.state)}</em></article>`
  ).join('');
  $('notes').innerHTML = view.notes.map(note => {
    const name = AGENTS.find(a => a.id === note.agent)?.name || note.agent;
    return `<li><strong>${esc(name)}:</strong> ${esc(note.text)}</li>`;
  }).join('');
  document.querySelectorAll('[data-loop]').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.loop === view.loopMode);
  });
  const caps = view.caps;
  $('pills').innerHTML = [
    pill(caps.bluetooth ? (caps.availability === false ? 'البلوتوث مغلق' : 'بلوتوث الويب') : 'بلا بلوتوث ويب', caps.bluetooth && caps.availability !== false),
    pill(caps.sinkId ? 'توجيه المخارج' : 'مخرج واحد', caps.sinkId),
    pill(caps.secure ? 'سياق آمن' : 'غير آمن', caps.secure)
  ].join('');
  $('embedBar').hidden = !caps.embedded;
  $('btBtn').disabled = !caps.bluetooth;
  $('outBtn').disabled = !caps.picker;
}

function pill(text, on) {
  return `<span class="pill ${on ? 'on' : 'warn'}">${esc(text)}</span>`;
}

function paint(view) {
  playBtn.classList.toggle('is-on', view.playing);
  playBtn.setAttribute('aria-label', view.playing ? 'إيقاف مؤقت' : 'تشغيل');
  $('title').textContent = view.track?.title || 'مجلس الصوت';
  $('artist').textContent = view.track?.artist || 'ننجاوي';
  $('timeNow').textContent = fmt(view.mediaTime);
  $('timeDur').textContent = fmt(view.duration);
  if (!seeking && view.duration) {
    seek.value = String(Math.round((view.mediaTime / view.duration) * 1000));
  }
  const routed = view.devices.filter(d => d.bound && d.sinkId).length;
  $('routeHint').textContent = view.playing
    ? `يعزف الآن على ${routed} ${routed === 1 ? 'مسار' : 'مسارات'} · الوكلاء يراقبون دون قطع`
    : 'اضغط التشغيل ليبدأ الصوت فورًا. أضف سماعة فلا يُعاد تشغيل الأخريات.';
  for (const d of view.devices) {
    const el = [...rack.children].find(node => node.dataset.key === d.key);
    if (!el) continue;
    const meter = el.querySelector('[data-meter]');
    if (meter) meter.style.transform = `scaleX(${Math.min(1, (d.level || 0) * 5)})`;
    const led = el.querySelector('[data-led]');
    if (led) led.style.opacity = String(0.35 + Math.min(0.65, (d.level || 0) * 6));
    const drift = el.querySelector('[data-drift]');
    if (drift && document.activeElement !== el.querySelector('[data-trim]')) {
      drift.textContent = d.drift == null ? '—' : `${d.drift > 0 ? '+' : ''}${Math.round(d.drift * 1000)} مللي`;
    }
  }
  draw(view);
}

function draw(view) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = viz.clientWidth || 320;
  const h = viz.clientHeight || 320;
  if (viz.width !== Math.floor(w * dpr)) {
    viz.width = Math.floor(w * dpr);
    viz.height = Math.floor(h * dpr);
  }
  const ctx = viz.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const energy = view.devices.reduce((sum, d) => sum + (d.level || 0), 0) / Math.max(1, view.devices.length);
  const t = reduce ? 0 : performance.now() / 1000;
  for (let i = 7; i >= 1; i--) {
    const r = 36 + i * (Math.min(w, h) / 18) + (reduce ? 0 : Math.sin(t * 1.3 + i) * 1.5) + energy * 14;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(224, 177, 90, ${0.08 + energy * 0.4})`;
    ctx.lineWidth = i === 2 ? 2.2 : 1;
    ctx.stroke();
  }
  const n = Math.max(view.devices.length, 0);
  view.devices.forEach((d, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const r = Math.min(w, h) * 0.34 + (d.level || 0) * 12;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 4 + (d.level || 0) * 7, 0, Math.PI * 2);
    ctx.fillStyle = d.bound ? '#3ec6c0' : 'rgba(224,177,90,.75)';
    ctx.fill();
  });
}

async function guard(work) {
  try {
    await work();
  } catch (err) {
    if (err?.name === 'NotFoundError') return;
    toast(session.explain(err));
  }
}

playBtn.addEventListener('click', () => guard(async () => {
  const view = session.view();
  if (view.playing) session.pause();
  else await session.play();
}));

$('prevBtn').addEventListener('click', () => session.prev());
$('nextBtn').addEventListener('click', () => session.next());
$('pingBtn').addEventListener('click', () => {
  session.syncPing();
  toast('نقرة على كل المسارات معًا. إن سبق أحدها، حرّك تأخيره.');
});

$('btBtn').addEventListener('click', () => guard(async () => {
  const device = await session.requestBluetooth();
  await session.adoptBluetooth(device);
  toast('تم الربط. اختر مخرج الصوت نفسه لتسمعه مع البقية.');
}));

$('outBtn').addEventListener('click', () => guard(async () => {
  const output = await session.pickOutput();
  await session.addOutputDevice(output);
  toast(`«${output.label}» في المجلس.`);
}));

$('allBtn').addEventListener('click', () => guard(async () => {
  await session.addVisibleOutputs();
  toast('أُضيفت المخارج الظاهرة. اكتم مخرج النظام إن سمعت صدى.');
}));

$('fileBtn').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', () => guard(async () => {
  if ($('fileInput').files?.length) await session.addFiles($('fileInput').files);
  $('fileInput').value = '';
}));

stage.addEventListener('dragover', (event) => {
  event.preventDefault();
  stage.classList.add('drop');
});
stage.addEventListener('dragleave', () => stage.classList.remove('drop'));
stage.addEventListener('drop', (event) => guard(async () => {
  event.preventDefault();
  stage.classList.remove('drop');
  const files = [...(event.dataTransfer?.files || [])].filter(file => file.type.startsWith('audio') || /\.(mp3|wav|ogg|flac|m4a|aac|webm|opus)$/i.test(file.name));
  if (files.length) await session.addFiles(files);
}));

seek.addEventListener('pointerdown', () => { seeking = true; });
seek.addEventListener('pointerup', () => { seeking = false; });
seek.addEventListener('change', () => {
  const view = session.view();
  session.seek((Number(seek.value) / 1000) * (view.duration || 0));
  seeking = false;
});

$('master').addEventListener('input', () => {
  session.setMaster(Number($('master').value) / 100);
});

document.querySelector('.loop').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-loop]');
  if (btn) session.setLoopMode(btn.dataset.loop);
});

rack.addEventListener('click', (event) => guard(async () => {
  const btn = event.target.closest('[data-act]');
  if (!btn) return;
  const key = btn.closest('[data-key]')?.dataset.key;
  if (!key) return;
  if (btn.dataset.act === 'mute') session.setMuted(key, !btn.classList.contains('on'));
  else if (btn.dataset.act === 'solo') session.setSolo(key, !btn.classList.contains('on'));
  else if (btn.dataset.act === 'neutral') session.setNeutral(key);
  else if (btn.dataset.act === 'remove') session.removeKey(key);
  else if (btn.dataset.act === 'cal') {
    toast('أخفض الموسيقى لحظيًا وأقيس النقرة. لن أوقف المسار.');
    await session.calibrate(key);
    toast('انتهت المعايرة.');
  } else if (btn.dataset.act === 'arm') {
    const linkId = key.startsWith('bt:') ? key : session.view().devices.find(d => d.key === key)?.linkId;
    if (linkId) await session.armSuggestion(linkId);
  } else if (btn.dataset.act === 'pick') {
    const output = await session.pickOutput();
    await session.addOutputDevice(output, key.startsWith('bt:') ? key : null);
  }
}));

rack.addEventListener('input', (event) => {
  const cardEl = event.target.closest('[data-key]');
  if (!cardEl) return;
  const key = cardEl.dataset.key;
  if (event.target.matches('[data-gain]')) session.setGain(key, Number(event.target.value) / 100);
  if (event.target.matches('[data-trim]')) {
    session.setTrim(key, Number(event.target.value));
    const read = cardEl.querySelector('[data-trim-read]');
    if (read) read.textContent = event.target.value;
  }
});

$('queue').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-track]');
  if (btn) session.selectTrack(btn.dataset.track);
});

$('menuBtn').addEventListener('click', () => {
  const nav = $('nav');
  const open = nav.classList.toggle('open');
  $('menuBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
});

document.addEventListener('keydown', (event) => {
  if (event.target.matches('input, textarea') || event.metaKey || event.ctrlKey) return;
  if (event.code === 'Space') {
    event.preventDefault();
    playBtn.click();
  } else if (event.key === 'ArrowLeft') session.seek(Math.max(0, session.view().mediaTime - 5));
  else if (event.key === 'ArrowRight') session.seek(session.view().mediaTime + 5);
});

let installEvent = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installEvent = event;
  $('installBtn').hidden = false;
});
$('installBtn').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  $('installBtn').hidden = true;
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
session.subscribe((view) => {
  renderStructure(view);
  paint(view);
});

function loop() {
  const view = session.view();
  paint(view);
  requestAnimationFrame(loop);
}

session.boot().then(() => {
  document.body.dataset.ready = '1';
  const master = Math.round(session.view().master * 100);
  $('master').value = String(master);
  renderStructure(session.view());
  requestAnimationFrame(loop);
}).catch((err) => {
  toast(session.explain(err));
});
