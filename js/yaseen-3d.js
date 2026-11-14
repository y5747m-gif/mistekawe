/* رحيق — شخصية WebGL محلية بمفاصل حقيقية. لا قواعد أو ردود في هذا الملف.
 * Three.js r160.1 مضمّن محليًا (الترخيص: js/vendor/THREE-LICENSE.txt).
 * الصور الأصلية تبقى بديلًا إذا لم يتوفر WebGL أو لم يكتمل التحميل. */
import * as THREE from './vendor/three.module.min.js';

export const ACTIONS = ['idle', 'walk', 'run', 'jump', 'wave', 'dance', 'spin', 'thinking', 'point', 'celebrate', 'stretch', 'float'];

export function createScene(canvas, options = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1.12, 1.12, 1.48, -1.48, .1, 30);
  camera.position.set(0, 1.9, 8);
  camera.lookAt(0, 1.48, 0);
  scene.add(new THREE.HemisphereLight(0xfff5e4, 0x8d6474, 2.5));
  const key = new THREE.DirectionalLight(0xffecd2, 3.1);
  key.position.set(-3, 5, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xe6c58d, 2.2);
  rim.position.set(3, 3, -3); scene.add(rim);
  const mat = (color, roughness = .62, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const maroon = mat(0x881234), dark = mat(0x5e0c24), cream = mat(0xf3e8d2), skin = mat(0xffd9b8), gold = mat(0xd9b574, .32, .55);
  const eyeMat = mat(0x291710, .22), white = mat(0xffffff, .25), blush = mat(0xf2a3a0), sole = mat(0x3b1420);
  const root = new THREE.Group(); scene.add(root);
  const body = new THREE.Group(); root.add(body);
  const geometries = new Set(), materials = new Set([maroon, dark, cream, skin, gold, eyeMat, white, blush, sole]);
  function mesh(geometry, material, parent, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
    geometries.add(geometry);
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz); parent.add(m); return m;
  }
  const ball = (parent, material, x, y, z, sx, sy, sz) => mesh(new THREE.SphereGeometry(1, 24, 18), material, parent, x, y, z, sx, sy, sz);
  const capsule = (parent, material, radius, length, x, y, z) => mesh(new THREE.CapsuleGeometry(radius, length, 6, 12), material, parent, x, y, z);
  function joint(parent, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }
  function tube(points, radius, material, parent) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    return mesh(new THREE.TubeGeometry(curve, 20, radius, 6, false), material, parent);
  }

  // Legs have separate hip and knee pivots, so feet actually stride rather than slide.
  const legs = [], knees = [];
  [-1, 1].forEach(side => {
    const hip = joint(body, side * .205, .83, 0);
    capsule(hip, cream, .105, .23, 0, -.16, 0);
    const knee = joint(hip, 0, -.36, 0);
    capsule(knee, cream, .09, .21, 0, -.14, 0);
    ball(knee, dark, 0, -.34, .075, .145, .10, .23);
    ball(knee, sole, 0, -.405, .075, .15, .035, .235);
    ball(knee, gold, 0, -.285, .22, .045, .025, .025);
    legs.push(hip); knees.push(knee);
  });
  // Pleated skirt, knitted sweater and collar.
  const skirtGeo = new THREE.CylinderGeometry(.31, .48, .46, 48, 1, false);
  const pos = skirtGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), a = Math.atan2(z, x);
    const f = 1 + .045 * Math.cos(a * 12);
    pos.setX(i, x * f); pos.setZ(i, z * f);
  }
  skirtGeo.computeVertexNormals();
  mesh(skirtGeo, cream, body, 0, .91, 0);
  ball(body, maroon, 0, 1.32, 0, .39, .43, .27);
  const collar = mesh(new THREE.TorusGeometry(.235, .065, 8, 32), cream, body, 0, 1.64, .015);
  collar.rotation.x = Math.PI / 2;
  for (let i = 0; i < 4; i++) ball(body, gold, 0, 1.48 - i * .105, .268, .025, .025, .014);
  for (let i = -3; i <= 3; i++) tube([[i * .075, 1.12, .245], [i * .08, 1.32, .267], [i * .07, 1.5, .245]], .006, dark, body);
  ball(body, gold, .22, 1.48, .255, .055, .055, .018);

  const arms = [], elbows = [];
  [-1, 1].forEach(side => {
    const shoulder = joint(body, side * .36, 1.51, 0);
    shoulder.rotation.z = side * .12;
    capsule(shoulder, maroon, .12, .20, 0, -.15, 0);
    const elbow = joint(shoulder, 0, -.31, 0);
    capsule(elbow, maroon, .10, .16, 0, -.11, 0);
    capsule(elbow, dark, .102, .015, 0, -.225, 0);
    ball(elbow, skin, 0, -.31, .01, .095, .115, .085);
    arms.push(shoulder); elbows.push(elbow);
  });

  const head = joint(body, 0, 2.08, 0);
  ball(head, maroon, 0, .035, -.055, .565, .62, .43);
  ball(head, skin, 0, -.015, .235, .425, .455, .255);
  // The hood rim wraps the face in 3D, including when she turns while running.
  const rimHood = mesh(new THREE.TorusGeometry(.435, .085, 10, 48), maroon, head, 0, .015, .245, 1, 1.12, 1);
  rimHood.rotation.x = -.06;
  const scarf = ball(head, dark, 0, -.43, .04, .40, .16, .30);
  scarf.rotation.z = -.10;
  const tail = ball(head, maroon, .29, -.59, -.04, .13, .28, .10);
  tail.rotation.z = .28;
  const eyes = [];
  [-1, 1].forEach(side => {
    const eye = joint(head, side * .165, .035, .464);
    ball(eye, white, 0, 0, 0, .108, .133, .035);
    ball(eye, eyeMat, 0, -.004, .030, .079, .103, .025);
    ball(eye, white, -.024, .041, .054, .025, .031, .010);
    ball(eye, white, .026, -.035, .054, .011, .014, .008);
    eyes.push(eye);
    tube([[side * .09, .20, .447], [side * .16, .225, .443], [side * .23, .20, .421]], .014, dark, head);
    ball(head, blush, side * .265, -.135, .423, .072, .035, .012);
  });
  ball(head, skin, 0, -.085, .493, .045, .052, .042);
  const mouth = tube([[-.09, -.205, .449], [0, -.235, .471], [.09, -.205, .449]], .014, dark, head);
  const talkMouth = ball(head, dark, 0, -.218, .462, .062, .045, .014); talkMouth.visible = false;

  let disposed = false, raf = 0, last = 0, time = 0, action = 'idle', until = 0, facing = 1;
  let talking = false, blink = false, paused = false, lookX = 0, lookY = 0, onComplete = null;
  let settings = { idle: true, blink: true, tilt: true, talk: true, expressions: true };
  const reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = !!(reduceQuery && reduceQuery.matches);
  const onReduced = e => { reduced = e.matches; if (reduced) { action = 'idle'; until = 0; } wake(); };
  if (reduceQuery) reduceQuery.addEventListener('change', onReduced);
  const onContextLost = e => { e.preventDefault(); paused = true; canvas.classList.remove('is-ready'); if (options.onError) options.onError(); };
  canvas.addEventListener('webglcontextlost', onContextLost);
  function resize() {
    const box = canvas.getBoundingClientRect();
    renderer.setSize(Math.max(1, box.width), Math.max(1, box.height), false);
    const aspect = Math.max(1, box.width) / Math.max(1, box.height);
    camera.left = -1.43 * aspect; camera.right = 1.43 * aspect;
    camera.top = 1.43; camera.bottom = -1.43; camera.updateProjectionMatrix(); wake();
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  if (observer) observer.observe(canvas);
  function wake() { if (!disposed && !raf && !document.hidden) raf = requestAnimationFrame(frame); }
  function play(name, duration = 2600, done = null) {
    if (disposed) return;
    if (ACTIONS.indexOf(name) < 0) name = 'idle';
    action = reduced ? 'idle' : name;
    until = action === 'idle' || ['walk', 'run'].includes(action) ? 0 : performance.now() + duration;
    onComplete = done; wake();
  }
  function frame(now) {
    raf = 0;
    if (disposed || document.hidden) return;
    if (paused) return;
    if (now - last < 32) { wake(); return; }
    const dt = Math.min(.08, (now - last) / 1000 || .033); last = now; time += dt;
    if (until && now >= until) { const cb = onComplete; onComplete = null; until = 0; action = 'idle'; if (cb) cb(); }
    const a = reduced ? 'idle' : action, t = time, fast = a === 'run';
    const stride = (a === 'walk' || fast) ? Math.sin(t * (fast ? 13 : 7)) : 0;
    let bounce = settings.idle ? Math.sin(t * 2.3) * .014 : 0, lean = 0, yaw = facing * .13, roll = 0;
    let lx = stride * (fast ? .85 : .42), rx = -lx, la = -stride * (fast ? .7 : .32), ra = -la;
    let le = -.12, re = -.12, kneeL = Math.max(0, -stride) * (fast ? 1.1 : .5), kneeR = Math.max(0, stride) * (fast ? 1.1 : .5);
    let az = .12, hz = settings.tilt ? Math.sin(t * 1.3) * .035 : 0;
    if (a === 'run' || a === 'walk') { bounce = Math.abs(stride) * (fast ? .095 : .035); lean = fast ? -.16 : -.04; yaw = facing * (fast ? .62 : .32); le = re = fast ? -1.05 : -.3; }
    if (a === 'jump' || a === 'celebrate') { bounce = Math.abs(Math.sin(t * 4.5)) * .32; az = a === 'celebrate' ? 2.5 : .7; la = az; ra = -az; kneeL = kneeR = .3; }
    if (a === 'wave') { ra = -2.45; re = -.45 + Math.sin(t * 9) * .38; hz = -.10; }
    if (a === 'dance') { yaw += Math.sin(t * 4) * .4; roll = Math.sin(t * 4) * .12; bounce = Math.abs(Math.sin(t * 4)) * .08; la = 1.2 + Math.sin(t * 4) * .6; ra = -1.2 + Math.cos(t * 4) * .6; lx = Math.sin(t * 4) * .25; rx = -lx; }
    if (a === 'spin') { yaw += t * 5; la = 1.1; ra = -1.1; bounce = .035; }
    if (a === 'thinking') { ra = -1.8; re = -1.65; hz = .16; yaw += .2; }
    if (a === 'point') { ra = -1.45; re = -.1; yaw = facing * .4; }
    if (a === 'stretch') { la = 2.7; ra = -2.7; roll = Math.sin(t * 2) * .09; bounce = .04; }
    if (a === 'float') { bounce = .16 + Math.sin(t * 2.5) * .08; la = .65; ra = -.65; kneeL = kneeR = .35; roll = Math.sin(t * 1.8) * .06; }
    const k = 1 - Math.exp(-dt * 14), lerp = (obj, axis, value) => { obj[axis] += (value - obj[axis]) * k; };
    lerp(root.position, 'y', bounce); lerp(root.rotation, 'y', yaw); lerp(root.rotation, 'z', roll);
    lerp(body.rotation, 'x', lean); lerp(body.scale, 'y', 1 + (settings.idle ? Math.sin(t * 2.3) * .008 : 0));
    lerp(legs[0].rotation, 'x', lx); lerp(legs[1].rotation, 'x', rx);
    lerp(knees[0].rotation, 'x', kneeL); lerp(knees[1].rotation, 'x', kneeR);
    lerp(arms[0].rotation, 'z', la); lerp(arms[1].rotation, 'z', ra);
    lerp(arms[0].rotation, 'x', a === 'run' ? stride * .35 : 0); lerp(arms[1].rotation, 'x', a === 'run' ? -stride * .35 : 0);
    lerp(elbows[0].rotation, 'x', le); lerp(elbows[1].rotation, 'x', re);
    lerp(head.rotation, 'z', hz); lerp(head.rotation, 'y', lookX * .16); lerp(head.rotation, 'x', lookY * .08);
    const eyeScale = blink && settings.blink ? .08 : 1;
    eyes.forEach(e => lerp(e.scale, 'y', eyeScale));
    const speaking = talking && settings.talk && Math.sin(t * 17) > 0;
    mouth.visible = !speaking; talkMouth.visible = speaking;
    renderer.render(scene, camera);
    // Reduced motion renders a still pose; no continuous animation loop.
    if (!reduced && settings.idle || !reduced && action !== 'idle' || talking && settings.talk) wake();
  }
  function visibility() { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else { last = performance.now(); wake(); } }
  document.addEventListener('visibilitychange', visibility);
  resize(); renderer.render(scene, camera); wake();
  return {
    play,
    setFacing(value) { facing = value < 0 ? -1 : 1; wake(); },
    setTalking(value) { talking = !!value; wake(); },
    setBlink(value) { blink = !!value; wake(); },
    setLook(x, y) { lookX = Math.max(-1, Math.min(1, x)); lookY = Math.max(-1, Math.min(1, y)); },
    configure(value) { settings = Object.assign(settings, value || {}); wake(); },
    pause(value) { paused = !!value; if (paused) { cancelAnimationFrame(raf); raf = 0; } else wake(); },
    get action() { return action; },
    destroy() {
      disposed = true; cancelAnimationFrame(raf); if (observer) observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      if (reduceQuery) reduceQuery.removeEventListener('change', onReduced);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
      renderer.dispose(); renderer.forceContextLoss();
    }
  };
}
