(() => {
  const root = document.documentElement;
  const themeBtn = document.getElementById('theme-toggle');

  function applyTheme(theme) {
    root.dataset.theme = theme;
    try { localStorage.setItem('quizard-site-theme', theme); } catch {}
    themeBtn?.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }

  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
    });
  }

  const menuBtn = document.getElementById('menu-btn');
  const mobileMenu = document.getElementById('mobile-menu');
  function setMenu(open) {
    if (!mobileMenu || !menuBtn) return;
    mobileMenu.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }
  menuBtn?.addEventListener('click', () => setMenu(!mobileMenu.classList.contains('open')));
  mobileMenu?.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });

  // Stagger cards inside each section so groups arrive in a soft cascade.
  document.querySelectorAll('.feature-grid, .gallery, .steps, .install-grid, .qr-grid, .docs-grid, .faq-list, .offline-cards, .footer-grid')
    .forEach(group => {
      [...group.children].forEach((el, i) => {
        if (el.classList?.contains('reveal')) {
          el.style.setProperty('--reveal-delay', `${Math.min(i * 55, 220)}ms`);
        }
      });
    });

  // Reveal-on-scroll. The observer runs in both motion modes: full motion uses
  // the app-style rise, reduced motion fades opacity only (see CSS).
  const reveals = [...document.querySelectorAll('.reveal')];
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(el => io.observe(el));
  } else {
    reveals.forEach(el => el.classList.add('in'));
  }

  // Highlight the current section in the desktop nav.
  const links = [...document.querySelectorAll('.nav-links a')];
  const sections = links
    .map(a => document.querySelector(a.getAttribute('href')))
    .filter(Boolean);
  if ('IntersectionObserver' in window && sections.length) {
    const spy = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = '#' + entry.target.id;
        links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === id));
      }
    }, { rootMargin: '-35% 0px -55% 0px' });
    sections.forEach(s => spy.observe(s));
  }
})();

// ── Docs ratings ──
// Anonymous one-per-browser star rating. The average lives in the Cloudflare
// relay's KV, so every visitor sees the same number; the browser id only lets
// the same person change their vote instead of stuffing the ballot.
(() => {
  const widget = document.querySelector('[data-rating]');
  if (!widget) return;

  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const endpoint = local ? '/ratings' : 'https://quizard-relay.quizard-app.workers.dev/ratings';
  const buttons = [...widget.querySelectorAll('[data-star]')];
  const avgEl = widget.querySelector('[data-rating-average]');
  const countEl = widget.querySelector('[data-rating-count]');
  const fillEl = widget.querySelector('[data-rating-fill]');
  const msgEl = widget.querySelector('[data-rating-message]');

  const CLIENT_KEY = 'quizard-rating-client';
  const VALUE_KEY = 'quizard-rating-value';
  let busy = false;
  let myRating = 0;

  const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };

  let clientId = read(CLIENT_KEY);
  if (!clientId) {
    clientId = globalThis.crypto?.randomUUID?.()
      || 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    write(CLIENT_KEY, clientId);
  }
  myRating = Math.min(5, Math.max(0, Number(read(VALUE_KEY)) || 0));

  function paintInput() {
    buttons.forEach((button, i) => {
      button.classList.toggle('on', i < myRating);
      button.setAttribute('aria-pressed', String(myRating === i + 1));
    });
  }

  function paintSummary(data) {
    const count = Math.max(0, Number(data?.count) || 0);
    const average = count ? Math.min(5, Math.max(0, Number(data?.average) || 0)) : 0;
    if (avgEl) avgEl.textContent = count ? average.toFixed(1) : '—';
    if (countEl) countEl.textContent = count
      ? `${count} rating${count === 1 ? '' : 's'}`
      : 'No ratings yet';
    if (fillEl) fillEl.style.width = `${(average / 5) * 100}%`;
  }

  function setBusy(on) {
    busy = on;
    widget.classList.toggle('busy', on);
    buttons.forEach(b => { b.disabled = on; });
    if (!on) {
      buttons.forEach(b => b.classList.remove('preview'));
      paintInput();
    }
  }

  async function load() {
    try {
      const res = await fetch(endpoint, { cache: 'no-store' });
      if (!res.ok) throw new Error('ratings_http_' + res.status);
      paintSummary(await res.json());
      if (myRating && msgEl) {
        msgEl.textContent = `You rated Quizard ${myRating} star${myRating === 1 ? '' : 's'}. Tap another star to change it.`;
      }
    } catch {
      if (avgEl) avgEl.textContent = '—';
      if (countEl) countEl.textContent = 'Ratings unavailable';
      if (fillEl) fillEl.style.width = '0%';
    }
    paintInput();
  }

  async function rate(stars) {
    if (busy) return;
    setBusy(true);
    if (msgEl) msgEl.textContent = 'Saving your rating…';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stars, clientId })
      });
      if (!res.ok) throw new Error('ratings_http_' + res.status);
      paintSummary(await res.json());
      myRating = stars;
      write(VALUE_KEY, String(stars));
      if (msgEl) msgEl.textContent = `Thanks — you rated Quizard ${stars} star${stars === 1 ? '' : 's'}. Tap another star to change it.`;
    } catch {
      if (msgEl) msgEl.textContent = 'Could not save your rating. Please try again.';
    } finally {
      setBusy(false);
    }
  }

  function preview(n) {
    if (busy) return;
    buttons.forEach((b, i) => {
      b.classList.toggle('preview', i < n);
      b.classList.remove('on');
    });
  }

  function clearPreview() {
    if (busy) return;
    buttons.forEach(b => b.classList.remove('preview'));
    paintInput();
  }

  buttons.forEach((button) => {
    const n = Number(button.dataset.star);
    button.addEventListener('click', () => rate(n));
    button.addEventListener('mouseenter', () => preview(n));
    button.addEventListener('focus', () => preview(n));
    button.addEventListener('mouseleave', clearPreview);
    button.addEventListener('blur', clearPreview);
  });

  paintInput();
  load();
})();
