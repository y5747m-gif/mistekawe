/* ============================================================
 * dom-lite.mjs — DOM مصغّر (بلا متصفح) لاختبار واجهة رحيق
 * ------------------------------------------------------------
 * يكفي لتشغيل js/yaseen.js داخل Node: إنشاء العناصر، classList،
 * السمات، شجرة الأبناء، ومُحدِّد بسيط (.class و tag و «سليل»).
 * المؤقّتات لا تُنفَّذ تلقائيًا — الاختبار يقرّر متى يشغّلها.
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

class ClassList {
  constructor(node) { this.node = node; this.set = new Set(); }
  add(...names) { names.filter(Boolean).forEach(n => this.set.add(n)); }
  remove(...names) { names.forEach(n => this.set.delete(n)); }
  contains(name) { return this.set.has(name); }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : !!force;
    if (on) this.set.add(name); else this.set.delete(name);
    return on;
  }
  toString() { return Array.from(this.set).join(' '); }
}

function simpleMatches(node, token) {
  if (!token) return false;
  if (token[0] === '#') return node.id === token.slice(1);
  const parts = token.split('.');
  const tag = parts.shift();
  if (tag && String(node.tagName).toLowerCase() !== tag.toLowerCase()) return false;
  return parts.every(c => node.classList.contains(c));
}

function matchesChain(node, tokens) {
  const last = tokens[tokens.length - 1];
  if (!simpleMatches(node, last)) return false;
  let i = tokens.length - 2, cur = node.parentNode;
  while (i >= 0) {
    if (!cur) return false;
    if (simpleMatches(cur, tokens[i])) i -= 1;
    cur = cur.parentNode;
  }
  return true;
}

function selectorGroups(selector) {
  return String(selector).split(',').map(s => s.trim().split(/\s+/).filter(Boolean)).filter(g => g.length);
}

function descendants(node, out = []) {
  for (const child of node.childNodes) {
    if (child.tagName) { out.push(child); descendants(child, out); }
  }
  return out;
}

export class Node {
  constructor(tagName, ownerDoc) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDoc;
    this.childNodes = [];
    this.parentNode = null;
    this.classList = new ClassList(this);
    this.style = {};
    this.attributes = Object.create(null);
    this.listeners = Object.create(null);
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this._text = '';
    this.offsetWidth = 0;
    this.offsetHeight = 0;
    this.scrollTop = 0;
    this.scrollHeight = 0;
  }
  set className(v) { this.classList.set = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get className() { return this.classList.toString(); }
  set textContent(v) { this._text = String(v == null ? '' : v); this.childNodes = []; }
  get textContent() {
    const kids = this.childNodes.map(c => c.textContent || '').join('');
    return (this._text || '') + kids;
  }
  get firstChild() { return this.childNodes[0] || null; }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') this.id = String(value);
    if (name === 'class') this.className = value;
  }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    const list = this.listeners[type] || [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  dispatch(type, event = {}) {
    (this.listeners[type] || []).slice().forEach(fn => fn(Object.assign({ type, target: this, preventDefault() {} }, event)));
  }
  querySelectorAll(selector) {
    const groups = selectorGroups(selector);
    return descendants(this).filter(n => groups.some(g => matchesChain(n, g)));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    const groups = selectorGroups(selector);
    let cur = this;
    while (cur) {
      if (groups.some(g => matchesChain(cur, g))) return cur;
      cur = cur.parentNode;
    }
    return null;
  }
  getClientRects() { return []; }
  getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  scrollIntoView() {}
  focus() {}
  get offsetLeft() { return 0; }
}

class TextNode {
  constructor(text) { this.textContent = String(text); this.parentNode = null; this.tagName = ''; this.childNodes = []; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
}

/**
 * ينشئ بيئة DOM مصغّرة ويحمّل js/yaseen.js داخلها.
 * opts.fetch  — بديل fetch (يرجّع {status, body} كما يتوقّع الملف)
 * opts.meta   — خريطة meta tags (name → المحتوى)
 */
export function loadWidget(opts = {}) {
  const doc = new Node('#document', null);
  const body = new Node('body', doc);
  const head = new Node('head', doc);
  doc.childNodes.push(head, body);
  doc.body = body;
  doc.documentElement = doc;
  doc.hidden = false;
  doc.readyState = 'complete';
  doc.createElement = tag => new Node(tag, doc);
  doc.createTextNode = text => new TextNode(text);
  doc.getElementById = () => null;
  doc.querySelectorAll = sel => body.querySelectorAll(sel);
  doc.querySelector = sel => body.querySelector(sel);
  doc.addEventListener = (type, fn) => { (doc._listeners = doc._listeners || {}); (doc._listeners[type] = doc._listeners[type] || []).push(fn); };
  doc.removeEventListener = () => {};
  doc.dispatch = (type, event = {}) => ((doc._listeners || {})[type] || []).forEach(fn => fn(Object.assign({ type, target: body, preventDefault() {} }, event)));

  const metaByName = opts.meta || {};
  const realQuerySelector = doc.querySelector;
  doc.querySelector = sel => {
    const m = /^meta\[name="([^"]+)"\]$/.exec(String(sel));
    if (m) return Object.prototype.hasOwnProperty.call(metaByName, m[1]) ? { getAttribute: () => metaByName[m[1]] } : null;
    return realQuerySelector(sel);
  };

  const timers = new Map();
  const intervals = new Map();
  let seq = 1;
  const fakeSetTimeout = fn => { const id = seq++; timers.set(id, fn); return id; };
  const fakeClearTimeout = id => { timers.delete(id); };
  const fakeSetInterval = fn => { const id = seq++; intervals.set(id, fn); return id; };
  const fakeClearInterval = id => { intervals.delete(id); };

  const calls = [];
  const fetchImpl = opts.fetch || (() => Promise.reject(new Error('offline')));

  const win = {
    innerWidth: 1280,
    innerHeight: 900,
    devicePixelRatio: 1,
    document: doc,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    setInterval: fakeSetInterval,
    clearInterval: fakeClearInterval,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    getComputedStyle: () => ({ left: '14px', bottom: '14px' }),
    localStorage: {
      store: Object.create(null),
      getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; },
      setItem(k, v) { this.store[k] = String(v); }
    },
    sessionStorage: {
      store: Object.create(null),
      getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; },
      setItem(k, v) { this.store[k] = String(v); }
    },
    /* يحاكي استجابة fetch الحقيقية: status + json() */
    fetch: url => {
      calls.push(url);
      return Promise.resolve(fetchImpl(url)).then(r => ({
        status: r.status,
        ok: r.status >= 200 && r.status < 300,
        json: () => Promise.resolve(r.body)
      }));
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  win.window = win;

  const context = vm.createContext(win);
  context.window = win;
  context.document = doc;
  context.globalThis = win;
  const code = fs.readFileSync(path.join(ROOT, 'js/yaseen.js'), 'utf8');
  vm.runInContext(code, context, { filename: 'js/yaseen.js' });

  /** ينفّذ المؤقّتات المستحقّة (لمحاكاة wave/greet) */
  function flushTimers(limit = 20) {
    let n = 0;
    while (timers.size && n < limit) {
      const [id, fn] = timers.entries().next().value;
      timers.delete(id);
      fn();
      n += 1;
    }
    return n;
  }
  function tick(ms = 1000) {
    intervals.forEach(fn => fn());
    return ms;
  }

  return { window: win, document: doc, body, timers, intervals, calls, flushTimers, tick };
}

/** يرجّع BASE المضمَّن في js/yaseen.js كنص (لاختبار تطابقه مع افتراضيات الخادم) */
export function readBaseLiteral() {
  const code = fs.readFileSync(path.join(ROOT, 'js/yaseen.js'), 'utf8');
  const start = code.indexOf('var BASE = freeze(');
  if (start < 0) throw new Error('BASE غير موجود في js/yaseen.js');
  const open = code.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < code.length; i++) {
    const ch = code[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) break; }
  }
  return code.slice(open, i + 1);
}

/** يحوّل BASE إلى كائن JS حقيقي (تقييم نصّي بسيط، بلا تنفيذ أي كود آخر) */
export function readBase() {
  const literal = readBaseLiteral();
  const sandbox = vm.createContext({ __out: null });
  vm.runInContext('__out = (' + literal + ');', sandbox, { filename: 'BASE' });
  return sandbox.__out;
}

/** ينتظر انتهاء الوعود المعلّقة (دورة fetch ثم applyConfig) */
export function flushPromises(times = 6) {
  let p = Promise.resolve();
  for (let i = 0; i < times; i++) p = p.then(() => new Promise(r => setImmediate(r)));
  return p;
}
