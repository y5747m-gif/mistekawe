# محرك MISTEKAWE AI-3D — IMAGE → 3D

> **القاعدة الذهبية:** لا ChatGPT، ولا OpenAI، ولا أي خدمة تحويل خارجية.
> المحرك مكتفٍ بذاته: كل مرحلة (تحليل، اكتشاف، عزل، عمق، هندسة، خامات، تصدير)
> تُنفَّذ بخوارزميات مكتوبة داخل هذا المشروع وتعمل على جهاز المستخدم.

## التشغيل

```bash
cd /home/user/mistekawe
python3 server/serve.py            # ثم افتح http://localhost:8000/studio.html
# أو أي خادم ثابت:
python3 -m http.server 8000
```

لا يحتاج بناءً (no build) ولا `npm install` — ملفات HTML/CSS/JS تُحمّل مباشرة.
يعمل دون إنترنت: لا CDN، ولا خطوط خارجية، ولا مكتبات ثلاثية الأبعاد جاهزة (العارض مكتوب بـ WebGL خالص).

## خط المعالجة (Pipeline)

```
IMAGE
 → ANALYSIS        تحليل الصورة/الإضاءة/المنظور/الكاميرا/بوابة الجودة
 → DETECTION       SLIC + Saliency → مقترحات أجسام + تصنيف النوع
 → SEGMENTATION    Trimap + GMM + Local Color-Line Matting
 → DEPTH           إشارات متعددة + Shape-from-Shading + دمج بمربعات صغرى
 → POINT CLOUD     إسقاط عكسي بالكاميرا المقدّرة
 → RECONSTRUCTION  TSDF (سطح مرصود + سماكة مُستنتَجة) + Marching Tetrahedra
 → MESH CLEANUP    إصلاح/إغلاق ثقوب/تنعيم/تبسيط QEM
 → UV ATLAS        إسقاط محوري سداسي + تعبئة مخططات + حواشٍ
 → TEXTURE BAKE    خبز اللون مع إزالة الإضاءة + Normal/AO/Roughness/Metalness + حشو الثغرات
 → MATERIAL        تقدير نوع الخامة ومعاملات PBR
 → OPTIMIZATION    تحجيم اختياري بجسم مرجعي + قياس
 → VIEWER / EXPORT GLB · glTF · OBJ+MTL · STL · PLY · ZIP
```

## البنية

```
studio.html                 الواجهة (عربي RTL، داكن/فاتح، متجاوب، لمس)
ai3d/
  css/studio.css            التصميم
  engine/                   قلب المشروع
    core.js                 أدوات + حقول + ألوان + EDT + مكوّنات متصلة + سجل النماذج
    analysis.js             تحليل الصورة، الإضاءة، المنظور (Hough)، الكاميرا، التحسين، تصحيح المنظور
    detection.js            SLIC + Saliency Optimization + كشف دوائر + مصنّف الأنواع
    segmentation.js         GMM (EM) + Matting بخط اللون المحلي + Trimap تلقائي
    depth.js                إشارات العمق + حل SfS التكراري + التجانس الحافظ للحواف + دمج متعدد الصور
    geometry.js             سحابة نقطية + TSDF + Marching Tetrahedra + إصلاح/تنعيم/تبسيط QEM + أدوات تعديل
    texture.js              أطلس UV + خبز الخرائط + حشو push-pull + تقدير الخامة + معاينات
    exporters.js            كتّاب GLB/glTF/OBJ/STL/PLY/ZIP + ترميز PNG داخلي
    pipeline.js             المنسّق (13 مرحلة) + التقييم + التحسين + إعادة بناء منطقة
    backends.js             قدرات الجهاز + تركيب نماذج عصبية محلية (اختياري)
  app/
    viewer.js               عارض WebGL: Texture/Solid/Wireframe/X-Ray/Material/Point Cloud + تحديد منطقة
    studio.js               منطق الواجهة + المشاريع (IndexedDB) + التصدير + الخصوصية
tests/node/                 اختبارات تعمل في Node بدون DOM
server/serve.py             خادم ثابت (مكتبة Python القياسية فقط)
models/                     (اختياري) أوزان نماذج محلية — خارج Git
```

## الاختبارات (بدون متصفح)

```bash
node tests/node/run-tests.mjs
```

تتحقق الاختبارات من: التحليل، الاكتشاف، العزل، العمق، السحابة النقطية،
إعادة البناء (واتيرتايت/مانيفولد)، الأطلس والخبز، كل صيغ التصدير،
والمسار الكامل من صورة إلى نموذج.

اختبار إضافي للواجهة داخل DOM وهمي (يتطلب jsdom، اختياري):

```bash
npm i --no-save jsdom
node tests/node/dom-smoke.mjs
```

يتحقق هذا الاختبار من تهيئة الواجهة، مسار الرفع → التحليل → الاكتشاف →
المعالجة → العارض → التقييم → الأدوات → التصدير دون أي خطأ.

## تركيب نموذج عصبي محلي (اختياري — دون أي خدمة خارجية)

المحرك يعمل بوزنه المدمج؛ وإن أردت نموذجًا عصبيًا للعمق (مثل Depth Anything)
فهو يعمل **محليًا** من مجلد `models/`:

```js
AI3D.Backends.install('depth', {
  name: 'depth-anything-v2-small (ONNX محلي)',
  predict: async (img, w, h, mask, ctx) => Float32Array  // عمق 0..1
});
```

المراحل القابلة للاستبدال: `analysis` • `detection` • `segmentation` •
`depth` • `reconstruction` • `texture` • `material`.
الاستبدال لا يغيّر الواجهة ولا بقية الخطوات. راجع `models/README.md`.

## الدقة والحدود (بصراحة)

* الصورة الواحدة لا تحتوي معلومات عمق كاملة: الأجزاء الخلفية/الجانبية
  **مُستنتَجة هندسيًا** (AI Estimated Geometry) ويُميّزها العارض بالبرتقالي.
* القياسات تقديرية ما لم تُدخل مرجعًا معروف الحجم.
* درجات الجودة تقييمات داخلية تقريبية (تغطية العزل، بروز العمق، سلامة الشبكة،
  جودة الصورة) وليست ضمانًا لدقة هندسية حقيقية.
* وضع الصور المتعددة (أمام/جانب/خلف/أعلى/أسفل) يعطي نتائج أفضل من صورة واحدة.

## الخصوصية

* الصور لا تغادر الجهاز: لا رفع، لا تتبّع، لا إحصاءات، لا تدريب.
* المشاريع والصور تُحفظ محليًا في IndexedDB، ويمكن حذفها بزر «حذف كل بياناتي».
* لا يوجد خادم يحفظ شيئًا (الخادم في `server/serve.py` ثابت فقط).
