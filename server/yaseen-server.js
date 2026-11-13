#!/usr/bin/env node
'use strict';
/* ============================================================
   ياسين — خادم الواجهة المحلي (يشغّله server/serve.py تلقائيًا)
   يستمع على 127.0.0.1 فقط، وخادم رحيق يمرّر إليه /api/yaseen-*.
   التشغيل اليدوي:  node server/yaseen-server.js --port 8001
   ============================================================ */
const http = require('http');
const { createHandler } = require('../api/_yaseen/handler');

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const port = parseInt(arg('--port', process.env.YASEEN_PORT || '8001'), 10);
const host = arg('--host', '127.0.0.1');

const app = createHandler();
const server = http.createServer((req, res) => {
  app.nodeHandler(req, res).catch(() => { res.statusCode = 500; res.end('{"ok":false}'); });
});
server.listen(port, host, () => {
  console.log('[yaseen] listening on http://' + host + ':' + port + ' — storage: ' + app.store.kind + ' (' + app.store.location + ')');
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
