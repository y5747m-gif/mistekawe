/* ============================================================
 * اختبارات الذكاء الاصطناعي متعدد المزودين والأدوات لرحيق — بدون إنترنت
 *   node tests/node/yaseen-ai-tests.mjs
 * تغطي:
 *   - تفعيل المفتاح من مختلف أسماء متغيرات البيئة (GROQ_API_KEY، GROK_API_KEY،
 *     XAI_API_KEY، AI_API_KEY، OPENROUTER_API_KEY، تعدد المفاتيح، إلخ)
 *   - الاكتشاف التلقائي للمزود والموديلات الاحتياطية عند الفشل/الضغط
 *   - الأدوات الذكية المدمجة (الآلة الحاسبة للطلاب، فحص الاستمارة، الوقت)
 *   - حفظ ذاكرة المحادثة (remember) واستمرارية السياق الموقّع (ctxToken)
 *     عبر استدعاءات Serverless المنفصلة
 *   - اقتراحات المتابعة التفاعلية (followUps)
 *   - تحليل مرن لمخرجات النموذج (JSON أو Markdown JSON أو نص حر)
 *   - مساعدة الطلاب والأسئلة خارج الموقع والرجوع الآمن للقواعد عند الانقطاع
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
const { createHandler } = require(path.join(ROOT, 'api/_yaseen/handler.js'));

let passed = 0, failed = 0;
function ok(cond, name) { if (cond) { passed++; } else { failed++; console.error('  ✗ ' + name); } }
function eq(a, b, name) { ok(a === b, name + ' — got: ' + JSON.stringify(a)); }

const FAKE_KEY = 'gsk_test_0123456789abcdef0123456789abcdef01234567';
const mkEnv = over => Object.assign({ GROQ_API_KEY: FAKE_KEY }, over || {});

/* Groq/Provider وهمي: يسجّل الطلبات ويرد بما يُطلب منه */
function groqStub(payload, status) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: !status || status < 300,
      status: status || 200,
      json: async () => ({ choices: [{ message: { content: typeof payload === 'string' ? payload : JSON.stringify(payload) } }] })
    };
  };
  fn.calls = calls;
  return fn;
}

const AI_ANSWER = {
  reply: 'تمام، اكتب رقم موبايلك 11 رقم بالإنجليزي زي 01012345678، وقولي لو تحب أكمل معاك باقي الخانات!',
  expression: 'happy',
  pointTo: 'mobile',
  handoff: false,
  remember: 'ولي أمر يسجل في الخطوة الأولى',
  followUps: ['إيه الأوراق المطلوبة؟', 'إيه الفرق بين تأسيس ومنهج دراسي؟']
};
const CFG = system.defaultConfig();

/* ---------- 1) التفعيل وتعدد أسماء ومزودي المفاتيح ---------- */
ok(!ai.enabled({}), 'بلا مفتاح => الاصطناعي متوقف');
ok(!ai.enabled({ GROQ_API_KEY: 'قصير' }), 'مفتاح تافه => متوقف');
ok(ai.enabled(mkEnv()), 'مفتاح GROQ_API_KEY صالح => مفعّل');
ok(ai.enabled({ GROK_API_KEY: '  "' + FAKE_KEY + '"  ' }), 'يدعم GROK_API_KEY ويزيل علامات التنصيص والمسافات');
ok(ai.enabled({ AI_API_KEY: 'Bearer ' + FAKE_KEY }), 'يدعم AI_API_KEY ويزيل بادئة Bearer المكررة');
ok(ai.enabled({ XAI_API_KEY: 'xai-0123456789abcdef0123456789abcdef' }), 'يدعم مفتاح xAI Grok');
ok(ai.enabled({ OPENROUTER_API_KEY: 'sk-or-v1-0123456789abcdef0123456789' }), 'يدعم مفتاح OpenRouter متعدد النماذج');
ok(!ai.enabled(mkEnv({ GROQ_AI: '0' })), 'GROQ_AI=0 إطفاء صريح');
ok(!ai.enabled(mkEnv({ GROQ_AI: 'off' })), 'GROQ_AI=off إطفاء صريح');
ok(ai.enabled(mkEnv({ GROQ_AI: '1' })), 'GROQ_AI=1 يبقى مفعّلًا');

eq(ai.resolveProvider(FAKE_KEY, {}).name, 'groq', 'بادئة gsk_ توجه إلى Groq');
eq(ai.resolveProvider('xai-0123456789abcdef0123456789', {}).name, 'xai-grok', 'بادئة xai- توجه إلى xAI Grok');
eq(ai.resolveProvider('sk-or-v1-0123456789abcdef01234', {}).name, 'openrouter', 'بادئة sk-or- توجه إلى OpenRouter');
eq(ai.resolveKeys({ GROQ_API_KEY: FAKE_KEY + ' , gsk_second_0123456789abcdef0123456789' }).length, 2, 'يدعم تعدد المفاتيح المفصولة بفاصلة');

/* ---------- 1ب) الأدوات الذكية المدمجة (الآلة الحاسبة للطلاب + فحص الاستمارة) ---------- */
eq(ai.safeCalc('12 * (5 + 3)').result, 96, 'أداة الحساب الدقيق تحسب الأقواس والضرب');
eq(ai.safeCalc('١٥ ÷ ٣ + ٧').result, 12, 'أداة الحساب تدعم الأرقام العربية وعلامة القسمة');
eq(ai.safeCalc('2 ^ 5').result, 32, 'أداة الحساب تدعم الأسس');
eq(ai.safeCalc('10 / 0'), null, 'القسمة على صفر آمنة ولا تنهار');
const mathDetected = ai.detectMathTool('يا رحيق ساعدني أحسب المسألة دي: (24 + 16) * 3 بكام؟');
eq(mathDetected && mathDetected.result, 120, 'اكتشاف المسألة الحسابية داخل سؤال الطالب تلقائيًا');

/* ---------- 2) بناء البرومبت والذاكرة والأدوات ---------- */
const msgs = ai.buildMessages({
  question: 'رقم الموبايل مش بيتقبل، وكمان عايز أحسب 15 * 4 لابني',
  context: { step: 1, invalid: ['mobile', 'programType'] },
  config: CFG,
  history: [{ u: 'اهلا انا ابو عمر', b: 'اهلا بيك يا ابو عمر' }],
  memory: ['ولي أمر الطالب عمر في الصف الرابع الابتدائي']
});
ok(msgs[0].role === 'system', 'الرسالة الأولى نظام');
ok(msgs[0].content.indexOf('معرفة الموقع') >= 0, 'البرومبت يحتوي معرفة الموقع');
ok(msgs[0].content.indexOf('01012345678') >= 0, 'البرومبت يحتوي أمثلة الموقع الحقيقية');
ok(msgs[0].content.indexOf('201151947735') >= 0, 'البرومبت يحتوي رقم واتساب الأكاديمية');
ok(msgs[0].content.indexOf('mobile') >= 0 && msgs[0].content.indexOf('11 رقم') >= 0, 'خانة الموبايل المتعثرة مع شرحها في البرومبت');
ok(msgs[0].content.indexOf('programType') >= 0, 'خانات نوع البرنامج الجديدة مدعومة في السياق');
ok(msgs[0].content.indexOf('الصف الرابع الابتدائي') >= 0, 'ذاكرة المستخدم المحفوظة تُحقن في البرومبت');
ok(msgs[0].content.indexOf('60') >= 0, 'نتيجة الآلة الحاسبة (15 * 4 = 60) تُحقن كأداة ذكية للنموذج');
ok(msgs.length === 4 && msgs[1].role === 'user' && msgs[2].role === 'assistant' && msgs[3].role === 'user', 'سجل المحادثة يُمرر مع السؤال الحالي');
const bigHistory = Array.from({ length: 20 }, (_, i) => ({ u: 'u' + i, b: 'b' + i }));
eq(ai.buildMessages({ question: 'س', context: {}, config: CFG, history: bigHistory }).length, 26, 'سجل المحادثة يتسع لآخر 12 دورًا (24 رسالة + نظام + سؤال)');
const evilCtx = ai.buildMessages({ question: 'س', context: { step: 99, invalid: ['__proto__', 'constructor', 'evil', 'mobile'] }, config: CFG, history: [] });
ok(evilCtx[0].content.indexOf('__proto__') < 0 && evilCtx[0].content.indexOf('evil') < 0, 'أسماء خانات وهمية لا تدخل البرومبت');

/* ---------- 3) تنظيف الرد وتحليل المخرجات المرن ---------- */
ok(ai.sanitizeReply('زور https://evil.com/x كده').indexOf('http') < 0, 'الروابط تُمحى من رد النموذج');
ok(ai.sanitizeReply('زور www.evil.com كده').indexOf('www.') < 0, 'الروابط بلا بروتوكول تُمحى');
ok(ai.sanitizeReply('عادي [لينك](https://evil.com)').indexOf('](') < 0, 'روابط Markdown تُسطَّح لنص');
ok(ai.sanitizeReply('x'.repeat(3000)).length <= ai.MAX_REPLY_CHARS, 'الرد الواسع يُسمح به حتى الحد الأقصى الآمن');
ok(ai.sanitizeReply('أ\u0007ب\r\n\r\n\r\nج').indexOf('\u0007') < 0, 'محارف التحكم تُمحى');

const plainOut = ai.parseModelOutput('أهلًا يا بطل! الكسر النص يعني ١ على ٢، تحب نحل مثال كمان؟');
ok(plainOut.reply.indexOf('الكسر') >= 0, 'لو رد موديل احتياطي بنص صريح بدون JSON لا يسقط الرد بل يعمل بسلاسة');
const wrappedJsonOut = ai.parseModelOutput('تفضل الرد:\n```json\n{"reply":"إجابة ممتازة","expression":"celebrate","followUps":["سؤال ١"]}\n```');
eq(wrappedJsonOut.reply, 'إجابة ممتازة', 'استخراج JSON المحاط بكلام أو Markdown');
eq(wrappedJsonOut.followUps[0], 'سؤال ١', 'استخراج اقتراحات المتابعة');

/* ---------- 3ب) إخفاء البيانات الشخصية مع الحفاظ على المسائل الدراسية ---------- */
eq(ai.redactPersonal('موبايلي 01012345678 مش شغال').indexOf('01012345678'), -1, 'أرقام الموبايل تُخفى');
eq(ai.redactPersonal('ابعت على 010 1234 5678 ضروري').indexOf('1234'), -1, 'أرقام الموبايل بمسافات تُخفى');
eq(ai.redactPersonal('ايميلي ahmed@example.com مش بيتقبل').indexOf('@'), -1, 'الإيميل يُخفى');
ok(ai.redactPersonal('السنة 1900').indexOf('1900') >= 0, 'السنون تفضل ظاهرة');
ok(ai.redactPersonal('احسبلي 125000 + 34000').indexOf('125000') >= 0, 'الأرقام الحسابية في أسئلة الطلاب لا تُطمس بالخطأ');

/* ---------- 4) askAI + التبديل التلقائي بين الموديلات والمفاتيح ---------- */
const goodStub = groqStub(AI_ANSWER);
const out = await ai.askAI(mkEnv(), { question: 'الموبايل مش بيتقبل', context: { step: 1, invalid: ['mobile'] }, config: CFG, history: [], fetchImpl: goodStub });
eq(out.reply, AI_ANSWER.reply, 'رد النموذج يصل كاملًا');
eq(out.pointTo, 'mobile', 'الخانة المعتمدة تمر');
eq(out.expression, 'point', 'pointTo يفرض وضع الإشارة');
eq(out.remember, 'ولي أمر يسجل في الخطوة الأولى', 'المعلومة المحفوظة تُستخرج');
eq(out.followUps.length, 2, 'اقتراحات المتابعة تُستخرج');
eq(goodStub.calls.length, 1, 'نداء واحد لـ Groq عند النجاح من أول مرة');

/* محاكاة ضغط (429) على الموديل الأول => نجاح تلقائي على الموديل الاحتياطي الثاني */
let attemptCount = 0;
const fallbackStub = async (url, opts) => {
  attemptCount++;
  const reqBody = JSON.parse(opts.body);
  if (attemptCount === 1) {
    return { ok: false, status: 429, json: async () => ({ error: 'rate_limit' }) };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply: 'تم الرد من الموديل الاحتياطي ' + reqBody.model, expression: 'happy' }) } }] })
  };
};
const fbOut = await ai.askAI(mkEnv(), { question: 'اشرحلي نظرية فيثاغورس', config: CFG, fetchImpl: fallbackStub });
eq(attemptCount, 2, 'عند ضغط الموديل الأساسي (429) يتحول فورًا للموديل الاحتياطي');
ok(fbOut.reply.indexOf('الاحتياطي') >= 0, 'رد الموديل الاحتياطي ينجح بدون سقوط للردود الثابتة');

/* محاكاة رفض json_object (400) => إعادة تلقائية بدون response_format */
let jsonModeCalls = 0;
const noJsonModeStub = async (url, opts) => {
  jsonModeCalls++;
  const reqBody = JSON.parse(opts.body);
  if (reqBody.response_format) {
    return { ok: false, status: 400, json: async () => ({ error: 'json_validate_failed' }) };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: 'شرح كامل ووافي للطالب بدون JSON' } }] })
  };
};
const retryOut = await ai.askAI(mkEnv(), { question: 'اشرحلي الفاعل والمفعول به', config: CFG, fetchImpl: noJsonModeStub });
eq(jsonModeCalls, 2, 'يعيد المحاولة بدون response_format عند خطأ 400');
eq(retryOut.reply, 'شرح كامل ووافي للطالب بدون JSON', 'يقبل الرد النصي عند تعذر JSON mode');

/* ---------- 5) الخادم كاملًا + حفظ السياق والذاكرة عبر Serverless (ctxToken) ---------- */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaseen-ai-test-'));
let clock = Date.parse('2026-11-15T10:00:00Z');
const stubAI = groqStub(AI_ANSWER);
const app = createHandler({ dir, env: mkEnv(), now: () => clock, fetchImpl: stubAI });
const post = (p, body, extra) => app.handle(Object.assign({ method: 'POST', path: p, headers: {}, body, ip: '10.0.0.1' }, extra));

const pubCfg = await app.handle({ method: 'GET', path: '/api/yaseen-config', headers: {}, ip: '10.0.0.1' });
eq(pubCfg.body.ai, true, 'الإعدادات العامة تعلن أن الذكاء الاصطناعي مفعّل دون كشف المفتاح');

let res = await post('/api/yaseen-chat', { message: 'رقم الموبايل مش بيتقبل', context: { step: 1, invalid: ['mobile'] } });
eq(res.status, 200, 'المحادثة تعمل مع الذكاء الاصطناعي');
eq(res.body.reply, AI_ANSWER.reply, 'رد الذكاء الاصطناعي يصل للمتصفح');
eq(res.body.ai, true, 'وسم الرد يظهر عند نجاح الموديل');
eq(res.body.action && res.body.action.field, 'mobile', 'التوجيه يشير للخانة المتعثرة');
eq(res.body.followUps && res.body.followUps.length, 2, 'اقتراحات المتابعة تصل للواجهة');
ok(typeof res.body.ctxToken === 'string' && res.body.ctxToken.indexOf('.') > 0, 'رمز السياق الموقّع يُعاد للمتصفح');
const savedCtxToken = res.body.ctxToken;
const sid = res.body.sid;

/* محاكاة استدعاء Serverless جديد بذاكرة خادم فارغة (Vercel cold start) باستخدام ctxToken فقط */
const serverlessStub = groqStub({ reply: 'فاكرك طبعًا! نكمل خطواتك', expression: 'happy' });
const coldVercelApp = createHandler({ env: mkEnv({ VERCEL: '1', YASEEN_SECRET: '0123456789abcdef0123456789abcdef' }), now: () => clock + 5000, fetchImpl: serverlessStub });
const coldAppSameSecret = createHandler({ env: mkEnv({ VERCEL: '1', YASEEN_SECRET: '0123456789abcdef0123456789abcdef' }), now: () => clock, fetchImpl: stubAI });
const r1 = await coldAppSameSecret.handle({ method: 'POST', path: '/api/yaseen-chat', headers: {}, ip: '10.0.0.2', body: { message: 'انا طالب في تالتة اعدادي اسمي زياد' } });
const r2 = await coldVercelApp.handle({ method: 'POST', path: '/api/yaseen-chat', headers: {}, ip: '10.0.0.2', body: { sid: r1.body.sid, ctxToken: r1.body.ctxToken, message: 'فاكر انا في سنة كام؟' } });
eq(r2.status, 200, 'استدعاء Serverless البارد ينجح');
const coldSentMsgs = JSON.parse(serverlessStub.calls[0].opts.body).messages;
ok(coldSentMsgs.some(m => m.role === 'user' && m.content.indexOf('تالتة اعدادي') >= 0), 'السؤال السابق استُعيد عبر ctxToken رغم برودة الخادم');
ok(coldSentMsgs[0].content.indexOf('ولي أمر يسجل في الخطوة الأولى') >= 0, 'الذاكرة المحفوظة (remember) استُعيدت عبر ctxToken الموقّع');

/* التلاعب بـ ctxToken يُرفض بأمان ولا يمر */
const tampered = savedCtxToken.slice(0, -3) + 'xxx';
await coldVercelApp.handle({ method: 'POST', path: '/api/yaseen-chat', headers: {}, ip: '10.0.0.3', body: { ctxToken: tampered, message: 'تجربة' } });
const tamperedMsgs = JSON.parse(serverlessStub.calls[1].opts.body).messages;
eq(tamperedMsgs.length, 2, 'ctxToken المزوّر يُهمل تمامًا ولا يُقبل');

/* الفراغ والطول الزائد (>800) والروابط لا تستدعي النموذج */
const callsBefore = stubAI.calls.length;
clock += 5000;
await post('/api/yaseen-chat', { sid, message: '   ' });
clock += 5000;
await post('/api/yaseen-chat', { sid, message: 'زور https://spam.example/x' });
clock += 5000;
await post('/api/yaseen-chat', { sid, message: 'ا'.repeat(801) });
eq(stubAI.calls.length, callsBefore, 'الفراغ والروابط والطول الزائد تحسمه القواعد');

/* رسالة طالب طويلة (600 حرف مثل مسألة أو قطعة نحو) أصبحت مقبولة وتمر للنموذج! */
clock += 5000;
res = await post('/api/yaseen-chat', { sid, message: 'اشرحلي القطعة دي وأعرب الكلمات: ' + 'العلم نور يضيء طريق الطلاب المجتهدين. '.repeat(12) });
eq(stubAI.calls.length, callsBefore + 1, 'أسئلة الطلاب الطويلة حتى 800 حرف تمر للذكاء الاصطناعي بنجاح');

/* الأزرار السريعة تستخدم GROQ_API_KEY أيضًا للرد الذكي مع الحفاظ على زر واتساب والإشارة */
clock += 5000;
res = await post('/api/yaseen-chat', { sid, quickReply: 'human' });
eq(stubAI.calls.length, callsBefore + 2, 'الأزرار السريعة تمر عبر الذكاء الاصطناعي عند توفر GROQ_API_KEY');
eq(res.body.handoff && res.body.handoff.whatsapp, '201151947735', 'زر الموظف يحتفظ بتحويل واتساب الأكاديمية');

/* ---------- 6) فشل كل الموديلات => رجوع آمن ---------- */
const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'yaseen-aidown-'));
const downFetch = async () => { throw new Error('network down'); };
const appDown = createHandler({ dir: dir2, env: mkEnv(), now: () => clock, fetchImpl: downFetch });
const postDown = (p, body, extra) => appDown.handle(Object.assign({ method: 'POST', path: p, headers: {}, body, ip: '10.0.0.9' }, extra));

res = await postDown('/api/yaseen-chat', { message: 'سؤال غريب محدش يسأله' });
ok(/مشكلة في الاتصال/.test(res.body.reply), 'فشل الشبكة الكامل => اعتذار واضح بدل رد مضلل');
eq(res.body.ai, false, 'الرد الاحتياطي ليس رد الموديل حتى مع مفتاح مُعدّ');
eq(res.body.handoff && res.body.handoff.whatsapp, '201151947735', 'فشل الشبكة => تحويل لواتساب الأكاديمية');

/* بلا مفتاح => سلوك القواعد الاحتياطي */
const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'yaseen-rules-'));
const appRules = createHandler({ dir: dir3, env: {}, now: () => clock });
res = await appRules.handle({ method: 'POST', path: '/api/yaseen-chat', headers: {}, ip: '10.0.0.10', body: { message: 'مين رئيس الوزراء؟' } });
eq(res.body.reply, system.FIXED.offTopic, 'بلا مفتاح => الرد القاعدي الاحتياطي');

/* ---------- 7) انحدارات الإنتاج: ctxToken المضغوط، عدم تسميم السجل، كاش البادئة، وتنسيق Harmony ---------- */
{
  const cryptoMod = await import('crypto');
  const httpMod = await import('http');
  const signKey = ai.contextSigningKey(mkEnv());

  /* أ) 12 جولة عربية طويلة + 8 حقائق ذاكرة لا تتجاوز 4000 حرف ولا تكسر حد maxBodyBytes (كان 15,339 حرفًا => 413) */
  const heavySession = { history: [], memory: [] };
  for (let i = 1; i <= 12; i++) {
    ai.pushHistory(
      heavySession,
      'سؤال الطالب رقم ' + i + ': اشرحلي بالتفصيل درس القصور الذاتي وقوانين نيوتن للحركة مع أمثلة من الحياة اليومية ومسألة محلولة.',
      'شرح وافٍ للدرس رقم ' + i + ': القصور الذاتي هو ميل الجسم للحفاظ على حالته الحركية، وقانون نيوتن الثاني ينص على أن القوة تساوي الكتلة مضروبة في العجلة مع خطوات الحل الكاملة.',
      'حقيقة محفوظة رقم ' + i + ' عن الطالب وصفه الدراسي ومواده المفضلة'
    );
  }
  const packedHeavy = ai.packClientState(heavySession, signKey);
  ok(packedHeavy.startsWith('z1_'), 'رمز السياق الموقّع مضغوط بصيغة z1_');
  ok(packedHeavy.length <= 4000, 'حجم ctxToken بعد محادثة عربية طويلة يبقى <= 4000 حرف (' + packedHeavy.length + ')');
  const fullBodyBytes = Buffer.byteLength(JSON.stringify({
    sid: '0123456789abcdef0123456789abcdef',
    ctxToken: packedHeavy,
    context: { step: 2, invalid: ['programType', 'studentName'] },
    message: 'كمّل شرح المثال التاني لو سمحت'
  }), 'utf8');
  ok(fullBodyBytes < system.LIMITS.maxBodyBytes, 'جسم طلب المحادثة الكامل أصغر بكثير من حد 12KB (' + fullBodyBytes + ' بايت)');
  const unpackedHeavy = ai.unpackClientState(packedHeavy, signKey);
  ok(unpackedHeavy && unpackedHeavy.history.length >= 4 && unpackedHeavy.memory.length === 8, 'فك ضغط ctxToken يستعيد السجل والذاكرة بسلام');

  /* ب) التوافق الرجعي مع الرمز القديم غير المضغوط (<json>.<sig>) */
  const legacyBody = Buffer.from(JSON.stringify({
    v: 1,
    exp: Date.now() + 60000,
    h: [{ u: 'سؤال قديم', b: 'رد قديم سليم' }],
    m: ['طالب في الصف السادس']
  }), 'utf8').toString('base64url');
  const legacySig = cryptoMod.createHmac('sha256', signKey).update(legacyBody).digest('base64url');
  const unpackedLegacy = ai.unpackClientState(legacyBody + '.' + legacySig, signKey);
  ok(unpackedLegacy && unpackedLegacy.history.length === 1 && unpackedLegacy.memory[0] === 'طالب في الصف السادس', 'التوافق مع ctxToken القديم غير المضغوط');

  /* ج) رسائل الاعتذار الاحتياطية عند تعطل الشبكة لا تُخزّن في السجل (منع تسميم المحادثة التالية) */
  let failFirst = true;
  const flakyFetch = async () => {
    if (failFirst) throw new Error('temporary outage');
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          reply: 'أهلًا بيك! الجاذبية اكتشفها إسحاق نيوتن.',
          expression: 'happy', pointTo: null, handoff: false, remember: null, followUps: ['قوانين نيوتن', 'أمثلة']
        }) } }]
      })
    };
  };
  const dirFlaky = fs.mkdtempSync(path.join(os.tmpdir(), 'yaseen-flaky-'));
  let flakyClock = Date.parse('2026-11-16T11:00:00Z');
  let capturedSecondMsgs = null;
  const spyFlakyFetch = async (url, init) => {
    if (!failFirst) capturedSecondMsgs = JSON.parse(init.body).messages;
    return flakyFetch(url, init);
  };
  const appFlaky = createHandler({ dir: dirFlaky, env: mkEnv(), now: () => flakyClock, fetchImpl: spyFlakyFetch });
  const rFail = await appFlaky.handle({ method: 'POST', path: '/api/yaseen-chat', headers: {}, ip: '10.0.0.21', body: { message: 'مين اكتشف الجاذبية؟' } });
  ok(/حصلت مشكلة في الاتصال بالمساعد الذكي/.test(rFail.body.reply), 'الجولة الفاشلة تُرجع رسالة الاعتذار المتوقعة');
  failFirst = false;
  flakyClock += 5000;
  const rRecovered = await appFlaky.handle({
    method: 'POST', path: '/api/yaseen-chat', headers: {}, ip: '10.0.0.21',
    body: { sid: rFail.body.sid, ctxToken: rFail.body.ctxToken, message: 'مين اكتشف الجاذبية؟' }
  });
  ok(/نيوتن/.test(rRecovered.body.reply), 'الجولة التالية تنجح فور عودة الشبكة');
  ok(Array.isArray(capturedSecondMsgs) && capturedSecondMsgs.every(m => !/حصلت مشكلة في الاتصال/.test(m.content)), 'رسالة الفشل السابقة لم تتسرب إلى سجل النموذج');

  /* د) nodeHandler يتعافى تلقائيًا إذا أرسل متصفح قديم ctxToken متضخمًا (>12KB) بدل إرجاع 413 */
  const srv = httpMod.createServer((req, sres) => appFlaky.nodeHandler(req, sres));
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  const port = srv.address().port;
  flakyClock += 5000;
  const bloatedPayload = JSON.stringify({
    sid: rRecovered.body.sid,
    ctxToken: 'x'.repeat(15000),
    context: { step: 1, invalid: [] },
    message: 'سؤال جديد بعد رمز قديم كبير'
  });
  const httpRes = await new Promise((resolve, reject) => {
    const req = httpMod.request({
      hostname: '127.0.0.1', port, path: '/api/yaseen?__r=chat', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bloatedPayload) }
    }, sres => {
      let data = '';
      sres.on('data', c => { data += c; });
      sres.on('end', () => resolve({ status: sres.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.end(bloatedPayload);
  });
  srv.close();
  fs.rmSync(dirFlaky, { recursive: true, force: true });
  eq(httpRes.status, 200, 'nodeHandler يتجاهل ctxToken القديم المتضخم ويعالج الرسالة (200 بدل 413)');
  ok(/نيوتن/.test(httpRes.body.reply), 'الرد الفعلي يصل للمستخدم رغم ctxToken القديم المتضخم');

  /* هـ) بادئة النظام ثابتة 100% لتفعيل كاش البرومبت وحجمها متوافق مع حد 8K TPM */
  const sysA = ai.buildMessages({
    question: 'ما هي عاصمة مصر؟',
    context: { step: 1, invalid: [] },
    config: system.defaultConfig(),
    history: [],
    memory: []
  })[0].content;
  const sysB = ai.buildMessages({
    question: 'اشرحلي الكسور العشرية',
    context: { step: 3, invalid: ['birthCert', 'photo'] },
    config: system.defaultConfig(),
    history: [{ u: 'أهلًا', b: 'أهلًا بيك!' }],
    memory: ['طالب في الصف الخامس']
  })[0].content;
  ok(sysA.slice(0, 4800) === sysB.slice(0, 4800), 'أول 4800+ حرف (99% من رسالة النظام) ثابتة تمامًا بين الطلبات لتفعيل Prompt Caching');
  ok(sysA.length < 5500, 'رسالة النظام رشيقة (<5500 حرف بدل 10,160) لتناسب حد 8,000 TPM في Groq');

  /* و) تنظيف فواصل Harmony في موديلات gpt-oss عند السقوط للوضع النصي */
  const harmonyRaw = '<|channel|>analysis<|message|>Let us think step by step.<|end|><|start|>assistant<|channel|>final<|message|>{"reply":"أهلًا يا بطل!","expression":"happy","pointTo":null,"handoff":false,"remember":null,"followUps":["سؤال ١"]}';
  const harmonyParsed = ai.parseModelOutput(harmonyRaw);
  eq(harmonyParsed.reply, 'أهلًا يا بطل!', 'parseModelOutput يستخلص الرد النهائي من صيغة Harmony في gpt-oss');
}

fs.rmSync(dir, { recursive: true, force: true });
fs.rmSync(dir2, { recursive: true, force: true });
fs.rmSync(dir3, { recursive: true, force: true });

console.log('\n  الذكاء الاصطناعي: ' + passed + ' ناجح، ' + failed + ' فاشل');
process.exit(failed ? 1 : 0);
