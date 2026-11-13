'use strict';
/* ============================================================
   رحيق — التخزين الآمن (على الخادم فقط)
   ------------------------------------------------------------
   الحالة = { config, admin, logs, lastOtp, revoked } تُحفظ ككتلة واحدة
   مشفّرة AES-256-GCM. لا شيء منها يوضع في LocalStorage أو كود الواجهة.

   ثلاث وسائط:
     file   : data/yaseen/store.enc  (الخادم المحلي/الخاص — الافتراضي)
     kv     : Upstash / Vercel KV عبر REST (للنشر على Vercel)
     memory : قراءة فقط من الإعدادات الافتراضية ومتغيرات البيئة
              (Vercel بلا KV — لا يمكن حفظ تعديلات المدير)
   ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const system = require('./yaseen-system');

const MAX_LOGS = 400;

function deriveKey(secret) {
  return crypto.createHash('sha256').update('yaseen-store-v1:' + secret).digest();
}

function encrypt(obj, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return JSON.stringify({ v: 1, alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
}

function decrypt(text, key) {
  const box = JSON.parse(text);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  const data = Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]);
  return JSON.parse(data.toString('utf8'));
}

function emptyState() {
  return { config: system.defaultConfig(), admin: null, logs: [], lastOtp: 0, revoked: 0 };
}

function normalizeState(raw) {
  const st = emptyState();
  if (raw && typeof raw === 'object') {
    // ترقية واحدة للإعدادات القديمة دون الكتابة فوق إجابات المدير.
    const config = raw.config && typeof raw.config === 'object' ? raw.config : {};
    if (config.version !== 3 && Array.isArray(config.answers)) {
      const additions = require('./parent-help').filter(a => config.version !== 2 || a.id === 'help_foundation');
      const ids = new Set(config.answers.map(a => a && a.id));
      st.config = system.validateConfig({ ...config, version: 3,
        answers: config.answers.concat(additions.filter(a => !ids.has(a.id))).slice(0, 120) });
    } else {
      st.config = system.validateConfig(config);
    }
    st.admin = raw.admin && typeof raw.admin === 'object' ? raw.admin : null;
    st.logs = Array.isArray(raw.logs) ? raw.logs.slice(0, MAX_LOGS) : [];
    st.lastOtp = Number(raw.lastOtp) || 0;
    st.revoked = Number(raw.revoked) || 0;
  }
  return st;
}

/* عدّادات وجلسات في الذاكرة (للوسيطين file و memory) */
function memoryCounters() {
  const hits = new Map();
  const sessions = new Map();
  function sweep(map, now) {
    if (map.size < 5000) return;
    for (const [k, v] of map) if (v.exp <= now) map.delete(k);
  }
  return {
    async hit(key, windowSec) {
      const now = Date.now();
      sweep(hits, now);
      const cur = hits.get(key);
      if (!cur || cur.exp <= now) { hits.set(key, { n: 1, exp: now + windowSec * 1000 }); return 1; }
      cur.n += 1;
      return cur.n;
    },
    async getSession(id) {
      const cur = sessions.get(id);
      if (!cur || cur.exp <= Date.now()) { sessions.delete(id); return null; }
      return cur.value;
    },
    async setSession(id, value, ttlSec) {
      sweep(sessions, Date.now());
      sessions.set(id, { value, exp: Date.now() + ttlSec * 1000 });
    }
  };
}

/* ---------------- وسيط الملف المشفّر ---------------- */
function fileStore(dir, envSecret) {
  const file = path.join(dir, 'store.enc');
  const keyFile = path.join(dir, '.key');
  let key = null;
  let cache = null, cacheStamp = '';

  function ensureDir() { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  function getKey() {
    if (key) return key;
    if (envSecret) { key = deriveKey(envSecret); return key; }
    ensureDir();
    if (!fs.existsSync(keyFile)) {
      fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    }
    key = deriveKey(fs.readFileSync(keyFile, 'utf8').trim());
    return key;
  }
  const mem = memoryCounters();
  return Object.assign(mem, {
    kind: 'file', writable: true, location: file,
    secretKey: getKey,
    async getState() {
      let stamp = '';
      try { const s = fs.statSync(file); stamp = s.mtimeMs + ':' + s.size; } catch (e) { stamp = 'none'; }
      if (cache && stamp === cacheStamp) return cache;
      cache = stamp === 'none' ? emptyState() : normalizeState(decrypt(fs.readFileSync(file, 'utf8'), getKey()));
      cacheStamp = stamp;
      return cache;
    },
    async saveState(state) {
      ensureDir();
      const tmp = file + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, encrypt(state, getKey()), { mode: 0o600 });
      fs.renameSync(tmp, file);
      cache = null;
    }
  });
}

/* ---------------- وسيط Upstash / Vercel KV (REST) ---------------- */
function kvStore(url, token, envSecret) {
  const base = url.replace(/\/+$/, '');
  const key = envSecret ? deriveKey(envSecret) : null;
  let cache = null, cacheAt = 0;
  async function cmd(args) {
    const res = await fetch(base, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    if (!res.ok) throw new Error('KV HTTP ' + res.status);
    const body = await res.json();
    if (body.error) throw new Error('KV: ' + body.error);
    return body.result;
  }
  return {
    kind: 'kv', writable: !!key, location: 'kv:yaseen:state',
    secretKey: () => key,
    async getState() {
      if (cache && Date.now() - cacheAt < 5000) return cache;   // مفتاح الإيقاف يسري خلال ثوانٍ
      const raw = await cmd(['GET', 'yaseen:state']);
      cache = raw && key ? normalizeState(decrypt(raw, key)) : emptyState();
      cacheAt = Date.now();
      return cache;
    },
    async saveState(state) {
      if (!key) throw new Error('YASEEN_SECRET مطلوب للحفظ');
      await cmd(['SET', 'yaseen:state', encrypt(state, key)]);
      cache = null;
    },
    async hit(k, windowSec) {
      const n = await cmd(['INCR', 'yaseen:rl:' + k]);
      if (n === 1) await cmd(['EXPIRE', 'yaseen:rl:' + k, String(windowSec)]);
      return n;
    },
    async getSession(id) {
      const raw = await cmd(['GET', 'yaseen:s:' + id]);
      try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
    },
    async setSession(id, value, ttlSec) {
      await cmd(['SET', 'yaseen:s:' + id, JSON.stringify(value), 'EX', String(ttlSec)]);
    }
  };
}

/* ---------------- وسيط الذاكرة (قراءة فقط) ---------------- */
function memoryStore(envSecret) {
  const key = envSecret ? deriveKey(envSecret) : null;
  const state = emptyState();
  return Object.assign(memoryCounters(), {
    kind: 'memory', writable: false, location: 'memory',
    secretKey: () => key,
    async getState() { return state; },
    async saveState() { throw new Error('التخزين للقراءة فقط'); }
  });
}

function defaultDataDir(env) {
  if (env.YASEEN_DATA_DIR) return path.resolve(env.YASEEN_DATA_DIR);
  if (env.RAHEEQ_DATA_DIR) return path.join(path.resolve(env.RAHEEQ_DATA_DIR), 'yaseen');
  return path.resolve(__dirname, '..', '..', 'data', 'yaseen');
}

function createStore(options) {
  const env = (options && options.env) || process.env;
  const secret = env.YASEEN_SECRET && env.YASEEN_SECRET.length >= 16 ? env.YASEEN_SECRET : '';
  const kvUrl = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const kvToken = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  let store;
  if (options && options.dir) store = fileStore(options.dir, secret);
  else if (kvUrl && kvToken) store = kvStore(kvUrl, kvToken, secret);
  else if (env.VERCEL) store = memoryStore(secret);
  else store = fileStore(defaultDataDir(env), secret);

  /* مدير من متغيرات البيئة يتقدّم على المخزَّن (مناسب لـ Vercel) */
  store.envAdmin = function () {
    if (env.YASEEN_ADMIN_EMAIL && env.YASEEN_ADMIN_PASSWORD_HASH && env.YASEEN_ADMIN_TOTP_SECRET) {
      return {
        email: String(env.YASEEN_ADMIN_EMAIL).trim().toLowerCase(),
        name: env.YASEEN_ADMIN_NAME || 'مدير الأكاديمية',
        passwordHash: env.YASEEN_ADMIN_PASSWORD_HASH,
        totpSecret: env.YASEEN_ADMIN_TOTP_SECRET
      };
    }
    return null;
  };
  /* مفتاح إيقاف طارئ من البيئة: YASEEN_ENABLED=0 */
  store.envDisabled = function () { return /^(0|false|off)$/i.test(String(env.YASEEN_ENABLED || '')); };
  return store;
}

module.exports = { createStore, encrypt, decrypt, deriveKey, emptyState, MAX_LOGS };
