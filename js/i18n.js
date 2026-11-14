/* ============================================================
   رحيق RAHEEQ — دعم اللغتين العربية والإنجليزية
   ------------------------------------------------------------
   الطريقة: النص العربي هو المفتاح. مجموعة قاموس واحدة + مترجم
   DOM يمرّ على النصوص والسمات (placeholder/title/aria-label/alt)
   ويحوّلها قبل الرسم وبعد كل تغيير ديناميكي (MutationObserver).
   • التحويل قابل للرجوع: النص العربي الأصلي محفوظ في WeakMap.
   • للسلاسل التي تبنيها السكربتات: استخدم window.RaheeqI18n.t('...').

   واجهة عامة: window.RaheeqI18n = { DICT, t, apply, lang, onChange }
   ============================================================ */
(function (global) {
  'use strict';

  var DICT = {
    /* ---------- العلامة والتنقّل ---------- */
    'رحيق': 'Raheeq',
    'أكاديمية رحيق': 'Raheeq Academy',
    'أكاديمية رحيق · بوابة ولي الأمر': 'Raheeq Academy · Parent Portal',
    'تخطّي إلى المحتوى': 'Skip to content',
    'تخطي': 'Skip',
    'قيمنا': 'Our values',
    'التسجيل': 'Register',
    'تواصل معنا': 'Contact us',
    'تسجيل دخول ولي الأمر': 'Parent login',
    'الصفحة الرئيسية': 'Home page',
    'روابط سريعة': 'Quick links',

    /* ---------- الهيرو ---------- */
    '🎓 منصة تسجيل ولي الأمر — أكاديمية رحيق': '🎓 Parent registration platform — Raheeq Academy',
    'سجّل ابنك في': 'Enroll your child at',
    'بخطوات بسيطة و آمنة': 'in simple, safe steps',
    'ثلاث خطوات واضحة تبدأ ببيانات ولي الأمر، ثم بيانات الطالب، ثم المستندات الرسمية. أكمل طلبك في دقائق، وسيصلك رقم طلبك فورًا لتتابع به حالة التسجيل مع فريق أكاديمية رحيق في أي وقت.':
      'Three clear steps: parent details, student details, then the official documents. Complete your request in minutes and receive your order number instantly to follow up the admission with the Raheeq Academy team at any time.',
    'تسجيل آمن': 'Secure registration',
    'ثلاث خطوات': 'Three steps',
    'متابعة سريعة': 'Fast follow-up',
    'خصوصية تامة': 'Full privacy',
    'مميزات التسجيل': 'Registration features',
    'يصلك': 'You receive',
    'رقم طلب رسمي': 'an official order number',
    'لمتابعة تسجيل ابنك، ثم ترسل الطلب ومستنداته إلى': 'to follow up your child’s enrolment, then send the request and its documents to',
    'أكاديمية رحيق على واتساب': 'Raheeq Academy on WhatsApp',
    'بضغطة واحدة.': 'with one tap.',

    /* ---------- بطاقة التسجيل ---------- */
    'تسجيل ولي الأمر': 'Parent registration',
    'سجّل بياناتك في دقائق، ونصلك برقم طلبك لمتابعة القبول مع فريق أكاديمية رحيق':
      'Register in minutes and receive your order number to follow up admission with the Raheeq Academy team',
    'تسجيل دخول ولي الأمر': 'Parent login',
    'أدخل رقم موبايلك وكلمة السر للمتابعة': 'Enter your mobile number and password to continue',
    'طلبك لدينا': 'Your request is with us',
    'شكرًا لثقتك في رحيق': 'Thank you for trusting Raheeq',
    'التبديل بين التسجيل والدخول': 'Switch between registration and login',
    'تسجيل جديد': 'New registration',
    'تسجيل دخول': 'Log in',
    'تقدم التسجيل': 'Registration progress',
    'ولي الأمر': 'Parent',
    'الطالب': 'Student',
    'المستندات': 'Documents',

    /* ---------- الخطوة 1 ---------- */
    'بيانات ولي الأمر': 'Parent details',
    'الاسم رباعي': 'Full name (four parts)',
    'اكتب الاسم من أربعة أجزاء': 'Write the name in four parts',
    '⚠ الاسم الرباعي يجب أن يتكون من 4 أجزاء على الأقل': '⚠ Full name must have at least 4 parts',
    'الرقم القومي 14 رقم': 'National ID (14 digits)',
    '14 رقمًا': '14 digits',
    '⚠ الرقم القومي يجب أن يكون 14 رقمًا بالضبط': '⚠ National ID must be exactly 14 digits',
    'صلة القرابة': 'Relation',
    'اختر صلة القرابة': 'Select relation',
    'أب': 'Father',
    'أم': 'Mother',
    'رقم الموبايل': 'Mobile number',
    '⚠ رقم الموبايل يجب أن يكون 11 رقمًا': '⚠ Mobile number must be 11 digits',
    'واتساب': 'WhatsApp',
    'اتركه فارغًا لاستخدام الموبايل': 'Leave empty to use the mobile number',
    'اختياري': 'Optional',
    '⚠ رقم الواتساب يجب أن يكون 11 رقمًا': '⚠ WhatsApp number must be 11 digits',
    'البريد الإلكتروني': 'Email address',
    'بريدك الإلكتروني': 'Your email address',
    '⚠ أدخل بريدًا إلكترونيًا صحيحًا يحتوي على @': '⚠ Enter a valid email containing @',
    'كلمة السر': 'Password',
    '6 أحرف على الأقل': 'At least 6 characters',
    '⚠ كلمة السر يجب ألا تقل عن 6 أحرف': '⚠ Password must be at least 6 characters',
    'تأكيد كلمة السر': 'Confirm password',
    'أعد كتابة كلمة السر': 'Re-enter the password',
    '⚠ كلمتا السر غير متطابقتين': '⚠ Passwords do not match',

    /* ---------- الخطوة 2 ---------- */
    'بيانات الطالب': 'Student details',
    'مثال: محمد أحمد علي حسن': 'e.g. Mohamed Ahmed Ali Hassan',
    '⚠ اسم الطالب يجب أن يتكون من 4 أجزاء على الأقل': '⚠ Student name must have at least 4 parts',
    'تاريخ الميلاد': 'Date of birth',
    '⚠ اختر تاريخ ميلاد صحيحًا': '⚠ Choose a valid date of birth',
    'النوع': 'Gender',
    'اختر النوع': 'Select gender',
    'ذكر': 'Male',
    'أنثى': 'Female',
    'الصف الدراسي': 'Grade',
    'اختر الصف الدراسي': 'Select grade',
    '⚠ اختر الصف الدراسي': '⚠ Select the grade',
    'نوع البرنامج': 'Program type',
    'اختر نوع البرنامج: تأسيس أم منهج دراسي': 'Choose the program type: foundation or curriculum',
    '⚠ اختر نوع البرنامج (تأسيس أو منهج دراسي)': '⚠ Choose the program type (foundation or curriculum)',
    'تأسيس': 'Foundation',
    'منهج دراسي': 'Curriculum',
    'السنة الدراسية': 'Academic year',
    'اختر السنة الدراسية': 'Select the academic year',
    '⚠ اختر السنة الدراسية من القائمة': '⚠ Select the academic year from the list',
    'مستوى التأسيس': 'Foundation level',
    'اختر مستوى التأسيس': 'Select the foundation level',
    '⚠ اختر مستوى التأسيس': '⚠ Select the foundation level',
    'قائمة مواد التأسيس': 'Foundation subjects list',
    'اختَر من القائمة المواد التي سيتأسس فيها الطالب — مادة واحدة على الأقل.':
      'Pick from the list the subjects the student will study in foundation — at least one.',
    '⚠ اختر مادة أو أكثر من قائمة مواد التأسيس': '⚠ Select one or more subjects from the foundation list',
    'اختر نوع البرنامج: تأسيس أو منهج دراسي': 'Choose program type: foundation or curriculum',
    'اختر مادة أو أكثر من قائمة مواد التأسيس': 'Select one or more subjects from the foundation list',
    'اختر السنة الدراسية من القائمة': 'Select the academic year from the list',
    'تأسيس للصغار': 'Foundation for children',
    'تأسيس للكبار': 'Foundation for adults',
    'مواد التأسيس (اختياري)': 'Foundation subjects (optional)',
    'مواد التأسيس': 'Foundation subjects',
    'لو اخترت التأسيس للكبار أو الصغار، اختار مادة أو أكثر حسب احتياج الطالب.': 'If you choose foundation for adults or children, select one or more subjects as needed.',
    'اللغة العربية': 'Arabic',
    'اللغة الإنجليزية': 'English',
    'الرياضيات': 'Mathematics',
    'القراءة والكتابة': 'Reading and writing',
    'KG1': 'KG1',
    'KG2': 'KG2',
    'الصف الأول الابتدائي': 'Primary 1',
    'الصف الثاني الابتدائي': 'Primary 2',
    'الصف الثالث الابتدائي': 'Primary 3',
    'الصف الرابع الابتدائي': 'Primary 4',
    'الصف الخامس الابتدائي': 'Primary 5',
    'الصف السادس الابتدائي': 'Primary 6',
    'الصف الأول الإعدادي': 'Preparatory 1',
    'الصف الثاني الإعدادي': 'Preparatory 2',
    'الصف الثالث الإعدادي': 'Preparatory 3',
    'الصف الأول الثانوي': 'Secondary 1',
    'الصف الثاني الثانوي': 'Secondary 2',
    '3 ثانوي': 'Secondary 3',
    'الأكاديمية السابقة': 'Previous academy',
    'اسم الأكاديمية السابقة (اختياري)': 'Previous academy name (optional)',
    'العنوان': 'Address',
    'المحافظة — المدينة — الشارع': 'Governorate — city — street',
    '⚠ أدخل العنوان بالتفصيل': '⚠ Enter the full address',
    'ملاحظات صحية': 'Health notes',
    'أي ملاحظات صحية أو حساسية يجب معرفتها (اختياري)': 'Any health notes or allergies we should know (optional)',
    'مثال: عمر محمد أحمد علي': 'e.g. Omar Mohamed Ahmed Ali',

    /* ---------- الخطوة 3 ---------- */
    'المستندات المطلوبة': 'Required documents',
    'شهادة الميلاد': 'Birth certificate',
    'اضغط لرفع صورة شهادة الميلاد': 'Tap to upload the birth certificate',
    'صورة واضحة أو PDF — تُحفظ الصورة نفسها': 'Clear image or PDF — the image itself is saved',
    '⚠ ارفع صورة شهادة الميلاد': '⚠ Upload the birth certificate',
    'صورة شخصية': 'Personal photo',
    'اضغط لرفع الصورة الشخصية للطالب': 'Tap to upload the student photo',
    'صورة حديثة بخلفية واضحة — تُحفظ الصورة نفسها': 'Recent photo with a clear background — the image itself is saved',
    '⚠ ارفع الصورة الشخصية للطالب': '⚠ Upload the student photo',
    'بطاقة ولي الأمر': 'Parent ID card',
    'اضغط لرفع صورة بطاقة ولي الأمر': 'Tap to upload the parent ID card',
    'وجه البطاقة واضح وكامل — تُحفظ الصورة نفسها': 'Clear, full card face — the image itself is saved',
    '⚠ ارفع صورة بطاقة ولي الأمر': '⚠ Upload the parent ID card',
    'بيان نجاح': 'Success statement',
    'اضغط لرفع بيان النجاح (اختياري)': 'Tap to upload the success statement (optional)',
    'آخر بيان درجات متاح — تُحفظ الصورة نفسها': 'Latest available transcript — the image itself is saved',
    '📄 مستند مرفق': '📄 Document attached',
    'إزالة': 'Remove',
    'معاينة شهادة الميلاد': 'Birth certificate preview',
    'معاينة الصورة الشخصية': 'Personal photo preview',
    'معاينة بطاقة ولي الأمر': 'Parent ID card preview',
    'معاينة بيان النجاح': 'Success statement preview',
    'أكمل بياناتك ومستنداتك، وسيصل طلبك كاملًا إلى فريق أكاديمية رحيق على واتساب فور الإرسال.':
      'Complete your details and documents; your full request reaches the Raheeq Academy team on WhatsApp as soon as you send it.',
    'أوافق على': 'I agree to ',
    'الشروط والأحكام': 'the terms and conditions',
    'الخاصة بالتسجيل في رحيق، وأؤكد صحة البيانات المذكورة أعلاه.': ' for registration at Raheeq, and I confirm the data above is accurate.',
    '⚠ يجب الموافقة على الشروط والأحكام': '⚠ You must accept the terms and conditions',
    '⏳ جارٍ تجهيز صور المستندات… لحظات ولا تغلق الصفحة.':
      '⏳ Preparing your document images… just a moment, please keep the page open.',
    'السابق': 'Back',
    'التالي ←': 'Next →',
    'إرسال طلب التسجيل ✓': 'Submit registration ✓',

    /* ---------- الدخول ---------- */
    'أهلًا بعودتك': 'Welcome back',
    'أدخل رقم موبايلك وكلمة السر لمتابعة طلبك': 'Enter your mobile number and password to follow your request',
    '⚠ أدخل رقم موبايل صحيحًا (11 رقمًا)': '⚠ Enter a valid mobile number (11 digits)',
    '⚠ أدخل كلمة السر': '⚠ Enter your password',
    'دخول ✓': 'Log in ✓',
    'إنشاء حساب جديد': 'Create a new account',
    'ليس لديك حساب؟ اضغط «إنشاء حساب جديد» وابدأ في ثلاث خطوات.':
      'No account yet? Tap “Create a new account” and start in three steps.',
    'تم تسجيل الدخول بنجاح': 'Logged in successfully',
    'تسجيل الخروج': 'Log out',
    'المستندات المرفوعة (الصور الفعلية)': '📎 Uploaded documents (actual images)',
    '📎 المستندات المرفوعة (الصور الفعلية)': '📎 Uploaded documents (actual images)',
    'صور مستنداتك محفوظة في حسابك، ويمكنك عرضها أو تنزيلها في أي وقت.':
      'Your document images are saved in your account; view or download them at any time.',
    'عرض': 'View',
    'تنزيل': 'Download',
    'سجل قديم بالاسم فقط — أعد رفع الصورة لحفظها فعليًا': 'Old name-only record — re-upload the image to save it',
    'الصورة': 'Image',

    /* ---------- النجاح ---------- */
    'تم استلام طلبك بنجاح': 'Your request was received successfully',
    'تم استلام بياناتك ومستنداتك بنجاح، وطلبك جاهز الآن للإرسال إلى فريق أكاديمية رحيق على واتساب.':
      'Your details and documents were received successfully, and your request is ready to send to the Raheeq Academy team on WhatsApp.',
    'اسم ولي الأمر': 'Parent name',
    'اسم الطالب': 'Student name',
    'الصف': 'Grade',
    'رقم الطلب': 'Order number',
    'رقم الموبايل': 'Mobile number',
    'المستندات المحفوظة': 'Saved documents',
    'м': 'of',
    'من 4': 'of 4',
    '📲 خطوة أخيرة: أرسل طلبك إلى أكاديمية رحيق على واتساب': '📲 One last step: send your request to Raheeq Academy on WhatsApp',
    '📤 إرسال الطلب على واتساب': '📤 Send the request on WhatsApp',
    '📎 مشاركة الصور مع الطلب': '📎 Share the images with the request',
    'سيفتح واتساب برسالة جاهزة فيها كل بيانات طلبك على رقم أكاديمية رحيق. أرفق صور المستندات (4 صور) من زر 📎 داخل المحادثة إن لم تُرفق تلقائيًا.':
      'WhatsApp opens with a ready message containing all your request details, addressed to the Raheeq Academy number. Attach the document images from the 📎 button inside the chat if they are not attached automatically.',
    'لو لم يفتح واتساب تلقائيًا:': 'If WhatsApp does not open automatically:',
    'اضغط هنا لفتح المحادثة': 'Tap here to open the chat',
    '📋 نسخ رسالة الطلب': '📋 Copy the request message',
    '↧ إعادة إرسال النسخة إلى الأكاديمية (اختياري)': '↧ Resend the copy to the academy (optional)',
    'هنتواصل معاك خلال 24-48 ساعة': 'We will contact you within 24–48 hours',
    'تسجيل طالب آخر': 'Register another student',
    '📋 نسخ رقم الطلب': '📋 Copy order number',
    'احتفظ برقم طلبك لمتابعة حالة التسجيل، ويمكنك الدخول بحسابك في أي وقت لمراجعة بياناتك ومستنداتك.':
      'Keep your order number to track your registration, and log in to your account anytime to review your details and documents.',

    /* ---------- القيم والفوتر ---------- */
    'لماذا رحيق؟': 'Why Raheeq?',
    'أربع قيم نلتزم بها من أول يوم مع ولي الأمر والطالب': 'Four values we commit to from day one, with parents and students',
    'ثقة': 'Trust',
    'بياناتك ومستنداتك تُحفظ بعناية، وتواصل شفاف في كل خطوة من خطوات التسجيل.':
      'Your data and documents are handled carefully, with transparent communication at every step.',
    'نمو': 'Growth',
    'نرافق ابنك في رحلة تعلّم متدرجة تنمّي مهاراته وثقته بنفسه عامًا بعد عام.':
      'We accompany your child through a gradual learning journey that builds skills and confidence year after year.',
    'رعاية': 'Care',
    'اهتمام حقيقي بكل طالب على حدة، ومتابعة مستمرة مع ولي الأمر أولًا بأول.':
      'Genuine attention to each student, with continuous follow-up with parents.',
    'تميز': 'Excellence',
    'منهج متميز وكوادر متميزة، هدفنا أن يصل ابنك إلى أفضل نسخة من نفسه.':
      'A distinguished curriculum and team — our goal is your child’s best self.',
    'ثقة • نمو • رعاية • تميز': 'Trust • Growth • Care • Excellence',
    '© 2026 رحيق RAHEEQ -': '© 2026 Raheeq -',

    /* ---------- النوافذ ---------- */
    'إغلاق': 'Close',
    'الشروط والأحكام': 'Terms and conditions',
    'أقر بأن جميع البيانات المدخلة صحيحة ومطابقة للمستندات الرسمية.':
      'I confirm that all entered data is accurate and matches the official documents.',
    'تُحفظ صور المستندات بعد ضغطها مع بيانات حسابك، ويمكنك عرضها أو تنزيلها في أي وقت بعد تسجيل الدخول. ثم ترسل الطلب كاملًا إلى واتساب أكاديمية رحيق بضغطة واحدة من شاشة النجاح.':
      'Document images are saved (after compression) with your account data, and you can view or download them anytime after logging in. Then the whole request is sent to Raheeq Academy on WhatsApp with one tap from the success screen.',
    'أنت مسؤول عن سرية كلمة السر الخاصة بحسابك، وعن صحة البيانات والمستندات المرفقة مع الطلب.':
      'You are responsible for keeping your account password confidential and for the accuracy of the data and documents attached to the request.',
    'رقم الطلب يصلك بعد إتمام التسجيل وتستخدمه للمتابعة، والتواصل يتم عبر واتساب أكاديمية رحيق الرسمي الظاهر في الموقع.':
      'Your order number is issued once registration is complete and is used to follow up; contact happens via Raheeq Academy’s official WhatsApp shown on the site.',
    'حسنًا، فهمت': 'OK, I understand',
    'المستند': 'Document',
    '⬇ تنزيل الصورة': '⬇ Download image',
    '⬇ فتح شاشة المستندات لتنزيل الصور': '⬇ Open the documents screen to download images',

    /* ---------- نافذة الإرسال اليدوي ---------- */
    'طلبك جاهز للإرسال ✅': 'Your request is ready to send ✅',
    'طلبك مكتمل وجاهز، وبياناتك ومستنداتك أمامك كاملة. أرسله الآن إلى فريق أكاديمية رحيق في خطوة واحدة.':
      'Your request is complete and ready, with all your details and documents in place. Send it now to the Raheeq Academy team in one step.',
    'أرسل الطلب مباشرة إلى واتساب أكاديمية رحيق من زر «إرسال الطلب على واتساب» (رسالة جاهزة بكل البيانات).':
      'Send the request directly to Raheeq Academy’s WhatsApp with “Send the request on WhatsApp” (a ready message with all details).',
    'أرفق صور المستندات الثلاثة من داخل المحادثة، أو نزّلها من شاشة النجاح أولًا.':
      'Attach the three document images inside the chat, or download them from the success screen first.',
    'احتفظ برقم الطلب للرجوع إليه عند المتابعة.': 'Keep the order number for follow-up.',
    '📤 فتح واتساب أكاديمية رحيق برسالة الطلب': '📤 Open Raheeq Academy WhatsApp with the request message',
    'حسنًا': 'OK',
    'إن لم يفتح واتساب تلقائيًا، انسخ رسالة الطلب وأرسلها من تطبيق واتساب على نفس الرقم.':
      'If WhatsApp does not open automatically, copy the request message and send it from the WhatsApp app to the same number.',

    /* ---------- لوحة الإعدادات ---------- */
    'تخصيص الموقع': 'Customize the site',
    'اختر لون الهوية وحجم الخط واللغة — يظهر اختيارك في كل زيارة للموقع.':
      'Pick your brand color, text size and language — your choice applies every time you visit.',
    'ألوان الهوية الجاهزة': 'Ready-made brand colors',
    'لون حر': 'Custom color',
    'اختياري — يتقدم على الثيم': 'Optional — overrides the theme',
    'اللون الأساسي': 'Primary color',
    'اللون المكمّل': 'Accent color',
    'خلفية الصفحة': 'Page background',
    'تطبيق اللون': 'Apply color',
    'جرّب أي لون، وسيُشتق باقي التدرّجات تلقائيًا ليبقى كل شيء مقروءًا.':
      'Try any color — the remaining shades are derived automatically so everything stays readable.',
    'حجم الخط': 'Text size',
    'خط Cairo موحّد لكل الواجهة': 'Unified Cairo font across the interface',
    'استخدام خط أميري للعناوين فقط (اختياري)': 'Use Amiri for headings only (optional)',
    'اللغة': 'Language',
    'العربية': 'العربية',
    'English': 'English',
    'تم، احفظ الاختيار': 'Done, save my choice',
    'استعادة الافتراضي': 'Restore defaults',
    'تخصيص الألوان والخط': 'Customize colors and font',
    'تغيير اللغة': 'Change language',
    'العربية / English': 'العربية / English',
    'الصوت': 'Sound',

    /* ---------- رسائل ديناميكية (التحقق والرفع) ---------- */
    'انتظر لحظة حتى يكتمل حفظ الصور المرفوعة ثم أرسل الطلب': 'Wait a moment until the uploaded images finish saving, then submit',
    'الصورة لم تُحفظ فعليًا — أعد رفع الملف': 'The image was not actually saved — re-upload the file',
    'راجع البيانات المطلوبة وأكمل الحقول المميزة بعلامة * — ': 'Review the required data and complete the fields marked * — ',
    'يوجد خطأ في بيانات الخطوات السابقة، راجعها قبل الإرسال': 'There is an error in previous steps; review them before submitting',
    'تعذّر حفظ الصور على الجهاز، جرّب صورًا أصغر': 'Could not save the images on this device; try smaller images',
    'امتلأت مساحة التخزين في المتصفح. قلّل حجم الصور أو احذف مستندًا اختياريًا ثم أعد المحاولة.':
      'Browser storage is full. Reduce image size or remove an optional document, then try again.',
    'تعذّر حفظ البيانات على الجهاز. تأكد من تفعيل التخزين في المتصفح وتوفّر مساحة.':
      'Could not save data on this device. Make sure browser storage is enabled and space is available.',
    'رقم الموبايل أو كلمة السر غير صحيحة. لو ليس لديك حساب، أنشئ حسابًا جديدًا.':
      'Mobile number or password is incorrect. If you have no account, create a new one.',
    'رقم الموبايل أو كلمة السر غير صحيحة': 'Mobile number or password is incorrect',
    'أهلًا بك ': 'Welcome, ',
    '🎓 أهلًا بك مجددًا في رحيق': '🎓 Welcome back to Raheeq',
    '🎓 تم استلام طلبك وحفظ الصور فعليًا — رقم الطلب ': '🎓 Your request was received and images saved — order ',
    '📋 تم نسخ رقم الطلب: ': '📋 Order number copied: ',
    '⚠ انسخ الرقم يدويًا: ': '⚠ Copy the number manually: ',
    'ℹ أرسل طلبك الآن إلى أكاديمية رحيق على واتساب من الزر الأخضر — وطلبك ومستنداته جاهزة للإرسال.':
      'ℹ Send your request now to Raheeq Academy on WhatsApp from the green button — your request and documents are ready.',
    '⏳ جارٍ إرسال طلبك ومستنداتك إلى الأكاديمية…': '⏳ Sending your request and documents to the academy…',
    '✅ وصل طلبك ومستنداتك إلى الأكاديمية — رقم الطلب ': '✅ Your request and documents reached the academy — order ',
    '✅ تم إرسال الطلب والمستندات إلى الخادم': '✅ Request and documents sent to the server',
    'لا يزال طلبك ومستنداتك جاهزين — أرسلهما الآن على واتساب من الزر الأخضر.':
      'Your request and documents are still ready — send them now on WhatsApp from the green button.',
    '⚠ ': '⚠ ',
    '✓ خدمة الاستلام جاهزة — سيصل طلبك ومستنداته إلى فريق الأكاديمية فور الإرسال.':
      '✓ The receiving service is ready — your request and documents reach the academy team as soon as you send them.',
    'أكمل بياناتك ومستنداتك، وسيصل طلبك كاملًا إلى فريق أكاديمية رحيق على واتساب فور الإرسال.':
      'Complete your details and documents; your full request reaches the Raheeq Academy team on WhatsApp as soon as you send it.',
    'هذا المتصفح لا يدعم الاتصال بالخادم': 'This browser does not support server connection',
    'متصفحك لا يدعم الاتصال المباشر — أرسل طلبك على واتساب أكاديمية رحيق من الزر الأخضر':
      'Your browser does not support direct connection — send your request to Raheeq Academy on WhatsApp from the green button',
    'انتهت مهلة الاتصال بالخادم': 'Server connection timed out',
    'انتهت مهلة الاتصال بالخادم؛ تحقّق من الشبكة وأعد المحاولة': 'Server connection timed out; check your network and retry',
    'تعذّر الاتصال بالخادم؛ تحقّق من الشبكة أو من تشغيل الخادم ثم أعد المحاولة':
      'Could not reach the server; check the network or that the server is running, then retry',
    'حجم المستندات أكبر من المسموح؛ صغّر الصور ثم أعد الإرسال':
      'Documents exceed the allowed size; shrink the images and resend',
    'عدد محاولات كبير على الخادم؛ انتظر دقيقة ثم أعد المحاولة': 'Too many attempts on the server; wait a minute and retry',
    'الخادم رفض الطلب (صلاحيات)؛ تواصل مع إدارة أكاديمية رحيق':
      'The server rejected the request (permissions); contact the Raheeq Academy administration',
    'تعذّر إتمام الإرسال الآن؛ أعد المحاولة، أو أرسل طلبك على واتساب أكاديمية رحيق':
      'Could not complete the send right now; retry, or send your request to Raheeq Academy on WhatsApp',
    'تعذّر إرسال الطلب إلى الخادم': 'Could not send the request to the server',
    'حجم الطلب مع الصور كبير جدًا؛ اختر صورًا أصغر ثم أعد الإرسال':
      'The request with images is too large; choose smaller images and resend',

    /* ---------- أخطاء الملفات ---------- */
    'هذا المتصفح لا يدعم قراءة الملفات': 'This browser does not support reading files',
    'تعذّر قراءة الملف، جرّب ملفًا آخر': 'Could not read the file; try another file',
    'تعذّر قراءة الملف': 'Could not read the file',
    'تعذّر فتح الصورة على هذا المتصفح، حوّلها إلى JPG أو PNG وأعد المحاولة':
      'Could not open the image in this browser; convert it to JPG or PNG and retry',
    'أبعاد الصورة غير صالحة': 'Invalid image dimensions',
    'المتصفح لا يدعم معالجة الصور على Canvas': 'This browser does not support canvas image processing',
    'تعذّر إنتاج صورة صالحة': 'Could not produce a valid image',
    'الصورة كبيرة جدًا حتى بعد الضغط؛ استخدم صورة أصغر أو أقل تفاصيل':
      'The image is too large even after compression; use a smaller image',
    'تعذّر قراءة ملف PDF': 'Could not read the PDF file',
    'محتوى ملف PDF غير صالح': 'Invalid PDF content',
    'لم يتم اختيار ملف': 'No file selected',
    'صيغة الملف غير مدعومة — اختر صورة JPG/PNG/WEBP أو ملف PDF':
      'Unsupported file format — choose a JPG/PNG/WEBP image or a PDF',
    'حجم الملف يتجاوز 12 ميجابايت؛ اختر صورة أصغر': 'File size exceeds 12 MB; choose a smaller image',
    'حجم ملف PDF يتجاوز 700 كيلوبايت؛ حوّله إلى صورة أو صغّره':
      'PDF size exceeds 700 KB; convert it to an image or shrink it',
    'ملف PDF كبير جدًا على مساحة التخزين؛ حوّله إلى صورة': 'PDF is too large for storage; convert it to an image',
    'الملفات غير المدعومة مرفوضة': 'Unsupported files are rejected',
    'رحيق (الافتراضي)': 'Raheeq (default)',
    'رحيق (افتراضي)': 'Raheeq (default)',
    'زمردي': 'Emerald',
    'أزرق ملكي': 'Royal blue',
    'ليلي داكن': 'Midnight',
    'وردي': 'Rose',
    'رملي تراثي': 'Heritage sand',
    'فيروزي': 'Teal',
    'أسود وذهبي': 'Obsidian & gold',
    'صورة': 'Image',
    'فتح الصفحة': 'Open page',

    /* ---------- واتساب والإعدادات (نصوص يبنيها السكربت) ---------- */
    'لا يوجد طلب جاهز على هذه الصفحة': 'No ready request on this page',
    '📤 فتحنا واتساب أكاديمية رحيق برسالة الطلب — أرفق الصور إن لم تُرفق تلقائيًا':
      '📤 We opened Raheeq Academy WhatsApp with the request — attach images if they were not added automatically',
    '📎 تم تجهيز الرسالة مع الصور — اختر واتساب من قائمة المشاركة':
      '📎 The message and images are ready — choose WhatsApp from the share sheet',
    'هذا المتصفح لا يشارك الصور تلقائيًا — فتحنا واتساب برسالة الطلب، أرفق الصور من 📎':
      'This browser cannot share images directly — we opened WhatsApp with the request; attach the images there',
    '📋 تم نسخ رسالة الطلب — الصقها في محادثة واتساب أكاديمية رحيق':
      '📋 Request message copied — paste it in the Raheeq Academy WhatsApp chat',
    '⚠ تعذّر النسخ التلقائي؛ افتح واتساب من الزر الأخضر':
      '⚠ Auto-copy failed; open WhatsApp from the green button',
    '🎨 تم تغيير ألوان الموقع': '🎨 Site colors updated',
    '🎨 تم تطبيق اللون الحر على الموقع': '🎨 Custom color applied to the site',
    '↺ تم استعادة الإعدادات الافتراضية': '↺ Defaults restored',
    '⏳ جارٍ حفظ الطلب والصور…': '⏳ Saving the request and images…',
    '⏳ جارٍ قراءة الصور…': '⏳ Reading images…',
    'عرض الصورة بالحجم الكامل': 'View the full-size image',
    'مساحة التخزين': 'Storage',
    'خادم الأكاديمية': 'Academy server',
    '✓ تم حفظ «': '✓ Saved «',
    '» — الصورة جاهزة مع طلبك': '» — the image is ready with your request'
  };

  /* سمات تُترجم أيضًا */
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

  var lang = 'ar';
  var originals = new WeakMap();
  var observer = null;
  var applying = false;

  function t(str) {
    if (lang !== 'en') return str;
    var key = String(str);
    if (Object.prototype.hasOwnProperty.call(DICT, key)) return DICT[key];
    return key;
  }

  function prefixOf(str) {
    var m = /^(\s*)/.exec(str);
    return m ? m[1] : '';
  }
  function suffixOf(str) {
    var m = /(\s*)$/.exec(str);
    return m ? m[1] : '';
  }

  function translateText(node) {
    var raw = node.nodeValue;
    if (!raw) return;
    var trimmed = raw.trim();
    if (!trimmed) return;
    var rec = originals.get(node);
    if (!rec) {
      rec = { text: trimmed, prefix: prefixOf(raw), suffix: suffixOf(raw) };
      originals.set(node, rec);
    }
    var next = lang === 'en' && DICT[rec.text] != null ? DICT[rec.text] : rec.text;
    var value = rec.prefix + next + rec.suffix;
    if (node.nodeValue !== value) node.nodeValue = value;
  }

  function translateAttrs(el, rec) {
    ATTRS.forEach(function (attr) {
      if (!el.hasAttribute || !el.hasAttribute(attr)) return;
      if (!rec.attrs[attr]) rec.attrs[attr] = el.getAttribute(attr);
      var original = rec.attrs[attr];
      var next = lang === 'en' && DICT[original] != null ? DICT[original] : original;
      if (el.getAttribute(attr) !== next) el.setAttribute(attr, next);
    });
  }

  function walk(root) {
    if (!root) return;
    var stack = [root];
    while (stack.length) {
      var node = stack.pop();
      if (node.nodeType === 3) {
        var parent = node.parentNode;
        var tag = parent && parent.nodeName ? parent.nodeName : '';
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue;
        if (parent && parent.closest && parent.closest('[data-no-i18n]')) continue;
        translateText(node);
        continue;
      }
      if (node.nodeType !== 1) continue;
      if (node.hasAttribute && node.hasAttribute('data-no-i18n')) continue;
      var tagName = node.nodeName;
      if (tagName === 'SCRIPT' || tagName === 'STYLE') continue;
      var rec = originals.get(node);
      if (!rec) { rec = { attrs: {} }; originals.set(node, rec); }
      if (!rec.attrs) rec.attrs = {};
      translateAttrs(node, rec);
      for (var i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]);
    }
  }

  function translateMeta() {
    var title = document.querySelector('title');
    if (title && title.firstChild) translateText(title.firstChild);
    ['meta[name="description"]', 'meta[property="og:title"]', 'meta[property="og:description"]',
     'meta[name="twitter:title"]', 'meta[name="twitter:description"]'].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el) return;
      var rec = originals.get(el);
      if (!rec) { rec = { attrs: {} }; originals.set(el, rec); }
      if (!rec.attrs.content) rec.attrs.content = el.getAttribute('content');
      var original = rec.attrs.content;
      var next = lang === 'en' && DICT[original] != null ? DICT[original] : original;
      if (el.getAttribute('content') !== next) el.setAttribute('content', next);
    });
  }

  function apply(next, opts) {
    if (next) lang = next === 'en' ? 'en' : 'ar';
    if (!document.body) return lang;
    if (applying) return lang;
    applying = true;
    try {
      walk(document.body);
      translateMeta();
    } finally {
      applying = false;
    }
    if (!opts || opts.observe !== false) startObserver();
    if (global.document) {
      global.document.documentElement.setAttribute('lang', lang);
      global.document.documentElement.setAttribute('dir', lang === 'en' ? 'ltr' : 'rtl');
    }
    return lang;
  }

  function startObserver() {
    if (observer || !global.MutationObserver || !document.body) return;
    observer = new global.MutationObserver(function (mutations) {
      if (applying) return;
      applying = true;
      try {
        mutations.forEach(function (m) {
          if (m.type === 'characterData') {
            translateText(m.target);
          } else if (m.type === 'attributes') {
            var rec = originals.get(m.target);
            if (!rec) { rec = { attrs: {} }; originals.set(m.target, rec); }
            if (!rec.attrs) rec.attrs = {};
            var attr = m.attributeName;
            if (ATTRS.indexOf(attr) > -1) {
              /* القيمة تغيّرت من السكربت: اعتبرها نصًا عربيًا جديدًا */
              var cur = m.target.getAttribute(attr);
              var en = lang === 'en' && DICT[cur] != null ? DICT[cur] : cur;
              rec.attrs[attr] = cur;
              if (en !== cur) m.target.setAttribute(attr, en);
            }
          } else if (m.addedNodes) {
            m.addedNodes.forEach(function (n) {
              if (n.nodeType === 1 || n.nodeType === 3) walk(n);
            });
          }
        });
      } finally {
        applying = false;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  function onChange(fn) {
    if (typeof fn === 'function') global.addEventListener('raheeq:langchange', function (e) { fn(e.detail.lang); });
  }

  global.RaheeqI18n = {
    DICT: DICT,
    t: t,
    apply: apply,
    onChange: onChange,
    lang: function () { return lang; },
    isEnglish: function () { return lang === 'en'; }
  };
})(typeof window !== 'undefined' ? window : this);
