/**
 * motion.js
 * Small animation helpers shared by the screens. Motion only shows what
 * already happened: the data and the screen-reader announcements change at
 * once, and every helper finishes immediately when the device asks for
 * reduced motion. Timings and curves match the tokens in css/style.css.
 */
const Motion = (() => {
  const EASE_IN = 'cubic-bezier(.4, 0, 1, 1)';
  const MAX_FLYING = 6; // fast tapping never piles up dozens of tokens
  const query = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let flying = 0;

  function reduced() {
    return !!(query && query.matches);
  }

  function canAnimate(el) {
    return !reduced() && !!el && typeof el.animate === 'function';
  }

  // Restart a one-shot CSS animation class (a pop, a tick) even when it is
  // already on the element. The class is removed again when it finishes.
  function replay(el, cls, delayMs) {
    if (!el || reduced()) return;
    el.classList.remove(cls);
    el.style.animationDelay = delayMs ? Math.round(delayMs) + 'ms' : '';
    void el.offsetWidth; // let the browser see the class as new
    el.classList.add(cls);
    const done = (e) => {
      if (e.target !== el) return;
      el.removeEventListener('animationend', done);
      el.classList.remove(cls);
      el.style.animationDelay = '';
    };
    el.addEventListener('animationend', done);
  }

  // True when the element is on screen and not hidden under the top bar.
  function inView(el) {
    if (!el || !el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    const topbar = document.querySelector('.topbar');
    const top = topbar ? topbar.getBoundingClientRect().bottom : 0;
    return r.width > 0 && r.top >= top && r.bottom <= window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  }

  // Where an element will be once its moving container (for example the
  // phone cart bar, which may still be sliding in) has settled.
  function settledRect(el, mover) {
    const r = el.getBoundingClientRect();
    const t = mover ? getComputedStyle(mover).transform : 'none';
    if (!t || t === 'none' || typeof DOMMatrixReadOnly === 'undefined') return r;
    const m = new DOMMatrixReadOnly(t);
    return { left: r.left - m.m41, top: r.top - m.m42, width: r.width, height: r.height };
  }

  // Add to cart: a copy of the product photo lifts off, travels in an arc and
  // shrinks into the cart. Returns { duration, finished } or null when no
  // flight is shown (reduced motion, nothing to aim at, too many in the air).
  function fly(sourceEl, targetRect) {
    if (!canAnimate(sourceEl) || !targetRect || flying >= MAX_FLYING) return null;
    const from = sourceEl.getBoundingClientRect();
    if (!from.width || !from.height) return null;

    const dx = (targetRect.left + targetRect.width / 2) - (from.left + from.width / 2);
    const dy = (targetRect.top + targetRect.height / 2) - (from.top + from.height / 2);
    const dist = Math.hypot(dx, dy);
    const duration = Math.round(Math.min(760, Math.max(520, 420 + dist * 0.35)));
    // Trips upward (desktop: products below, sale panel above) get a low
    // arc that peaks late; trips downward (phone bar) hop up first.
    const up = dy < 0;
    const lift = up ? Math.min(72, Math.max(32, dist * 0.1)) : Math.min(140, Math.max(48, dist * 0.22));
    const peakAt = up ? 0.62 : 0.36;
    // Rise above both ends, but never off the top of the screen.
    const sy = from.top + from.height / 2;
    const highest = 16 + from.height * 0.3 - sy;
    const peak = Math.min(Math.min(0, dy), Math.max(Math.min(0, dy) - lift, highest));
    const endScale = Math.max(0.1, 28 / Math.max(from.width, from.height));

    // Three layers so each axis gets its own curve: the token moves
    // sideways, the lane rises then falls, the art shrinks and fades.
    const token = document.createElement('div');
    token.className = 'fly-token';
    token.setAttribute('aria-hidden', 'true');
    token.style.left = from.left + 'px';
    token.style.top = from.top + 'px';
    token.style.width = from.width + 'px';
    token.style.height = from.height + 'px';
    const lane = document.createElement('div');
    lane.className = 'fly-token-lane';
    const art = sourceEl.cloneNode(true);
    art.classList.add('fly-token-art');
    art.removeAttribute('id');
    lane.appendChild(art);
    token.appendChild(lane);
    document.body.appendChild(token);
    flying += 1;

    const across = token.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(' + dx + 'px)' }],
      { duration, easing: 'cubic-bezier(.45, 0, .4, 1)', fill: 'forwards' }
    );
    lane.animate([
      { transform: 'translateY(0)', easing: up ? 'cubic-bezier(.33, .45, .4, 1)' : 'cubic-bezier(.2, .7, .4, 1)' },
      { transform: 'translateY(' + peak + 'px)', offset: peakAt, easing: 'cubic-bezier(.45, 0, .75, .5)' },
      { transform: 'translateY(' + dy + 'px)' },
    ], { duration, fill: 'forwards' });
    // Picked up (a little smaller), shrinks on the way, and only fades in
    // the last moment so the landing itself is visible.
    const midScale = Math.max(endScale * 2, 0.42);
    art.animate([
      { transform: 'scale(1)', opacity: 1, borderRadius: '6px' },
      { transform: 'scale(.86)', opacity: 1, offset: 0.14 },
      { transform: 'scale(' + midScale + ')', opacity: 1, offset: 0.7 },
      { transform: 'scale(' + (endScale * 1.25) + ')', opacity: 1, offset: 0.9 },
      { transform: 'scale(' + endScale + ')', opacity: 0, borderRadius: '50%' },
    ], { duration, fill: 'forwards' });

    const finished = new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        flying -= 1;
        token.remove();
        resolve();
      };
      across.onfinish = finish;
      across.oncancel = finish;
      setTimeout(finish, duration + 400); // safety net if the tab was hidden
    });
    return { duration, finished };
  }

  // Fade an element out (and optionally fold its height away) before it is
  // removed, so the things below slide up instead of jumping.
  function leave(el, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      if (!canAnimate(el)) { resolve(); return; }
      el.style.pointerEvents = 'none';
      let frames;
      if (opts.collapse) {
        const cs = getComputedStyle(el);
        const h = el.offsetHeight + 'px';
        el.style.overflow = 'hidden';
        frames = [
          { opacity: 1, transform: 'none', height: h, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginBottom: cs.marginBottom },
          { opacity: 0, transform: 'translateX(16px)', height: h, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginBottom: cs.marginBottom, offset: 0.55 },
          { opacity: 0, transform: 'translateX(16px)', height: '0px', paddingTop: '0px', paddingBottom: '0px', marginBottom: opts.gap ? '-' + opts.gap : '0px' },
        ];
      } else {
        frames = [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(12px)' }];
      }
      const anim = el.animate(frames, { duration: opts.collapse ? 280 : 160, easing: EASE_IN, fill: 'forwards' });
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      anim.onfinish = finish;
      anim.oncancel = finish;
      setTimeout(finish, 700);
    });
  }

  // Fold an element that has already faded out (a dismissed notice).
  function collapse(el, gap) {
    return new Promise((resolve) => {
      if (!canAnimate(el)) { resolve(); return; }
      const cs = getComputedStyle(el);
      el.style.overflow = 'hidden';
      const anim = el.animate([
        { height: el.offsetHeight + 'px', paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginBottom: '0px' },
        { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginBottom: gap ? '-' + gap : '0px' },
      ], { duration: 160, easing: 'cubic-bezier(.2, 0, 0, 1)', fill: 'forwards' });
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      anim.onfinish = finish;
      anim.oncancel = finish;
      setTimeout(finish, 500);
    });
  }

  // Numbers that change on screen (report totals) count to their new value.
  function countTo(el, value, format) {
    if (!el) return;
    const to = Number(value) || 0;
    const prev = parseFloat(el.dataset.value);
    const from = isNaN(prev) ? 0 : prev;
    el.dataset.value = String(to);
    if (el._countFrame) cancelAnimationFrame(el._countFrame);
    if (reduced() || document.hidden || from === to || !el.getClientRects().length) {
      el.textContent = format(to);
      return;
    }
    const whole = Number.isInteger(from) && Number.isInteger(to);
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 480);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (to - from) * eased;
      el.textContent = format(t < 1 ? (whole ? Math.round(v) : v) : to);
      el._countFrame = t < 1 ? requestAnimationFrame(step) : null;
    };
    el._countFrame = requestAnimationFrame(step);
  }

  // Segmented controls: one highlight that slides to the chosen option.
  // Works with the existing markup; it follows the .active class.
  function segmented(group) {
    if (!group || group.querySelector('.segmented-thumb')) return;
    const thumb = document.createElement('span');
    thumb.className = 'segmented-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    group.prepend(thumb);
    group.classList.add('has-thumb');

    const sync = (instant) => {
      const active = group.querySelector('.segmented-btn.active');
      if (!active) { thumb.style.opacity = '0'; return; }
      if (!active.offsetWidth) return; // hidden tab: synced again when shown
      if (instant || thumb.style.opacity !== '1') thumb.classList.add('no-anim');
      thumb.style.opacity = '1';
      thumb.style.width = active.offsetWidth + 'px';
      thumb.style.transform = 'translateX(' + active.offsetLeft + 'px)';
      if (thumb.classList.contains('no-anim')) {
        void thumb.offsetWidth;
        thumb.classList.remove('no-anim');
      }
    };
    new MutationObserver((list) => {
      if (list.some((m) => m.target !== thumb)) sync(false);
    }).observe(group, { subtree: true, attributes: true, attributeFilter: ['class'] });
    if (window.ResizeObserver) new ResizeObserver(() => sync(true)).observe(group);
    sync(true);
  }

  return { reduced, replay, inView, settledRect, fly, leave, collapse, countTo, segmented };
})();
