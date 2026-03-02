/* ============================================================
   Qwint Caption JavaScript (Interactions & Animations)
   ============================================================ */

'use strict';

// ── Scroll Progress Bar ────────────────────────────────────
const progressBar = document.getElementById('progress-bar');
function updateProgress() {
  const scrollTop = window.scrollY;
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
  if (progressBar) progressBar.style.width = pct + '%';
}

// ── Navbar Scroll Effect ───────────────────────────────────
const navbar = document.getElementById('navbar');
function updateNavbar() {
  if (!navbar) return;
  if (window.scrollY > 60) {
    navbar.classList.add('scrolled');
  } else {
    navbar.classList.remove('scrolled');
  }
}

window.addEventListener('scroll', () => {
  updateProgress();
  updateNavbar();
}, { passive: true });

// ── Mobile Menu ─────────────────────────────────────────────
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileNav = document.getElementById('mobile-nav');
const mobileClose = document.getElementById('mobile-close');

function openMobileNav() {
  if (!mobileNav || !mobileMenuBtn) return;
  mobileNav.classList.add('open');
  mobileMenuBtn.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
}

function closeMobileNav() {
  if (!mobileNav || !mobileMenuBtn) return;
  mobileNav.classList.remove('open');
  mobileMenuBtn.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}

if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', openMobileNav);
if (mobileClose) mobileClose.addEventListener('click', closeMobileNav);

// Close mobile nav when a link is clicked
document.querySelectorAll('.mobile-nav-link, .mobile-nav .btn').forEach(link => {
  link.addEventListener('click', closeMobileNav);
});

// Close on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMobileNav();
});

// ── Intersection Observer Reveal on Scroll ───────────────
const revealEls = document.querySelectorAll('.reveal');
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, {
  threshold: 0.12,
  rootMargin: '0px 0px -40px 0px'
});

revealEls.forEach(el => revealObserver.observe(el));

// ── FAQ Accordion ──────────────────────────────────────────
document.querySelectorAll('.faq-trigger').forEach(trigger => {
  trigger.addEventListener('click', () => {
    const item = trigger.closest('.faq-item');
    const body = item.querySelector('.faq-body');
    const isOpen = item.classList.contains('open');

    // Close all open items
    document.querySelectorAll('.faq-item.open').forEach(openItem => {
      const openBody = openItem.querySelector('.faq-body');
      openItem.classList.remove('open');
      openItem.querySelector('.faq-trigger').setAttribute('aria-expanded', 'false');
      if (openBody) openBody.style.maxHeight = '0';
    });

    // Toggle current
    if (!isOpen) {
      item.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      if (body) body.style.maxHeight = body.scrollHeight + 'px';
    }
  });
});

// ── Demo play button hover ─────────────────────────────────
const demoTrigger = document.getElementById('demo-trigger');
const playBtn = document.getElementById('play-btn');

if (demoTrigger && playBtn) {
  demoTrigger.addEventListener('mouseenter', () => {
    playBtn.style.transform = 'scale(1.12)';
  });
  demoTrigger.addEventListener('mouseleave', () => {
    playBtn.style.transform = '';
  });
  demoTrigger.addEventListener('click', () => {
    // Placeholder: open a video modal or YouTube link
    // Replace 'YOUR_VIDEO_ID' with the actual YouTube video ID
    alert('Demo video coming soon! This will open a video player.');
  });
  demoTrigger.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      demoTrigger.click();
    }
  });
}

// ── Animated Caption Typing Effect ────────────────────────
const captionLines = [
  'Qwint Caption generates subtitles in seconds',
  'AI-powered • 60+ languages supported',
  'No subscription · One-time license',
  'Professional captions inside Premiere Pro',
];

let captionIdx = 0;
let charIdx = 0;
let isDeleting = false;
const captionEl = document.getElementById('caption-text');

function typeCaption() {
  if (!captionEl) return;

  const currentLine = captionLines[captionIdx];
  const cursor = '<span class="caption-cursor"></span>';

  if (!isDeleting) {
    charIdx++;
    captionEl.innerHTML = currentLine.slice(0, charIdx) + cursor;

    if (charIdx === currentLine.length) {
      isDeleting = true;
      setTimeout(typeCaption, 2200);
      return;
    }
    setTimeout(typeCaption, 52);
  } else {
    charIdx--;
    captionEl.innerHTML = currentLine.slice(0, charIdx) + cursor;

    if (charIdx === 0) {
      isDeleting = false;
      captionIdx = (captionIdx + 1) % captionLines.length;
      setTimeout(typeCaption, 400);
      return;
    }
    setTimeout(typeCaption, 28);
  }
}

// Start typing animation after page loads
window.addEventListener('load', () => {
  setTimeout(typeCaption, 1200);
});

// ── Smooth Scroll for anchor links ─────────────────────────
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const targetId = this.getAttribute('href');
    if (targetId === '#') return;
    const target = document.querySelector(targetId);
    if (!target) return;
    e.preventDefault();
    const navH = navbar ? navbar.offsetHeight : 80;
    const top = target.getBoundingClientRect().top + window.scrollY - navH - 12;
    window.scrollTo({ top, behavior: 'smooth' });
  });
});

// ── Top-up card interaction ────────────────────────────────
document.querySelectorAll('.topup-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.topup-card').forEach(c => c.style.outline = '');
    card.style.outline = '2px solid var(--clr-primary)';
  });
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      card.click();
    }
  });
});

// ── Feature card micro-animation ──────────────────────────
document.querySelectorAll('.feature-card').forEach(card => {
  card.addEventListener('mouseenter', function () {
    this.style.transition = 'all .3s cubic-bezier(.34,1.56,.64,1)';
  });
  card.addEventListener('mouseleave', function () {
    this.style.transition = 'all .3s var(--ease)';
  });
});

// ── Button ripple effect ───────────────────────────────────
document.querySelectorAll('.btn').forEach(btn => {
  btn.addEventListener('click', function (e) {
    const rect = btn.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const ripple = document.createElement('span');

    ripple.style.cssText = `
      position:absolute;
      left:${x}px; top:${y}px;
      width:0; height:0;
      border-radius:50%;
      background:rgba(255,255,255,.25);
      transform:translate(-50%,-50%);
      animation: ripple-anim .6s linear forwards;
      pointer-events:none;
    `;

    if (!document.querySelector('#ripple-style')) {
      const style = document.createElement('style');
      style.id = 'ripple-style';
      style.textContent = `
        @keyframes ripple-anim {
          to { width: 200px; height: 200px; opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    btn.style.position = 'relative';
    btn.style.overflow = 'hidden';
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 700);
  });
});

// ── Sol-steps stagger animation ───────────────────────────
const solSteps = document.querySelectorAll('.sol-step');
const solStepObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry, i) => {
    if (entry.isIntersecting) {
      setTimeout(() => {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateX(0)';
      }, i * 120);
      solStepObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.2 });

solSteps.forEach(step => {
  step.style.opacity = '0';
  step.style.transform = 'translateX(-16px)';
  step.style.transition = 'all .5s cubic-bezier(.4,0,.2,1)';
  solStepObserver.observe(step);
});

// ── Init ───────────────────────────────────────────────────
updateNavbar();
