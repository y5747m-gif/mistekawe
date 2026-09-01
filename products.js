// ننجاوي — بيانات المنتجات (بيانات تجريبية للعرض)

const NANJAWI_PRODUCTS = [
  { id: 'p1', name: 'عود كمبودي فاخر', category: 'بخور وعود', price: 420, oldPrice: 480, icon: '🪵', badge: 'الأكثر مبيعاً', desc: 'عود طبيعي معتّق برائحة دافئة وعميقة، مستخرج من أجود المزارع الكمبودية.' },
  { id: 'p2', name: 'دهن عود ملكي', category: 'عطور', price: 260, icon: '🧴', badge: null, desc: 'دهن عود مركّز بثبات عالٍ يدوم طوال اليوم، يُعصر بالطرق التقليدية.' },
  { id: 'p3', name: 'بخور معمول يدوي', category: 'بخور وعود', price: 95, icon: '🔥', badge: 'جديد', desc: 'خلطة بخور معمول من العنبر والمسك، تُحضّر يدوياً على الطريقة النجدية.' },
  { id: 'p4', name: 'صندوق تمر سكري فاخر', category: 'تمور', price: 150, icon: '🌴', badge: null, desc: 'تمر سكري منتقى من واحات القصيم، معبأ في صندوق خشبي تراثي.' },
  { id: 'p5', name: 'مسبحة يسر معطّرة', category: 'هدايا تراثية', price: 180, icon: '📿', badge: null, desc: 'مسبحة يسر أصلية معطّرة بخلاصة العود، بتفصيل يدوي دقيق.' },
  { id: 'p6', name: 'مبخرة نحاسية منقوشة', category: 'هدايا تراثية', price: 310, icon: '⚱️', badge: null, desc: 'مبخرة نحاسية بنقوش يدوية مستوحاة من الطراز النجدي القديم.' },
  { id: 'p7', name: 'عطر المسك الأبيض', category: 'عطور', price: 220, icon: '🧴', badge: null, desc: 'عطر فرنسي-عربي بمزيج المسك الأبيض والعنبر، توزيع ناعم وثبات طويل.' },
  { id: 'p8', name: 'صندوق هدايا ننجاوي', category: 'هدايا تراثية', price: 390, oldPrice: 450, icon: '🎁', badge: 'عرض خاص', desc: 'مجموعة مختارة من العود والعطر والتمر في صندوق هدية أنيق.' },
  { id: 'p9', name: 'تمر عجوة المدينة', category: 'تمور', price: 130, icon: '🌴', badge: null, desc: 'عجوة المدينة المنورة الأصلية، معبأة طازجة في عبوات محكمة.' },
  { id: 'p10', name: 'مجمرة كهربائية أنيقة', category: 'هدايا تراثية', price: 275, icon: '⚱️', badge: null, desc: 'مجمرة كهربائية بتصميم عصري بلمسة تراثية، آمنة وسهلة الاستخدام.' },
  { id: 'p11', name: 'عنبر خام درجة أولى', category: 'بخور وعود', price: 340, icon: '🪵', badge: null, desc: 'عنبر خام نقي بجودة عالية، يُستخدم للتبخير والتعطير الفاخر.' },
  { id: 'p12', name: 'عطر بخور العنبر', category: 'عطور', price: 240, icon: '🧴', badge: null, desc: 'عطر مستوحى من رائحة البخور التقليدية بقوام عصري قابل للحمل.' },
];

function formatPrice(value){
  return `${value.toLocaleString('ar-SA')}`;
}

function productCardHTML(p){
  return `
    <div class="product-card">
      <a href="product.html?id=${p.id}">
        <div class="product-thumb">
          ${p.badge ? `<span class="product-badge">${p.badge}</span>` : ''}
          <span>${p.icon}</span>
        </div>
      </a>
      <div class="product-info">
        <span class="product-cat">${p.category}</span>
        <a href="product.html?id=${p.id}"><h3>${p.name}</h3></a>
        <p class="product-desc">${p.desc}</p>
        <div class="product-foot">
          <span class="price">${formatPrice(p.price)} ر.س ${p.oldPrice ? `<small style="text-decoration:line-through;margin-inline-start:6px;">${formatPrice(p.oldPrice)}</small>` : ''}</span>
          <button class="add-btn" title="أضف إلى السلة" data-add-id="${p.id}">+</button>
        </div>
      </div>
    </div>
  `;
}

function renderProductGrid(container, products){
  if(!container) return;
  container.innerHTML = products.map(productCardHTML).join('');
  container.querySelectorAll('[data-add-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const product = NANJAWI_PRODUCTS.find(p => p.id === btn.dataset.addId);
      if(product) addToCart({ id: product.id, name: product.name, price: product.price, icon: product.icon, category: product.category }, 1);
    });
  });
}

function getProductById(id){
  return NANJAWI_PRODUCTS.find(p => p.id === id);
}
