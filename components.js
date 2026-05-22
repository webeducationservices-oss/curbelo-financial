/* ============================================================
   Curbelo Financial Coaching — Shared JavaScript
   ============================================================ */

(function () {
  'use strict';

  // ── Mobile menu ────────────────────────────────────────
  const toggle = document.querySelector('.nav-toggle');
  const links  = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const isOpen = toggle.classList.toggle('open');
      links.classList.toggle('open', isOpen);
      toggle.setAttribute('aria-expanded', isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });
    // Close menu on link click
    links.querySelectorAll('a').forEach(a =>
      a.addEventListener('click', () => {
        toggle.classList.remove('open');
        links.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      })
    );
  }

  // ── Nav scroll state ───────────────────────────────────
  const nav = document.querySelector('.nav');
  if (nav) {
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // ── Fade-in observer ───────────────────────────────────
  const fadeEls = document.querySelectorAll('.fade-in');
  if (fadeEls.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -50px 0px' });
    fadeEls.forEach(el => io.observe(el));
  } else {
    fadeEls.forEach(el => el.classList.add('visible'));
  }

  // ── Hero rotating word ─────────────────────────────────
  const rotator = document.querySelector('.hero h1 .rotator');
  if (rotator) {
    const words = (rotator.dataset.words || 'Freedom,Clarity,Peace,Confidence,Progress').split(',');
    let i = 0;
    rotator.textContent = words[0];
    setInterval(() => {
      rotator.style.opacity = '0';
      setTimeout(() => {
        i = (i + 1) % words.length;
        rotator.textContent = words[i];
        rotator.style.opacity = '1';
      }, 350);
    }, 2800);
    rotator.style.transition = 'opacity 0.35s ease';
  }

  // ── Blog category filter ───────────────────────────────
  const filterBtns = document.querySelectorAll('#blogFilters .filter-btn');
  if (filterBtns.length) {
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.getAttribute('data-filter');
        document.querySelectorAll('#postGrid .post-card').forEach(card => {
          const cat = card.getAttribute('data-cat');
          card.style.display = (filter === 'all' || cat === filter) ? '' : 'none';
        });
      });
    });
  }

  // ── Form submit (AJAX) ─────────────────────────────────
  const RECAPTCHA_KEY = '6Lck8aQsAAAAALMA-T6nwfkSf7bv4K-mOhkszeKh';
  document.querySelectorAll('form[data-ajax]').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Honeypot
      const honey = form.querySelector('[name="_honey"]');
      if (honey && honey.value) return;

      const btn = form.querySelector('[type="submit"]');
      const original = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

      try {
        // reCAPTCHA token
        if (typeof grecaptcha !== 'undefined' && grecaptcha.execute) {
          await new Promise(r => grecaptcha.ready(r));
          const token = await grecaptcha.execute(RECAPTCHA_KEY, { action: 'form_submit' });
          const tField = form.querySelector('[name="recaptcha_token"]');
          if (tField) tField.value = token;
        }

        const data = Object.fromEntries(new FormData(form).entries());

        // Fire in parallel: notification endpoint (email + Google Sheet) AND the CRM (SuiteDash)
        await Promise.allSettled([
          fetch('https://myaieditor.com/api/form-notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          }),
          fetch('/api/lead/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          })
        ]);

        // GTM dataLayer push
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({
          event: 'form_submission',
          form_type: data.form_type || 'contact',
          form_location: location.pathname
        });
      } catch (err) {
        console.error('Form submit error:', err);
      }

      // Show success
      const fields = form.querySelector('.form-fields');
      const success = form.querySelector('.form-success');
      if (fields) fields.style.display = 'none';
      if (success) success.classList.add('show');
      if (btn) { btn.disabled = false; btn.textContent = original; }
    });
  });

  // ── Newsletter form (lightweight, separate from contact) ─
  document.querySelectorAll('form.newsletter-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      const orig = btn.textContent;
      btn.disabled = true; btn.textContent = 'Subscribing...';

      const data = Object.fromEntries(new FormData(form).entries());
      data.site_slug = 'curbelo-financial';
      data.form_type = 'newsletter';

      try {
        await Promise.allSettled([
          fetch('https://myaieditor.com/api/form-notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          }),
          fetch('/api/lead/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          })
        ]);
      } catch (err) { console.error(err); }

      btn.textContent = 'Thank you!';
      btn.style.background = 'var(--green-500)';
      form.querySelectorAll('input').forEach(i => i.value = '');
      setTimeout(() => {
        btn.textContent = orig;
        btn.disabled = false;
        btn.style.background = '';
      }, 3500);
    });
  });

  // ── Smooth scroll for hash links ───────────────────────
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id.length <= 1) return;
      const el = document.querySelector(id);
      if (el) {
        e.preventDefault();
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // ── Year stamp ─────────────────────────────────────────
  const y = document.querySelector('[data-year]');
  if (y) y.textContent = new Date().getFullYear();

})();
