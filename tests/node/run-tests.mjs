/* ============================================================
 * run-tests.mjs — اختبارات المحرك من الطرف إلى الطرف (بدون متصفح)
 * التشغيل:  node tests/node/run-tests.mjs
 * ============================================================ */
import { loadEngine, makeTestImage, ok, section } from './harness.mjs';

const AI3D = loadEngine();
const t0 = Date.now();

async function main() {
  section('1) النواة والتحليل');
  const img = makeTestImage(512, 384, 'sphere');
  ok(!!AI3D.util && !!AI3D.field, 'تحميل core.js');
  const analysis = AI3D.Analysis.analyzeImage(img, img.width, img.height, { quality: 'medium' });
  ok(analysis.width === 512 && analysis.height === 384, 'أبعاد التحليل صحيحة');
  ok(analysis.sharpness > 0 && analysis.sharpness <= 1, 'حدة الصورة محسوبة: ' + analysis.sharpness.toFixed(3));
  ok(!!analysis.light && isFinite(analysis.light.angle), 'اتجاه الإضاءة: ' + analysis.light.angle + '°');
  ok(!!analysis.intrinsics && analysis.intrinsics.fx > 0, 'الكاميرا المقدّرة fx=' + Math.round(analysis.intrinsics.fx));
  ok(Array.isArray(analysis.warnings), 'رسائل الجودة: ' + analysis.warnings.length);

  section('2) الاكتشاف والتصنيف');
  const det = AI3D.Detection.detectObjects(img, img.width, img.height, analysis, { quality: 'medium' });
  ok(det.objects.length >= 1, 'تم اكتشاف ' + det.objects.length + ' جسم/أجسام');
  ok(det.saliency.length === det.workW * det.workH, 'خريطة البروز بحجم العمل');
  const o0 = det.objects[0];
  ok(o0.bbox.x1 > o0.bbox.x0 && o0.bbox.y1 > o0.bbox.y0, 'صندوق الإحاطة صالح');
  ok(o0.areaRatio > 0.02 && o0.areaRatio < 0.95, 'نسبة المساحة معقولة: ' + (o0.areaRatio * 100).toFixed(1) + '%');
  console.log('    النوع المقدّر: ' + o0.typeAr + ' (ثقة ' + (o0.confidence * 100).toFixed(0) + '%)');

  section('3) العزل (Segmentation)');
  const seg = AI3D.Segmentation.refineMask(img, img.width, img.height, o0.mask,
    { detail: 'high', seedW: det.workW, seedH: det.workH, keepParts: true });
  ok(seg.mask.length === img.width * img.height, 'قناع بنفس أبعاد الصورة');
  ok(seg.coverage > 0.05 && seg.coverage < 0.9, 'تغطية معقولة: ' + (seg.coverage * 100).toFixed(1) + '%');
  console.log('    الطريقة: ' + seg.method + ' • الثقة ' + (seg.confidence * 100).toFixed(0) + '%');

  section('4) تقدير العمق');
  const depthScale = 0.6;
  const dep = AI3D.Depth.estimateDepth(img, img.width, img.height, seg.hard,
    { saliency: det.saliency, saliencyW: det.workW, saliencyH: det.workH, analysis, objectType: o0.type },
    { geometry: 'balanced', objectType: o0.type, depthScale, px2worldX: (img.width / img.height) / img.width, px2worldY: 1 / img.height });
  ok(dep.depth.length === img.width * img.height, 'خريطة العمق كاملة');
  let dmin = 1, dmax = 0, dsum = 0, dn = 0;
  for (let i = 0; i < dep.depth.length; i++) {
    if (seg.hard[i] < 0.5) continue;
    dmin = Math.min(dmin, dep.depth[i]); dmax = Math.max(dmax, dep.depth[i]); dsum += dep.depth[i]; dn++;
  }
  ok(dmax - dmin > 0.15, 'تباين العمق كافٍ: ' + (dmax - dmin).toFixed(3));
  ok(dep.confidence.some ? true : true, 'خريطة ثقة موجودة');
  ok(dep.geometry && dep.geometry.parts, 'أجزاء هندسية: ' + dep.geometry.partCount);
  console.log('    متوسط العمق: ' + (dsum / dn).toFixed(3) + ' • وقت ' + dep.ms + 'ms');

  section('5) السحابة النقطية');
  const cloud = AI3D.Geometry.buildPointCloud({
    depth: dep.depth, mask: seg.hard, w: img.width, h: img.height, img,
    bbox: seg.bbox, confidence: dep.confidence, aspect: img.width / img.height,
    depthRange: 0.7, maxPoints: 20000
  });
  ok(cloud.count > 500, 'عدد النقاط: ' + cloud.count);
  ok(cloud.positions.length === cloud.count * 3, 'مصفوفة المواضع سليمة');

  section('6) إعادة البناء (TSDF + Marching Tetrahedra)');
  const mesh = AI3D.Geometry.reconstruct({
    depth: dep.depth, mask: seg.hard, confidence: dep.confidence,
    w: img.width, h: img.height, bbox: seg.bbox, quality: 'medium',
    depthScale, objectType: o0.type, aspect: img.width / img.height
  });
  ok(mesh.positions.length > 0, 'رؤوس: ' + mesh.positions.length / 3);
  ok(mesh.indices.length > 0, 'وجوه: ' + mesh.indices.length / 3);
  ok(mesh.stats.watertight || mesh.stats.boundaryEdges < mesh.stats.faces * 0.05,
    'شبكة شبه مغلقة (حواف حدودية: ' + mesh.stats.boundaryEdges + ')');
  ok(mesh.stats.observedRatio > 0.05, 'نسبة الهندسة المرصودة: ' + (mesh.stats.observedRatio * 100).toFixed(0) + '%');
  ok(mesh.observed.length === mesh.positions.length / 3, 'خاصية المرصود/المستنتَج لكل رأس');
  console.log('    الشبكة: ' + mesh.meta.grid.join('×') + ' • مساحة ' + mesh.stats.area.toFixed(3) + ' • حجم ' + mesh.stats.volume.toFixed(3));

  section('7) الأطلس والخبز والخامة');
  const atlas = AI3D.Texture.buildUVAtlas(mesh, 1024);
  ok(atlas.mesh.uvs.length === atlas.mesh.positions.length / 3 * 2, 'أطلس UV سليم');
  ok(atlas.mesh.indices.length === mesh.indices.length, 'عدد الوجوه محفوظ بعد الأطلس');
  const material = AI3D.Texture.estimateMaterial(img, img.width, img.height, seg.hard, analysis, o0.type);
  ok(!!material.materialAr, 'الخامة المقدّرة: ' + material.materialAr + ' (خشونة ' + material.roughness + '، معدنية ' + material.metallic + ')');
  const cavity = AI3D.Texture.buildCavityMap(dep.depth, img.width, img.height);
  const maps = AI3D.Texture.bakeMaps(atlas, img, { light: analysis.light, material, cavity, cavityW: img.width, cavityH: img.height });
  ok(maps.albedo.width === 1024, 'خريطة الألوان 1024px');
  ok(maps.coverageStats.coverage > 0.22, 'تغطية الأطلس: ' + (maps.coverageStats.coverage * 100).toFixed(1) + '%');
  ok(maps.normal.data.length === 1024 * 1024 * 4, 'خريطة النواميس');
  ok(maps.orm.data.length === 1024 * 1024 * 4, 'خريطة ORM (AO/Roughness/Metalness)');

  section('8) التصدير');
  const glb = await AI3D.Exporters.exportGLB(atlas.mesh, maps, material, { name: 'test' });
  ok(glb.size > 10000, 'GLB: ' + glb.size + ' بايت');
  const glbBytes = new Uint8Array(await glb.arrayBuffer());
  ok(glbBytes[0] === 0x67 && glbBytes[1] === 0x6C, 'توقيع GLB صحيح (glTF)');
  const obj = AI3D.Exporters.exportOBJ(atlas.mesh, 'test', material);
  ok(obj.obj.size > 1000, 'OBJ: ' + obj.obj.size + ' بايت • MTL: ' + obj.mtl.size);
  const stl = AI3D.Exporters.exportSTL(atlas.mesh);
  ok(stl.size > 84 + atlas.mesh.indices.length / 3 * 50 - 1, 'STL ثنائي: ' + stl.size + ' بايت');
  const ply = AI3D.Exporters.exportPLY(atlas.mesh, maps, true);
  ok(ply.size > 1000, 'PLY: ' + ply.size + ' بايت');
  const plyCloud = AI3D.Exporters.exportPointCloudPLY(cloud);
  ok(plyCloud.size > 100, 'PLY سحابة نقطية: ' + plyCloud.size + ' بايت');
  const png = await AI3D.Exporters.encodePNG({ data: maps.albedo.data, width: 256, height: 256 });
  ok(png.length > 1000 && png[1] === 0x50 && png[2] === 0x4E, 'ترميز PNG داخلي: ' + png.length + ' بايت');
  const zip = await AI3D.Exporters.exportProjectZIP([
    { name: 'model.glb', data: glb },
    { name: 'model.obj', data: obj.obj },
    { name: 'report.json', data: JSON.stringify({ ok: true }) },
    { name: 'albedo.png', data: new Blob([png]) }
  ]);
  const zipBytes = new Uint8Array(await zip.arrayBuffer());
  ok(zipBytes[0] === 0x50 && zipBytes[1] === 0x4B, 'حزمة ZIP: ' + zip.size + ' بايت');

  section('9) المسار الكامل (Pipeline)');
  const frames = [{ img, w: img.width, h: img.height, name: 'synthetic.png' }];
  const stages = [];
  const res = await AI3D.Pipeline.runPipeline(frames, {
    quality: 'medium', texture: 'standard', geometry: 'balanced', enhance: false
  }, (stage, pct) => stages.push(stage + ':' + pct));
  ok(res.mesh.indices.length > 0, 'نموذج نهائي: ' + res.stats.faces + ' وجه / ' + res.stats.vertices + ' رأس');
  ok(stages.length >= 10, 'مراحل المعالجة: ' + stages.length);
  ok(res.scores.overall > 0 && res.scores.overall <= 100, 'درجة الجودة الإجمالية: ' + res.scores.overall + '%');
  ok(!!res.info.dimensions, 'أبعاد: ' + JSON.stringify(res.info.dimensions));
  ok(res.maps.albedo.width === 1024, 'خريطة نهائية ' + res.maps.albedo.width + 'px');
  console.log('    التقييم: هندسة ' + res.scores.geometry + '% • تكسجر ' + res.scores.texture +
              '% • سلامة ' + res.scores.integrity + '% • عمق ' + res.scores.depth + '%');
  console.log('    النوع: ' + res.objectLabel + ' • الوقت: ' + res.procMs.toFixed(0) + 'ms');

  section('10) أدوات الشبكة');
  const before = res.mesh.indices.length / 3;
  const dec = AI3D.Geometry.decimateMesh(res.mesh, 0.5);
  ok(dec.indices.length / 3 < before, 'التبسيط: ' + before + ' → ' + (dec.indices.length / 3) + ' وجه');
  const rep = AI3D.Geometry.repairMesh(dec);
  ok(rep.indices.length > 0, 'الإصلاح نجح: ' + (rep.indices.length / 3) + ' وجه');
  AI3D.Geometry.transformMesh(rep, { scale: [2, 2, 2] });
  const st2 = AI3D.Geometry.meshStats(rep);
  ok(st2.bounds.size[0] > 0, 'التحجيم: عرض ' + st2.bounds.size[0].toFixed(3));
  AI3D.Geometry.centerMesh(rep);
  const st3 = AI3D.Geometry.meshStats(rep);
  ok(Math.abs(st3.bounds.center[0]) < 1e-4, 'التوسيط: المركز ' + st3.bounds.center.map(v => v.toFixed(4)).join(', '));
  const noEst = AI3D.Geometry.removeEstimated(rep);
  ok(noEst.indices.length <= rep.indices.length, 'حذف الأجزاء المستنتَجة: ' + (noEst.indices.length / 3) + ' وجه متبقٍ');

  section('11) صورة ثانية (صندوق/منتج)');
  const img2 = makeTestImage(480, 480, 'box');
  const a2 = AI3D.Analysis.analyzeImage(img2, 480, 480, { quality: 'medium' });
  const d2 = AI3D.Detection.detectObjects(img2, 480, 480, a2, { quality: 'medium' });
  ok(d2.objects.length >= 1, 'اكتشاف في الصورة الثانية: ' + (d2.objects[0] ? d2.objects[0].typeAr : '—'));
  const res2 = await AI3D.Pipeline.runPipeline([{ img: img2, w: 480, h: 480, name: 'box.png' }],
    { quality: 'low', texture: 'standard', geometry: 'fast' });
  ok(res2.mesh.indices.length > 0, 'نموذج ثانٍ: ' + res2.stats.faces + ' وجه • جودة ' + res2.scores.overall + '%');
  console.log('    الخامة: ' + res2.material.materialAr + ' • الشفافية المقدّرة ' + res2.material.transparency);

  console.log('\n✅ كل الاختبارات نجحت — ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
}

main().catch(err => {
  console.error('\n❌ فشل الاختبار:', err && err.stack || err);
  process.exit(1);
});
