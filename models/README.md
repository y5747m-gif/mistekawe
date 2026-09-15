# مجلد النماذج المحلية (اختياري)

المحرك يعمل **كاملًا بدون هذا المجلد** — كل المراحل خوارزميات داخلية.
هذا المجلد مخصص لمن يريد تركيب نموذج عصبي **محلي** (مثل Depth Anything / MiDaS /
YOLO / SAM بصيغة ONNX) ليحسّن إحدى المراحل، بشرط واحد: **لا يوجد أي API خارجي**.
الأوزان تعمل على جهاز المستخدم داخل المتصفح (WebGPU / WASM / WebGL).

## البنية المتوقعة

```
models/
  manifest.json
  depth-local.js        ← يركّب النموذج عبر AI3D.Backends.install(...)
  *.onnx                ← الأوزان (غير مرفوعة إلى Git)
```

### manifest.json

```json
{
  "models": [
    { "stage": "depth", "file": "depth-local.js", "name": "depth-anything-v2-small" }
  ]
}
```

### depth-local.js (مثال)

```js
export default async function (AI3D, install) {
  // حمّل أوزانك من نفس المجلد (طلب محلي، لا خدمة خارجية)
  const session = await MyOrtRuntime.load('models/depth-anything-v2-small.onnx');
  install('depth', {
    name: 'depth-anything-v2-small (محلي)',
    async predict(img, w, h, mask, ctx) {
      const out = await session.run(img, w, h);      // Float32Array بمدى 0..1
      return { depth: out, confidence: null, w, h };
    }
  });
}
```

## المراحل القابلة للاستبدال

| المرحلة | المدخلات | المخرجات المتوقعة |
|---------|----------|-------------------|
| `analysis` | `(img, w, h, opts)` | تقرير التحليل |
| `detection` | `(img, w, h, analysis, opts)` | `{objects[], saliency...}` |
| `segmentation` | `(img, w, h, seedMask, opts)` | `{mask, hard, bbox, coverage}` |
| `depth` | `(img, w, h, mask, ctx, opts)` | `{depth, confidence, w, h}` |
| `reconstruction` | `(input)` | كائن Mesh |
| `texture` | `(atlas, img, opts)` | `{albedo, normal, orm}` |
| `material` | `(img, w, h, mask, analysis, type)` | كائن الخامة |

## ملاحظات

* ملفات الأوزان (`.onnx`, `.bin`, `.safetensors`) مستثناة من Git عبر `.gitignore`.
* إن لم تُركّب أي نموذج، يعمل المحرك بخوارزمياته المدمجة (افتراضي آمن).
* لا تضف أي كود يتصل بشبكة خارجية — هذا يخالف قاعدة المشروع الأساسية.
