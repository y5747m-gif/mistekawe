# MISTEKAWE

مستودع يجمع بين متجر إلكتروني (ننجاوي) و**استوديو AI 3D** لتحويل الصور إلى
نماذج ثلاثية الأبعاد.

## استوديو AI IMAGE TO 3D

مدخل الاستوديو: `studio.html` — محرك إعادة بناء ثلاثي الأبعاد محلي ومستقل:

```
IMAGE → ANALYSIS → DETECTION → SEGMENTATION → DEPTH → POINT CLOUD
      → TSDF RECONSTRUCTION → MESH → UV ATLAS → TEXTURE/MATERIALS
      → OPTIMIZATION → VIEWER → EXPORT
```

* **لا يعتمد على أي خدمة ذكاء اصطناعي خارجية** (لا OpenAI/ChatGPT ولا خدمة تحويل جاهزة).
* كل المعالجة تتم على جهاز المستخدم داخل المتصفح، والصور لا تغادر الجهاز.
* تصدير: GLB • glTF • OBJ+MTL • STL • PLY • ZIP (مع الخرائط وتقرير JSON).

### التشغيل السريع

```bash
python3 server/serve.py      # http://localhost:8000/studio.html
```

### الاختبارات (بدون متصفح)

```bash
node tests/node/run-tests.mjs
```

### التوثيق

* [`ai3d/README.md`](ai3d/README.md) — بنية المحرك وطريقة تشغيله وتوسيعه.
* [`docs/SPEC-MAP.md`](docs/SPEC-MAP.md) — خريطة المواصفات الستين ومكان تنفيذ كل بند.
* [`models/README.md`](models/README.md) — كيفية تركيب نموذج عصبي محلي اختياريًا.
