'use strict';
const parentHelp = require('./parent-help');
/* ============================================================
   رحيق YASEEN — نظام البوت المقفول (يعمل على الخادم فقط)
   ------------------------------------------------------------
   هذا الملف هو «تعليمات النظام» لرحيق. لا يُرسل إلى المتصفح أبدًا،
   ولا يستطيع ولي الأمر قراءته أو تغييره. ما يكتبه ولي الأمر يُعامل
   كبيانات فقط: يُنظَّف ثم يُطابَق مع قائمة إجابات معتمدة، ولا يُنفَّذ
   كتعليمات إطلاقًا (لا يوجد نموذج لغوي يمكن خداعه — المحرك قواعد ثابتة).

   مستويان من الإعدادات:
     1) قواعد مقفولة (LOCKED) في هذا الملف: الحدود، الردود الثابتة على
        التلاعب والخروج عن الموضوع، أنماط كشف التلاعب. لا تتغير إلا
        بتعديل الكود ونشره.
     2) محتوى يديره مدير الأكاديمية من /admin-yaseen: الشخصية، الإجابات،
        الحركات، الأصوات، التشغيل/الإيقاف، مواعيد العمل، الكلمات المحظورة.
   ============================================================ */

/* ---------------- 1) قواعد مقفولة ---------------- */
const LIMITS = Object.freeze({
  maxMessages: 20,        // أقصى عدد رسائل في الجلسة
  maxChars: 200,          // أقصى طول للرسالة
  burstCount: 4,          // أكثر من هذا العدد خلال النافذة => CAPTCHA
  burstWindowMs: 10000,
  minGapMs: 700,          // رسالتان أسرع من ذلك => سبام
  ipPerHour: 120,         // رسائل لكل عنوان IP في الساعة
  sessionsPerHour: 12,    // جلسات جديدة لكل عنوان IP في الساعة
  sessionTtlSec: 2 * 60 * 60,
  captchaTtlMs: 5 * 60 * 1000,
  maxBodyBytes: 4096
});

const FIXED = Object.freeze({
  manipulation: 'أنا هنا عشان أساعدك في التسجيل في رحيق بس، تحب أكمل معاك في استمارة ابنك؟',
  offTopic: 'أنا متخصص في التسجيل بس، لو عندك سؤال عن المدرسة أنا معاك'
});

/* الحقول التي يُسمح لرحيق بالإشارة إليها (قائمة بيضاء) */
const FIELDS = Object.freeze({
  parentName: 1, nationalId: 1, relation: 1, mobile: 1, whatsapp: 1, email: 1,
  password: 1, confirmPassword: 1,
  studentName: 2, dob: 2, gender: 2, grade: 2, prevSchool: 2, address: 2, healthNotes: 2,
  birthCert: 3, photo: 3, parentCard: 3, reportCard: 3, agree: 3
});

const EXPRESSIONS = Object.freeze(['happy', 'worried', 'thinking', 'celebrate', 'point', 'wave']);
const QUICK_IDS = Object.freeze(['problem', 'upload', 'password', 'human']);

/* ---------------- تنظيف وتطبيع النص ---------------- */
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;
const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;      // محارف خفية تُستخدم لتمويه الكلمات

function sanitize(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw;
  try { s = s.normalize('NFKC'); } catch (e) { /* يبقى كما هو */ }
  return s.replace(INVISIBLE, '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
}

function normalize(text) {
  return sanitize(text)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')                  // التشكيل والتطويل
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/(.)\1{2,}/g, '$1')                                   // «انسسسسى» => «انسى»
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokens(norm) {
  const out = [];
  norm.split(' ').forEach(t => {
    if (!t) return;
    out.push(t);
    const bare = t.replace(/^(?:و|ف|ب|ل|لل)?ال/, '');
    if (bare !== t && bare.length >= 2) out.push(bare);
  });
  return out;
}

/* تطابق كلمة مفتاحية: العبارات بالاحتواء، والكلمات المفردة بالتطابق أو البادئة (4 أحرف+) */
function hasKeyword(norm, toks, keyword) {
  const kw = normalize(keyword);
  if (!kw) return false;
  if (kw.indexOf(' ') >= 0) return (' ' + norm + ' ').indexOf(' ' + kw + ' ') >= 0 || norm.indexOf(kw) >= 0;
  return toks.some(t => t === kw || (kw.length >= 4 && t.indexOf(kw) === 0));
}

const LINK_RE = /(https?:\/\/|ftp:\/\/|www\.|<\s*a\b|href\s*=|\b[a-z0-9-]{2,}\.(?:com|net|org|io|me|co|eg|ly|info|xyz|app|dev|ru|cn|site|online|link|gg|tv)\b(?!\s*@))/i;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/gi;

function containsLink(text) {
  return LINK_RE.test(String(text || '').replace(EMAIL_RE, ' '));
}

/* ---------------- كشف التلاعب / حقن التعليمات ---------------- */
const RAW_INJECTION = /(<\|.*?\|>|\[\s*\/?\s*(?:system|inst|assistant)\s*\]|^\s*(?:system|assistant|developer)\s*:|###\s*(?:system|instruction)|<\/?\s*(?:system|script|prompt)\b|\{\{.*\}\})/im;

const MANIPULATION = [
  /(^| )(انس|انسي|انسا|تنسي|تنسا|امسح|الغي|سيبك من)( |$).*(تعليمات|قواعد|قوانين|برمج|اللي فات|اللي قبل|كل حاجه|كل شي|دورك)/,
  /(^| )(انس|انسي) (كل|اي) /,
  /(^| )(ا?تجاهل|تتجاهل|تجاهلي|اهمل|طنش|متلتزمش|ماتلتزمش|خالف|اكسر|تخطي|تجاوز)( |$)/,
  /(^| )(غير|غيري|بدل|بدلي|عدل|عدلي) (ال)?(شخصيت|اسم|صوت|طريقت|اسلوب|لهجت|ردود|اجابات|تعليمات|قواعد|برمجت|دور)/,
  /(^| )(انت|انتي) (دلوقتي|دلوقت|الان|من النهارده|بقيت|بقيتي|مبقتش) /,
  /(^| )(انت|انتي) (حر|حره|مش بوت|مش مساعد|انسان)( |$)/,
  /(^| )من (دلوقتي|الان|هنا ورايح) /,
  /^(قول|قولي|قولو|قل) (?!(ازاي|ايه|فين|امتي|كام|ليه|هل|اعمل|اسجل|ارفع|اكتب|منين|انهي|عن|لي|المطلوب)( |$))/,
  /^(قول|قولي|قل|ردد|رددي|كرر|كرري)$/,
  /^(ردد|رددي|كرر|كرري) /,
  /(^| )(قول|قولي|ردد|كرر) (ورايا|بعدي|كذا|الكلام|الجمله)/,
  /(^| )(اعمل|اعملي|خليك|خليكي) (نفسك|زي|كانك)( |$)/,
  /(^| )(تظاهر|تظاهري|تخيل|تخيلي|مثل|مثلي|العب|العبي|تقمص|اتقمص|اتقمصي) .*(انك|دور|شخصيه)/,
  /(^| )(اعرض|اعرضي|وريني|اطبع|اكتب|هات|قولي|ايه|اديني) .*(تعليماتك|التعليمات|برومبت|الاعدادات|قواعدك|الكود بتاعك|السيستم|برمجتك|البرمجه بتاعتك)/,
  /(^| )(هعلمك|اعلمك|علمتك|اتعلم مني|احفظ الكلام|احفظي الكلام|خليك فاكر|افتكر ان)/,
  /(بدون|من غير|بلا) (قيود|قواعد|حدود|فلتر|رقابه)/,
  /(وضع|مود) (المطور|الادمن|المدير|الحر)/,
  /(^| )انا (المدير|الادمن|المطور|صاحب الموقع|المبرمج)( |$)/,
  /(system|hidden|secret|initial) ?(prompt|message|instruction)/,
  /(^| )(prompt|jailbreak|dan|sudo|override|bypass|roleplay|uncensored|unfiltered)( |$)/,
  /(developer|admin|god|debug) mode/,
  /(ignore|forget|disregard|skip|drop) (all |any |the |your |my |previous |prior |above )+/,
  /(^| )(act|behave|pretend|respond|answer) (as|like) /,
  /(you are|you re|youre) (now|free|no longer|not)/,
  /(new|change your|reveal your|show your|print your|repeat your) (instructions|rules|persona|personality|prompt|name)/,
  /(^| )(say|repeat|print|write|output) (after me|exactly|the following|this)/
];

function isManipulation(raw, norm) {
  if (RAW_INJECTION.test(raw)) return true;
  return MANIPULATION.some(re => re.test(norm));
}

/* ---------------- مواضيع خارج التسجيل (حظر مقفول) ---------------- */
const OFF_TOPIC = [
  // سياسة
  'سياسه', 'سياسي', 'انتخابات', 'رييس', 'حكومه', 'حزب', 'برلمان', 'حرب', 'مظاهره', 'ثوره', 'politics', 'election', 'president',
  // دين وجدل مذهبي
  'فتوي', 'حلال', 'حرام', 'مذهب', 'شيعه', 'سنه وشيعه', 'ملحد', 'تكفير', 'religion',
  // نكت وتسلية
  'نكته', 'نكت', 'ضحكني', 'اضحك', 'هزار', 'فزوره', 'لغز', 'غنيلي', 'اغنيه', 'قصيده', 'شعر', 'joke', 'poem', 'song',
  // برمجة
  'كود', 'برمجه', 'بايثون', 'جافاسكربت', 'python', 'javascript', 'html', 'css', 'sql', 'code', 'script', 'هاك', 'اختراق', 'hack',
  // أسئلة شخصية
  'بتحبني', 'بحبك', 'تتجوزيني', 'حبيبتي', 'عمرك كام', 'ساكنه فين', 'رقمك', 'صورتك', 'شكلك',
  // عام
  'كوره', 'ماتش', 'الاهلي', 'الزمالك', 'فيلم', 'مسلسل', 'طقس', 'بورصه', 'دولار', 'بيتكوين', 'ترجم', 'ترجملي', 'واجب', 'حل المساله'
];

/* ---------------- 2) الإعدادات الافتراضية التي يديرها المدير ---------------- */
function defaultConfig() {
  return {
    version: 3,
    enabled: true,
    name: 'رحيق',
    personality: {
      greeting: 'أهلًا بيك في أكاديمية رحيق 👋 أنا رحيق، هساعدك تسجّل ابنك خطوة بخطوة.',
      chatIntro: 'اسألني عن أي حاجة في التسجيل، أو اختار من الأزرار 👇'
    },
    messages: {
      stuck: 'تحب أساعدك في الخطوة دي؟',
      fieldFixed: 'تمام كده 👌',
      allGood: 'كل بيانات الخطوة دي تمام ✅ دوس «التالي» وكمّل.',
      success: 'مبروك! 🎉 طلب التسجيل اتبعت بنجاح، احتفظ برقم الطلب.',
      limit: 'وصلنا لأقصى عدد رسائل في المحادثة دي. لو لسه محتاج مساعدة كلّم موظف التسجيل على واتساب الأكاديمية.',
      tooLong: 'الرسالة طويلة شوية 🙏 اكتب سؤالك في 200 حرف أو أقل.',
      noLinks: 'مش بقدر أفتح روابط أو ملفات. اكتب سؤالك عن التسجيل بالكلام وأنا معاك.',
      spam: 'واحدة واحدة عليّا 😊 استنى ثواني وابعت سؤالك تاني.',
      captcha: 'عشان أتأكد إنك مش برنامج آلي، حل المسألة البسيطة دي:',
      captchaWrong: 'الإجابة مش مظبوطة، جرّب المسألة دي:',
      captchaOk: 'تمام ✅ اتفضل اكتب سؤالك عن التسجيل.',
      offHours: 'أنا متاح في مواعيد العمل بس. تقدر تكمّل الاستمارة عادي، ولو محتاج حاجة كلّم الأكاديمية على واتساب.',
      empty: 'اكتب سؤالك عن التسجيل وأنا معاك.'
    },
    steps: {
      1: 'الخطوة 1: بيانات ولي الأمر. ابدأ بالاسم الرباعي والرقم القومي.',
      2: 'الخطوة 2: بيانات الطالب. اكتب اسم ابنك وتاريخ ميلاده والصف.',
      3: 'الخطوة 3: المستندات. ارفع شهادة الميلاد وصورة الطالب وبطاقة ولي الأمر.'
    },
    guide: {
      parentName: 'اكتب اسمك رباعي: 4 أسماء على الأقل.',
      nationalId: 'الرقم القومي لازم 14 رقم بالظبط.',
      relation: 'اختار صلة القرابة بالطالب.',
      mobile: 'اكتب رقم الموبايل 11 رقمًا وراجع الأرقام الناقصة أو الزائدة.',
      whatsapp: 'رقم الواتساب لازم 11 رقم، أو سيبه فاضي لو هو نفس الموبايل.',
      email: 'اكتب البريد بدون مسافات، مع علامة @ واحدة وبينها نص قبلها وبعدها.',
      password: 'كلمة السر لازم 6 حروف أو أرقام على الأقل.',
      confirmPassword: 'اكتب نفس كلمة السر مرة تانية بالظبط.',
      studentName: 'اكتب اسم الطالب رباعي: 4 أسماء على الأقل.',
      dob: 'اختار تاريخ ميلاد صحيح للطالب، بعد سنة 1900 وليس في المستقبل.',
      gender: 'اختار نوع الطالب.',
      grade: 'اختار الصف الدراسي المطلوب.',
      prevSchool: 'اسم المدرسة السابقة اختياري.',
      address: 'اكتب عنوانًا من 5 أحرف على الأقل، مثل المحافظة والمدينة والشارع.',
      healthNotes: 'لو فيه ملاحظات صحية اكتبها هنا، وده اختياري.',
      birthCert: 'ارفع صورة واضحة لشهادة الميلاد من هنا.',
      photo: 'ارفع صورة شخصية حديثة للطالب من هنا.',
      parentCard: 'ارفع صورة بطاقة الرقم القومي لولي الأمر من هنا.',
      reportCard: 'آخر شهادة دراسية اختيارية، ارفعها لو موجودة.',
      agree: 'علّم على الموافقة على الشروط والأحكام عشان تقدر تبعت الطلب.'
    },
    quickReplies: [
      { id: 'problem', label: 'فين المشكلة؟', reply: '' },
      { id: 'upload', label: 'عايز أرفع مستند', reply: 'المستندات في الخطوة 3: شهادة الميلاد، صورة الطالب، وبطاقة ولي الأمر. دوس على المربع واختار الصورة (JPG أو PNG أو PDF).', pointTo: 'birthCert', expression: 'point' },
      { id: 'password', label: 'نسيت كلمة السر', reply: 'لو نسيت كلمة السر كلّم موظف التسجيل على واتساب الأكاديمية وهيساعدك تدخل حسابك. ما تبعتش كلمة السر في المحادثة.', expression: 'thinking', handoff: true },
      { id: 'human', label: 'عايز أكلم موظف', reply: 'حاضر 🤝 تقدر تكلّم موظف التسجيل مباشرة على واتساب أكاديمية رحيق من الزر ده.', expression: 'happy', handoff: true }
    ],
    answers: [
      { id: 'greeting', keywords: ['اهلا', 'مرحبا', 'السلام عليكم', 'سلام', 'هاي', 'صباح الخير', 'مساء الخير', 'ازيك', 'hello', 'hi'], reply: 'أهلًا بيك 👋 أنا رحيق، مساعد التسجيل في رحيق. محتاج مساعدة في أنهي خطوة؟', expression: 'wave' },
      { id: 'thanks', keywords: ['شكرا', 'متشكر', 'تسلم', 'تسلمي', 'thanks'], reply: 'العفو 🌷 لو احتجت أي حاجة في التسجيل أنا معاك.', expression: 'happy' },
      { id: 'steps', keywords: ['ازاي اسجل', 'اسجل ازاي', 'طريقه التسجيل', 'خطوات', 'اسجل ابني', 'اسجل بنتي', 'التسجيل ازاي', 'ابدا منين', 'التقديم'], reply: 'التسجيل 3 خطوات: 1) بيانات ولي الأمر، 2) بيانات الطالب، 3) المستندات. بعد كده تدوس «إرسال طلب التسجيل» وتاخد رقم الطلب.', expression: 'happy' },
      { id: 'nationalId', keywords: ['الرقم القومي', 'رقم قومي', 'البطاقه', 'القومي'], reply: 'الرقم القومي لازم 14 رقم بالظبط، زي ما هو مكتوب في البطاقة ومن غير مسافات.', pointTo: 'nationalId', expression: 'point' },
      { id: 'parentName', keywords: ['الاسم رباعي', 'اسم رباعي', 'اسمي', 'اسم ولي الامر', 'رباعي', 'خانه الاسم'], reply: 'اكتب الاسم رباعي: 4 أسماء على الأقل، زي «محمد أحمد علي حسن».', pointTo: 'parentName', expression: 'point' },
      { id: 'mobile', keywords: ['رقم الموبايل', 'الموبايل', 'رقم التليفون', 'التليفون', 'واتساب', 'رقم الواتس'], reply: 'رقم الموبايل لازم 11 رقم. ولو الواتساب رقم مختلف اكتبه في خانته، أو سيبه فاضي.', pointTo: 'mobile', expression: 'point' },
      { id: 'email', keywords: ['الايميل', 'ايميل', 'البريد', 'بريد الكتروني', 'email'], reply: 'اكتب بريدك الإلكتروني كامل وفيه علامة @، زي name@example.com.', pointTo: 'email', expression: 'point' },
      { id: 'passwordRule', keywords: ['كلمه السر', 'كلمه المرور', 'الباسورد', 'باسورد', 'password'], reply: 'كلمة السر لازم 6 حروف أو أرقام على الأقل، وتكتبها مرتين بنفس الشكل. ولو نسيتها كلّم موظف التسجيل.', pointTo: 'password', expression: 'point' },
      { id: 'forgot', keywords: ['نسيت كلمه السر', 'نسيت الباسورد', 'نسيت كلمه المرور', 'مش فاكر كلمه السر', 'مش عارف ادخل'], reply: 'لو نسيت كلمة السر كلّم موظف التسجيل على واتساب الأكاديمية وما تبعتش كلمة السر في المحادثة.', expression: 'thinking', handoff: true },
      { id: 'student', keywords: ['اسم الطالب', 'بيانات الطالب', 'اسم ابني', 'اسم بنتي'], reply: 'في الخطوة 2 اكتب اسم الطالب رباعي، وتاريخ الميلاد، والنوع، والصف، والعنوان.', pointTo: 'studentName', expression: 'point' },
      { id: 'dob', keywords: ['تاريخ الميلاد', 'تاريخ ميلاد', 'السن', 'سن القبول', 'عمر الطالب'], reply: 'اختار تاريخ ميلاد الطالب من التقويم في الخطوة 2. ولو عندك سؤال عن سن القبول كلّم موظف التسجيل.', pointTo: 'dob', expression: 'point' },
      { id: 'grade', keywords: ['الصف', 'الصفوف', 'المرحله', 'سنه كام', 'كي جي', 'kg', 'حضانه', 'ابتدائي', 'اعدادي'], reply: 'اختار الصف الدراسي المطلوب من القائمة في الخطوة 2.', pointTo: 'grade', expression: 'point' },
      { id: 'address', keywords: ['العنوان', 'عنوان', 'ساكن'], reply: 'اكتب العنوان بالترتيب: المحافظة، المدينة، الشارع.', pointTo: 'address', expression: 'point' },
      { id: 'docs', keywords: ['المستندات', 'مستندات', 'الاوراق', 'ورق', 'الورق المطلوب', 'المطلوب', 'شهاده الميلاد', 'صوره الطالب', 'صوره البطاقه'], reply: 'المستندات المطلوبة: شهادة ميلاد الطالب، صورة شخصية للطالب، وبطاقة ولي الأمر. وآخر شهادة دراسية اختيارية.', pointTo: 'birthCert', expression: 'point' },
      { id: 'upload', keywords: ['ارفع', 'رفع', 'ارفع مستند', 'ارفع صوره', 'تحميل', 'الصوره مش بترفع', 'مش بترفع', 'حجم الصوره', 'pdf'], reply: 'دوس على مربع المستند في الخطوة 3 واختار الصورة من جهازك (JPG أو PNG أو PDF). لو الصورة كبيرة جرّب صورة أصغر أو أوضح.', pointTo: 'birthCert', expression: 'point' },
      { id: 'order', keywords: ['رقم الطلب', 'متابعه الطلب', 'اتابع', 'حاله الطلب', 'اتقبل', 'القبول', 'النتيجه'], reply: 'بعد الإرسال هتاخد رقم طلب يبدأ بـ RHQ. احتفظ بيه، وفريق الأكاديمية هيتواصل معاك على واتساب لمتابعة القبول.', expression: 'happy' },
      { id: 'terms', keywords: ['الشروط', 'الاحكام', 'الموافقه'], reply: 'لازم تعلّم على «أوافق على الشروط والأحكام» في آخر الخطوة 3 قبل ما تبعت الطلب.', pointTo: 'agree', expression: 'point' },
      { id: 'fees', keywords: ['المصاريف', 'المصروفات', 'الرسوم', 'بكام', 'السعر', 'الاقساط', 'خصم'], reply: 'تفاصيل المصروفات والخصومات مع موظف التسجيل. تقدر تكلّمه مباشرة على واتساب الأكاديمية.', expression: 'happy', handoff: true },
      { id: 'human', keywords: ['موظف', 'اكلم حد', 'خدمه العملاء', 'الدعم', 'اتصل', 'رقم الاكاديميه', 'رقم المدرسه', 'تواصل'], reply: 'تقدر تكلّم موظف التسجيل مباشرة على واتساب أكاديمية رحيق من الزر ده.', expression: 'happy', handoff: true },
      { id: 'error', keywords: ['مشكله', 'خطا', 'مش شغال', 'مش راضي', 'بيرفض', 'مش بيقبل', 'واقف', 'علقت', 'مش عارف', 'مش فاهم', 'ساعدني', 'مساعده', 'اكتب ايه', 'خانه'], reply: 'ولا يهمك 🙏 دوس على زر «فين المشكلة؟» وأنا أشاورلك على الخانة اللي محتاجة تتظبط.', expression: 'worried' }
    ].concat(parentHelp),
    animations: { idle: true, blink: true, blinkEverySec: 3, tilt: true, wave: true, point: true, expressions: true, talk: true, confetti: true, stuckAfterSec: 10, threeD: true, roam: true, walk: true, run: true, jump: true, dance: true, spin: true, stretch: true, float: true },
    sounds: { enabled: true, volume: 0.4, speech: false },
    hours: { enabled: false, start: '08:00', end: '22:00', days: [0, 1, 2, 3, 4, 5, 6], timezone: 'Africa/Cairo' },
    blockedWords: [],
    handoff: { whatsapp: '201151947735' }
  };
}

/* ---------------- التحقق من إعدادات المدير (مخطط صارم) ---------------- */
function str(v, max, fallback) {
  if (typeof v !== 'string') return fallback;
  const s = sanitize(v).slice(0, max);
  return s || fallback;
}
function bool(v, fallback) { return typeof v === 'boolean' ? v : fallback; }
function num(v, min, max, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function fieldOrNull(v) { return typeof v === 'string' && Object.prototype.hasOwnProperty.call(FIELDS, v) ? v : null; }
function exprOr(v, fallback) { return EXPRESSIONS.indexOf(v) >= 0 ? v : fallback; }

function validateConfig(input) {
  const base = defaultConfig();
  const src = input && typeof input === 'object' ? input : {};
  const out = { version: src.version === 3 ? 3 : (src.version === 2 ? 2 : 1) };
  out.enabled = bool(src.enabled, base.enabled);
  out.name = str(src.name, 30, base.name);

  const p = src.personality || {};
  out.personality = {
    greeting: str(p.greeting, 240, base.personality.greeting),
    chatIntro: str(p.chatIntro, 240, base.personality.chatIntro)
  };

  out.messages = {};
  Object.keys(base.messages).forEach(k => { out.messages[k] = str((src.messages || {})[k], 300, base.messages[k]); });
  out.steps = {};
  [1, 2, 3].forEach(k => { out.steps[k] = str((src.steps || {})[k], 240, base.steps[k]); });
  out.guide = {};
  Object.keys(base.guide).forEach(k => { out.guide[k] = str((src.guide || {})[k], 240, base.guide[k]); });

  const qrIn = Array.isArray(src.quickReplies) ? src.quickReplies : [];
  out.quickReplies = base.quickReplies.map(def => {
    const got = qrIn.find(q => q && q.id === def.id) || {};
    return {
      id: def.id,
      label: str(got.label, 40, def.label),
      reply: def.id === 'problem' ? '' : str(got.reply, 400, def.reply),
      pointTo: got.pointTo === undefined ? (def.pointTo || null) : fieldOrNull(got.pointTo),
      expression: exprOr(got.expression, def.expression || 'happy'),
      handoff: bool(got.handoff, !!def.handoff)
    };
  });

  const ansIn = Array.isArray(src.answers) ? src.answers : base.answers;
  const seen = new Set();
  out.answers = [];
  ansIn.slice(0, 120).forEach((a, i) => {
    if (!a || typeof a !== 'object') return;
    const reply = str(a.reply, 400, '');
    const keywords = (Array.isArray(a.keywords) ? a.keywords : String(a.keywords || '').split(/[,،\n]/))
      .map(k => str(k, 40, '')).filter(Boolean).slice(0, 30);
    if (!reply || !keywords.length) return;
    let id = str(a.id, 30, '').replace(/[^a-zA-Z0-9_-]/g, '') || ('a' + (i + 1));
    while (seen.has(id)) id += '_';
    seen.add(id);
    out.answers.push({ id, keywords, reply, pointTo: fieldOrNull(a.pointTo), expression: exprOr(a.expression, 'happy'), handoff: bool(a.handoff, false) });
  });

  const an = src.animations || {};
  out.animations = {
    idle: bool(an.idle, true), blink: bool(an.blink, true), blinkEverySec: num(an.blinkEverySec, 2, 15, 3),
    tilt: bool(an.tilt, true), wave: bool(an.wave, true), point: bool(an.point, true),
    expressions: bool(an.expressions, true), talk: bool(an.talk, true), confetti: bool(an.confetti, true),
    stuckAfterSec: num(an.stuckAfterSec, 5, 120, 10),
    threeD: bool(an.threeD, true), roam: bool(an.roam, true), walk: bool(an.walk, true),
    run: bool(an.run, true), jump: bool(an.jump, true), dance: bool(an.dance, true),
    spin: bool(an.spin, true), stretch: bool(an.stretch, true), float: bool(an.float, true)
  };
  const so = src.sounds || {};
  out.sounds = { enabled: bool(so.enabled, true), volume: num(so.volume, 0, 1, 0.4), speech: bool(so.speech, false) };

  const h = src.hours || {};
  const time = (v, fb) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : fb);
  let tz = typeof h.timezone === 'string' ? h.timezone.slice(0, 60) : base.hours.timezone;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch (e) { tz = base.hours.timezone; }
  out.hours = {
    enabled: bool(h.enabled, false), start: time(h.start, '08:00'), end: time(h.end, '22:00'),
    days: (Array.isArray(h.days) ? h.days : base.hours.days).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
      .filter((d, i, arr) => arr.indexOf(d) === i).sort(),
    timezone: tz
  };

  out.blockedWords = (Array.isArray(src.blockedWords) ? src.blockedWords : String(src.blockedWords || '').split(/[,،\n]/))
    .map(w => str(w, 40, '')).filter(Boolean).filter((w, i, arr) => arr.indexOf(w) === i).slice(0, 300);

  const wa = String((src.handoff || {}).whatsapp || '').replace(/\D/g, '').slice(0, 15);
  out.handoff = { whatsapp: wa.length >= 8 ? wa : base.handoff.whatsapp };
  return out;
}

/* ---------------- مواعيد العمل ---------------- */
function isWithinHours(config, now) {
  const h = config.hours;
  if (!h || !h.enabled) return true;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: h.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now || new Date());
  const get = t => (parts.find(p => p.type === t) || {}).value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const mins = parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10);
  const toM = s => parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3), 10);
  const start = toM(h.start), end = toM(h.end);
  if (start === end) return h.days.indexOf(day) >= 0;
  if (start < end) return h.days.indexOf(day) >= 0 && mins >= start && mins < end;
  // فترة تعبر منتصف الليل: الجزء بعد منتصف الليل يتبع اليوم السابق
  if (mins >= start) return h.days.indexOf(day) >= 0;
  return mins < end && h.days.indexOf((day + 6) % 7) >= 0;
}

/* ---------------- ما يراه متصفح ولي الأمر فقط ---------------- */
function publicConfig(config, now) {
  if (!config.enabled) return { ok: true, enabled: false };
  return {
    ok: true,
    enabled: true,
    online: isWithinHours(config, now),
    name: config.name,
    greeting: config.personality.greeting,
    chatIntro: config.personality.chatIntro,
    quickReplies: config.quickReplies.map(q => ({ id: q.id, label: q.label })),
    steps: config.steps,
    guide: config.guide,
    lines: { stuck: config.messages.stuck, fieldFixed: config.messages.fieldFixed, success: config.messages.success, offHours: config.messages.offHours },
    animations: config.animations,
    sounds: config.sounds,
    limits: { maxMessages: LIMITS.maxMessages, maxChars: LIMITS.maxChars }
  };
}

/* ---------------- سياق الاستمارة (بيانات فقط، قائمة بيضاء) ---------------- */
function cleanContext(ctx) {
  const out = { step: 0, invalid: [] };
  if (!ctx || typeof ctx !== 'object') return out;
  const step = Number(ctx.step);
  if (step === 1 || step === 2 || step === 3) out.step = step;
  if (Array.isArray(ctx.invalid)) {
    ctx.invalid.slice(0, 25).forEach(f => { if (fieldOrNull(f) && out.invalid.indexOf(f) < 0) out.invalid.push(f); });
  }
  return out;
}

function reply(text, expression, extra) {
  return Object.assign({ reply: text, expression: expression || 'happy', action: null, handoff: null, kind: 'answer' }, extra || {});
}

function withAction(config, item) {
  const out = reply(item.reply, item.expression || 'happy');
  if (item.pointTo && FIELDS[item.pointTo]) out.action = { type: 'point', field: item.pointTo, step: FIELDS[item.pointTo] };
  if (item.handoff) out.handoff = { whatsapp: config.handoff.whatsapp };
  return out;
}

/* ---------------- المحرك: رسالة => رد معتمد ---------------- */
function answerQuick(config, id, ctx) {
  if (QUICK_IDS.indexOf(id) < 0) return reply(FIXED.offTopic, 'thinking', { kind: 'offtopic' });
  const item = config.quickReplies.find(q => q.id === id);
  if (id === 'problem') {
    const c = cleanContext(ctx);
    const bad = c.invalid.filter(f => !c.step || FIELDS[f] === c.step)[0] || c.invalid[0];
    if (bad) {
      return reply(config.guide[bad], 'point', { action: { type: 'point', field: bad, step: FIELDS[bad] }, kind: 'guide' });
    }
    return reply(config.messages.allGood, 'happy', { kind: 'guide' });
  }
  return withAction(config, item);
}

function answerText(config, raw, ctx) {
  const text = sanitize(raw);
  if (!text) return reply(config.messages.empty, 'thinking', { kind: 'empty' });
  if (text.length > LIMITS.maxChars) return reply(config.messages.tooLong, 'worried', { kind: 'toolong' });
  if (containsLink(text)) return reply(config.messages.noLinks, 'worried', { kind: 'link' });

  const norm = normalize(text);
  const toks = tokens(norm);
  if (isManipulation(text, norm)) return reply(FIXED.manipulation, 'thinking', { kind: 'manipulation' });
  if (!norm) return reply(FIXED.offTopic, 'thinking', { kind: 'offtopic' });
  if (config.blockedWords.some(w => hasKeyword(norm, toks, w))) return reply(FIXED.offTopic, 'thinking', { kind: 'blocked' });
  if (OFF_TOPIC.some(w => hasKeyword(norm, toks, w))) return reply(FIXED.offTopic, 'thinking', { kind: 'offtopic' });

  let best = null, bestScore = 0;
  config.answers.forEach(a => {
    let score = 0;
    a.keywords.forEach(k => { if (hasKeyword(norm, toks, k)) score += 1 + normalize(k).length / 10; });
    if (score > bestScore) { bestScore = score; best = a; }
  });
  // الأسئلة العامة عن خطأ تستفيد من أسماء الخانات المتعثرة فقط، دون إرسال قيمها.
  if (best && best.id === 'error') {
    const c = cleanContext(ctx);
    const bad = c.invalid.find(f => !c.step || FIELDS[f] === c.step) || c.invalid[0];
    if (bad) return reply(config.guide[bad], 'point', { action: { type: 'point', field: bad, step: FIELDS[bad] }, kind: 'guide' });
  }
  if (best) return withAction(config, best);
  // الأصل هو الرفض: أي شيء غير معروف يُعد خارج التسجيل
  return reply(FIXED.offTopic, 'thinking', { kind: 'offtopic' });
}

function makeCaptcha(randomInt) {
  const a = 2 + randomInt(8), b = 1 + randomInt(8);
  return { question: a + ' + ' + b + ' = ؟', answer: String(a + b) };
}

function captchaMatches(expected, given) {
  const g = normalize(String(given == null ? '' : given)).replace(/\D/g, '');
  return !!expected && g === String(expected);
}

module.exports = {
  LIMITS, FIXED, FIELDS, EXPRESSIONS, QUICK_IDS,
  sanitize, normalize, containsLink, isManipulation,
  defaultConfig, validateConfig, publicConfig, isWithinHours, cleanContext,
  answerQuick, answerText, makeCaptcha, captchaMatches
};
