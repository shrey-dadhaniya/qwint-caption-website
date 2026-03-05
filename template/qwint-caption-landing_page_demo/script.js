/* ============================================================
   QWINT CAPTION — JAVASCRIPT
   Analytics, Razorpay, Animations, Interactions
   ============================================================ */

// ===== NAVBAR + STICKY CTA SCROLL =====
const navbar = document.getElementById('navbar');
const stickyCta = document.getElementById('stickyCta');
let heroBottom = 0;

function updateHeroBottom() {
  const hero = document.getElementById('hero');
  if (hero) heroBottom = hero.getBoundingClientRect().bottom + window.scrollY;
}

window.addEventListener('load', updateHeroBottom);
window.addEventListener('resize', updateHeroBottom);

window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 20);
  // Show sticky CTA once user scrolls past hero
  if (stickyCta) {
    stickyCta.classList.toggle('visible', window.scrollY > heroBottom - 100);
  }
});

// ===== HAMBURGER MENU =====
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobile-menu');
hamburger.addEventListener('click', () => {
  mobileMenu.classList.toggle('open');
});
mobileMenu.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => mobileMenu.classList.remove('open'));
});

// ===== CAPTION ANIMATION =====
const captions = [
  document.getElementById('cap1'),
  document.getElementById('cap2'),
  document.getElementById('cap3')
];
let currentCaption = 0;
function cycleCaption() {
  captions[currentCaption].classList.remove('active');
  currentCaption = (currentCaption + 1) % captions.length;
  captions[currentCaption].classList.add('active');
}
setInterval(cycleCaption, 2800);

// ===== GENERATE BUTTON ANIMATION =====
function animateGenerate() {
  const btn = document.getElementById('generateBtn');
  const spinner = document.getElementById('generateSpinner');
  const btnText = document.getElementById('generateBtnText');
  const status = document.getElementById('pluginStatus');

  if (btn.disabled) return;
  btn.disabled = true;
  spinner.style.display = 'block';
  btnText.textContent = 'Generating...';
  status.style.display = 'flex';

  const cc4 = document.getElementById('cc4');
  cc4.classList.add('generating');

  setTimeout(() => {
    spinner.style.display = 'none';
    btnText.textContent = '✦ Generate Captions';
    btn.disabled = false;
  }, 4000);
}

// ===== SCROLL ANIMATIONS =====
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('visible'); }
  });
}, { threshold: 0.15 });

document.querySelectorAll(
  '.step-card, .feature-card, .pricing-card, .testimonial-card, .faq-item, .dl-step'
).forEach((el, i) => {
  el.classList.add('fade-in');
  el.style.transitionDelay = `${(i % 4) * 80}ms`;
  observer.observe(el);
});

// ===== FAQ =====
function toggleFaq(item) {
  const isOpen = item.classList.contains('open');
  document.querySelectorAll('.faq-item.open').forEach(el => el.classList.remove('open'));
  if (!isOpen) item.classList.add('open');
}

// ===== DEMO VIDEO =====
function playDemo() {
  const overlay = document.getElementById('demoPlayOverlay');
  const iframe = document.getElementById('demoIframe');
  const thumbnail = document.querySelector('.demo-thumbnail');

  // Replace with your YouTube video ID
  const videoId = 'YOUR_YOUTUBE_VIDEO_ID';
  iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
  overlay.style.display = 'none';
  thumbnail.style.display = 'none';
  iframe.style.display = 'block';

  // Analytics
  trackEvent('demo_video_play');
}

// ===== ANALYTICS =====
function trackEvent(eventName, params = {}) {
  // GA4
  if (typeof gtag !== 'undefined') {
    gtag('event', eventName, params);
  }
  // Facebook Pixel
  if (typeof fbq !== 'undefined') {
    fbq('track', 'Lead', { content_name: eventName, ...params });
  }
}

function trackDownload() {
  // GA4 Conversion
  if (typeof gtag !== 'undefined') {
    gtag('event', 'download_click', {
      event_category: 'CTA',
      event_label: 'Plugin Download',
      value: 1
    });
    gtag('event', 'conversion', { send_to: 'G-XXXXXXXXXX/download' });
  }
  // Facebook Purchase / Lead Event
  if (typeof fbq !== 'undefined') {
    fbq('track', 'Lead', { content_name: 'Plugin Download' });
  }
}

function trackTrial() {
  if (typeof gtag !== 'undefined') {
    gtag('event', 'free_trial_activation', {
      event_category: 'Trial',
      event_label: '1 Minute Free Trial'
    });
  }
  if (typeof fbq !== 'undefined') {
    fbq('track', 'StartTrial', { content_name: '1 Minute Free' });
  }
}

// ===== RAZORPAY PAYMENT =====
function handlePayment(amountINR, minutes, planName) {
  const options = {
    key: 'rzp_live_XXXXXXXXXXXXXXXX', // Replace with your Razorpay Live Key
    amount: amountINR * 100, // Razorpay expects paise
    currency: 'INR',
    name: 'Qwint Caption',
    description: `${planName} — ${minutes} minutes of AI captions`,
    image: 'https://qwintcaption.com/logo.png',
    theme: { color: '#6A00FF' },
    prefill: {
      email: document.getElementById('emailInput')?.value || '',
    },
    handler: function (response) {
      // Payment success
      onPaymentSuccess(response, amountINR, minutes, planName);
    },
    modal: {
      ondismiss: function () {
        trackEvent('payment_dismissed', { plan: planName });
      }
    }
  };

  const rzp = new Razorpay(options);
  rzp.on('payment.failed', function (response) {
    console.error('Payment failed:', response.error);
    trackEvent('payment_failed', { plan: planName, reason: response.error.description });
    alert('Payment failed: ' + response.error.description + '. Please try again.');
  });

  rzp.open();

  // Track initiation
  trackEvent('payment_initiated', { plan: planName, value: amountINR, currency: 'INR' });
}

function onPaymentSuccess(response, amountINR, minutes, planName) {
  // Show success modal
  document.getElementById('modalMessage').textContent =
    `${minutes} minutes of caption credits have been added to your account. Payment ID: ${response.razorpay_payment_id.slice(-8)}`;
  document.getElementById('successModal').style.display = 'flex';

  // GA4 Purchase Event
  if (typeof gtag !== 'undefined') {
    gtag('event', 'purchase', {
      transaction_id: response.razorpay_payment_id,
      value: amountINR,
      currency: 'INR',
      items: [{
        item_id: planName.toLowerCase(),
        item_name: `Qwint Caption ${planName}`,
        quantity: 1,
        price: amountINR
      }]
    });
    gtag('event', 'conversion', {
      send_to: 'G-XXXXXXXXXX/purchase',
      value: amountINR,
      currency: 'INR',
      transaction_id: response.razorpay_payment_id
    });
  }

  // Facebook Pixel Purchase Event
  if (typeof fbq !== 'undefined') {
    fbq('track', 'Purchase', {
      value: amountINR,
      currency: 'INR',
      content_name: `${planName} Credits`,
      content_ids: [planName.toLowerCase()]
    });
  }
}

function closeModal() {
  document.getElementById('successModal').style.display = 'none';
}

// ===== DOWNLOAD HANDLER =====
function handleDownload() {
  const email = document.getElementById('emailInput').value.trim();

  if (!email || !isValidEmail(email)) {
    highlightEmailInput();
    return;
  }

  // Track download with email
  trackDownload();

  // You can send email to your backend here
  // fetch('/api/capture-email', { method: 'POST', body: JSON.stringify({ email }) });

  // Trigger plugin download
  // Replace with your actual plugin download URL
  const downloadUrl = 'https://qwintcaption.com/downloads/qwint-caption-installer.zxp';

  // Show a small feedback message before redirect
  const btn = document.getElementById('final-download-btn');
  btn.textContent = 'Preparing Download...';
  btn.style.opacity = '0.8';

  setTimeout(() => {
    // Uncomment when real download is available:
    // window.location.href = downloadUrl;
    btn.textContent = 'Download Plugin Free';
    btn.style.opacity = '1';
    alert('Thank you! The Qwint Caption plugin will start downloading shortly.\n\nMake sure Adobe Premiere Pro is installed on your system.');
  }, 1200);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function highlightEmailInput() {
  const input = document.getElementById('emailInput');
  input.style.borderColor = '#FF4444';
  input.placeholder = 'Please enter your email first';
  input.focus();
  setTimeout(() => {
    input.style.borderColor = '';
    input.placeholder = 'Enter your email';
  }, 3000);
}

// ===== DIRECT DOWNLOAD (no email required, for instant-download section) =====
function handleDownloadDirect() {
  // Replace with your actual plugin download URL
  const downloadUrl = 'https://qwintcaption.com/downloads/qwint-caption-installer.zxp';
  const btn = document.getElementById('dl-section-btn');
  if (btn) {
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3v10M6 9l4 4 4-4" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 15h14" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg> Preparing Download...';
    btn.style.opacity = '0.8';
  }
  setTimeout(() => {
    // Uncomment when real download URL is ready:
    // window.location.href = downloadUrl;
    if (btn) {
      btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M11 3v12M6 11l5 5 5-5" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 18h16" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg> Download Plugin Free';
      btn.style.opacity = '1';
    }
    alert('Download starting!\n\nMake sure Adobe Premiere Pro is installed.\nCompatible with Premiere Pro 2022 and above.');
  }, 900);
}

// ===== DOWNLOAD BUTTONS (hero + other CTAs) =====
document.getElementById('hero-download-btn').addEventListener('click', () => {
  trackDownload();
  document.getElementById('download').scrollIntoView({ behavior: 'smooth' });
});

// ===== PARALLAX / SUBTLE MOUSEMOVE =====
let ticking = false;
document.addEventListener('mousemove', (e) => {
  if (!ticking) {
    requestAnimationFrame(() => {
      const x = (e.clientX / window.innerWidth - 0.5) * 20;
      const y = (e.clientY / window.innerHeight - 0.5) * 20;
      const glow1 = document.querySelector('.hero-glow-1');
      const glow2 = document.querySelector('.hero-glow-2');
      if (glow1) glow1.style.transform = `translate(${x * 0.5}px, ${y * 0.5}px)`;
      if (glow2) glow2.style.transform = `translate(${-x * 0.3}px, ${-y * 0.3}px)`;
      ticking = false;
    });
    ticking = true;
  }
});

// ===== SMOOTH COUNTER ANIMATION =====
function animateCounter(el, target, duration = 2000) {
  let start = 0;
  const step = (timestamp) => {
    if (!start) start = timestamp;
    const progress = Math.min((timestamp - start) / duration, 1);
    el.textContent = Math.floor(progress * target);
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ===== PAGE LOAD =====
window.addEventListener('load', () => {
  // Pre-animate visible elements
  document.querySelectorAll('.fade-in').forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight) {
      el.classList.add('visible');
    }
  });
});
