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
  const PHONE_TEL = 'tel:+17273165747';
  const PHONE_TEXT = '(727) 316-5747';
  const CONTACT_EMAIL = 'info@curbelofinancialcoaching.com';

  // reCAPTCHA must never be fatal. If the script is blocked (ad blockers,
  // privacy extensions) or the key is wrong, grecaptcha.execute() can hang
  // forever and the visitor is left on a dead button. Race it against an 8s
  // timer and fall back to posting with no token: form-notify records that as
  // missing_recaptcha_token, so the lead stays rescuable from the Spam tab
  // instead of vanishing.
  function recaptchaToken(action) {
    if (typeof grecaptcha === 'undefined' || !grecaptcha.execute) return Promise.resolve('');
    const run = new Promise((resolve) => {
      try {
        grecaptcha.ready(() => {
          try {
            grecaptcha.execute(RECAPTCHA_KEY, { action: action }).then(resolve, () => resolve(''));
          } catch (e) { resolve(''); }
        });
      } catch (e) { resolve(''); }
    });
    const timer = new Promise((resolve) => { setTimeout(() => resolve(''), 8000); });
    return Promise.race([run, timer]);
  }

  // A submission only counts once the server actually accepted it. form-notify
  // answers 200 with { accepted:false, reason } for blocked posts and /api/lead
  // answers { success:false }, so res.ok on its own is not the whole story.
  async function wasAccepted(settled) {
    if (!settled || settled.status !== 'fulfilled') return false;
    const res = settled.value;
    const body = await res.json().catch(() => ({}));
    return !!res.ok && body.accepted !== false && body.success !== false;
  }

  // Visible fallback so a failed submission is never mistaken for a sent one.
  function showFormError(form) {
    const host = form.querySelector('.form-actions') || form;
    let p = form.querySelector('.form-error');
    if (!p) {
      p = document.createElement('p');
      p.className = 'form-error';
      p.setAttribute('role', 'alert');
      p.style.cssText = 'margin-top:1rem;text-align:center;color:#b91c1c;font-size:0.9375rem;line-height:1.5;';
      host.appendChild(p);
    }
    p.innerHTML = 'We could not send that just now. Please call us at ' +
      '<a href="' + PHONE_TEL + '" style="color:#b91c1c;font-weight:700;">' + PHONE_TEXT + '</a>' +
      ' or email <a href="mailto:' + CONTACT_EMAIL + '" style="color:#b91c1c;font-weight:700;">' + CONTACT_EMAIL + '</a>' +
      ' so your message is not lost.';
  }

  document.querySelectorAll('form[data-ajax]').forEach(form => {
    // Stamp a load-time timestamp so form-notify's "too fast" bot check passes
    // for real users (must be set on load, not at submit).
    const tsField = form.querySelector('[name="_ts"]');
    if (tsField && !tsField.value) tsField.value = String(Date.now());

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Honeypot
      const honey = form.querySelector('[name="_honey"]');
      if (honey && honey.value) return;

      const btn = form.querySelector('[type="submit"]');
      const original = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

      const staleError = form.querySelector('.form-error');
      if (staleError) staleError.remove();

      let delivered = false;
      try {
        // reCAPTCHA token (never fatal, never hangs)
        const tField = form.querySelector('[name="recaptcha_token"]');
        if (tField) tField.value = await recaptchaToken('form_submit');

        const data = Object.fromEntries(new FormData(form).entries());

        // Fire in parallel: notification endpoint (email + Google Sheet) AND the CRM (SuiteDash)
        const settled = await Promise.allSettled([
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

        // Captured if EITHER pipeline took it (form-notify -> leads/email/sheet,
        // or /api/lead -> SuiteDash, which is George's actual pipeline).
        const notifyOk = await wasAccepted(settled[0]);
        const crmOk = await wasAccepted(settled[1]);
        delivered = notifyOk || crmOk;

        if (delivered) {
          // GTM dataLayer push (only on a real, server-accepted submission)
          window.dataLayer = window.dataLayer || [];
          window.dataLayer.push({
            event: 'form_submission',
            form_type: data.form_type || 'contact',
            form_location: location.pathname
          });
        } else {
          console.error('Form submit rejected by both endpoints', settled);
        }
      } catch (err) {
        console.error('Form submit error:', err);
      }

      if (!delivered) {
        // Real, visible fallback so the lead is not lost behind a fake thank-you.
        if (btn) { btn.disabled = false; btn.textContent = original; }
        showFormError(form);
        return;
      }

      // Show success (only after the server accepted it)
      const fields = form.querySelector('.form-fields');
      const success = form.querySelector('.form-success');
      if (fields) fields.style.display = 'none';
      if (success) success.classList.add('show');
      if (btn) { btn.disabled = false; btn.textContent = original; }

      // Optional post-success redirect (e.g. contact form → Calendly scheduler)
      const successUrl = form.getAttribute('data-success-url');
      if (successUrl) setTimeout(() => window.open(successUrl, '_blank'), 2000);
    });
  });

  // ── Newsletter form (lightweight, separate from contact) ─
  document.querySelectorAll('form.newsletter-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      const orig = btn.textContent;
      btn.disabled = true; btn.textContent = 'Subscribing...';

      const staleErr = form.parentNode && form.parentNode.querySelector('.newsletter-error');
      if (staleErr) staleErr.remove();

      const data = Object.fromEntries(new FormData(form).entries());
      data.site_slug = 'curbelo-financial';
      data.form_type = 'newsletter';
      // The newsletter used to post with no token at all, so form-notify
      // rejected 100% of signups. Send one now (best effort, never fatal).
      data.recaptcha_token = await recaptchaToken('newsletter');

      let delivered = false;
      try {
        const settled = await Promise.allSettled([
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
        delivered = (await wasAccepted(settled[0])) || (await wasAccepted(settled[1]));
        if (!delivered) console.error('Newsletter signup rejected by both endpoints', settled);
      } catch (err) { console.error(err); }

      if (!delivered) {
        btn.disabled = false;
        btn.textContent = orig;
        const note = document.createElement('div');
        note.className = 'newsletter-error';
        note.setAttribute('role', 'alert');
        note.style.cssText = 'max-width:720px;margin:1rem auto 0;padding:0.75rem 1rem;border-radius:10px;background:#7f1d1d;color:#fff;font-size:0.9375rem;line-height:1.5;text-align:center;';
        note.innerHTML = 'We could not sign you up just now. Please call us at ' +
          '<a href="' + PHONE_TEL + '" style="color:#fff;font-weight:700;">' + PHONE_TEXT + '</a>' +
          ' or email <a href="mailto:' + CONTACT_EMAIL + '" style="color:#fff;font-weight:700;">' + CONTACT_EMAIL + '</a>' +
          ' and we will add you.';
        if (form.parentNode) form.parentNode.insertBefore(note, form.nextSibling);
        return;
      }

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
