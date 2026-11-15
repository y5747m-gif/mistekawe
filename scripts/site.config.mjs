/* إعدادات الموقع التقنية (SEO) — لا تحتوي أي نص ظاهر جديد:
   كل القيم هنا منقولة حرفيًا من محتوى الصفحات الموجود أصلًا. */

export const SITE = 'https://mistekawe.vercel.app';

/* الصفحات المنشورة (اسم الملف بدون .html). index = '/'.
   أي صفحة HTML جديدة في جذر المشروع تُضاف للخريطة تلقائيًا؛ هذه القائمة
   تحدد فقط بيانات Schema الإضافية لكل صفحة. */

const SOCIAL = [
  'https://youtube.com/@raheeq.foundati',
  'https://www.facebook.com/share/1D5b2pqYVv/',
  'https://www.instagram.com/ltrykh.nbd',
  'https://www.tiktok.com/@shahdadeel..952008',
];

/* الجهة: أكاديمية رحيق — البيانات كما هي منشورة في تذييل الصفحة الرئيسية */
export const ORG = {
  '@type': 'Organization',
  '@id': SITE + '/#organization',
  name: 'رحيق RAHEEQ',
  alternateName: 'أكاديمية رحيق',
  url: SITE + '/',
  logo: SITE + '/assets/brand/raheeq-icon-512.png',
  image: SITE + '/assets/brand/raheeq-og.jpg',
  email: 'info@raheeq.edu',
  telephone: '+201151947735',
  sameAs: SOCIAL,
  contactPoint: {
    '@type': 'ContactPoint',
    contactType: 'customer service',
    telephone: '+201151947735',
    email: 'info@raheeq.edu',
    availableLanguage: ['ar', 'en'],
  },
};

/* LocalBusiness: نفس بيانات الجهة فقط. لا يوجد عنوان منشور في الموقع،
   لذلك لا نضيف address (ممنوع اختراع بيانات). */
export const LOCAL_BUSINESS = {
  '@type': 'LocalBusiness',
  '@id': SITE + '/#localbusiness',
  name: 'رحيق RAHEEQ',
  alternateName: 'أكاديمية رحيق',
  url: SITE + '/',
  logo: SITE + '/assets/brand/raheeq-icon-512.png',
  image: SITE + '/assets/brand/raheeq-og.jpg',
  email: 'info@raheeq.edu',
  telephone: '+201151947735',
  sameAs: SOCIAL,
  parentOrganization: { '@id': SITE + '/#organization' },
};

/* مسار التنقل (Breadcrumb) لكل صفحة — الأسماء مأخوذة من روابط/عناوين الصفحات نفسها */
const HOME = ['رحيق RAHEEQ', '/'];
const MAJLIS = ['مجلس الصوت', '/majlis'];
const SHOP = ['المتجر', '/shop'];

export const PAGES = {
  index: {
    breadcrumb: [HOME],
    localBusiness: true,
    services: [{
      name: 'تسجيل ولي الأمر',
      description: 'رحيق RAHEEQ — منصة تسجيل ولي الأمر. سجّل ابنك في ثلاث خطوات بسيطة وآمنة، وتابع طلبك بكل سهولة.',
    }],
  },
  login: { breadcrumb: [HOME, ['تسجيل الدخول', '/login']] },
  register: { breadcrumb: [HOME, ['إنشاء حساب', '/register']] },
  majlis: {
    breadcrumb: [HOME, MAJLIS],
    services: [{
      name: 'مجلس الصوت',
      description: 'مجلس الصوت — شغّل الصوت على عدة سماعات بلوتوث معًا.',
    }],
  },
  hall: { breadcrumb: [HOME, MAJLIS, ['الوضع المتقدم', '/hall']] },
  heritage: { breadcrumb: [HOME, MAJLIS, ['التراث', '/heritage']] },
  shop: { breadcrumb: [HOME, MAJLIS, SHOP] },
  product: { breadcrumb: [HOME, MAJLIS, SHOP, ['تفاصيل المنتج', '/product']] },
  cart: { breadcrumb: [HOME, MAJLIS, ['سلة المشتريات', '/cart']] },
  studio: {
    breadcrumb: [HOME, ['استوديو 3D', '/studio']],
    services: [{
      name: 'AI IMAGE TO 3D',
      description: 'أداة ذكاء اصطناعي مستقلة: تحليل الصور، اكتشاف الأجسام، العزل، تقدير العمق، إعادة بناء Mesh وTexture وتصدير GLB/OBJ/STL/PLY — كل شيء محليًا دون أي API خارجي.',
    }],
  },
};

/* صفحات لا تدخل الخريطة: تحويلات وملفات تحقق */
export const NOT_PAGES = new Set(['raheeq']);
