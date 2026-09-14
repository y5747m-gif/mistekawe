/* ============================================================
 * pipeline.js — منسّق مراحل المعالجة (مواصفة 39 + 56)
 * IMAGE → ANALYSIS → DEPTH → RECONSTRUCTION → MESH → TEXTURE
 * → OPTIMIZATION → MODEL  — كل مرحلة قابلة للاستبدال عبر
 * AI3D.Models دون تغيير الواجهة.
 * ============================================================ */
(function (global) {
  'use strict';
  const AI3D = global.AI3D;
  const U = AI3D.util;

  const STAGES = [
    { id: 'uploading', ar: 'رفع الصورة', en: 'Uploading' },
    { id: 'analyzing', ar: 'تحليل الصورة', en: 'Analyzing Image' },
    { id: 'detecting', ar: 'اكتشاف الأجسام', en: 'Detecting Objects' },
    { id: 'segmenting', ar: 'عزل الجسم', en: 'Segmenting' },
    { id: 'depth', ar: 'توليد خريطة العمق', en: 'Generating Depth Map' },
    { id: 'geometry', ar: 'إعادة بناء الهندسة', en: 'Reconstructing Geometry' },
    { id: 'mesh', ar: 'توليد الـ Mesh', en: 'Generating Mesh' },
    { id: 'texture', ar: 'توليد الـ Texture', en: 'Generating Texture' },
    { id: 'optimizing', ar: 'تحسين النموذج', en: 'Optimizing Model' },
    { id: 'finalizing', ar: 'تجهيز المشهد ثلاثي الأبعاد', en: 'Finalizing 3D Scene' },
    { id: 'complete', ar: 'اكتمل', en: 'Complete' }
  ];

  const call = (name, fallback, ...args) => {
    const fn = AI3D.Models.get(name) || fallback;
    return fn(...args);
  };

  async function runPipeline(frames, options, onProgress) {
    options = Object.assign({
      mode: 'single', quality: 'medium', texture: 'high', geometry: 'balanced',
      output: 'glb', enhance: false, perspective: false, selection: 'auto', // auto | all | <objectId>
      depthScale: 0.55, refWidthCm: null
    }, options || {});
    const t0 = performance.now();
    const emit = async (stage, pct, extra) => {
      if (onProgress) onProgress(stage, pct, extra);
      await U.tick(10);
    };

    // 0) الرفع (تهيئة الإطارات)
    await emit('uploading', 4);
    const prepared = [];
    for (const f of frames) {
      let canvas = f.canvas;
      if (options.enhance) canvas = AI3D.Analysis.enhanceImage(canvas, { amount: 0.6 });
      const img = U.getImageData(canvas);
      prepared.push({ canvas, img, w: canvas.width, h: canvas.height, name: f.name });
      await U.tick(0);
    }
    const ref = prepared[0];
    if (options.perspective) {
      // يُطبَّق بعد التحليل (نحتاج skew) — معالجة لاحقة
    }

    // 1) التحليل
    await emit('analyzing', 12);
    let analysis = call('analysis', AI3D.Analysis.analyzeImage, ref.img, ref.w, ref.h);
    if (options.perspective && Math.abs(analysis.perspective.skew) > 0.04) {
      const fixed = AI3D.Analysis.correctPerspective(ref.canvas, analysis.perspective.skew, 0.6);
      ref.canvas = fixed;
      ref.img = U.getImageData(fixed);
      analysis = call('analysis', AI3D.Analysis.analyzeImage, ref.img, ref.w, ref.h);
      analysis.perspectiveCorrected = true;
    }

    // 2) اكتشاف الأجسام
    await emit('detecting', 24);
    const detection = call('detection', AI3D.Detection.detectObjects, ref.img, ref.w, ref.h, analysis);
    await U.tick(0);

    // اختيار الجسم
    let targetBox, objectType = 'object', objectLabel = 'جسم';
    if (options.selection === 'all' && detection.objects.length > 1) {
      targetBox = AI3D.Detection.unionBoxes(detection.objects);
      objectType = 'object'; objectLabel = 'كل الأجسام (' + detection.objects.length + ')';
    } else if (typeof options.selection === 'number' && detection.objects[options.selection]) {
      const o = detection.objects[options.selection];
      targetBox = o.bbox; objectType = o.type; objectLabel = o.typeAr;
    } else if (detection.objects.length) {
      const o = detection.objects[0];
      targetBox = o.bbox; objectType = o.type; objectLabel = o.typeAr;
    } else {
      targetBox = { x0: 0.08, y0: 0.08, x1: 0.92, y1: 0.92 }; // احتياطي: الصورة كاملة
    }

    // 3) العزل
    await emit('segmenting', 36);
    let seg = call('segmentation', AI3D.Detection.segmentSelection, ref.img, ref.w, ref.h, targetBox, {});
    await U.tick(0);
    if (seg.coverage < 0.01) {
      // فشل العزل — استخدم بروزًا عامًا
      const sal = detection.saliency, sw = detection.saliencyW, sh = detection.saliencyH;
      const full = new Float32Array(ref.w * ref.h);
      for (let y = 0; y < ref.h; y++) for (let x = 0; x < ref.w; x++) {
        const sx = Math.min(sw - 1, (x / ref.w * sw) | 0), sy = Math.min(sh - 1, (y / ref.h * sh) | 0);
        full[y * ref.w + x] = sal[sy * sw + sx] > detection.threshold ? 1 : 0;
      }
      seg = { mask: full, w: ref.w, h: ref.h, bbox: targetBox, coverage: 0.05, fallback: true };
    }

    // 4) العمق (يدعم تعدد الصور)
    await emit('depth', 50);
    const depthFrames = [];
    const framesToUse = options.mode === 'multi' ? prepared : [ref];
    for (const fr of framesToUse) {
      let m = seg.mask, mw = seg.w, mh = seg.h;
      if (fr !== ref) {
        // عزل سريع للإطار الإضافي بنفس المنطقة النسبية
        const s2 = call('segmentation', AI3D.Detection.segmentSelection, fr.img, fr.w, fr.h, seg.bbox, { pad: 0.04 });
        m = s2.mask; mw = s2.w; mh = s2.h;
      }
      const salField = fr === ref
        ? { field: detection.saliency, w: detection.saliencyW, h: detection.saliencyH }
        : null;
      const est = call('depth', AI3D.Depth.estimateDepth, fr.img, fr.w, fr.h, m, salField,
        { geometry: options.geometry, objectType });
      depthFrames.push({ depth: est.depth, mask: m, w: mw, h: mh, confidence: est.confidence, lum: AI3D.field.luminanceField(fr.img, fr.w, fr.h) });
      await U.tick(0);
    }
    let depthRes = depthFrames[0];
    if (depthFrames.length > 1) {
      // وحّد الأبعاد إلى المرجع ثم ادمج
      const rw = ref.w, rh = ref.h;
      const norm = depthFrames.map(f => {
        if (f.w === rw && f.h === rh) return f;
        return {
          depth: AI3D.field.resampleField(f.depth, f.w, f.h, rw, rh),
          mask: AI3D.field.resampleField(f.mask, f.w, f.h, rw, rh),
          confidence: f.confidence ? AI3D.field.resampleField(f.confidence, f.w, f.h, rw, rh) : null,
          w: rw, h: rh
        };
      });
      const fused = AI3D.Depth.fuseDepths(norm);
      depthRes = { depth: fused.depth, confidence: fused.confidence || depthFrames[0].confidence, w: rw, h: rh, fused: norm.length };
    }

    // 5) الهندسة: سحابة نقطية ضمنية → Mesh
    await emit('geometry', 62);
    await U.tick(0);
    const depthScaleForType = options.depthScale *
      (objectType === 'vehicle' ? 0.8 : (objectType === 'human' || objectType === 'animal' ? 0.62 : (objectType === 'building' ? 0.4 : 0.55))) / 0.55;

    // 6) الـ Mesh
    await emit('mesh', 72);
    let mesh = call('reconstruction', AI3D.Geometry.buildMesh, {
      depth: depthRes.depth, mask: seg.mask, confidence: depthRes.confidence,
      w: ref.w, h: ref.h, bbox: seg.bbox, quality: options.quality, depthScale: depthScaleForType
    });
    await U.tick(0);

    // 7) الـ Texture + الخامة
    await emit('texture', 82);
    const texCanvas = U.makeCanvas(ref.w, ref.h);
    texCanvas.getContext('2d').putImageData(ref.img, 0, 0);
    const texture = call('texture', AI3D.Texture.buildTexture, texCanvas, seg.mask, ref.w, ref.h, options.texture);
    const material = AI3D.Texture.estimateMaterial(ref.img, ref.w, ref.h, seg.mask, analysis, objectType);
    const normalCanvas = AI3D.Texture.buildNormalMap(depthRes.depth, Math.min(ref.w, 512) | 0, Math.min(ref.h, 512) | 0, 2.0);
    await U.tick(0);

    // 8) التحسين
    await emit('optimizing', 90);
    mesh = AI3D.Geometry.removeIsolated(mesh, 0.015);
    if (options.geometry === 'detailed') AI3D.Geometry.smoothMesh(mesh, 1, 0.3);
    await U.tick(0);
    const stats = AI3D.Geometry.meshStats(mesh);

    // 9) التجهيز النهائي + التقييم
    await emit('finalizing', 96);
    const procMs = performance.now() - t0;
    const scores = computeScores({ analysis, stats, seg, mesh, texture, depthRes });
    const info = buildInfo({ stats, texture, procMs, objectLabel, objectType, options, ref });
    await emit('complete', 100);

    return {
      mesh, texture: texture.canvas, textureSize: { w: texture.width, h: texture.height },
      normalMap: normalCanvas, material,
      analysis, detection, segmentation: seg, depth: depthRes,
      scores, info, stats, options: Object.assign({}, options),
      objectType, objectLabel,
      refCanvas: ref.canvas, procMs
    };
  }

  function computeScores(ctx) {
    const { analysis, stats, seg, mesh } = ctx;
    // هندسة: من التغطية + سلامة الشبكة + دقة الصورة
    const coverage = U.clamp01(seg.coverage * 4);
    const triQ = U.clamp01(stats.faces / 40000 + 0.35);
    const geoQ = U.clamp01(0.4 * coverage + 0.3 * triQ + 0.3 * analysis.quality.overall);
    // texture: من دقة الصورة + حدتها
    const texQ = U.clamp01(0.5 * analysis.quality.resolution + 0.3 * analysis.quality.sharpness + 0.2 * (1 - analysis.noise));
    // سلامة الشبكة: نسبة المرصود + عدم وجود عزل احتياطي
    const integQ = U.clamp01(0.55 + 0.3 * stats.observedRatio + (seg.fallback ? -0.15 : 0.1));
    // ثقة العمق: متوسط ثقة الرؤوس المرصودة
    let cs = 0, cc = 0;
    for (let i = 0; i < mesh.confidence.length; i += 3) { cs += mesh.confidence[i]; cc++; }
    const depthQ = U.clamp01((cs / Math.max(1, cc)) * 1.15);
    const overall = 0.32 * geoQ + 0.26 * texQ + 0.2 * integQ + 0.22 * depthQ;
    const pct = v => Math.round(U.clamp01(v) * 100);
    return {
      geometry: pct(geoQ), texture: pct(texQ), integrity: pct(integQ),
      depth: pct(depthQ), overall: pct(overall),
      disclaimer: 'تقييمات داخلية تقديرية — ليست ضمانًا لدقة حقيقية.'
    };
  }

  function buildInfo(ctx) {
    const { stats, texture, procMs, objectLabel, objectType, options, ref } = ctx;
    const b = stats.bounds.size;
    return {
      objectType, objectLabel,
      vertices: stats.vertices, faces: stats.faces,
      textureResolution: texture.width + '×' + texture.height,
      processingTime: U.fmtTime(procMs), processingMs: Math.round(procMs),
      dimensions: { x: +b[0].toFixed(3), y: +b[1].toFixed(3), z: +b[2].toFixed(3), unit: 'unit (تقديري)' },
      sourceResolution: ref.w + '×' + ref.h,
      quality: options.quality, geometry: options.geometry, mode: options.mode,
      estimatedNotice: 'الأبعاد والأجزاء الخلفية تقديرية (AI Estimated) ما لم توجد مرجعية حقيقية.'
    };
  }

  AI3D.Pipeline = { runPipeline, STAGES };
})(window);
