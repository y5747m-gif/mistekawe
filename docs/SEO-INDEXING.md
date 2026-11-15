# فهرسة Google — دليل التشغيل

هذا الملف مرجع سريع لفهرسة `https://mistekawe.vercel.app` على Google Search Console.
آخر تحديث: 2026-11-15.

## 1) الصفحات المفهرسة (مصدر الحقيقة: `scripts/generate-sitemap.mjs`)

| الرابط | الأولوية | changefreq |
|--------|----------|------------|
| `https://mistekawe.vercel.app/` | 1.0 | daily |
| `https://mistekawe.vercel.app/shop.html` | 0.8 | weekly |
| `https://mistekawe.vercel.app/heritage.html` | 0.8 | monthly |
| `https://mistekawe.vercel.app/product.html` | 0.7 | weekly |
| `https://mistekawe.vercel.app/majlis.html` | 0.7 | weekly |
| `https://mistekawe.vercel.app/studio.html` | 0.7 | monthly |
| `https://mistekawe.vercel.app/hall.html` | 0.6 | weekly |

بعد أي تعديل على هذه القائمة: `npm run build:sitemap` (السكربت يفشل بصوت عالٍ لو صفحة
عليها `noindex` أو `canonical` مختلف، فلا تظهر رابطًا خاطئًا في الخريطة).

### مستبعدة عن قصد
- `cart.html` / `login.html` / `register.html` — عليها `<meta name="robots" content="noindex, follow">`.
- `raheeq.html` — صفحة تحويل (`meta refresh`) إلى الجذر + `noindex`.
- `admin-yaseen/` — `noindex` + `Disallow` في `robots.txt` + `X-Robots-Tag` من `vercel.json`.
- `googleXXXXXXXX.html` — ملف تحقّق Search Console فقط.
- `product.html?id=p1…` — روابط استعلام؛ الـ `canonical` يجمعها على `product.html`.

## 2) التفعيل (Verification)
- الطريقة المعتمدة: **ملف HTML** — `https://mistekawe.vercel.app/googleb5d3f8a6b43bc225.html`
- الميتا تاج في كل الصفحات: `content="b5d3f8a6b43bc225"` (بلا بادئة `google` وبلا `.html`).
  كانت مكتوبة `googleb5d3f8a6b43bc225` قبل 2026-11-15 وكانت ستُفشل التحقق بهذه الطريقة.

## 3) الخطوات بعد التفعيل
1. **Sitemaps** → أضف `sitemap.xml` (وليس الرابط الكامل) → Submit.
2. **URL Inspection** لكل رابط من الجدول أعلاه → *Request Indexing*
   (الحصة ~10–12 رابطًا/يوم للـ property، فلا داعي للتكرار).
3. بعد 48 ساعة → أسبوع: تقرير **Pages** وراجع الحالات:
   `Indexed` / `Crawled – currently not indexed` / `Duplicate, Google chose different canonical`.
4. راقب **Enhancements**: `FAQ` و`Breadcrumbs` (يجب ألا يظهر أي منها بلا محتوى مطابق في الصفحة).
5. راجع **Core Web Vitals** و**HTTPS** بعد أول أسبوع بيانات.

## 4) قواعد ثابتة في الكود (لا تكسرها)
1. **كل `Question` في JSON-LD يجب أن يكون ظاهرًا في الصفحة** بنفس النص
   (قسم `#faq` في `index.html`). إضافة سؤال لأحدهما فقط = مخالفة سياسة Google.
2. **لا تكتب ألوان الثيم كـ `style=""` داخل `<html>`** — الافتراضي معرّف على `:root`
   في `css/raheeq.css`، و`js/settings.js` يكتب المتغيّرات فقط عند تخصيص فعلي
   (كان الحل السابق يضع 28 خاصية داخل `<html>` في مصدر كل صفحة).
3. **كل صفحة لها محتوى ثابت في HTML** (بلا JavaScript): `shop.html` فيه شبكة منتجات
   ثابتة و`product.html` فيه عنوان ووصف مبدئي، والسكربت يستبدلهما بالنسخة التفاعلية.
4. **كل صفحة قابلة للوصول من رابط داخلي ثابت** — `index.html` يربط كل الصفحات من
   الفوتر (`صفحات الموقع`). الصفحة التي لا يصلها زاحف لا تُفهرس مهما كان الـ sitemap.
