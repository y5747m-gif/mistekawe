import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BASE_URL = 'https://mistekawe.vercel.app';

// Scan all public html pages
const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.html') && !f.startsWith('google') && !f.startsWith('.'));

const priorityMap = {
  'index.html': { path: '', priority: '1.0', changefreq: 'daily' },
  'shop.html': { path: 'shop.html', priority: '0.8', changefreq: 'weekly' },
  'product.html': { path: 'product.html', priority: '0.8', changefreq: 'weekly' },
  'heritage.html': { path: 'heritage.html', priority: '0.7', changefreq: 'monthly' },
  'majlis.html': { path: 'majlis.html', priority: '0.8', changefreq: 'weekly' },
  'hall.html': { path: 'hall.html', priority: '0.7', changefreq: 'weekly' },
  'studio.html': { path: 'studio.html', priority: '0.7', changefreq: 'monthly' },
  'cart.html': { path: 'cart.html', priority: '0.5', changefreq: 'monthly' },
  'login.html': { path: 'login.html', priority: '0.6', changefreq: 'monthly' },
  'register.html': { path: 'register.html', priority: '0.6', changefreq: 'monthly' }
};

const now = new Date().toISOString().split('T')[0];

const urls = Object.entries(priorityMap).map(([file, info]) => {
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
console.log('sitemap.xml updated successfully with ' + Object.keys(priorityMap).length + ' pages.');
