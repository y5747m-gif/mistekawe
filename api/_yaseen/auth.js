'use strict';
/* رحيق — المصادقة: bcrypt لكلمة سر المدير + TOTP (رمز OTP) + جلسات موقّعة */
const crypto = require('crypto');

let bcrypt = null;
try { bcrypt = require('bcryptjs'); } catch (e) { bcrypt = null; }

const BCRYPT_COST = 12;
const SCRYPT = { N: 32768, r: 8, p: 1, len: 32, maxmem: 128 * 1024 * 1024 };

function hashPassword(password) {
  const pw = String(password || '');
  if (bcrypt) return bcrypt.hashSync(pw, BCRYPT_COST);
  // بديل قوي عند غياب مكتبة bcryptjs (npm install لم يُنفَّذ)
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(pw, salt, SCRYPT.len, SCRYPT);
  return ['scrypt', SCRYPT.N, salt.toString('base64'), dk.toString('base64')].join('$');
}

function verifyPassword(password, hash) {
  const pw = String(password || '');
  const h = String(hash || '');
  try {
    if (/^\$2[aby]\$/.test(h)) return bcrypt ? bcrypt.compareSync(pw, h) : false;
    if (h.indexOf('scrypt$') === 0) {
      const parts = h.split('$');
      const salt = Buffer.from(parts[2], 'base64');
      const want = Buffer.from(parts[3], 'base64');
      const got = crypto.scryptSync(pw, salt, want.length, Object.assign({}, SCRYPT, { N: parseInt(parts[1], 10) }));
      return crypto.timingSafeEqual(got, want);
    }
  } catch (e) { return false; }
  return false;
}

function hashKind(hash) {
  return /^\$2[aby]\$/.test(String(hash || '')) ? 'bcrypt' : 'scrypt';
}

/* كلمة وهمية لتوحيد زمن الرد عند بريد غير صحيح */
let dummyHash = null;
function burnTime(password) {
  if (!dummyHash) dummyHash = hashPassword(crypto.randomBytes(12).toString('hex'));
  verifyPassword(password, dummyHash);
}

/* ---------------- TOTP (RFC 6238) ---------------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function newTotpSecret() { return base32Encode(crypto.randomBytes(20)); }

function totpAt(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const off = mac[mac.length - 1] & 15;
  const code = ((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(code % 1000000).padStart(6, '0');
}

function totpNow(secret, nowMs) { return totpAt(secret, Math.floor((nowMs || Date.now()) / 30000)); }

/* يعيد رقم النافذة الزمنية المطابقة أو -1 */
function totpVerify(secret, code, nowMs) {
  const given = String(code || '').replace(/\D/g, '');
  if (given.length !== 6 || !secret) return -1;
  const counter = Math.floor((nowMs || Date.now()) / 30000);
  let hit = -1;
  for (let w = -1; w <= 1; w++) {
    const expect = Buffer.from(totpAt(secret, counter + w));
    if (crypto.timingSafeEqual(expect, Buffer.from(given))) hit = counter + w;
  }
  return hit;
}

function otpauthUri(email, secret) {
  return 'otpauth://totp/' + encodeURIComponent('RAHEEQ Yaseen:' + email) + '?secret=' + secret +
    '&issuer=' + encodeURIComponent('RAHEEQ Yaseen') + '&algorithm=SHA1&digits=6&period=30';
}

/* ---------------- رموز جلسة موقّعة (HMAC-SHA256) ---------------- */
function b64u(buf) { return Buffer.from(buf).toString('base64url'); }

function signToken(payload, key) {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', key).update(body).digest('base64url');
  return body + '.' + mac;
}

function readToken(token, key, nowMs) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const want = crypto.createHmac('sha256', key).update(parts[0]).digest();
  let got;
  try { got = Buffer.from(parts[1], 'base64url'); } catch (e) { return null; }
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!payload || typeof payload.exp !== 'number' || payload.exp < (nowMs || Date.now())) return null;
    return payload;
  } catch (e) { return null; }
}

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

module.exports = {
  hasBcrypt: () => !!bcrypt, hashPassword, verifyPassword, hashKind, burnTime,
  newTotpSecret, totpNow, totpVerify, otpauthUri, base32Encode, base32Decode,
  signToken, readToken, safeEqual
};
