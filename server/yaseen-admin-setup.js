#!/usr/bin/env node
'use strict';
/* ============================================================
   رحيق — إنشاء/تحديث حساب المدير (يُشغَّل على الخادم فقط)
   ------------------------------------------------------------
   node server/yaseen-admin-setup.js --email admin@raheeq.edu --name "مدير رحيق"
       يسأل عن كلمة السر (أو من المتغير YASEEN_ADMIN_PASSWORD)،
       يخزّنها مشفّرة bcrypt داخل المخزن المشفّر، ويطبع سر تطبيق
       المصادقة (Google Authenticator / Authy) لرمز OTP.
   --env    يطبع القيم كمتغيرات بيئة (للنشر على Vercel) بدل الحفظ المحلي.
   ============================================================ */
const readline = require('readline');
const crypto = require('crypto');
const auth = require('../api/_yaseen/auth');
const { createStore } = require('../api/_yaseen/store');

const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : ''; };
const flag = name => args.indexOf(name) >= 0;

function ask(question, hidden) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = s => { if (s.indexOf(question) >= 0) process.stdout.write(question); };
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer); });
  });
}

(async function main() {
  const email = (arg('--email') || await ask('بريد المدير: ')).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error('بريد غير صالح'); process.exit(1); }
  const name = arg('--name') || 'مدير الأكاديمية';
  const password = process.env.YASEEN_ADMIN_PASSWORD || await ask('كلمة السر (12 حرفًا على الأقل): ', true);
  if (password.length < 12) { console.error('كلمة السر قصيرة: 12 حرفًا على الأقل'); process.exit(1); }

  const passwordHash = auth.hashPassword(password);
  const totpSecret = auth.newTotpSecret();
  if (!auth.hasBcrypt()) console.warn('⚠ مكتبة bcryptjs غير مثبّتة (نفّذ npm install) — استُخدم scrypt بدلًا من bcrypt.');

  if (flag('--env')) {
    console.log('\n# أضف هذه القيم إلى متغيرات البيئة في Vercel (Settings → Environment Variables):');
    console.log('YASEEN_SECRET=' + crypto.randomBytes(32).toString('hex'));
    console.log('YASEEN_ADMIN_EMAIL=' + email);
    console.log('YASEEN_ADMIN_NAME=' + name);
    console.log('YASEEN_ADMIN_PASSWORD_HASH=' + passwordHash);
    console.log('YASEEN_ADMIN_TOTP_SECRET=' + totpSecret);
  } else {
    const store = createStore();
    if (!store.writable) { console.error('التخزين للقراءة فقط — استخدم --env'); process.exit(1); }
    const state = await store.getState();
    state.admin = { email, name, passwordHash, totpSecret };
    state.revoked = Date.now();
    state.logs = [{ at: new Date().toISOString(), admin: name, email, ip: 'cli', action: 'admin-setup' }].concat(state.logs || []);
    await store.saveState(state);
    console.log('\n✓ تم حفظ حساب المدير في المخزن المشفّر: ' + store.location);
  }
  console.log('\nرمز OTP — أضف هذا السر في تطبيق المصادقة (إدخال يدوي، نوع «حسب الوقت»):');
  console.log('  السر:  ' + totpSecret);
  console.log('  الرابط: ' + auth.otpauthUri(email, totpSecret));
  console.log('\nصفحة المدير: /admin-yaseen/  (غير مرتبطة بأي مكان في الموقع)');
})().catch(err => { console.error(err.message); process.exit(1); });
