# استوديو AI 3D — محرك محلي مستقل لتحويل الصور إلى نماذج ثلاثية الأبعاد

> **القاعدة الذهبية:** لا يعتمد على ChatGPT ولا على أي API خارجي.
> كل المعالجة (تحليل، عزل، عمق، هندسة، خامات، تصدير) تعمل داخل المتصفح.

## التشغيل

لا يحتاج بناءً ولا خادمًا خاصًا — افتح `studio.html` مباشرة أو عبر أي خادم ثابت:

```bash
cd /home/user/mistekawe
python3 -m http.server 8000
# ثم افتح: http://localhost:8000/studio.html
```

يعمل دون إنترنت بعد أول تحميل (لا توجد أي مكتبات CDN — حتى العارض مبني بـ WebGL خالص).

## البنية

```
studio.html                 ← الواجهة (عربي RTL، داكن/فاتح، متجاوب)
ai3d/
  css/studio.css            ← تصميم الاستوديو
  engine/                   ← قلب المشروع: AI 3D Reconstruction Engine
    core.js                 ← أدوات + سجل النماذج AI3D.Models
    analysis.js             ← تحليل الصورة + بوابة الجودة + تصحيح المنظور + تحسين
    detection.js            ← اكتشاف الأجسام + تصنيف النوع + عزل GrabCut-lite
    depth.js                ← تقدير العمق متعدد الإشارات + دمج متعدد الصور
    geometry.js             ← بناء Mesh + ظهر مُستنتَج + إصلاح + تبسيط + تنعيم
    texture.js              ← Texture + UV + Normal Map + تقدير الخامة
    exporters.js            ← GLB / OBJ+MTL / STL / PLY / ZIP
    pipeline.js             ← المنسّق: 11 مرحلة من الرفع حتى النموذج
  app/
    viewer.js               ← عارض WebGL (تدوير/لمس/إضاءة/خلفيات/تمييز المُستنتَج)
    studio.js               ← منطق الواجهة + المشاريع المحلية + المقارنة
```

## خط المعالجة

```
IMAGE → ANALYSIS → DETECTION → SEGMENTATION → DEPTH → GEOMETRY
→ MESH → TEXTURE → OPTIMIZATION → 3D MODEL → VIEWER → EXPORT
```

## تطوير المحرك مستقبلًا (دون تغيير الواجهة)

كل مرحلة مسجّلة في `AI3D.Models` ويمكن استبدالها بنموذج أقوى
(ONNX محلي، WASM، WebGPU، أو خادمك الخاص):

```js
// مثال: حقن نموذج عمق أقوى
AI3D.Models.register('depth', async (img, w, h, mask, saliency, opts) => {
  // ... نفّذ نموذجك هنا محليًا ...
  return { depth, confidence, w, h };
});
```

المراحل القابلة للاستبدال: `analysis` • `detection` • `segmentation`
• `depth` • `reconstruction` • `texture`

## ملاحظات الدقة

- الصورة الواحدة لا تحتوي عمقًا حقيقيًا — الأجزاء الخلفية **تقدير ذكي**
  (AI Estimated Geometry) ويمكن تمييزها باللون البرتقالي من العارض.
- درجات الجودة **تقديرية داخلية** وليست ضمانًا لدقة حقيقية.
- وضع الصور المتعددة (أمام/جانب/خلف…) يعطي نتائج أفضل.

## الخصوصية

- الصور لا تغادر الجهاز أبدًا — لا رفع، لا تتبع، لا تدريب.
- المشاريع تُحفظ في `localStorage` على جهازك فقط.
