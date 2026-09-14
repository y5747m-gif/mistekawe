/* ============================================================
 * backends.js — قدرات الجهاز + سجل النماذج المحلية (مواصفة 33+34+35)
 *
 *  القاعدة: المحرك يعمل بوزنه المدمج (خوارزميات محلية خالصة).
 *  يمكن لاحقًا تركيب نموذج عصبي **محلي** (ONNX/WebGPU/WASM) داخل
 *  مجلد models/ في نفس المشروع — دون أي اتصال بخدمة خارجية.
 *
 *  مثال الاستخدام من الكونسول أو من ملف داخل المشروع:
 *    AI3D.Backends.install('depth', {
 *      name: 'depth-anything-v2-small (local ONNX)',
 *      predict: async (img, w, h, mask, ctx) => Float32Array   // عمق 0..1
 *    });
 * ============================================================ */
(function (global) {
  'use strict';
  const AI3D = global.AI3D;

  function detectCapabilities() {
    const caps = {
      webgl2: false, webgpu: false, wasm: typeof WebAssembly === 'object',
      offscreenCanvas: typeof OffscreenCanvas === 'function',
      threads: typeof SharedArrayBuffer === 'function',
      cores: (global.navigator && global.navigator.hardwareConcurrency) || 4,
      memoryGB: (global.navigator && global.navigator.deviceMemory) || null,
      compression: typeof global.CompressionStream === 'function',
      serviceWorker: !!(global.navigator && global.navigator.serviceWorker),
      indexedDB: !!global.indexedDB,
      touch: (global.matchMedia && global.matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in global)
    };
    try {
      const c = global.document.createElement('canvas');
      caps.webgl2 = !!(c.getContext && c.getContext('webgl2'));
    } catch (e) { /* ignore */ }
    caps.webgpu = !!(global.navigator && global.navigator.gpu);
    return caps;
  }

  /* واجهة تركيب نموذج محلي: تُسجّل في AI3D.Models مع وسم المصدر */
  function install(stage, impl) {
    if (!impl || typeof impl.predict !== 'function') throw new Error('النموذج يجب أن يوفّر دالة predict');
    AI3D.Models.register(stage, async function (...args) {
      const out = await impl.predict(...args);
      if (!out) throw new Error('النموذج لم يُرجع نتيجة');
      return out;
    }, { name: impl.name || 'local-model', source: 'local', kind: impl.kind || 'neural', local: true });
    return true;
  }

  /* محاولة تحميل بيان نماذج محلية إن وُجد (لا يتصل بأي شبكة) */
  async function tryLoadLocalModels(basePath) {
    const base = basePath || 'models/';
    try {
      const res = await fetch(base + 'manifest.json', { cache: 'no-store' });
      if (!res.ok) return { loaded: 0, reason: 'لا يوجد ملف models/manifest.json' };
      const manifest = await res.json();
      let loaded = 0;
      for (const entry of (manifest.models || [])) {
        if (!entry.stage || !entry.file) continue;
        try {
          const mod = await import(base + entry.file);
          if (mod && typeof mod.default === 'function') {
            mod.default(AI3D, install);
            loaded++;
          }
        } catch (e) {
          console.warn('تعذّر تحميل النموذج المحلي:', entry.file, e && e.message);
        }
      }
      return { loaded, manifest };
    } catch (e) {
      return { loaded: 0, reason: 'لا توجد نماذج محلية إضافية (يعمل المحرك بوزنه المدمج)' };
    }
  }

  function describeModels() {
    return AI3D.Models.list().map(name => ({
      stage: name,
      meta: AI3D.Models.meta(name)
    }));
  }

  AI3D.Backends = { detectCapabilities, install, tryLoadLocalModels, describeModels };
})(typeof window !== 'undefined' ? window : globalThis);
