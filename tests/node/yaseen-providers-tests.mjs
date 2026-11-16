/* ============================================================
 * اختبارات اتصال الذكاء الاصطناعي (xAI Grok / Groq) — بدون إنترنت
 *   node tests/node/yaseen-providers-tests.mjs
 * محاكاة واقعية لردود المزودين (نصوص وأكواد الأخطاء الحقيقية):
 *   - اكتشاف المفتاح من أي اسم متغير + تنظيف اللصق + المزود من البادئة
 *   - الموديلات الحالية فقط أولًا، وتخطي المتقاعدة وموديلات المزود الآخر
 *   - الاكتشاف التلقائي للموديلات المتاحة من GET /models عند تقاعد الكل
 *   - إسقاط المعامل المرفوض فقط (reasoning_effort / JSON mode)
 *   - مفتاح مرفوض / بلا رصيد / ضغط 429 / طلب كبير 413 / مهلة إجمالية
 *   - التشخيص الآمن /api/yaseen-ai-status — والمفتاح لا يظهر أبدًا
 * ============================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const system = require(path.join(ROOT, 'api/_yaseen/yaseen-system.js'));
const ai = require(path.join(ROOT, 'api/_yaseen/ai.js'));
const providers = require(path.join(ROOT, 'api/_yaseen/providers.js'));
const { createHandler } = require(path.join(ROOT, 'api/_yaseen/handler.js'));

let passed = 0, failed = 0;
function ok(cond, name) { if (cond) { passed++; } else { failed++; console.error('  ✗ ' + name); } }
function eq(a, b, name) { ok(a === b, name + ' — got: ' + JSON.stringify(a)); }

const XAI_KEY = 'xai-T3stKey0123456789abcdefABCDEF0123456789abcdefXYZ';
const GSK_KEY = 'gsk_T3stKey0123456789abcdefABCDEF0123456789abcdef';
const CFG = system.defaultConfig();
const ANSWER = { reply: 'أهلًا بيك! أنا رحيق، أقدر أساعدك في التسجيل أو أي سؤال تاني 🌸', expression: 'happy', pointTo: null, handoff: false };

/* رد HTTP شبيه بـ fetch الحقيقي (text + json) */
function resp(status, obj) {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
}
const completion = content => resp(200, { id: 'x', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] });

/* مزود وهمي: chat(model, body, call) يقرر رد كل موديل، و list() لـ GET /models */
function mockProvider({ chat, list }) {
  const calls = [];
  const fn = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    const call = { url, method: (init && init.method) || 'GET', body, auth: init && init.headers && init.headers.Authorization };
    calls.push(call);
    if (/\/models$/.test(url)) return list ? list(call) : resp(404, { error: 'not found' });
    return chat(body.model, body, call);
  };
  fn.calls = calls;
  fn.chatCalls = () => calls.filter(c => c.method === 'POST');
  return fn;
}

const xaiGone = model => resp(404, { code: 'Some requested entity was not found', error: 'The model ' + model + ' does not exist or your team does not have access to it.' });
const groqGone = model => resp(400, { error: { message: 'The model `' + model + '` has been decommissioned and is no longer supported. Please refer to https://console.groq.com/docs/deprecations for a recommendation on which model to use instead.', type: 'invalid_request_error', code: 'model_decommissioned' } });

/* ---------- 1) المفتاح: أي اسم متغير + تنظيف اللصق ---------- */
providers._resetForTests();
ok(ai.enabled({ XAI_API_KEY: XAI_KEY }), 'XAI_API_KEY يفعّل الذكاء الاصطناعي');
ok(ai.enabled({ GROK_API_KEY: XAI_KEY }), 'GROK_API_KEY يفعّل الذكاء الاصطناعي');
ok(ai.enabled({ MY_GROK_SECRET_KEY: XAI_KEY }), 'اسم غير متوقع فيه GROK و KEY يُقرأ');
ok(ai.enabled({ RAHEEQ_AI: XAI_KEY }), 'أي متغير قيمته مفتاح xai- صريح يُقرأ مهما كان اسمه');
ok(ai.enabled({ grok: GSK_KEY }), 'أي متغير قيمته مفتاح gsk_ يُقرأ');
eq(ai.resolveKeys({ XAI_API_KEY: '\u200B "Bearer ' + XAI_KEY + '"\u00A0' })[0], XAI_KEY, 'تُزال المحارف الخفية والتنصيص و Bearer من اللصق');
eq(ai.resolveKeys({ XAI_API_KEY: 'XAI_API_KEY=' + XAI_KEY })[0], XAI_KEY, 'لصق «الاسم=القيمة» كقيمة يُصلَّح تلقائيًا');
eq(ai.resolveKeys({ XAI_API_KEY: XAI_KEY, GROK_API_KEY: XAI_KEY }).length, 1, 'نفس المفتاح في متغيرين لا يتكرر');
eq(ai.resolveKeys({ XAI_API_KEY: XAI_KEY + ',' + GSK_KEY }).length, 2, 'مفتاحان مفصولان بفاصلة');
ok(!ai.enabled({ YASEEN_SECRET: '0123456789abcdef0123456789abcdef', KV_REST_API_TOKEN: 'AYxxASQgYjM2ZTk0ZTgtNmRlNy00' }), 'أسرار أخرى ليست مفتاح ذكاء اصطناعي');
ok(!ai.enabled({ XAI_API_KEY: XAI_KEY, GROQ_AI: 'false' }), 'GROQ_AI=false يطفئ حتى مع وجود المفتاح');

/* ---------- 2) المزود والموديلات الحالية ---------- */
const px = ai.resolveProvider(XAI_KEY, { XAI_API_KEY: XAI_KEY });
eq(px.name, 'xai-grok', 'مفتاح xai- => xAI Grok');
eq(px.url, 'https://api.x.ai/v1/chat/completions', 'نقطة نهاية xAI الصحيحة');
eq(px.models[0], 'grok-4.3', 'أول موديل Grok هو grok-4.3');
eq(ai.resolveProvider(XAI_KEY, { GROQ_API_KEY: XAI_KEY }).name, 'xai-grok', 'مفتاح xai- داخل GROQ_API_KEY يروح لـ xAI برضه');
const pg = ai.resolveProvider(GSK_KEY, {});
eq(pg.name, 'groq', 'مفتاح gsk_ => Groq');
eq(pg.models[0], 'openai/gpt-oss-120b', 'أول موديل Groq هو openai/gpt-oss-120b');
eq(ai.DEFAULT_MODEL, 'openai/gpt-oss-120b', 'DEFAULT_MODEL لم يعد موديلًا متقاعدًا');

const RETIRED_SAMPLE = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'meta-llama/llama-4-scout-17b-16e-instruct', 'grok-2-latest', 'grok-beta', 'grok-2-1212', 'qwen/qwen3-32b'];
Object.keys(providers.PROVIDERS).forEach(name => {
  providers.PROVIDERS[name].defaults.forEach(m => ok(!providers.isRetired(m), 'الموديل الافتراضي ' + m + ' (' + name + ') ليس متقاعدًا'));
});
RETIRED_SAMPLE.forEach(m => ok(providers.isRetired(m), m + ' معروف كمتقاعد'));

const withDeadGroqModel = ai.resolveProvider(XAI_KEY, { XAI_API_KEY: XAI_KEY, GROQ_MODEL: 'llama-3.3-70b-versatile' });
ok(withDeadGroqModel.models.every(m => /^grok/.test(m)), 'GROQ_MODEL=llama القديم لا يُرسل أبدًا لمفتاح xAI');
const groqWithDead = ai.resolveProvider(GSK_KEY, { GROQ_MODEL: 'llama-3.3-70b-versatile' });
eq(groqWithDead.models[0], 'openai/gpt-oss-120b', 'GROQ_MODEL متقاعد => لا يُجرَّب أولًا');
eq(groqWithDead.models[groqWithDead.models.length - 1], 'llama-3.3-70b-versatile', 'والموديل المتقاعد المضبوط يدويًا يُجرَّب في الآخر فقط');
eq(ai.resolveProvider(XAI_KEY, { GROK_MODEL: 'grok-4.7' }).models[0], 'grok-4.7', 'GROK_MODEL حالي مضبوط يدويًا يُحترم');
eq(ai.resolveProvider(XAI_KEY, { GROK_MODEL: 'grok-2-latest' }).models[0], 'grok-4.3', 'GROK_MODEL متقاعد => grok-4.3 أولًا');
eq(ai.resolveProvider(XAI_KEY, { AI_BASE_URL: 'https://api.groq.com/openai/v1' }).url, 'https://api.x.ai/v1/chat/completions', 'رابط Groq المخصص لا يسرّب مفتاح xAI إليه');
const custom = ai.resolveProvider('my-gateway-token-0123456789abcdef', { AI_BASE_URL: 'https://gw.example.com/v1', AI_MODEL: 'my-model' });
ok(custom.name === 'custom' && custom.url === 'https://gw.example.com/v1/chat/completions' && custom.models[0] === 'my-model', 'بوابة مخصصة AI_BASE_URL + AI_MODEL');
const info = ai.providerInfo({ XAI_API_KEY: XAI_KEY });
ok(info.enabled && info.provider === 'xai-grok' && info.model === 'grok-4.3' && info.keySource === 'XAI_API_KEY', 'providerInfo يعرض المزود والموديل واسم المتغير');
ok(JSON.stringify(info).indexOf(XAI_KEY) < 0, 'providerInfo لا يحتوي المفتاح');

/* ---------- 3) شكل الطلب لكل موديل ---------- */
const P = providers.PROVIDERS;
const msgs = [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }];
const b43 = providers.buildPayload(P['xai-grok'], 'grok-4.3', msgs, { json: true });
ok(b43.reasoning_effort === 'none' && b43.response_format && b43.response_format.type === 'json_object' && b43.max_completion_tokens > 0 && b43.temperature === 0.7, 'grok-4.3: بلا تفكير + JSON + max_completion_tokens');
ok(!('top_p' in b43) && !('presence_penalty' in b43) && !('frequency_penalty' in b43) && !('stop' in b43) && !('max_tokens' in b43), 'grok-4.3: بلا معاملات ممنوعة على موديلات التفكير');
eq(providers.buildPayload(P['xai-grok'], 'grok-4.7', msgs, { json: true }).reasoning_effort, 'low', 'grok-4.7: تفكير low (لا يمكن إطفاؤه)');
ok(!('reasoning_effort' in providers.buildPayload(P['xai-grok'], 'grok-4.20-0309-non-reasoning', msgs, { json: true })), 'grok-4.20 non-reasoning بلا reasoning_effort');
const bOss = providers.buildPayload(P.groq, 'openai/gpt-oss-120b', msgs, { json: true });
ok(bOss.reasoning_effort === 'low' && bOss.max_completion_tokens >= 1500, 'gpt-oss: تفكير low وهامش رموز للتفكير');
eq(providers.buildPayload(P['xai-grok'], 'grok-4.5', msgs, { json: true }, { efforts: ['low', 'medium', 'high'] }).reasoning_effort, 'low', 'قدرات الموديل المكتشفة تحدد reasoning_effort');

/* ---------- 4) xAI: نجاح من أول مرة + الهيدر الصحيح ---------- */
providers._resetForTests();
let xstub = mockProvider({ chat: () => completion(JSON.stringify(ANSWER)) });
let out = await ai.askAI({ XAI_API_KEY: XAI_KEY }, { question: 'اهلا مين انت', config: CFG, fetchImpl: xstub });
eq(out.reply, ANSWER.reply, 'رد Grok يصل كاملًا');
eq(out.provider, 'xai-grok', 'المزود xai-grok');
eq(out.model, 'grok-4.3', 'الموديل grok-4.3');
eq(xstub.calls.length, 1, 'نداء واحد فقط عند النجاح');
eq(xstub.calls[0].url, 'https://api.x.ai/v1/chat/completions', 'الطلب راح لـ api.x.ai');
eq(xstub.calls[0].auth, 'Bearer ' + XAI_KEY, 'المفتاح في هيدر Authorization');

/* ---------- 5) موديل غير موجود => التالي، ويُتذكَّر ---------- */
providers._resetForTests();
xstub = mockProvider({ chat: m => (m === 'grok-4.3' ? xaiGone(m) : completion(JSON.stringify(ANSWER))) });
out = await ai.askAI({ XAI_API_KEY: XAI_KEY }, { question: 'سؤال', config: CFG, fetchImpl: xstub });
eq(out.model, 'grok-4.20-0309-non-reasoning', 'grok-4.3 غير متاح => grok-4.20-0309-non-reasoning');
const before = xstub.chatCalls().length;
out = await ai.askAI({ XAI_API_KEY: XAI_KEY }, { question: 'سؤال تاني', config: CFG, fetchImpl: xstub });
eq(xstub.chatCalls().length - before, 1, 'الموديل الميت يُتخطّى في الطلب التالي (نداء واحد)');

/* ---------- 6) كل الموديلات المعروفة متقاعدة => اكتشاف من GET /models ---------- */
providers._resetForTests();
let gstub = mockProvider({
  chat: m => (m === 'acme/new-chat-model' ? completion(JSON.stringify(ANSWER)) : groqGone(m)),
  list: () => resp(200, { object: 'list', data: [
    { id: 'whisper-large-v3', object: 'model', active: true },
    { id: 'openai/gpt-oss-safeguard-20b', object: 'model', active: true },
    { id: 'canopylabs/orpheus-v1-english', object: 'model', active: true },
    { id: 'llama-3.3-70b-versatile', object: 'model', active: true },
    { id: 'acme/new-chat-model', object: 'model', active: true }
  ] })
});
out = await ai.askAI({ GROQ_API_KEY: GSK_KEY }, { question: 'سؤال', config: CFG, fetchImpl: gstub });
eq(out.model, 'acme/new-chat-model', 'الموديل المتاح فعلًا يُكتشف ويُستخدم تلقائيًا');
const triedModels = gstub.chatCalls().map(c => c.body.model);
ok(triedModels.indexOf('whisper-large-v3') < 0 && triedModels.indexOf('openai/gpt-oss-safeguard-20b') < 0 && triedModels.indexOf('canopylabs/orpheus-v1-english') < 0, 'موديلات الصوت والحماية لا تُجرَّب للمحادثة');
ok(triedModels.indexOf('llama-3.3-70b-versatile') < 0, 'الموديل المتقاعد في القائمة لا يُجرَّب');
ok(gstub.calls.some(c => c.url === 'https://api.groq.com/openai/v1/models' && c.method === 'GET'), 'الاكتشاف من https://api.groq.com/openai/v1/models');

/* xAI: قدرات الموديل المكتشفة (reasoning_effort) تُحترم */
providers._resetForTests();
xstub = mockProvider({
  chat: (m, body) => (m === 'grok-5' ? (body.reasoning_effort === 'low' ? completion(JSON.stringify(ANSWER)) : resp(400, { error: 'bad effort' })) : xaiGone(m)),
  list: () => resp(200, { object: 'list', data: [
    { id: 'grok-imagine-image', aliases: [], object: 'model', owned_by: 'xai', image_price: 200000000 },
    { id: 'grok-5', aliases: [], object: 'model', owned_by: 'xai', completion_text_token_price: 30000, capabilities: { reasoning_effort: ['low', 'medium', 'high'], default_reasoning_effort: 'high' } }
  ] })
});
out = await ai.askAI({ XAI_API_KEY: XAI_KEY }, { question: 'سؤال', config: CFG, fetchImpl: xstub });
eq(out.model, 'grok-5', 'موديل Grok جديد يُكتشف تلقائيًا لو اتشالت كل الموديلات المعروفة');
ok(xstub.chatCalls().every(c => c.body.model !== 'grok-imagine-image'), 'موديلات الصور لا تُجرَّب للمحادثة');

/* ---------- 7) معامل مرفوض => يُسقط هو فقط ---------- */
providers._resetForTests();
xstub = mockProvider({
  chat: (m, body) => (body.reasoning_effort ? resp(400, { code: 'Client specified an invalid argument', error: 'Argument not supported on this model: reasoning_effort' }) : completion(JSON.stringify(ANSWER)))
});
out = await ai.askAI({ XAI_API_KEY: XAI_KEY }, { question: 'سؤال', config: CFG, fetchImpl: xstub });
eq(xstub.calls.length, 2, 'reasoning_effort مرفوض => إعادة واحدة');
ok(!xstub.calls[1].body.reasoning_effort && xstub.calls[1].body.response_format && xstub.calls[1].body.response_format.type === 'json_object', 'الإعادة بدون reasoning_effort مع الإبقاء على JSON mode');
eq(out.model, 'grok-4.3', 'نفس الموديل ينجح بعد إسقاط المعامل');

providers._resetForTests();
gstub = mockProvider({
  chat: (m, body) => (body.response_format ? resp(400, { error: { message: "Failed to generate JSON. Please adjust your prompt. See 'failed_generation' for more details.", type: 'invalid_request_error', code: 'json_validate_failed', failed_generation: '...' } }) : completion('شرح كامل ووافي للطالب'))
});
out = await ai.askAI({ GROQ_API_KEY: GSK_KEY }, { question: 'اشرحلي الكسور', config: CFG, fetchImpl: gstub });
ok(gstub.calls.length === 2 && !gstub.calls[1].body.response_format && gstub.calls[1].body.reasoning_effort === 'low', 'json_validate_failed => إعادة بدون JSON مع الإبقاء على reasoning_effort');
eq(out.reply, 'شرح كامل ووافي للطالب', 'الرد النصي يُقبل');

/* ---------- 8) مفتاح مرفوض / بلا رصيد / ضغط / طلب كبير ---------- */
providers._resetForTests();
let warnLines = [];
const origWarn = console.warn;
xstub = mockProvider({ chat: () => resp(400, { code: 'Client specified an invalid argument', error: 'Incorrect API key provided: xa***YZ. You can obtain an API key from https://console.x.ai.' }) });
let err = null;
try { await ai.askAI({ XAI_API_KEY: XAI_KEY }, { question: 'سؤال', config: CFG, fetchImpl: xstub }); } catch (e) { err = e; }
ok(err && err.kind === 'auth', 'مفتاح خطأ => kind=auth — got: ' + (err && err.kind));
eq(xstub.calls.length, 1, 'المفتاح المرفوض لا يُعاد تجريبه مع موديلات أخرى');
ok(err && String(err.detail).indexOf(XAI_KEY) < 0 && String(err.message).indexOf(XAI_KEY) < 0, 'رسالة الخطأ بلا المفتاح');

providers._resetForTests();
const twoKeys = mockProvider({
  chat: (m, body, call) => (call.auth === 'Bearer ' + XAI_KEY
    ? resp(403, { code: 'The caller does not have permission to execute the specified operation', error: "Your newly created team doesn't have any credits yet. You can purchase credits on https://console.x.ai/team/abc." })
    : completion(JSON.stringify(ANSWER)))
});
out = await ai.askAI({ XAI_API_KEY: XAI_KEY + ',' + GSK_KEY }, { question: 'سؤال', config: CFG, fetchImpl: twoKeys });
eq(out.provider, 'groq', 'مفتاح xAI بلا رصيد => المفتاح التالي (Groq) يرد');
eq(twoKeys.calls.filter(c => c.auth === 'Bearer ' + XAI_KEY).length, 1, 'المفتاح بلا رصيد يُجرَّب مرة واحدة فقط');
const againBefore = twoKeys.calls.length;
out = await ai.askAI({ XAI_API_KEY: XAI_KEY + ',' + GSK_KEY }, { question: 'سؤال تاني', config: CFG, fetchImpl: twoKeys });
ok(out.provider === 'groq' && twoKeys.calls.length - againBefore === 1 && twoKeys.calls[againBefore].auth === 'Bearer ' + GSK_KEY, 'المفتاح المرفوض مؤقتًا يتأخر للآخر في الطلب التالي (نداء واحد)');

eq(providers.classify(403, { code: 'x', error: "Your newly created team doesn't have any credits yet." }).kind, 'credits', 'xAI بلا رصيد => credits');
eq(providers.classify(429, { code: 'x', error: 'Your team has either used all available credits or reached its monthly spending limit.' }).kind, 'credits', 'xAI حد الإنفاق => credits');
eq(providers.classify(429, { error: { message: 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199000, Requested 1500. Please try again in 5m. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing', type: 'tokens', code: 'rate_limit_exceeded' } }).kind, 'rate', 'Groq 429 (فيه رابط billing) => rate وليس credits');
eq(providers.classify(413, { error: { message: 'Request too large for model `openai/gpt-oss-120b` ... Upgrade to Dev Tier today at https://console.groq.com/settings/billing', type: 'tokens', code: 'rate_limit_exceeded' } }).kind, 'too-large', 'Groq 413 => too-large');
eq(providers.classify(401, { error: { message: 'Invalid API Key', type: 'invalid_request_error', code: 'invalid_api_key' } }).kind, 'auth', 'Groq 401 => auth');
eq(providers.classify(400, null, '').kind, 'request', '400 بلا تفاصيل => request');
eq(providers.classify(503, { error: 'overloaded' }).kind, 'server', '503 => server');
eq(providers.classify(404, { error: 'The model grok-beta does not exist' }).kind, 'model', '404 => model');
eq(providers.classify(403, { code: 'The caller does not have permission to execute the specified operation', error: 'Team abc does not have access to model grok-4.7' }).kind, 'model', '403 لموديل معين => model (لا يوقف باقي الموديلات)');
eq(providers.classify(403, { code: 'The caller does not have permission to execute the specified operation', error: 'Team abc is blocked' }).kind, 'auth', '403 للحساب كله => auth');
eq(providers.classify(400, { code: 'Client specified an invalid argument', error: 'Invalid reasoning effort none for model grok-4.3' }).kind, 'request', 'قيمة reasoning_effort مرفوضة => request (إسقاط المعامل)');

providers._resetForTests();
gstub = mockProvider({ chat: m => (m === 'openai/gpt-oss-120b' ? resp(429, { error: { message: 'Rate limit reached ... https://console.groq.com/settings/billing', code: 'rate_limit_exceeded' } }) : completion(JSON.stringify(ANSWER))) });
out = await ai.askAI({ GROQ_API_KEY: GSK_KEY }, { question: 'سؤال', config: CFG, fetchImpl: gstub });
eq(out.model, 'openai/gpt-oss-20b', 'ضغط 429 على موديل => الموديل التالي على نفس المفتاح');

providers._resetForTests();
gstub = mockProvider({ chat: (m, body) => (body.messages.length > 2 ? resp(413, { error: { message: 'Request too large for model', code: 'rate_limit_exceeded' } }) : completion(JSON.stringify(ANSWER))) });
out = await ai.askAI({ GROQ_API_KEY: GSK_KEY }, { question: 'سؤال', config: CFG, history: [{ u: 'a', b: 'b' }, { u: 'c', b: 'd' }], fetchImpl: gstub });
ok(out.reply === ANSWER.reply && gstub.calls[1].body.messages.length === 2, 'طلب كبير 413 => إعادة بالبرومبت والسؤال فقط');

/* ---------- 9) المهلة الإجمالية: الخادم يرد قبل مهلة المتصفح ---------- */
providers._resetForTests();
const hang = mockProvider({ chat: () => new Promise(() => {}) });
const t0 = Date.now();
err = null;
try { await ai.askAI({ XAI_API_KEY: XAI_KEY, GROQ_TIMEOUT_MS: '2500' }, { question: 'سؤال', config: CFG, fetchImpl: hang, budgetMs: 4000 }); } catch (e) { err = e; }
const took = Date.now() - t0;
ok(err && err.kind === 'timeout', 'مزود معلّق => kind=timeout — got: ' + (err && err.kind));
ok(took < 5000, 'المحاولات تحترم الميزانية الإجمالية (' + took + 'ms < 5000)');

/* ---------- 10) تحليل المخرجات ---------- */
eq(ai.parseModelOutput('<think>المستخدم بيسأل عن الكسور… هشرح</think>{"reply":"الكسر جزء من الكل","expression":"happy"}').reply, 'الكسر جزء من الكل', 'كتلة <think> تُحذف قبل التحليل');
eq(ai.parseModelOutput('<think>\nreasoning</think>\n\nرد نصي عادي').reply, 'رد نصي عادي', '<think> + نص عادي');
let thrown = false;
try { ai.parseModelOutput('<think>تفكير مقطوع بلا إغلاق'); } catch (e) { thrown = true; }
ok(thrown, 'تفكير مقطوع بلا رد => خطأ (يُجرَّب الموديل التالي) بدل عرض التفكير');
providers._resetForTests();
xstub = mockProvider({ chat: () => resp(200, { choices: [{ message: { role: 'assistant', content: [{ type: 'text', text: JSON.stringify(ANSWER) }] } }] }) });
out = await ai.askAI({ XAI_API_KEY: XAI_KEY }, { question: 'سؤال', config: CFG, fetchImpl: xstub });
eq(out.reply, ANSWER.reply, 'محتوى على شكل أجزاء (array) يُجمع');

/* ---------- 11) المفتاح لا يتسرب في أي رسالة خطأ ---------- */
const leakDetail = providers.sanitizeDetail('bad key ' + XAI_KEY + ' and gsk_abcdefghijklmnop and sk-or-v1-abcdef123456 and xa***YZ', [XAI_KEY]);
ok(leakDetail.indexOf(XAI_KEY) < 0 && leakDetail.indexOf('abcdefghijklmnop') < 0 && leakDetail.indexOf('abcdef123456') < 0 && leakDetail.indexOf('xa***YZ') < 0, 'sanitizeDetail يمحو أي مفتاح أو جزء مقنّع منه');
providers._resetForTests();
const echoKey = mockProvider({ chat: () => resp(500, { error: 'internal error for key ' + XAI_KEY }) });
err = null;
try { await ai.askAI({ XAI_API_KEY: XAI_KEY }, { question: 'سؤال', config: CFG, fetchImpl: echoKey }); } catch (e) { err = e; }
ok(err && JSON.stringify({ m: err.message, d: err.detail }).indexOf(XAI_KEY) < 0, 'حتى لو المزود كرر المفتاح في الخطأ لا يظهر');
ok(JSON.stringify(ai.lastOutcome()).indexOf(XAI_KEY) < 0 && ai.lastOutcome().ok === false, 'آخر نتيجة (للوحة المدير) بلا المفتاح');

/* ---------- 12) التشخيص ---------- */
providers._resetForTests();
let d = await ai.diagnose({}, {});
ok(d.status === 'no-key' && !d.working && /XAI_API_KEY/.test(d.message) && Array.isArray(d.howTo), 'بلا مفتاح => no-key مع خطوات الربط');
d = await ai.diagnose({ XAI_API_KEY: XAI_KEY, GROQ_AI: '0' }, {});
eq(d.status, 'disabled', 'GROQ_AI=0 => disabled');

const healthyXai = mockProvider({
  chat: () => completion('{"reply":"تمام"}'),
  list: () => resp(200, { object: 'list', data: [{ id: 'grok-4.3', object: 'model', owned_by: 'xai' }, { id: 'grok-4.7', object: 'model', owned_by: 'xai' }] })
});
d = await ai.diagnose({ XAI_API_KEY: XAI_KEY }, { fetchImpl: healthyXai });
ok(d.status === 'working' && d.working === true && d.model === 'grok-4.3' && d.keySource === 'XAI_API_KEY' && d.provider === 'xai-grok', 'مفتاح سليم => working + grok-4.3 — got: ' + d.status);
ok(/شغال/.test(d.message), 'رسالة النجاح بالعربي');
ok(JSON.stringify(d).indexOf(XAI_KEY) < 0, 'تقرير التشخيص بلا المفتاح');

providers._resetForTests();
const badKey = mockProvider({
  chat: () => resp(400, { error: 'Incorrect API key provided: xa***YZ.' }),
  list: () => resp(400, { code: 'Client specified an invalid argument', error: 'Incorrect API key provided: xa***YZ. You can obtain an API key from https://console.x.ai.' })
});
d = await ai.diagnose({ XAI_API_KEY: XAI_KEY }, { fetchImpl: badKey });
ok(d.status === 'invalid-key' && /مرفوض/.test(d.message) && /XAI_API_KEY/.test(d.message), 'مفتاح خطأ => invalid-key برسالة واضحة');
eq(badKey.chatCalls().length, 0, 'المفتاح المرفوض في /models لا يحرق محاولات محادثة');

providers._resetForTests();
const noCredit = mockProvider({
  chat: () => resp(403, { error: "Your newly created team doesn't have any credits yet." }),
  list: () => resp(200, { object: 'list', data: [{ id: 'grok-4.3' }] })
});
d = await ai.diagnose({ XAI_API_KEY: XAI_KEY }, { fetchImpl: noCredit });
ok(d.status === 'no-credits' && /رصيد/.test(d.message), 'بلا رصيد => no-credits — got: ' + d.status);

/* ---------- 13) الخادم: /api/yaseen-ai-status + السجلات ---------- */
providers._resetForTests();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaseen-prov-'));
const app = createHandler({ dir, env: { XAI_API_KEY: XAI_KEY }, fetchImpl: healthyXai });
const callsBeforeStatus = healthyXai.calls.length;
let res = await app.handle({ method: 'GET', path: '/api/yaseen-ai-status', headers: {}, ip: '10.1.0.1' });
ok(res.status === 200 && res.body.working === true && res.body.status === 'working' && res.body.model === 'grok-4.3', '/api/yaseen-ai-status => working');
ok(JSON.stringify(res.body).indexOf(XAI_KEY) < 0, 'المسار العام لا يكشف المفتاح');
ok(res.body.keys[0].keyType === 'xai-…' && res.body.keys[0].source === 'XAI_API_KEY', 'يعرض نوع المفتاح واسم المتغير فقط');
ok(!/detail/.test(JSON.stringify(res.body)), 'المسار العام بلا رسائل المزود الخام');
const callsAfterFirst = healthyXai.calls.length;
ok(callsAfterFirst > callsBeforeStatus, 'الفحص الأول يتصل بالمزود فعلًا');
res = await app.handle({ method: 'GET', path: '/api/yaseen', query: { __r: 'ai-status' }, headers: {}, ip: '10.1.0.1' });
ok(res.status === 200 && res.body.cached === true && healthyXai.calls.length === callsAfterFirst, 'الفحص التالي من الكاش (لا يستهلك المفتاح) وعبر ?__r=ai-status');
res = await app.handle({ method: 'POST', path: '/api/yaseen-ai-status', headers: {}, body: {}, ip: '10.1.0.1' });
eq(res.status, 405, 'POST على مسار الحالة => 405');
const appNoKey = createHandler({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'yaseen-prov2-')), env: {} });
res = await appNoKey.handle({ method: 'GET', path: '/api/yaseen-ai-status', headers: {}, ip: '10.1.0.2' });
ok(res.status === 200 && res.body.status === 'no-key' && res.body.working === false, 'بلا مفتاح => no-key');

/* فشل الذكاء الاصطناعي يُكتب في سجل Vercel بسبب واضح وبلا المفتاح — في المحادثة والأزرار السريعة */
providers._resetForTests();
const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'yaseen-prov3-'));
let clock = Date.parse('2026-11-16T10:00:00Z');
const appBad = createHandler({ dir: dir3, env: { XAI_API_KEY: XAI_KEY }, now: () => clock, fetchImpl: badKey });
console.warn = (...a) => { warnLines.push(a.join(' ')); };
try {
  res = await appBad.handle({ method: 'POST', path: '/api/yaseen-chat', headers: {}, ip: '10.1.0.3', body: { message: 'مين اكتشف الجاذبية؟' } });
  ok(/مشكلة في الاتصال/.test(res.body.reply), 'مفتاح مرفوض => اعتذار + واتساب بدل رد مضلل');
  clock += 5000;
  await appBad.handle({ method: 'POST', path: '/api/yaseen-chat', headers: {}, ip: '10.1.0.3', body: { sid: res.body.sid, quickReply: 'upload' } });
} finally {
  console.warn = origWarn;
}
ok(warnLines.some(l => /\(chat\)/.test(l) && /auth/.test(l) && /xai-grok\/grok-4\.3/.test(l) && /XAI_API_KEY/.test(l)), 'سجل المحادثة: نوع الخطأ + المزود/الموديل + اسم المتغير');
ok(warnLines.some(l => /\(quick-reply\)/.test(l)), 'فشل الأزرار السريعة يُسجَّل أيضًا (كان صامتًا)');
ok(warnLines.every(l => l.indexOf(XAI_KEY) < 0), 'السجلات لا تحتوي المفتاح أبدًا');

/* ---------- 14) النشر والتوثيق ---------- */
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
ok((vercel.rewrites || []).some(r => r.source === '/api/yaseen-ai-status' && r.destination === '/api/yaseen?__r=ai-status'), 'vercel.json يوجّه /api/yaseen-ai-status');
ok(vercel.functions && vercel.functions['api/yaseen.js'] && vercel.functions['api/yaseen.js'].maxDuration >= 20, 'مهلة دالة Vercel تكفي ميزانية الذكاء الاصطناعي');
const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
ok(/^XAI_API_KEY=/m.test(envExample), '.env.example يوضح XAI_API_KEY لمفتاح Grok');
ok(!/^\s*GRO[QK]_MODEL\s*=\s*\S/m.test(envExample), '.env.example لا يفرض موديلًا (المتقاعد كان سبب العطل)');
ok(fs.readFileSync(path.join(ROOT, 'admin-yaseen/admin.js'), 'utf8').indexOf("'llama-3.3-70b-versatile'") < 0, 'لوحة المدير لا تعرض موديلًا متقاعدًا كافتراضي');
ok(fs.readFileSync(path.join(ROOT, 'server/serve.py'), 'utf8').indexOf('/api/yaseen-ai-status') >= 0, 'الخادم المحلي يمرّر مسار الحالة');

[dir, dir3].forEach(p => fs.rmSync(p, { recursive: true, force: true }));
console.log('\n  مزودو الذكاء الاصطناعي: ' + passed + ' ناجح، ' + failed + ' فاشل');
process.exit(failed ? 1 : 0);
