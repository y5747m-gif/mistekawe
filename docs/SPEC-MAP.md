# خريطة المواصفات الستين → التنفيذ

هذا الملف يربط كل بند من المواصفات الاحترافية المطلوبة بمكانه الفعلي في الكود.

| # | المطلب | التنفيذ |
|---|--------|---------|
| 1 | أداة مستقلة تحلل الصورة وتعيد بناء نموذج 3D | `ai3d/engine/*` — لا يوجد أي نداء شبكي في المحرك |
| 2 | IMAGE → ANALYSIS → DEPTH → RECONSTRUCTION → MESH → TEXTURE → OPTIMIZATION | `ai3d/engine/pipeline.js` (13 مرحلة) |
| 3 | صيغ الصور JPG/PNG/WEBP/BMP/TIFF + أنواع محتوى متعددة | `core.js › loadImageFile` (EXIF orientation) + مصنّف الأنواع في `detection.js` |
| 4 | تحليل الصورة (دقة، نسبة، جودة، تشويش، إضاءة، تباين، ألوان، حدة، زاوية، منظور) | `analysis.js › analyzeImage` |
| 5 | Object Detection وعناصر متعددة قابلة للاختيار | `detection.js › detectObjects` + واجهة «الأجسام» في `studio.html` |
| 6 | العزل Segmentation بمحافظة على الشعر/الحواف/الفتحات | `segmentation.js › refineMask` (GMM + color-line matting) |
| 7 | Depth Estimation وخريطة عمق أساسية للبناء | `depth.js › estimateDepth` (SfS + إشارات متعددة + ثقة) |
| 8 | تحليل الشكل الهندسي (حواف، انحناءات، أسطح، تجاويف، أجزاء) | `depth.js › analyzeDepthGeometry / segmentParts` |
| 9 | فهم نوع الجسم (مركبة/أثاث/شخص/حيوان/منتج/مبنى) | `detection.js › classify` + `TYPE_AR` |
| 10 | تقدير الأجزاء غير المرئية مع تمييز Observed vs Estimated | `geometry.js` (سمة `observed` لكل رأس) + زر `◑` في العارض |
| 11 | تمثيل ثلاثي الأبعاد (Point Cloud / Implicit / Voxel) ثم Mesh | `geometry.js › buildPointCloud` و`reconstruct` (TSDF + Marching Tetrahedra) |
| 12 | Mesh Reconstruction: إغلاق ثقوب، إزالة تشوهات، تحسين حواف | `geometry.js › repairMesh / fillSmallHoles / removeIsolated` |
| 13 | مستويات جودة Low/Medium/High/Ultra | `geometry.js › QUALITY` (دقة شبكة TSDF) + تبسيط يدوي可选 |
| 14 | Texture من الصورة + UV Mapping | `texture.js › buildUVAtlas` (إسقاط محوري 6 اتجاهات + تعبئة) |
| 15 | تحليل الخامات (معدن/بلاستيك/زجاج/خشب/قماش/جلد/مطاط/حجر/خرسانة/سيراميك) | `texture.js › estimateMaterial` + خرائط Roughness/Metalness |
| 16 | تحليل الإضاءة وعدم تثبيتها داخل الـ Texture | `analysis.js › estimateLighting` + إزالة الإضاءة (de-light) في `bakeMaps` |
| 17 | معالجة الانعكاسات وفصل لون السطح عن الإضاءة | `analysis › light.specular` + `estimateMaterial › scores.glass/metal` |
| 18 | معالجة الشفافية (زجاج/بلاستيك/ماء) | `estimateMaterial › transparency/ior` + `KHR_materials_transmission` في GLB |
| 19 | إعادة بناء التفاصيل (هندسة كبيرة + Normal/Texture للتفاصيل الدقيقة) | شبكة TSDF للهندسة + `bakeMaps` لخرائط Normal/AO/ORM |
| 20 | التعامل مع الأشخاص (رأس/جسم/أطراف/وضعية) | `detection` كشف الرأس (دوائر) + `objectFeatures` (skinRatio/تماثل) + سماكة مناسبة في `THICKNESS.human` |
| 21 | السيارات والمركبات (هيكل/نوافذ/عجلات…) | `detectCircles` (عجلات) + `THICKNESS.vehicle` + تصنيف `vehicle` |
| 22 | المنتجات (شكل/لون/شعار/كتابة/حواف) | خبز الألوان بدقة حتى 4096px + تصنيف `product` |
| 23 | الصور متعددة العناصر: «تحويل الكل» أو اختيار عنصر | `studio.js › allObjBtn` + `Detection.unionBoxes` |
| 24 | Multi-View Reconstruction | `depth.js › fuseDepths` + وضع «صور متعددة» (حتى 6) |
| 25 | اكتشاف الصور غير المناسبة مع إمكانية المتابعة | `analysis.js › buildWarnings` + `blocking` + `warnbox` في الواجهة |
| 26 | نظام تحسين تلقائي (ثقوب/Non-manifold/رؤوس عائمة/Normals/UV) | `geometry.js › repairMesh` + `meshStats` (فحص مانيفولد) |
| 27 | نظام تقييم النموذج بنسب واضحة | `pipeline.js › computeScores` + تنبيه بأنها تقديرية |
| 28 | عارض 3D احترافي (تدوير/زوم/تحريك/إعادة ضبط/زوايا/دوران تلقائي/wireframe/solid/texture/إضاءة/خلفية) | `app/viewer.js` |
| 29 | مقارنة الصورة بالنموذج | قسم «مقارنة Before/After» في `studio.html` |
| 30 | وضع Before/After مع شريط مقارنة | `#cmpRange` + clip-path |
| 31 | التصدير GLB / glTF / OBJ / STL / PLY | `exporters.js` (كتّاب ثنائيون مكتوبون داخليًا) |
| 32 | تنزيل النموذج، والـ Texture، وحزمة المشروع ZIP | أزرار التصدير + `exportProjectZIP` |
| 33 | المعالجة المحلية (CPU/GPU/WebGPU/WASM) | كل شيء في المتصفح + `backends.js › detectCapabilities` |
| 34 | تشغيل النموذج على خادم المشروع عند الحاجة | `server/serve.py` + `backends.js` (النماذج تُحمّل من `models/` في نفس المشروع) |
| 35 | عدم الاعتماد على أدوات خارجية | لا يوجد أي `fetch` لخدمة AI في المحرك؛ كل المراحل خوارزميات داخلية |
| 36 | الخصوصية (حفظ/مدة/حذف/إرسال/تدريب) | قسم «الخصوصية والاستقلالية» + تخزين محلي + «حذف كل بياناتي» |
| 37 | واجهة حديثة (Minimal/Professional/Futuristic/Clean/Fast/Responsive) | `studio.html` + `ai3d/css/studio.css` |
| 38 | إعدادات التحويل (الوضع/الجودة/الـTexture/الهندسة/الإخراج) | قسم «الإعدادات» |
| 39 | شريط معالجة بمراحل واضحة وعدم تجميد الواجهة | `pipeline.js › STAGES` + تحديث تدريجي مع `await tick` |
| 40 | معلومات النموذج (اسم/نوع/مضلعات/رؤوس/دقة/حجم/زمن/جودة/أبعاد) | `pipeline.js › buildInfo` + بطاقة «معلومات النموذج» |
| 41 | التحكم في أبعاد النموذج مع تنبيه التقديرية | حقول القياس + `applyScale` |
| 42 | Reference Object (بطاقة/مسطرة/عملة) | قائمة «جسم مرجعي معروف» + `applyScale` |
| 43 | Perspective Correction | `analysis.js › correctPerspective` (خيار في الإعدادات) |
| 44 | AI Image Enhancement (حدة/دقة/تباين/تشويش) بدون تفاصيل وهمية | `analysis.js › enhanceImage` (خيار قبل التحليل) |
| 45 | معالجة الصور القديمة قبل إعادة البناء | نفس الخيار + رسائل «Image Quality Enhancement» |
| 46 | نظام إعادة المحاولة Improve Model | `pipeline.js › suggestImprovements` + أزرار التحسين |
| 47 | تعديل النموذج (تحجيم/تدوير/تحريك/توسيط/Normals/Smooth/Decimate/Repair) | `geometry.js` + قسم «تعديل النموذج» |
| 48 | حذف أجزاء غير مرغوبة | تحديد بمستطيل على العارض + `deleteVertices` |
| 49 | إعادة توليد جزء محدد | `pipeline.js › reconstructRegion` + زر «إعادة بناء المنطقة المحددة» |
| 50 | نظام المشاريع | `studio.js` + IndexedDB (اسم/صورة/نموذج/تاريخ/جودة/تنزيل) |
| 51 | تصميم متجاوب + تحسين العارض للهواتف | CSS media queries + ارتفاع مرن للعارض |
| 52 | دعم اللمس (سحب/قرص/إصبعان/نقرة مزدوجة) | `viewer.js › _bindInput` (Pointer Events) |
| 53 | وضع ليلي ونهاري | `data-theme` + زر التبديل + حفظ الاختيار |
| 54 | رسائل خطأ واضحة بالعربية | `studio.js › friendlyError` |
| 55 | الذكاء الاصطناعي مسؤول عن التحليل (لا قواعد ثابتة فقط) | نماذج إحصائية/تعلمية خفيفة: GMM (EM)، Saliency Optimization، حل المربعات الصغرى، QEM |
| 56 | البنية المقترحة للمراحل | مطابقة بالكامل في `pipeline.js` |
| 57 | محرك إعادة بناء حقيقي لا واجهة فوق API | `ai3d/engine` هو قلب المشروع؛ الواجهة مجرد وسيط |
| 58 | رحلة المستخدم من الرفع حتى الحفظ والتصدير | مطبّقة في `studio.html` بأقسام مرقّمة 1→7 |
| 59 | تعريف الأداة في جملة واحدة | «أداة ذكاء اصطناعي مستقلة لتحليل الصور وإعادة بناء محتواها كنماذج ثلاثية الأبعاد… دون الاعتماد على خدمة AI خارجية» |
| 60 | هدف احترافي قابل للتطوير | سجل النماذج `AI3D.Models` + `AI3D.Backends.install` يسمحان بتركيب نماذج أقوى دون تغيير الواجهة |

## ما هو «تقديري» تحديدًا؟

* **العمق المطلق والمقياس:** صورة واحدة بلا مرجع ⇒ الأبعاد نسبية.
* **الأجزاء غير المرئية:** الظهر والجوانب تُبنى بسماكة مُستنتَجة (موسومة `estimated`).
* **الخامة:** تقدير إحصائي من اللون واللمعان والتباين الموضعي.
* **درجات الجودة:** مقاييس داخلية، وليست قياسًا مقابل نموذج مرجعي حقيقي.
