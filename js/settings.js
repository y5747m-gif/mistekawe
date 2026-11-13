/* ============================================================
   رحيق RAHEEQ — إعدادات المستخدم (الشخصنة)
   ------------------------------------------------------------
   • الألوان: ثيمات جاهزة + لون حر (المستخدم يغيّر لون الهوية بنفسه)
   • الخط: Cairo موحّد + التحكم في حجم الواجهة (90% – 135%)
   • اللغة: العربية (RTL) / English (LTR)
   • وضع الألوان الفاتح/الداكن للقماش خلف النصوص — اختياري لكل ثيم

   كل شيء محفوظ في LocalStorage تحت المفتاح raheeq_settings،
   ويُطبَّق على :root قبل رسم الصفحة (لتجنّب وميض الثيم الافتراضي).

   واجهة عامة: window.RaheeqSettings
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'raheeq_settings';

  /* ---------- الثيمات الجاهزة ----------
     كل ثيم يعرّف 7 ألوان فقط: البرغندي (الهوية) ودرجاته، الذهبي ودرجاته،
     ودرجات الكريمي. بقية النظام (الشفافيات، الظلال، الحدود) مشتقة تلقائيًا. */
  var THEMES = [
    {
      id: 'raheeq', nameAr: 'رحيق (الافتراضي)', nameEn: 'Raheeq (default)',
      maroon: '#881234', maroonDark: '#5E0C24', maroonHover: '#A6193F',
      gold: '#C9A86A', goldLight: '#E3C98F', goldPale: '#F5E6C0',
      cream: '#F3E8D2', creamLight: '#FBF6EC', creamDeep: '#EFE1C7'
    },
    {
      id: 'emerald', nameAr: 'زمردي', nameEn: 'Emerald',
      maroon: '#146B4A', maroonDark: '#0B4A32', maroonHover: '#1E8A5F',
      gold: '#C9A86A', goldLight: '#E3C98F', goldPale: '#F2E7C8',
      cream: '#EAF3E6', creamLight: '#F7FBF3', creamDeep: '#DBE9D4'
    },
    {
      id: 'royal', nameAr: 'أزرق ملكي', nameEn: 'Royal blue',
      maroon: '#1D3E8C', maroonDark: '#122A63', maroonHover: '#2A55B8',
      gold: '#C9A86A', goldLight: '#E3C98F', goldPale: '#EFE6CC',
      cream: '#E8EEF8', creamLight: '#F6F9FE', creamDeep: '#D9E3F4'
    },
    {
      id: 'midnight', nameAr: 'ليلي داكن', nameEn: 'Midnight',
      maroon: '#4A1860', maroonDark: '#2B0E38', maroonHover: '#6A2A86',
      gold: '#D8B978', goldLight: '#EBD49B', goldPale: '#F3E6C8',
      cream: '#EAE4F0', creamLight: '#F7F4FA', creamDeep: '#DED5E8'
    },
    {
      id: 'rose', nameAr: 'وردي', nameEn: 'Rose',
      maroon: '#A3205A', maroonDark: '#701440', maroonHover: '#C42E72',
      gold: '#D6A76A', goldLight: '#EDC594', goldPale: '#F7E4CC',
      cream: '#FBECE9', creamLight: '#FFF7F5', creamDeep: '#F6DCD8'
    },
    {
      id: 'sand', nameAr: 'رملي تراثي', nameEn: 'Heritage sand',
      maroon: '#8A4A1B', maroonDark: '#5C2E0D', maroonHover: '#A85E25',
      gold: '#C79443', goldLight: '#E3BC7A', goldPale: '#F3E2C2',
      cream: '#F5EAD6', creamLight: '#FCF6EA', creamDeep: '#EADBBE'
    },
    {
      id: 'teal', nameAr: 'فيروزي', nameEn: 'Teal',
      maroon: '#0F5E6E', maroonDark: '#083E4A', maroonHover: '#177A8E',
      gold: '#D1A85F', goldLight: '#E8C98C', goldPale: '#F2E5C6',
      cream: '#E6F1F1', creamLight: '#F5FAFA', creamDeep: '#D6E8E8'
    },
    {
      id: 'obsidian', nameAr: 'أسود وذهبي', nameEn: 'Obsidian & gold',
      maroon: '#2A2A2E', maroonDark: '#141416', maroonHover: '#3E3E45',
      gold: '#D4A94F', goldLight: '#EBCB87', goldPale: '#F3E4C0',
      cream: '#EFEDE8', creamLight: '#F9F8F5', creamDeep: '#E2DFD6'
    }
  ];

  var FONT_SCALE = { min: 0.9, max: 1.35, step: 0.05, def: 1 };
  var LANGS = ['ar', 'en'];

  var defaults = { theme: 'raheeq', custom: null, scale: FONT_SCALE.def, lang: 'ar', display: false };

  /* ---------- أدوات لون ---------- */
  function hexToRgb(hex) {
    var h = String(hex || '').trim().replace(/^#/, '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgbToHex(rgb) {
    return '#' + rgb.map(function (n) {
      var s = Math.max(0, Math.min(255, Math.round(n))).toString(16);
      return s.length === 1 ? '0' + s : s;
    }).join('');
  }
  function mix(a, b, t) {
    var A = hexToRgb(a), B = hexToRgb(b);
    if (!A || !B) return a;
    return rgbToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
  }
  function rgbStr(hex) {
    var rgb = hexToRgb(hex);
    return rgb ? rgb.join(',') : '136,18,52';
  }
  function isLight(hex) {
    var rgb = hexToRgb(hex);
    if (!rgb) return true;
    return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) > 150;
  }
  function normalizeHex(v) {
    if (!v) return null;
    var h = String(v).trim();
    if (/^#?[0-9a-fA-F]{3}$/.test(h)) h = '#' + h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (/^[0-9a-fA-F]{6}$/.test(h)) h = '#' + h;
    return hexToRgb(h) ? h.toLowerCase() : null;
  }

  /* ---------- قراءة/كتابة الإعدادات ---------- */
  function read() {
    var out = {};
    Object.keys(defaults).forEach(function (k) { out[k] = defaults[k]; });
    try {
      var raw = global.localStorage && global.localStorage.getItem(KEY);
      var saved = raw ? JSON.parse(raw) : null;
      if (saved && typeof saved === 'object') {
        if (typeof saved.theme === 'string') out.theme = saved.theme;
        if (saved.custom && typeof saved.custom === 'object') {
          var c = {};
          ['maroon', 'maroonDark', 'gold', 'creamLight'].forEach(function (k) {
            var v = normalizeHex(saved.custom[k]);
            if (v) c[k] = v;
          });
          if (c.maroon) out.custom = c;
        }
        var s = Number(saved.scale);
        if (isFinite(s) && s >= FONT_SCALE.min && s <= FONT_SCALE.max) out.scale = Math.round(s * 100) / 100;
        if (LANGS.indexOf(saved.lang) > -1) out.lang = saved.lang;
        out.display = !!saved.display;
      }
    } catch (e) { /* تخزين متاح دائمًا احتياطيًا */ }
    if (!findTheme(out.theme)) out.theme = 'raheeq';
    return out;
  }

  function write(settings) {
    try {
      if (global.localStorage) global.localStorage.setItem(KEY, JSON.stringify(settings));
    } catch (e) { /* التخزين قد يكون ممتلئًا أو معطّلًا — نكمل في الجلسة */ }
  }

  function findTheme(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i];
    return null;
  }

  /* ---------- دمج الثيم الحر مع الثيم الجاهز ---------- */
  function resolvePalette(settings) {
    var base = findTheme(settings.theme) || THEMES[0];
    var pal = {
      maroon: base.maroon, maroonDark: base.maroonDark, maroonHover: base.maroonHover,
      gold: base.gold, goldLight: base.goldLight, goldPale: base.goldPale,
      cream: base.cream, creamLight: base.creamLight, creamDeep: base.creamDeep
    };
    if (settings.custom) {
      var c = settings.custom;
      if (c.maroon) {
        pal.maroon = c.maroon;
        pal.maroonDark = c.maroonDark || mix(c.maroon, '#000000', 0.34);
        pal.maroonHover = mix(c.maroon, '#FFFFFF', 0.18);
      }
      if (c.gold) {
        pal.gold = c.gold;
        pal.goldLight = mix(c.gold, '#FFFFFF', 0.28);
        pal.goldPale = mix(c.gold, '#FFFFFF', 0.62);
      }
      if (c.creamLight) {
        pal.creamLight = c.creamLight;
        pal.cream = mix(c.creamLight, pal.gold, 0.16);
        pal.creamDeep = mix(c.creamLight, pal.gold, 0.34);
      }
    }
    var ink = mix(pal.maroonDark, '#1A1A1A', 0.35);
    return {
      theme: pal,
      ink: ink,
      vars: {
        '--brand-maroon': pal.maroon,
        '--brand-maroon-rgb': rgbStr(pal.maroon),
        '--brand-maroon-dark': pal.maroonDark,
        '--brand-maroon-dark-rgb': rgbStr(pal.maroonDark),
        '--brand-maroon-hover': pal.maroonHover,
        '--brand-maroon-hover-rgb': rgbStr(pal.maroonHover),
        '--brand-gold': pal.gold,
        '--brand-gold-rgb': rgbStr(pal.gold),
        '--brand-gold-light': pal.goldLight,
        '--brand-gold-light-rgb': rgbStr(pal.goldLight),
        '--brand-gold-pale': pal.goldPale,
        '--brand-gold-pale-rgb': rgbStr(pal.goldPale),
        '--brand-cream': pal.cream,
        '--brand-cream-rgb': rgbStr(pal.cream),
        '--brand-cream-light': pal.creamLight,
        '--brand-cream-deep': pal.creamDeep,
        '--brand-ink': ink,
        '--brand-ink-rgb': rgbStr(ink),
        '--ink-rgb': rgbStr(ink),
        '--maroon-dark-rgb': rgbStr(pal.maroonDark)
      }
    };
  }

  /* ---------- تطبيق الإعدادات على الصفحة ---------- */
  function apply(settings) {
    var s = settings || read();
    var root = document.documentElement;
    var resolved = resolvePalette(s);
    Object.keys(resolved.vars).forEach(function (name) {
      root.style.setProperty(name, resolved.vars[name]);
    });
    root.style.setProperty('--ui-scale', String(s.scale || 1));
    root.setAttribute('data-theme', s.theme);
    root.setAttribute('data-scale', String(s.scale || 1));
    if (document.body) document.body.classList.toggle('use-display', !!s.display);
    applyThemeColor(resolved.theme);
    return resolved;
  }

  /* شريط المتصفح على الجوال يلبس لون الثيم */
  function applyThemeColor(pal) {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && pal) meta.setAttribute('content', pal.maroonDark);
  }

  /* ---------- اللغة ---------- */
  function setLang(lang, opts) {
    var s = read();
    s.lang = LANGS.indexOf(lang) > -1 ? lang : 'ar';
    write(s);
    applyLang(s.lang, opts);
    return s.lang;
  }

  function applyLang(lang, opts) {
    var root = document.documentElement;
    root.setAttribute('lang', lang);
    root.setAttribute('dir', lang === 'en' ? 'ltr' : 'rtl');
    /* الترجمة الفعلية للنصوص مسؤولية js/i18n.js — إن وُجد */
    var I = global.RaheeqI18n;
    if (I && I.apply) I.apply(lang);
    if (!opts || opts.announce !== false) {
      var evt;
      try { evt = new global.CustomEvent('raheeq:langchange', { detail: { lang: lang } }); } catch (e) { evt = null; }
      if (evt && global.dispatchEvent) global.dispatchEvent(evt);
    }
  }

  function setScale(scale) {
    var s = read();
    var n = Number(scale);
    if (isFinite(n)) s.scale = Math.min(FONT_SCALE.max, Math.max(FONT_SCALE.min, Math.round(n * 100) / 100));
    write(s);
    document.documentElement.style.setProperty('--ui-scale', String(s.scale));
    document.documentElement.setAttribute('data-scale', String(s.scale));
    return s.scale;
  }

  function setTheme(id) {
    var s = read();
    s.theme = findTheme(id) ? id : 'raheeq';
    /* اختيار ثيم جاهز يلغي اللون الحر حتى لا يبدو الاختيار بلا أثر */
    s.custom = null;
    write(s);
    var resolved = apply(s);
    return resolved;
  }

  function setCustom(custom) {
    var s = read();
    var next = {};
    if (custom) {
      ['maroon', 'maroonDark', 'gold', 'creamLight'].forEach(function (k) {
        var v = normalizeHex(custom[k]);
        if (v) next[k] = v;
      });
    }
    s.custom = next.maroon || next.gold || next.creamLight ? next : null;
    write(s);
    return apply(s);
  }

  function reset() {
    var s = {};
    Object.keys(defaults).forEach(function (k) { s[k] = defaults[k]; });
    write(s);
    apply(s);
    applyLang('ar', { announce: false });
    if (global.RaheeqI18n && global.RaheeqI18n.apply) global.RaheeqI18n.apply('ar');
    return s;
  }

  function setDisplayFont(on) {
    var s = read();
    s.display = !!on;
    write(s);
    if (document.body) document.body.classList.toggle('use-display', s.display);
    return s.display;
  }

  /* ---------- تسجيل واجهة عامة ---------- */
  /* ---------- التشغيل المبكر: يُطبَّق الثيم قبل رسم الصفحة ---------- */
  function boot() {
    var s = read();
    apply(s);
    applyLang(s.lang, { announce: false });
    return s;
  }
  boot();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      var s = boot();
      if (global.RaheeqI18n && global.RaheeqI18n.apply) global.RaheeqI18n.apply(s.lang);
    });
  } else {
    var now = boot();
    if (global.RaheeqI18n && global.RaheeqI18n.apply) global.RaheeqI18n.apply(now.lang);
  }

  global.RaheeqSettings = {
    KEY: KEY,
    THEMES: THEMES,
    LANGS: LANGS,
    FONT_SCALE: FONT_SCALE,
    defaults: defaults,
    read: read,
    write: write,
    findTheme: findTheme,
    resolvePalette: resolvePalette,
    apply: apply,
    applyLang: applyLang,
    setLang: setLang,
    setScale: setScale,
    setTheme: setTheme,
    setCustom: setCustom,
    setDisplayFont: setDisplayFont,
    reset: reset,
    normalizeHex: normalizeHex,
    isLight: isLight,
    mix: mix
  };
})(typeof window !== 'undefined' ? window : this);
