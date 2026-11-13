'use strict';
/* دالة Vercel: كل مسارات رحيق تُحوَّل إلى هنا عبر vercel.json (?__r=...) */
const { createHandler } = require('./_yaseen/handler');

const app = createHandler();

module.exports = (req, res) => app.nodeHandler(req, res);
