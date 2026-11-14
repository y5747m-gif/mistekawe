// ننجاوي + أكاديمية رحيق — منطق مشترك للموقع (السلة، القائمة الجانبية، النماذج)

const NANJAWI_CART_KEY = 'nanjawi_cart_v1';

/* ---------- أكاديمية رحيق — منصات التواصل ---------- */
/* مصدر واحد للحقيقة: عدّل اللينك هنا وفي HTML معًا عند تغيير الحساب */
const RAHEEQ_SOCIALS = [
  { id: 'facebook',  name: 'فيسبوك',  url: 'https://www.facebook.com/share/1D5b2pqYVv/' },
  { id: 'instagram', name: 'إنستجرام', url: 'https://www.instagram.com/ltrykh.nbd', handle: '@ltrykh.nbd' },
  { id: 'tiktok',    name: 'تيك توك',  url: 'https://www.tiktok.com/@shahdadeel..952008', handle: '@shahdadeel..952008' },
  { id: 'youtube', name: 'يوتيوب', url: 'https://youtube.com/@raheeq.foundati?si=yvSJSrTjSsgAFn7k', handle: '@raheeq.foundati' },
];

const RAHEEQ_SOCIAL_ICONS = {
  youtube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/></svg>',
};

/* يملأ أي عنصر [data-raheeq-socials] بروابط المنصات (لأي صفحة جديدة) */
function initRaheeqSocials(){
  document.querySelectorAll('[data-raheeq-socials]').forEach((box) => {
    if(box.dataset.raheeqSocialsFilled) return;
    box.dataset.raheeqSocialsFilled = '1';
    const iconsOnly = box.classList.contains('socials--icons');
    box.innerHTML = RAHEEQ_SOCIALS.map((s) => {
      const handle = (!iconsOnly && s.handle) ? `<span class="handle">${s.handle}</span>` : '';
      return `<a class="social-link" href="${s.url}" target="_blank" rel="noopener noreferrer" aria-label="أكاديمية رحيق على ${s.name}" title="${s.name}">${RAHEEQ_SOCIAL_ICONS[s.id] || ''}<span>${s.name}</span>${handle}</a>`;
    }).join('');
  });
}

/* هروب HTML لأي قيمة تُدخل في innerHTML — حماية من XSS المخزّن */
function escHtml(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}
window.escHtml = escHtml;

function sanitizeCartItem(i){
  if(!i || typeof i !== 'object') return null;
  var id = String(i.id == null ? '' : i.id);
  var name = String(i.name == null ? '' : i.name);
  if(!id || !name) return null;
  var price = Number(i.price);
  var qty = parseInt(i.qty, 10);
  return {
    id: id,
    name: name,
    price: isFinite(price) && price >= 0 ? price : 0,
    oldPrice: isFinite(Number(i.oldPrice)) && Number(i.oldPrice) > 0 ? Number(i.oldPrice) : null,
    icon: String(i.icon == null ? '' : i.icon),
    category: String(i.category == null ? '' : i.category),
    qty: isFinite(qty) && qty >= 1 ? Math.min(qty, 999) : 1
  };
}

function getCart(){
  try{
    const raw = JSON.parse(localStorage.getItem(NANJAWI_CART_KEY)) || [];
    if(!Array.isArray(raw)) return [];
    return raw.map(sanitizeCartItem).filter(Boolean);
  }catch(e){
    return [];
  }
}

function saveCart(cart){
  localStorage.setItem(NANJAWI_CART_KEY, JSON.stringify(cart));
  updateCartBadge();
}

function addToCart(product, qty = 1){
  const cart = getCart();
  const existing = cart.find(item => item.id === product.id);
  if(existing){
    existing.qty += qty;
  }else{
    cart.push({ ...product, qty });
  }
  saveCart(cart);
  showToast(`تمت إضافة «${product.name}» إلى السلة`);
}

function removeFromCart(id){
  const cart = getCart().filter(item => item.id !== id);
  saveCart(cart);
}

function updateQty(id, qty){
  const cart = getCart();
  const item = cart.find(i => i.id === id);
  if(item){
    item.qty = Math.max(1, qty);
    saveCart(cart);
  }
}

function cartCount(){
  return getCart().reduce((sum, item) => sum + item.qty, 0);
}

function cartTotal(){
  return getCart().reduce((sum, item) => sum + item.qty * item.price, 0);
}

function updateCartBadge(){
  document.querySelectorAll('[data-cart-count]').forEach(el => {
    const count = cartCount();
    el.textContent = count;
    el.style.display = count > 0 ? 'flex' : 'none';
  });
}

function showToast(message){
  let toast = document.querySelector('.toast');
  if(!toast){
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(window.__nanjawiToastTimer);
  window.__nanjawiToastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

// ---------- القائمة الجانبية على الجوال ----------
function initNavToggle(){
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.main-nav');
  if(!toggle || !nav) return;
  toggle.addEventListener('click', () => {
    nav.classList.toggle('open');
  });
}

// ---------- التحقق من النماذج ----------
function validateField(field, condition, message){
  const errorEl = field.querySelector('.field-error');
  if(!condition){
    field.classList.add('invalid');
    if(errorEl) errorEl.textContent = message;
    return false;
  }
  field.classList.remove('invalid');
  return true;
}

function isValidEmail(value){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function initLoginForm(){
  const form = document.getElementById('login-form');
  if(!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const emailField = document.getElementById('login-email-field');
    const passField = document.getElementById('login-password-field');
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    const emailOk = validateField(emailField, isValidEmail(email), 'يرجى إدخال بريد إلكتروني صحيح');
    const passOk = validateField(passField, password.length >= 6, 'كلمة المرور يجب ألا تقل عن 6 أحرف');

    if(emailOk && passOk){
      showToast('تم تسجيل الدخول إلى أكاديمية رحيق بنجاح، جاري تحويلك...');
      setTimeout(() => { window.location.href = 'index.html'; }, 1400);
    }
  });
}

function initRegisterForm(){
  const form = document.getElementById('register-form');
  if(!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const nameField = document.getElementById('reg-name-field');
    const emailField = document.getElementById('reg-email-field');
    const passField = document.getElementById('reg-password-field');
    const confirmField = document.getElementById('reg-confirm-field');

    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const confirm = document.getElementById('reg-confirm').value;

    const nameOk = validateField(nameField, name.length >= 3, 'الاسم يجب ألا يقل عن 3 أحرف');
    const emailOk = validateField(emailField, isValidEmail(email), 'يرجى إدخال بريد إلكتروني صحيح');
    const passOk = validateField(passField, password.length >= 6, 'كلمة المرور يجب ألا تقل عن 6 أحرف');
    const confirmOk = validateField(confirmField, confirm === password && confirm.length > 0, 'كلمتا المرور غير متطابقتين');

    if(nameOk && emailOk && passOk && confirmOk){
      showToast('تم إنشاء حسابك في أكاديمية رحيق بنجاح، جاري تحويلك...');
      setTimeout(() => { window.location.href = 'login.html'; }, 1400);
    }
  });
}

// ---------- تشغيل عند تحميل الصفحة ----------
document.addEventListener('DOMContentLoaded', () => {
  initNavToggle();
  updateCartBadge();
  initLoginForm();
  initRegisterForm();
  initRaheeqSocials();
});
