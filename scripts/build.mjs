#!/usr/bin/env node
/* بناء نسخة النشر في public/ — أداء + SEO تقني فقط، بدون أي تغيير في المحتوى.

   المصدر (index.html, css/, js/ ...) يبقى كما هو للتطوير والاختبارات.
   هذا السكربت ينتج نسخة مُحسَّنة:
     • تصغير HTML/CSS/JS ودمج الملفات في حزمة واحدة لكل صفحة باسم يحمل بصمة المحتوى
     • استضافة خطوط Google محليًا (لا طلبات خارجية حاجبة للعرض)
     • روابط نظيفة بدون .html + canonical مطابق
     • JSON-LD (Organization / LocalBusiness / BreadcrumbList / Service)
     • robots.txt + sitemap.xml يُولَّدان تلقائيًا من الصفحات الموجودة
     • فحص SEO يوقف البناء عند أي خلل (عنوان مكرر، H1 مكرر، رابط مكسور، صورة بلا alt ...)

   التشغيل:  node scripts/build.mjs        (أو npm run build)                      */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';
import { minify as minifyHtml } from 'html-minifier-terser';
import { SITE, ORG, LOCAL_BUSINESS, PAGES, NOT_PAGES } from './site.config.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public');
const BUNDLE_DIR = '_b';

/* ما يُنشر (كل ما عداه — خادم، اختبارات، أندرويد، مصادر — لا يخرج للعلن) */
const COPY = [
  'css', 'js', 'ai3d', 'sound', 'sounds', 'assets', 'icons', 'admin-yaseen', 'dist', 'models',
  'products.js', 'script.js', 'style.css', 'sw.js',
  'manifest.webmanifest', 'raheeq.webmanifest',
];
const SKIP = [/\.(md|py)$/i, /(^|\/)\.[^/]+$/];

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const hash = buf => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
const errors = [];
const warn = [];
const fail = m => errors.push(m);

function writeOut(rel, data) {
  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, data);
}
const existsOut = rel => fs.existsSync(path.join(OUT, rel));

/* ---------- الصفحات ---------- */
const htmlFiles = fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();
const verificationFiles = htmlFiles.filter(f => /^google[0-9a-f]+\.html$/.test(f));
const pageNames = htmlFiles
  .filter(f => !verificationFiles.includes(f))
  .map(f => f.replace(/\.html$/, ''));
const realPages = pageNames.filter(n => !NOT_PAGES.has(n));
const cleanPath = name => (name === 'index' ? '/' : '/' + name);
const PAGE_RE = new RegExp('\\b(' + pageNames.join('|') + ')\\.html\\b', 'g');

/* ---------- تصغير ---------- */
async function minJs(code, file) {
  try {
    return (await esbuild.transform(code, { loader: 'js', minify: true, legalComments: 'none', target: 'es2019', charset: 'utf8' })).code;
  } catch (e) { fail(`تعذّر تصغير ${file}: ${e.message}`); return code; }
}
async function minCss(code, file) {
  try {
    return (await esbuild.transform(code, { loader: 'css', minify: true, legalComments: 'none', charset: 'utf8' })).code;
  } catch (e) { fail(`تعذّر تصغير ${file}: ${e.message}`); return code; }
}

/* ---------- الخطوط: Google Fonts → ملفات محلية (@fontsource) ---------- */
const fontFilesCopied = new Set();
function fontFace(pkg, weight, italic) {
  const dir = path.dirname(require.resolve(`@fontsource/${pkg}/package.json`));
  const cssFile = path.join(dir, `${weight}${italic ? '-italic' : ''}.css`);
  if (!fs.existsSync(cssFile)) return '';
  let css = fs.readFileSync(cssFile, 'utf8');
  /* woff2 فقط (كل المتصفحات الحالية) + مسار مطلق */
  css = css.replace(/src:\s*url\(\.\/files\/([^)]+\.woff2)\)\s*format\('woff2'\)[^;]*;/g, (_, file) => {
    if (!fontFilesCopied.has(file)) {
      fontFilesCopied.add(file);
      writeOut(`assets/fonts/${file}`, fs.readFileSync(path.join(dir, 'files', file)));
    }
    return `src:url(/assets/fonts/${file}) format('woff2');`;
  });
  return css;
}
function googleFontsToCss(url) {
  const u = new URL(url.replace(/&amp;/g, '&'));
  let out = '';
  for (const fam of u.searchParams.getAll('family')) {
    const [name, spec = 'wght@400'] = fam.split(':');
    const pkg = name.trim().toLowerCase().replace(/\s+/g, '-');
    const [axes, values] = spec.split('@');
    const hasItal = axes.split(',').includes('ital');
    for (const v of values.split(';')) {
      let italic = false, w = v;
      if (hasItal) { const [i, ww] = v.split(','); italic = i === '1'; w = ww; }
      const weights = w.includes('..')
        ? (() => { const [a, b] = w.split('..').map(Number); const r = []; for (let x = Math.ceil(a / 100) * 100; x <= b; x += 100) r.push(x); return r; })()
        : [Number(w)];
      for (const weight of weights) {
        const css = fontFace(pkg, weight, italic);
        if (!css) fail(`خط غير متاح محليًا: ${name} ${weight}${italic ? ' italic' : ''}`);
        out += css;
      }
    }
  }
  return out;
}

/* ---------- CSS: حلّ @import لخطوط Google + تحويل url() لمسارات مطلقة ---------- */
function prepareCss(rel) {
  let css = read(rel);
  let fonts = '';
  css = css.replace(/@import\s+url\(\s*['"]?(https:\/\/fonts\.googleapis\.com\/[^'")]+)['"]?\s*\)\s*;/g, (_, url) => {
    fonts += googleFontsToCss(url);
    return '';
  });
  const dir = path.posix.dirname(rel);
  css = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, ref) => {
    if (/^(data:|https?:|#|\/)/.test(ref)) return m;
    return `url(${q}/${path.posix.normalize(path.posix.join(dir, ref))}${q})`;
  });
  return fonts + css;
}

/* ---------- نسخ الملفات الثابتة (مع تصغير كل JS/CSS في مكانه) ---------- */
async function copyTree(rel) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) return;
  if (SKIP.some(r => r.test(rel))) return;
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    for (const f of fs.readdirSync(src)) await copyTree(path.posix.join(rel, f));
    return;
  }
  if (rel.startsWith('admin-yaseen/')) return writeOut(rel, fs.readFileSync(src));
  if (rel === 'sw.js') return writeOut(rel, await minJs(buildServiceWorker(read(rel)), rel));
  if (rel.endsWith('.js')) return writeOut(rel, await minJs(cleanLinks(read(rel)), rel));
  if (rel.endsWith('.css')) return writeOut(rel, await minCss(prepareCss(rel), rel));
  if (rel.endsWith('.webmanifest')) return writeOut(rel, JSON.stringify(JSON.parse(cleanLinks(read(rel)))));
  if (rel.endsWith('.svg')) return writeOut(rel, read(rel).replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').trim());
  writeOut(rel, fs.readFileSync(src));
}

/* shop.html → shop ، index.html → ./ (روابط نظيفة بنفس المعنى) */
function cleanLinks(text) {
  return text.replace(PAGE_RE, (m, name, offset, whole) => {
    if (name !== 'index') return name;
    /* index.html → ./ فقط عندما يكون رابطًا كاملًا داخل علامتي تنصيص */
    const before = whole[offset - 1], after = whole[offset + m.length];
    if (/['"`]/.test(before) && /['"`]/.test(after)) return './';
    if (before === '/' && /['"`]/.test(after)) return '';
    return m;
  });
}

/* service worker: نفس المنطق، مع أسماء الصفحات النظيفة وبلا تكرار لمدخل './' */
function buildServiceWorker(code) {
  const out = cleanLinks(code);
  const m = out.match(/const SHELL = \[([\s\S]*?)\];/);
  if (!m) { fail('sw.js: قائمة SHELL غير موجودة'); return out; }
  const items = [...new Set(m[1].split(',').map(s => s.trim()).filter(Boolean))];
  return out.replace(m[0], `const SHELL = [${items.join(',')}];`);
}

/* ---------- JSON-LD ---------- */
function jsonLd(name, title, description) {
  const cfg = PAGES[name] || {};
  const url = SITE + cleanPath(name);
  const graph = [
    ORG,
    { '@type': 'WebSite', '@id': SITE + '/#website', url: SITE + '/', name: ORG.name, inLanguage: 'ar', publisher: { '@id': ORG['@id'] } },
    { '@type': 'WebPage', '@id': url + '#webpage', url, name: title, description, inLanguage: 'ar', isPartOf: { '@id': SITE + '/#website' } },
  ];
  if (cfg.localBusiness) graph.push(LOCAL_BUSINESS);
  const crumbs = cfg.breadcrumb || [['رحيق RAHEEQ', '/'], [title, cleanPath(name)]];
  graph.push({
    '@type': 'BreadcrumbList',
    '@id': url + '#breadcrumb',
    itemListElement: crumbs.map(([n, p], i) => ({ '@type': 'ListItem', position: i + 1, name: n, item: SITE + p })),
  });
  for (const s of cfg.services || []) {
    graph.push({ '@type': 'Service', name: s.name, description: s.description, url, provider: { '@id': ORG['@id'] }, inLanguage: 'ar' });
  }
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

/* ---------- معالجة صفحة HTML ---------- */
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i')) || [])[1];
const isLocal = ref => ref && !/^(https?:)?\/\//.test(ref) && !ref.startsWith('data:');
const seo = [];

async function buildPage(name) {
  const file = name + '.html';
  let html = read(file);

  /* صفحة التحويل القديمة: تُنسخ كما هي (التحويل 301 الفعلي في vercel.json) */
  if (NOT_PAGES.has(name)) return writeOut(file, html);

  /* 1) الخطوط: إزالة روابط Google Fonts الحاجبة للعرض وتوليد @font-face محلي */
  let fontCss = '';
  html = html.replace(/<link\b[^>]*\bhref="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^"]*"[^>]*>\s*/g, tag => {
    if (/rel="stylesheet"/.test(tag)) fontCss += googleFontsToCss(attr(tag, 'href'));
    return '';
  });

  /* 2) CSS: كل ملفات التنسيق المحلية → حزمة واحدة مصغّرة */
  const cssParts = [];
  let cssSlot = false;
  html = html.replace(/<link\b[^>]*\brel="stylesheet"[^>]*>\s*/g, tag => {
    const href = attr(tag, 'href');
    if (!isLocal(href)) return tag;
    cssParts.push(prepareCss(href.replace(/^\.?\//, '')));
    if (cssSlot) return '';
    cssSlot = true;
    return '<!--CSS_BUNDLE-->';
  });
  if (cssSlot) {
    const css = await minCss(fontCss + cssParts.join('\n'), file + ' (css)');
    const rel = `${BUNDLE_DIR}/${hash(css)}.css`;
    writeOut(rel, css);
    html = html.replace('<!--CSS_BUNDLE-->', `<link rel="stylesheet" href="/${rel}">\n`);
  } else if (fontCss) fail(`${file}: خطوط Google بلا ملف CSS محلي`);

  /* 3) JS: دمج السكربتات المتتالية المتشابهة في حزمة واحدة */
  const scriptRe = /<script\b([^>]*)\bsrc="([^"]+)"([^>]*)><\/script>/g;
  const tags = [...html.matchAll(scriptRe)].filter(m => isLocal(m[2]));
  const groups = [];
  for (const m of tags) {
    const attrs = (m[1] + ' ' + m[3]).trim().replace(/\s+/g, ' ');
    const kind = /type="module"/.test(attrs) ? 'module' : /\bdefer\b/.test(attrs) ? 'defer' : /\basync\b/.test(attrs) ? 'async' : 'sync';
    const inHead = m.index < html.indexOf('</head>');
    const last = groups[groups.length - 1];
    const between = last ? html.slice(last.end, m.index) : 'x';
    if (last && last.kind === kind && kind !== 'module' && kind !== 'async' && !between.trim()) {
      last.items.push(m); last.end = m.index + m[0].length;
    } else groups.push({ kind, inHead, items: [m], start: m.index, end: m.index + m[0].length });
  }
  for (const g of groups.reverse()) {
    const files = g.items.map(m => m[2].replace(/^\.?\//, ''));
    let replacement;
    if (g.kind === 'module') {
      const res = await esbuild.build({
        entryPoints: [path.join(ROOT, files[0])], bundle: true, format: 'esm', minify: true,
        write: false, legalComments: 'none', target: 'es2020', charset: 'utf8',
      });
      const code = cleanLinks(res.outputFiles[0].text);
      const rel = `${BUNDLE_DIR}/${hash(code)}.js`;
      writeOut(rel, code);
      replacement = `<script type="module" src="/${rel}"></script>`;
    } else {
      const parts = [];
      for (const f of files) parts.push(await minJs(cleanLinks(read(f)), f));
      const code = parts.map(p => p.trim().replace(/;?$/, ';')).join('\n');
      if (g.kind === 'sync' && g.inHead) {
        /* سكربت مبكر صغير في <head> (تطبيق الثيم قبل الرسم): يُضمَّن لتوفير طلب حاجب */
        replacement = `<script>${code.replace(/<\/script/gi, '<\\/script')}</script>`;
      } else {
        const rel = `${BUNDLE_DIR}/${hash(code)}.js`;
        writeOut(rel, code);
        replacement = `<script src="/${rel}"${g.kind === 'defer' ? ' defer' : ''}></script>`;
      }
    }
    html = html.slice(0, g.start) + replacement + html.slice(g.end);
  }

  /* 4) روابط نظيفة + canonical/og:url مطابقان */
  html = html.replace(/(\b(?:href|action)=")([^"]+)"/g, (m, pre, ref) => {
    if (!isLocal(ref) || ref.startsWith('#') || !/\.html\b/.test(ref)) return m;
    return pre + cleanLinks(`"${ref}"`).slice(1, -1) + '"';
  });
  html = html.split(SITE + '/' + file).join(SITE + cleanPath(name));
  /* روابط داخل السكربتات المضمّنة في الصفحة (قوالب المنتجات والسلة) */
  html = html.replace(/(<script>)([\s\S]*?)(<\/script>)/g, (m, a, body, c) => a + cleanLinks(body) + c);

  /* 5) بيانات الصفحة + فحص SEO */
  const head = html.split('</head>')[0];
  const title = (head.match(/<title>([^<]*)<\/title>/) || [])[1];
  const description = (head.match(/<meta name="description" content="([^"]*)"/) || [])[1];
  const canonical = (head.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
  if (!title) fail(`${file}: بلا <title>`);
  if (!description) fail(`${file}: بلا meta description`);
  if (canonical !== SITE + cleanPath(name)) fail(`${file}: canonical غير صحيح (${canonical})`);
  if (/<meta[^>]+name="robots"[^>]+noindex/i.test(head)) fail(`${file}: الصفحة عليها noindex`);
  const bodyStatic = html.split('</head>')[1].replace(/<script\b[\s\S]*?<\/script>/g, '');
  const h1Static = (bodyStatic.match(/<h1\b/g) || []).length;
  const h1Dynamic = (html.match(/<h1\b/g) || []).length - h1Static;
  if (h1Static + h1Dynamic !== 1) fail(`${file}: عدد H1 = ${h1Static + h1Dynamic}`);
  let prev = 0;
  for (const m of bodyStatic.matchAll(/<h([1-6])\b/g)) {
    const lvl = +m[1];
    if (prev && lvl > prev + 1) fail(`${file}: ترتيب العناوين يقفز من h${prev} إلى h${lvl}`);
    prev = lvl;
  }
  for (const m of bodyStatic.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt="[^"]+"/.test(m[0])) fail(`${file}: صورة بلا alt → ${m[0].slice(0, 80)}`);
    const src = attr(m[0], 'src');
    if (src && !/\bwidth=/.test(m[0])) fail(`${file}: صورة بلا أبعاد (CLS) → ${src}`);
  }
  if (/(?:src|href|action)="http:\/\//.test(html)) fail(`${file}: Mixed Content (http://)`);
  seo.push({ name, file, title, description, html });

  /* 6) JSON-LD */
  html = html.replace('</head>', jsonLd(name, title, description) + '</head>');

  /* 7) تصغير HTML (محافظ: لا يغيّر أي نص ظاهر) */
  html = await minifyHtml(html, {
    collapseWhitespace: true, conservativeCollapse: true, removeComments: true,
    minifyCSS: true, minifyJS: { mangle: false, compress: false },
    decodeEntities: false, removeAttributeQuotes: false, keepClosingSlash: true,
    ignoreCustomFragments: [/<script type="application\/ld\+json">[\s\S]*?<\/script>/],
  });
  writeOut(file, html);
}

/* ---------- فحص الروابط الداخلية ---------- */
function checkLinks() {
  for (const { file, html } of seo) {
    const body = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, s => (/^<script[^>]*src=/.test(s) ? s : ''));
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
    for (const m of body.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const ref = m[1];
      if (!isLocal(ref) || /^(mailto:|tel:|javascript:|blob:)/.test(ref) || ref.includes('${')) continue;
      if (ref.startsWith('#')) {
        /* روابط مثل #terms تُفتح بجافاسكربت (نافذة) — تنبيه فقط */
        if (ref.length > 1 && !ids.has(ref.slice(1))) warn.push(`${file}: الرابط ${ref} يعمل بجافاسكربت (لا يوجد عنصر بهذا المعرّف)`);
        continue;
      }
      let p = decodeURI(ref.split(/[?#]/)[0]).replace(/^\.?\//, '');
      if (p === '' || p === '.') p = 'index.html';
      const ok = existsOut(p) || existsOut(p + '.html');
      if (!ok) fail(`${file}: رابط مكسور → ${ref}`);
    }
  }
}

/* ---------- robots.txt + sitemap.xml ---------- */
function lastmod(file) {
  try {
    const d = execFileSync('git', ['log', '-1', '--format=%cI', '--', file], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (d) return d.slice(0, 10);
  } catch { /* لا يوجد git في بيئة البناء */ }
  return new Date().toISOString().slice(0, 10);
}
function writeSeoFiles() {
  const urls = realPages.map(n => `  <url><loc>${SITE}${cleanPath(n)}</loc><lastmod>${lastmod(n + '.html')}</lastmod></url>`);
  writeOut('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
  writeOut('robots.txt', [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin-yaseen/',
    'Disallow: /api/',
    '',
    `Sitemap: ${SITE}/sitemap.xml`,
    '',
  ].join('\n'));
}

/* ---------- vercel.json يجب أن يغطي كل الصفحات (روابط نظيفة) ---------- */
function checkVercelConfig() {
  const cfg = JSON.parse(read('vercel.json'));
  const text = JSON.stringify(cfg);
  for (const n of realPages.filter(n => n !== 'index')) {
    if (!new RegExp(`[(|]${n}[|)]`).test(text)) fail(`vercel.json: الصفحة ${n} غير مضافة لقواعد الروابط النظيفة`);
  }
}

/* ---------- التنفيذ ---------- */
const t0 = Date.now();
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const item of COPY) await copyTree(item);
for (const f of verificationFiles) writeOut(f, fs.readFileSync(path.join(ROOT, f)));
for (const name of pageNames) await buildPage(name);

const seen = { title: new Map(), description: new Map() };
for (const p of seo) for (const k of ['title', 'description']) {
  if (seen[k].has(p[k])) fail(`${k} مكرر بين ${seen[k].get(p[k])} و ${p.file}`);
  seen[k].set(p[k], p.file);
}
checkLinks();
checkVercelConfig();
writeSeoFiles();

const size = d => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`✔ public/ جاهز — ${realPages.length} صفحة، ${fontFilesCopied.size} ملف خط محلي، ${(size(OUT) / 1024 / 1024).toFixed(1)}MB، ${Date.now() - t0}ms`);
for (const w of warn) console.warn('⚠ ' + w);
if (errors.length) {
  console.error('\n✖ فشل فحص البناء/SEO:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('✔ فحص SEO: عنوان ووصف فريدان، H1 واحد، canonical، alt، روابط داخلية سليمة، بلا Mixed Content');
