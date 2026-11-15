#!/usr/bin/env node
/* معاينة محلية لنسخة النشر public/ بنفس سلوك Vercel:
   ضغط Brotli/GZIP + ترويسات وتحويلات vercel.json (روابط نظيفة، 301، Cache-Control).
   التشغيل: npm run build && npm run preview [-- --port 4173] [-- --dir .] */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; };
const PORT = Number(arg('port', process.env.PORT || 4173));
const DIR = path.resolve(ROOT, arg('dir', 'public'));
const useConfig = !process.argv.includes('--no-config');
const cfg = useConfig ? JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')) : {};

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.apk': 'application/vnd.android.package-archive',
};
const COMPRESSIBLE = /^(text\/|application\/(json|xml|manifest\+json)|image\/svg)/;

/* تحويل نمط vercel (path-to-regexp مبسّط) إلى RegExp */
function compile(source) {
  const names = [];
  let re = source
    .replace(/:(\w+)\(([^)]*)\)/g, (_, n, body) => { names.push(n); return `(${body})`; })
    .replace(/:(\w+)\*/g, (_, n) => { names.push(n); return '(.*)'; })
    .replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; });
  re = re.replace(/\.(?![*+?)])/g, '\\.');
  return { re: new RegExp('^' + re + '$'), names };
}
const rules = list => (list || []).map(r => ({ ...r, ...compile(r.source) }));
const redirects = rules(cfg.redirects), rewrites = rules(cfg.rewrites), headers = rules(cfg.headers);
const fill = (dest, m, names) => names.reduce((d, n, i) => d.replace(':' + n, m[i + 1] || ''), dest);
const cache = new Map();

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  for (const r of redirects) {
    const m = p.match(r.re);
    if (m) { res.writeHead(r.statusCode || (r.permanent ? 308 : 307), { Location: fill(r.destination, m, r.names) + url.search }); return res.end(); }
  }
  for (const r of rewrites) {
    const m = p.match(r.re);
    if (m) { p = fill(r.destination, m, r.names).split('?')[0]; break; }
  }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(DIR, p);
  if (!file.startsWith(DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404');
  }
  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  const h = { 'Content-Type': type, 'Cache-Control': 'public, max-age=0, must-revalidate' };
  for (const r of headers) if (r.re.test(decodeURIComponent(url.pathname))) for (const x of r.headers) h[x.key] = x.value;
  delete h['Strict-Transport-Security'];          /* المعاينة المحلية HTTP */
  /* المعاينة قد تُعرض داخل إطار (iframe) — قيود التأطير تبقى في الإنتاج فقط */
  delete h['X-Frame-Options']; delete h['Cross-Origin-Opener-Policy'];
  if (h['Content-Security-Policy']) h['Content-Security-Policy'] = h['Content-Security-Policy'].replace(/;\s*frame-ancestors[^;]*/, '');
  let body = fs.readFileSync(file);
  const ae = req.headers['accept-encoding'] || '';
  if (COMPRESSIBLE.test(type) && body.length > 512) {
    const enc = /\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : '';
    if (enc) {
      const key = enc + file + fs.statSync(file).mtimeMs;
      if (!cache.has(key)) cache.set(key, enc === 'br' ? zlib.brotliCompressSync(body) : zlib.gzipSync(body));
      body = cache.get(key); h['Content-Encoding'] = enc; h.Vary = 'Accept-Encoding';
    }
  }
  h['Content-Length'] = body.length;
  res.writeHead(200, h); res.end(body);
}).listen(PORT, '0.0.0.0', () => console.log(`معاينة ${path.relative(ROOT, DIR) || '.'} على http://0.0.0.0:${PORT}`));
