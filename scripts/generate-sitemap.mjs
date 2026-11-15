import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BASE_URL = 'https://mistekawe.vercel.app';

/*
 * خريطة الصفحات المفهرسة — مصدر الحقيقة الواحد.
 * أي صفحة تُضاف هنا لازم تكون:
 *   • عامة (بلا تسجيل دخول)
 *   • بلا <meta name="robots" content="noindex">
 *   • بلا canonical يشير لصفحة أخرى
 * الصفحات المستبعدة عن قصد: cart/login/register (noindex) · raheeq.html (تحويل) ·
 * admin-yaseen/ (noindex + Disallow) · googleXXXX.html (ملف تحقّق) · product.html?id=*
 * (روابط استعلام تُفهرَس عبر صفحة الشرح الثابتة — canonical موحّد).
 */
const PAGES = {
  'index.html': { path: '', priority: '1.0', changefreq: 'daily' },
  'shop.html': { path: 'shop.html', priority: '0.8', changefreq: 'weekly' },
  'product.html': { path: 'product.html', priority: '0.7', changefreq: 'weekly' },
  'heritage.html': { path: 'heritage.html', priority: '0.8', changefreq: 'monthly' },
  'majlis.html': { path: 'majlis.html', priority: '0.7', changefreq: 'weekly' },
  'hall.html': { path: 'hall.html', priority: '0.6', changefreq: 'weekly' },
  'studio.html': { path: 'studio.html', priority: '0.7', changefreq: 'monthly' }
};

/* حماية: لو صفحة في الخريطة صار عليها noindex أو اتشالت، النسخ يفشل بصوت عالٍ */
const problems = [];
for (const file of Object.keys(PAGES)) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) { problems.push(`${file}: الملف غير موجود`); continue; }
  const html = fs.readFileSync(full, 'utf8');
  if (/<meta\s+name="robots"[^>]*noindex/i.test(html)) problems.push(`${file}: عليها noindex`);
  const canonical = (html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/) || [])[1];
  const expected = `${BASE_URL}/${PAGES[file].path}`;
  if (canonical && canonical !== expected) problems.push(`${file}: canonical يشير إلى ${canonical} بدل ${expected}`);
}
if (problems.length) {
  console.error('❌ sitemap: صفحات غير صالحة للفهرسة:\n- ' + problems.join('\n- '));
  process.exit(1);
}

const now = new Date().toISOString().split('T')[0];

const urls = Object.entries(PAGES).map(([file, info]) => {
  const loc = info.path ? `${BASE_URL}/${info.path}` : `${BASE_URL}/`;
  return `  <url>
    <loc>${loc}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${info.changefreq}</changefreq>
    <priority>${info.priority}</priority>
  </url>`;
}).join('\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml, 'utf8');
console.log(`sitemap.xml updated: ${Object.keys(PAGES).length} indexable pages.`);
