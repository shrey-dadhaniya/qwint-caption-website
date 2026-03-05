/* ============================================================
   QWINT CAPTION LANDING INTERACTIONS (UI ONLY)
   ============================================================ */

'use strict';

const navbar = document.getElementById('navbar');
const stickyCta = document.getElementById('stickyCta');
const hero = document.getElementById('hero');
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobile-menu');

let heroBottom = 0;

function updateHeroBottom() {
  if (hero) heroBottom = hero.getBoundingClientRect().bottom + window.scrollY;
}

function onScroll() {
  if (navbar) navbar.classList.toggle('scrolled', window.scrollY > 20);
  if (stickyCta) stickyCta.classList.toggle('visible', window.scrollY > heroBottom - 100);
}

window.addEventListener('load', () => {
  updateHeroBottom();
  onScroll();

  // Pre-show visible fade-in blocks.
  document.querySelectorAll('.fade-in').forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight) el.classList.add('visible');
  });
});

window.addEventListener('resize', updateHeroBottom);
window.addEventListener('scroll', onScroll, { passive: true });

if (hamburger && mobileMenu) {
  hamburger.addEventListener('click', () => {
    const isOpen = mobileMenu.classList.toggle('open');
    hamburger.setAttribute('aria-expanded', String(isOpen));
  });

  mobileMenu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      mobileMenu.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
    });
  });
}

// Caption demo loop
const captions = [
  document.getElementById('cap1'),
  document.getElementById('cap2'),
  document.getElementById('cap3')
].filter(Boolean);

if (captions.length > 0) {
  let currentCaption = 0;
  setInterval(() => {
    captions[currentCaption].classList.remove('active');
    currentCaption = (currentCaption + 1) % captions.length;
    captions[currentCaption].classList.add('active');
  }, 2800);
}

// Plugin "generate" animation
function animateGenerate() {
  const btn = document.getElementById('generateBtn');
  const spinner = document.getElementById('generateSpinner');
  const btnText = document.getElementById('generateBtnText');
  const status = document.getElementById('pluginStatus');
  const cc4 = document.getElementById('cc4');

  if (!btn || !spinner || !btnText || !status || !cc4 || btn.disabled) return;

  btn.disabled = true;
  spinner.style.display = 'block';
  btnText.textContent = 'Generating...';
  status.style.display = 'flex';
  cc4.classList.add('generating');

  setTimeout(() => {
    spinner.style.display = 'none';
    btnText.textContent = '✦ Generate Captions';
    btn.disabled = false;
  }, 3000);
}

window.animateGenerate = animateGenerate;

// Scroll reveal
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) entry.target.classList.add('visible');
  });
}, { threshold: 0.15 });

document.querySelectorAll('.step-card, .feature-card, .pricing-card, .testimonial-card, .faq-item')
  .forEach((el, i) => {
    el.classList.add('fade-in');
    el.style.transitionDelay = `${(i % 4) * 80}ms`;
    observer.observe(el);
  });

function toggleFaq(item) {
  if (!item) return;
  const isOpen = item.classList.contains('open');
  document.querySelectorAll('.faq-item.open').forEach((el) => el.classList.remove('open'));
  if (!isOpen) item.classList.add('open');
}

window.toggleFaq = toggleFaq;

function playDemo() {
  const overlay = document.getElementById('demoPlayOverlay');
  const iframe = document.getElementById('demoIframe');
  const thumbnail = document.querySelector('.demo-thumbnail');
  if (!overlay || !iframe || !thumbnail) return;

  // Keep UI behavior without forcing a placeholder YouTube ID.
  overlay.style.display = 'none';
  thumbnail.style.display = 'none';
  iframe.style.display = 'block';
}

window.playDemo = playDemo;

function showMsg(message, isError) {
  if (typeof window.showToast === 'function') {
    window.showToast(message, !!isError);
  }
}

async function verifyPaymentAndRedirect(razorpayResponse) {
  const response = await fetch('/api/payment/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(razorpayResponse)
  });
  const data = await response.json();
  if (!response.ok || !data.ok || !data.redirectUrl) {
    throw new Error(data.error || 'Payment verification failed');
  }
  window.location.href = data.redirectUrl;
}

function openRazorpayCheckout({ order, product, checkout, razorpayKeyId }) {
  if (typeof Razorpay === 'undefined') {
    throw new Error('Razorpay checkout failed to load. Please refresh and retry.');
  }

  const options = {
    key: razorpayKeyId,
    amount: order.amount,
    currency: order.currency,
    name: (checkout && checkout.display_name) || 'Qwint Caption',
    description: (product && product.name) || (checkout && checkout.description) || 'Caption Credits',
    order_id: order.id,
    notes: {
      product_id: product && product.id ? product.id : ''
    },
    theme: {
      color: (checkout && checkout.theme_color) || '#6A00FF'
    },
    handler: async function (paymentResponse) {
      try {
        await verifyPaymentAndRedirect(paymentResponse);
      } catch (err) {
        showMsg(err.message || 'Payment verification failed', true);
      }
    },
    modal: {
      ondismiss: function () {
        showMsg('Payment cancelled', true);
      }
    }
  };

  const rzp = new Razorpay(options);
  rzp.on('payment.failed', function (event) {
    const reason = event && event.error && event.error.description
      ? event.error.description
      : 'Payment failed. Please try again.';
    showMsg(reason, true);
  });
  rzp.open();
}

async function handlePackageCheckout(productId) {
  if (!productId) {
    showMsg('Package is not configured', true);
    return;
  }

  const btn = document.getElementById(`buy-${productId}`);
  const originalText = btn ? btn.textContent : '';

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Opening checkout...';
  }

  try {
    const response = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId })
    });
    const data = await response.json();

    if (!response.ok || !data.order || !data.razorpayKeyId) {
      throw new Error(data.error || 'Could not initiate checkout');
    }

    openRazorpayCheckout(data);
  } catch (err) {
    showMsg(err.message || 'Could not initiate checkout', true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

window.handlePackageCheckout = handlePackageCheckout;

function trackDownload() {
  // UI-only phase: keep hook for future analytics wiring.
}

window.trackDownload = trackDownload;

function trackTrial() {
  // UI-only phase: keep hook for future analytics wiring.
}

window.trackTrial = trackTrial;

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function handleDownload() {
  const input = document.getElementById('emailInput');
  const btn = document.getElementById('final-download-btn');
  if (!input || !btn) return;

  const email = input.value.trim();
  if (!email || !isValidEmail(email)) {
    input.style.borderColor = '#ff5f57';
    input.placeholder = 'Enter a valid email to continue';
    input.focus();
    setTimeout(() => {
      input.style.borderColor = '';
      input.placeholder = 'Enter your email';
    }, 2000);
    return;
  }

  const original = btn.textContent;
  btn.textContent = 'Preparing your free download...';
  btn.disabled = true;
  btn.style.opacity = '0.9';

  try {
    const response = await fetch('/api/free-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await response.json();
    if (!response.ok || !data.ok || !data.downloadUrl) {
      throw new Error(data.error || 'Could not create your free download');
    }

    if (typeof window.showToast === 'function') {
      window.showToast('Your download is starting...', false);
    }

    const link = document.createElement('a');
    link.href = data.downloadUrl;
    link.setAttribute('download', '');
    document.body.appendChild(link);
    link.click();
    link.remove();

    input.value = '';
    btn.textContent = 'Download started';

    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
      btn.style.opacity = '1';
    }, 1600);
  } catch (err) {
    if (typeof window.showToast === 'function') {
      window.showToast(err.message || 'Could not create your free download', true);
    }
    btn.textContent = original;
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}

window.handleDownload = handleDownload;

// Subtle hero glow parallax
let ticking = false;
document.addEventListener('mousemove', (e) => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    const x = (e.clientX / window.innerWidth - 0.5) * 20;
    const y = (e.clientY / window.innerHeight - 0.5) * 20;
    const glow1 = document.querySelector('.hero-glow-1');
    const glow2 = document.querySelector('.hero-glow-2');
    if (glow1) glow1.style.transform = `translate(${x * 0.5}px, ${y * 0.5}px)`;
    if (glow2) glow2.style.transform = `translate(${-x * 0.3}px, ${-y * 0.3}px)`;
    ticking = false;
  });
});
