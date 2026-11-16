'use strict';
/* ============================================================
   رحيق — مسارات الواجهة (مستقلة عن نوع الخادم)
   ------------------------------------------------------------
   عام (ولي الأمر):
     GET  /api/yaseen-config        الإجابات النهائية فقط (بلا قواعد أو إعدادات)
     POST /api/yaseen-chat          رسالة/زر سريع => رد معتمد
     GET  /api/yaseen-ai-status     هل مفتاح Grok/Groq مربوط وشغال؟ (تشخيص آمن بلا أي جزء من المفتاح)
   المدير فقط (Authorization: Bearer <رمز جلسة>):
     POST /api/yaseen-admin/login   بريد + كلمة سر + رمز OTP
     POST /api/yaseen-admin/logout
     GET  /api/yaseen-admin/config
     POST /api/yaseen-admin/config  حفظ الإعدادات (مع سجل تغييرات)
     POST /api/yaseen-admin/kill    مفتاح الإيقاف الفوري
     GET  /api/yaseen-admin/logs
     POST /api/yaseen-admin/test    تجربة رد رحيق على رسالة
     GET  /api/yaseen-admin/aistatus تشخيص مفصل للذكاء الاصطناعي (مع رسالة خطأ المزود)
   ============================================================ */
const crypto = require('crypto');
const system = require('./yaseen-system');
const ai = require('./ai');
const auth = require('./auth');
const { createStore, MAX_LOGS } = require('./store');

const ADMIN_SESSION_MS = 60 * 60 * 1000;
const LOGIN_WINDOW_SEC = 15 * 60;
const LOGIN_MAX = 8;
const AI_STATUS_CACHE_MS = 60 * 1000;     // فحص حي واحد كل دقيقة على الأكثر لكل نسخة خادم
const AI_STATUS_IP_PER_HOUR = 30;

/* سطر سجل آمن لفشل الذكاء الاصطناعي (يظهر في Vercel ← Logs) — بلا مفتاح */
function logAiFailure(where, err) {
  const e = err || {};
  const parts = ['[yaseen] AI failed (' + where + '), falling back to rules:', e.kind || 'error'];
  if (e.provider || e.model) parts.push((e.provider || '?') + '/' + (e.model || '?'));
  if (e.status) parts.push('http ' + e.status);
  if (e.source) parts.push('key from ' + e.source);
  parts.push('— ' + String(e.detail || e.message || '').slice(0, 200));
  console.warn(parts.join(' '));
}

/* نسخة عامة من التشخيص: بلا رسائل المزود الخام (قد تحتوي معرّفات حساب) */
function publicAiStatus(report) {
  const r = report || {};
  const last = ai.lastOutcome();
  return {
    ok: true,
    status: r.status,
    working: !!r.working,
    message: r.message,
    provider: r.provider || null,
    providerLabel: r.providerLabel || null,
    model: r.model || null,
    keySource: r.keySource || null,
    keyCount: r.keyCount || 0,
    checkedAt: r.checkedAt,
    howTo: r.howTo,
    lastChat: last ? {
      at: last.at,
      ok: !!last.ok,
      provider: last.provider || null,
      model: last.model || null,
      kind: last.kind || null,
      status: last.status || null,
      ms: last.ms || null
    } : null,
    keys: (r.keys || []).map(k => ({
      source: k.source,
      keyType: k.keyType,
      provider: k.provider,
      status: k.status,
      models: k.models,
      modelList: k.modelList ? { ok: k.modelList.ok, kind: k.modelList.kind, status: k.modelList.status, available: k.modelList.available, usable: k.modelList.usable } : undefined,
      chat: k.chat ? { ok: k.chat.ok, kind: k.chat.kind, status: k.chat.status, model: k.chat.model, ms: k.chat.ms } : undefined
    }))
  };
}

function json(status, body, headers) {
  return { status, body, headers: Object.assign({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' }, headers || {}) };
}

function short(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s === undefined ? '' : (s.length > 1500 ? s.slice(0, 1500) + '…' : s);
}

/* فروق الإعدادات: مسار => (قديم، جديد) */
function diffConfig(before, after) {
  const changes = [];
  Object.keys(after).forEach(k => {
    const a = before[k], b = after[k];
    if (b && typeof b === 'object' && !Array.isArray(b)) {
      Object.keys(b).forEach(sub => {
        if (JSON.stringify((a || {})[sub]) !== JSON.stringify(b[sub])) changes.push({ path: k + '.' + sub, old: short((a || {})[sub]), new: short(b[sub]) });
      });
    } else if (Array.isArray(b) && k !== 'blockedWords') {
      const ids = new Set([].concat((a || []).map(x => x.id), b.map(x => x.id)));
      ids.forEach(id => {
        const x = (a || []).find(i => i.id === id), y = b.find(i => i.id === id);
        if (JSON.stringify(x) !== JSON.stringify(y)) changes.push({ path: k + '[' + id + ']', old: short(x === undefined ? '(غير موجود)' : x), new: short(y === undefined ? '(محذوف)' : y) });
      });
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push({ path: k, old: short(a), new: short(b) });
    }
  });
  return changes;
}

function createHandler(options) {
  const store = (options && options.store) || createStore(options);
  const env = (options && options.env) || process.env;
  const fetchImpl = (options && options.fetchImpl) || undefined;
  const now = (options && options.now) || (() => Date.now());
  let memLastOtp = 0;
  let aiStatusCache = null;          // { at, report, pending }

  function effectiveConfig(state) {
    const cfg = state.config;
    return store.envDisabled() ? Object.assign({}, cfg, { enabled: false }) : cfg;
  }
  function adminRecord(state) { return store.envAdmin() || state.admin; }

  async function addLogs(state, entries) {
    if (!store.writable) return;
    state.logs = entries.concat(state.logs).slice(0, MAX_LOGS);
    await store.saveState(state);
  }
  function logEntry(admin, ip, action, change) {
    return Object.assign({ at: new Date(now()).toISOString(), admin: admin ? (admin.name || admin.email) : '—', email: admin ? admin.email : '', ip, action }, change || {});
  }

  /* ---------------- عام: الإعدادات الظاهرة ---------------- */
  async function getPublicConfig() {
    const state = await store.getState();
    const pub = system.publicConfig(effectiveConfig(state), new Date(now()));
    if (pub.enabled) pub.ai = ai.enabled(env);
    return json(200, pub);
  }

  /* ---------------- عام: هل الذكاء الاصطناعي مربوط وشغال؟ ---------------- */
  async function getAiStatus(req) {
    const t = Date.now();
    if (aiStatusCache && aiStatusCache.report && t - aiStatusCache.at < AI_STATUS_CACHE_MS) {
      return json(200, Object.assign(publicAiStatus(aiStatusCache.report), { cached: true }));
    }
    if (await store.hit('aistatus:' + (req.ip || '?'), 3600) > AI_STATUS_IP_PER_HOUR) {
      return json(429, { ok: false, error: 'rate-limited' });
    }
    if (!aiStatusCache || !aiStatusCache.pending) {
      const pending = ai.diagnose(env, { fetchImpl }).then(report => {
        aiStatusCache = { at: Date.now(), report, pending: null };
        return report;
      }, err => {
        aiStatusCache = null;
        throw err;
      });
      aiStatusCache = Object.assign({}, aiStatusCache || {}, { pending });
    }
    const report = await aiStatusCache.pending;
    return json(200, publicAiStatus(report));
  }

  /* ---------------- عام: المحادثة ---------------- */
  async function chat(req) {
    const state = await store.getState();
    const config = effectiveConfig(state);
    if (!config.enabled) return json(200, { ok: false, disabled: true });

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { ok: false, error: 'bad-request' });
    const ip = req.ip || '?';
    const t = now();
    const base = { ok: true, expression: 'happy', action: null, handoff: null };

    if (await store.hit('ip:' + ip, 3600) > system.LIMITS.ipPerHour) {
      return json(429, Object.assign(base, { reply: config.messages.spam, expression: 'worried', rateLimited: true }), { 'Retry-After': '600' });
    }

    const ctxSignKey = ai.contextSigningKey(env, store.secretKey());
    let sid = typeof body.sid === 'string' && /^[a-f0-9]{32}$/.test(body.sid) ? body.sid : '';
    let session = sid ? await store.getSession(sid) : null;
    if (!session) {
      if (await store.hit('new:' + ip, 3600) > system.LIMITS.sessionsPerHour) {
        return json(429, Object.assign(base, { reply: config.messages.spam, expression: 'worried', rateLimited: true }), { 'Retry-After': '600' });
      }
      sid = sid || crypto.randomBytes(16).toString('hex');
      session = { n: 0, times: [], captcha: null };
    }
    /* استرجاع ذاكرة وسجل المحادثة الموقّع (يحفظ الاستمرارية على Vercel Serverless بلا KV) */
    if ((!session.history || !session.history.length) && typeof body.ctxToken === 'string') {
      const unpacked = ai.unpackClientState(body.ctxToken, ctxSignKey);
      if (unpacked) {
        session.history = unpacked.history;
        session.memory = unpacked.memory;
      }
    }
    const save = () => store.setSession(sid, session, system.LIMITS.sessionTtlSec);
    const remaining = () => Math.max(0, system.LIMITS.maxMessages - session.n);
    const send = (extra, status) => json(status || 200, Object.assign(base, {
      sid,
      remaining: remaining(),
      ctxToken: ai.packClientState(session, ctxSignKey)
    }, extra));

    if (!system.isWithinHours(config, new Date(t))) {
      await save();
      return send({ reply: config.messages.offHours, expression: 'thinking', offline: true });
    }
    if (session.n >= system.LIMITS.maxMessages) {
      await save();
      return send({ reply: config.messages.limit, expression: 'worried', locked: true, handoff: { whatsapp: config.handoff.whatsapp } });
    }

    /* CAPTCHA معلّقة: لا تُعالج أي رسالة قبل حلّها */
    if (session.captcha) {
      const ok = session.captcha.exp > t && system.captchaMatches(session.captcha.answer, body.captcha);
      if (ok) {
        session.captcha = null; session.times = [];
        await save();
        return send({ reply: config.messages.captchaOk, expression: 'happy' });
      }
      const c = system.makeCaptcha(n => crypto.randomInt(n));
      session.captcha = { answer: c.answer, exp: t + system.LIMITS.captchaTtlMs };
      await save();
      return send({ reply: body.captcha == null ? config.messages.captcha : config.messages.captchaWrong, expression: 'worried', captcha: { question: c.question } });
    }

    /* سبام: رسائل متلاحقة بسرعة */
    session.times = (session.times || []).filter(x => t - x < system.LIMITS.burstWindowMs);
    const last = session.times[session.times.length - 1] || 0;
    session.times.push(t);
    if (session.times.length > system.LIMITS.burstCount) {
      const c = system.makeCaptcha(n => crypto.randomInt(n));
      session.captcha = { answer: c.answer, exp: t + system.LIMITS.captchaTtlMs };
      await save();
      return send({ reply: config.messages.captcha, expression: 'worried', captcha: { question: c.question } });
    }
    if (last && t - last < system.LIMITS.minGapMs) {
      await save();
      return send({ reply: config.messages.spam, expression: 'worried' });
    }

    session.n += 1;
    let result;
    if (body.file !== undefined || body.files !== undefined || body.attachment !== undefined || body.attachments !== undefined) {
      result = { reply: config.messages.noLinks, expression: 'worried', action: null, handoff: null };
    } else if (typeof body.quickReply === 'string') {
      const QUICK_PROMPTS = {
        problem: 'بص على الخانات في الخطوة اللي أنا واقف فيها دلوقتي وقولي فين المشكلة بالظبط وإزاي أحلها خطوة بخطوة',
        upload: 'عايز أرفع المستندات المطلوبة، إيه الأوراق المطلوبة بالظبط وصيغها وحجمها وإزاي أرفعها؟',
        password: 'نسيت كلمة السر بتاعتي ومش عارف أدخل، أعمل إيه؟',
        human: 'عايز أتواصل مع موظف التسجيل في أكاديمية رحيق على واتساب'
      };
      const baseQuick = system.answerQuick(config, body.quickReply, body.context);
      const qPrompt = QUICK_PROMPTS[body.quickReply];
      if (qPrompt && ai.enabled(env)) {
        try {
          const out = await ai.askAI(env, {
            question: qPrompt,
            context: body.context,
            config,
            history: session.history,
            memory: session.memory,
            fetchImpl
          });
          result = {
            reply: out.reply,
            expression: out.expression,
            action: (out.pointTo ? { type: 'point', field: out.pointTo, step: system.FIELDS[out.pointTo] } : null) || baseQuick.action,
            handoff: (out.handoff || baseQuick.handoff) ? { whatsapp: config.handoff.whatsapp } : null,
            followUps: out.followUps && out.followUps.length ? out.followUps : undefined,
            kind: 'ai'
          };
          ai.pushHistory(session, qPrompt, result.reply, out.remember || null);
        } catch (err) {
          logAiFailure('quick-reply', err);
          result = baseQuick;
        }
      } else {
        result = baseQuick;
      }
    } else if (typeof body.message === 'string') {
      const rawMessage = body.message.slice(0, 2000);
      const base = system.answerText(config, rawMessage, body.context);
      /* أنواع تُحسم قطعيًا بلا نموذج: حظر الكلمات/روابط/طول/فراغ — وإلا الذكاء الاصطناعي يجاوب على أي سؤال */
      const HARD_STOP = { blocked: 1, link: 1, toolong: 1, empty: 1 };
      let remembered = null;
      if (HARD_STOP[base.kind] || !ai.enabled(env)) {
        result = base;
      } else {
        try {
          const out = await ai.askAI(env, {
            question: rawMessage,
            context: body.context,
            config,
            history: session.history,
            memory: session.memory,
            fetchImpl
          });
          remembered = out.remember || null;
          result = {
            reply: out.reply,
            expression: out.expression,
            action: out.pointTo ? { type: 'point', field: out.pointTo, step: system.FIELDS[out.pointTo] } : null,
            handoff: out.handoff ? { whatsapp: config.handoff.whatsapp } : null,
            followUps: out.followUps && out.followUps.length ? out.followUps : undefined,
            kind: 'ai'
          };
        } catch (err) {
          logAiFailure('chat', err);
          /* المحرك القاعدي لا يعرف غير التسجيل — لو كان هيرفض بره التسجيل نقدّم اعتذارًا واضحًا مع تحويل للواتساب */
          result = base.kind === 'offtopic'
            ? { reply: 'حصلت مشكلة في الاتصال بالمساعد الذكي دلوقتي 🙏 حاول تاني كمان شوية. ولو محتاج متابعة خاصة بالتسجيل أو بطلبك كلّم موظف التسجيل على واتساب الأكاديمية من الزر ده.', expression: 'worried', action: null, handoff: { whatsapp: config.handoff.whatsapp }, kind: 'ai-down' }
            : base;
        }
      }
      const NO_HISTORY = { 'ai-down': 1, offtopic: 1, manipulation: 1, blocked: 1, link: 1, toolong: 1, empty: 1 };
      if (!NO_HISTORY[result.kind]) {
        ai.pushHistory(session, rawMessage, result.reply, remembered);
      }
    } else {
      result = { reply: config.messages.empty, expression: 'thinking', action: null, handoff: null };
    }
    await save();
    return send({
      reply: result.reply,
      expression: result.expression,
      action: result.action,
      handoff: result.handoff,
      followUps: result.followUps,
      locked: remaining() === 0
    });
  }

  /* ---------------- المدير ---------------- */
  function bearer(req) {
    const h = String(req.headers.authorization || '');
    return h.indexOf('Bearer ') === 0 ? h.slice(7).trim() : '';
  }

  async function requireAdmin(req, state) {
    const key = store.secretKey();
    if (!key) return null;
    const payload = auth.readToken(bearer(req), key, now());
    if (!payload || payload.t !== 'admin') return null;
    if (state.revoked && payload.iat <= state.revoked) return null;
    const admin = adminRecord(state);
    if (!admin || !auth.safeEqual(admin.email, payload.email)) return null;
    return admin;
  }

  async function login(req) {
    const ip = req.ip || '?';
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (await store.hit('login:' + ip, LOGIN_WINDOW_SEC) > LOGIN_MAX) {
      return json(429, { ok: false, error: 'محاولات كثيرة. انتظر 15 دقيقة ثم حاول مرة أخرى.' }, { 'Retry-After': String(LOGIN_WINDOW_SEC) });
    }
    const state = await store.getState();
    const admin = adminRecord(state);
    const key = store.secretKey();
    if (!admin || !key) {
      return json(503, { ok: false, error: 'لم يتم إعداد حساب المدير على الخادم بعد.' });
    }
    const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
    const password = String(body.password || '').slice(0, 200);
    const emailOk = auth.safeEqual(email, admin.email);
    let passOk = false;
    if (emailOk) passOk = auth.verifyPassword(password, admin.passwordHash); else auth.burnTime(password);
    const counter = auth.totpVerify(admin.totpSecret, body.otp, now());
    const lastOtp = Math.max(state.lastOtp || 0, memLastOtp);
    const otpOk = counter > 0 && counter > lastOtp;        // لا يُقبل نفس الرمز مرتين

    if (!(emailOk && passOk && otpOk)) {
      await addLogs(state, [logEntry({ name: email || '(فارغ)', email }, ip, 'login-failed')]);
      return json(401, { ok: false, error: 'بيانات الدخول أو رمز التحقق غير صحيح.' });
    }
    memLastOtp = counter;
    state.lastOtp = counter;
    await addLogs(state, [logEntry(admin, ip, 'login')]);
    const t = now();
    const token = auth.signToken({ t: 'admin', email: admin.email, iat: t, exp: t + ADMIN_SESSION_MS }, key);
    return json(200, { ok: true, token, expiresInSec: ADMIN_SESSION_MS / 1000, admin: { email: admin.email, name: admin.name } });
  }

  function adminView(state, admin) {
    const pInfo = ai.providerInfo(env);
    return {
      ok: true,
      admin: { email: admin.email, name: admin.name },
      config: state.config,
      envDisabled: store.envDisabled(),
      online: system.isWithinHours(state.config, new Date(now())),
      storage: { kind: store.kind, writable: store.writable },
      passwordHash: auth.hashKind(admin.passwordHash),
      ai: {
        enabled: pInfo.enabled,
        provider: pInfo.provider,
        providerLabel: pInfo.providerLabel || null,
        model: pInfo.model,
        fallbackModels: pInfo.fallbackModels || [],
        keyCount: pInfo.keyCount,
        keySource: pInfo.keySource || null,
        last: ai.lastOutcome()
      },
      locked: { limits: system.LIMITS, fixed: system.FIXED, fields: Object.keys(system.FIELDS), expressions: system.EXPRESSIONS }
    };
  }

  async function admin(req, action) {
    if (action === 'login') {
      if (req.method !== 'POST') return json(405, { ok: false, error: 'method' });
      return login(req);
    }
    const state = await store.getState();
    const who = await requireAdmin(req, state);
    if (!who) return json(401, { ok: false, error: 'سجّل الدخول أولًا.' });
    const ip = req.ip || '?';
    const readOnly = () => json(409, { ok: false, error: 'التخزين للقراءة فقط: اربط قاعدة KV بالمشروع ليتم حفظ التعديلات.' });

    if (action === 'config' && req.method === 'GET') return json(200, adminView(state, who));
    if (action === 'logs' && req.method === 'GET') return json(200, { ok: true, logs: state.logs });
    if (action === 'aistatus') return json(200, { ok: true, status: await ai.diagnose(env, { fetchImpl }) });
    if (req.method !== 'POST') return json(405, { ok: false, error: 'method' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    if (action === 'logout') {
      if (store.writable) { state.revoked = now(); await addLogs(state, [logEntry(who, ip, 'logout')]); }
      return json(200, { ok: true });
    }
    if (action === 'test') {
      let result;
      if (typeof body.quickReply === 'string') {
        result = system.answerQuick(state.config, body.quickReply, body.context);
      } else {
        const rawMsg = String(body.message || '').slice(0, 2000);
        const base = system.answerText(state.config, rawMsg, body.context);
        const HARD_STOP = { blocked: 1, link: 1, toolong: 1, empty: 1 };
        if (body.useAI === true && !HARD_STOP[base.kind] && ai.enabled(env)) {
          try {
            const out = await ai.askAI(env, { question: rawMsg, context: body.context, config: state.config, fetchImpl });
            result = {
              reply: out.reply,
              expression: out.expression,
              action: out.pointTo ? { type: 'point', field: out.pointTo, step: system.FIELDS[out.pointTo] } : null,
              handoff: out.handoff ? { whatsapp: state.config.handoff.whatsapp } : null,
              kind: 'ai (' + (out.provider || 'groq') + ':' + (out.model || '') + ')'
            };
          } catch (err) {
            const e = err || {};
            result = Object.assign({}, base, {
              kind: 'ai-error: ' + (e.kind || 'error') + (e.provider ? ' [' + e.provider + '/' + (e.model || '?') + (e.status ? ' http ' + e.status : '') + ']' : '') +
                (e.detail ? ' — ' + String(e.detail).slice(0, 200) : (e.message && !e.kind ? ' — ' + e.message : ''))
            });
          }
        } else {
          result = base;
        }
      }
      return json(200, { ok: true, result });
    }
    if (action === 'kill') {
      if (!store.writable) return readOnly();
      const enabled = body.enabled === true;
      const old = state.config.enabled;
      state.config = Object.assign({}, state.config, { enabled });
      await addLogs(state, [logEntry(who, ip, enabled ? 'bot-on' : 'kill-switch', { path: 'enabled', old: String(old), new: String(enabled) })]);
      return json(200, adminView(state, who));
    }
    if (action === 'config') {
      if (!store.writable) return readOnly();
      const next = system.validateConfig(body.config);
      const changes = diffConfig(state.config, next);
      if (!changes.length) return json(200, Object.assign(adminView(state, who), { changed: 0 }));
      state.config = next;
      await addLogs(state, changes.map(c => logEntry(who, ip, 'config', c)));
      return json(200, Object.assign(adminView(state, who), { changed: changes.length }));
    }
    return json(404, { ok: false, error: 'not-found' });
  }

  /* ---------------- التوجيه ---------------- */
  async function handle(req) {
    try {
      const q = (req.query && req.query.__r) || '';
      let route = String(q);
      if (!route) {
        const p = String(req.path || '').replace(/\/+$/, '');
        if (p === '/api/yaseen-config') route = 'config';
        else if (p === '/api/yaseen-chat') route = 'chat';
        else if (p === '/api/yaseen-ai-status') route = 'ai-status';
        else if (p.indexOf('/api/yaseen-admin/') === 0) route = 'admin-' + p.slice('/api/yaseen-admin/'.length);
      }
      if (req.method === 'POST' && req.bodyError) return json(req.bodyError === 'too-large' ? 413 : 400, { ok: false, error: req.bodyError });
      if (route === 'config') return req.method === 'GET' ? await getPublicConfig() : json(405, { ok: false, error: 'method' });
      if (route === 'chat') return req.method === 'POST' ? await chat(req) : json(405, { ok: false, error: 'method' });
      if (route === 'ai-status') return req.method === 'GET' ? await getAiStatus(req) : json(405, { ok: false, error: 'method' });
      if (/^admin-[a-z]+$/.test(route)) return await admin(req, route.slice(6));
      return json(404, { ok: false, error: 'not-found' });
    } catch (err) {
      console.error('[yaseen] error:', err && err.message);
      return json(500, { ok: false, error: 'server-error' });
    }
  }

  /* مهايئ Node (http.IncomingMessage / Vercel) */
  async function readBody(req) {
    if (req.method !== 'POST') return {};
    const type = String(req.headers['content-type'] || '').toLowerCase();
    if (type.indexOf('application/json') !== 0) return { bodyError: 'json-only' };   // لا رفع ملفات
    const limit = system.LIMITS.maxBodyBytes * 16;      // إعدادات المدير أكبر من رسالة ولي الأمر
    let raw;
    try {
      if (req.body !== undefined && req.body !== null) raw = req.body;       // Vercel يحلل الجسم مسبقًا
    } catch (e) { return { bodyError: 'bad-json' }; }
    if (raw === undefined) {
      raw = await new Promise((resolve, reject) => {
        const chunks = []; let size = 0;
        req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too-large')); req.destroy(); } else chunks.push(c); });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
      }).catch(e => ({ __err: e.message === 'too-large' ? 'too-large' : 'bad-request' }));
      if (raw && raw.__err) return { bodyError: raw.__err };
    }
    if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
    if (typeof raw === 'string') {
      if (raw.length > limit) return { bodyError: 'too-large' };
      try { raw = JSON.parse(raw); } catch (e) { return { bodyError: 'bad-json' }; }
    }
    return { body: raw };
  }

  async function nodeHandler(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    const query = Object.assign({}, (req.query && typeof req.query === 'object') ? req.query : {});
    url.searchParams.forEach((v, k) => { query[k] = v; });
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const parsed = await readBody(req);
    const isChat = url.pathname === '/api/yaseen-chat' || query.__r === 'chat';
    if (isChat && parsed.body && typeof parsed.body === 'object' && JSON.stringify(parsed.body).length > system.LIMITS.maxBodyBytes) {
      if (typeof parsed.body.ctxToken === 'string' && parsed.body.ctxToken.length > 0) {
        delete parsed.body.ctxToken;
      }
      if (JSON.stringify(parsed.body).length > system.LIMITS.maxBodyBytes) {
        parsed.body = undefined;
        parsed.bodyError = 'too-large';
      }
    }
    const out = await handle({
      method: req.method, path: url.pathname, query, headers: req.headers,
      body: parsed.body, bodyError: parsed.bodyError,
      ip: fwd || (req.socket && req.socket.remoteAddress) || '?'
    });
    const payload = Buffer.from(JSON.stringify(out.body), 'utf8');
    res.statusCode = out.status;
    Object.keys(out.headers).forEach(k => res.setHeader(k, out.headers[k]));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', String(payload.length));
    res.end(payload);
  }

  return { handle, nodeHandler, store };
}

module.exports = { createHandler, diffConfig };
