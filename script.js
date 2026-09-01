// ننجاوي — منطق مشترك للموقع (السلة، القائمة الجانبية، النماذج)

const NANJAWI_CART_KEY = 'nanjawi_cart_v1';

function getCart(){
  try{
    return JSON.parse(localStorage.getItem(NANJAWI_CART_KEY)) || [];
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
      showToast('تم تسجيل الدخول بنجاح، جاري تحويلك...');
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
      showToast('تم إنشاء الحساب بنجاح، جاري تحويلك...');
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
});
