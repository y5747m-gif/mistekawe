'use strict';
/* دالة Vercel: كل مسارات ياسين تُحوَّل إلى هنا عبر vercel.json (?__r=...) */
const { createHandler } = require('./_yaseen/handler');

const app = createHandler();

module.exports = (req, res) => app.nodeHandler(req, res);
