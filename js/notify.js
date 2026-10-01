/**
 * notify.js
 * Two kinds of notification:
 *
 *  1. Toast cards -- short-lived feedback on something that just happened
 *     (sale recorded, item saved, export failed...). They stack in the
 *     top-right corner, each with a type (success / info / warning /
 *     error), an icon, a title and an optional message. They dismiss
 *     themselves after a few seconds (errors stay longer), pause while
 *     hovered or focused, and can be closed early with the X.
 *
 *  2. The bell menu in the top bar -- things that still need attention
 *     (out-of-stock and low-stock items, unpaid Pay Later balances) plus
 *     this session's recent activity. The red count on the bell shows how
 *     many attention items haven't been seen yet; it clears when the menu
 *     is closed or "Mark all as read" is pressed.
 */
const Notify = (() => {
  const MAX_VISIBLE = 4;
  const DURATION = { success: 4000, info: 4500, warning: 5500, error: 7000 };
  const TYPE_ICON = { success: 'checkCircle', info: 'info', warning: 'alertTriangle', error: 'alertCircle' };
  const DEFAULT_TITLE = { success: 'Done', info: 'Note', warning: 'Check this', error: 'Something went wrong' };
  const SEEN_KEY = 'tindarhan_notif_seen';
  const LOW_STOCK_DEFAULT = 5;
  const HISTORY_LIMIT = 15;

  let stackEl = null;
  const history = []; // recent toasts this session: {type, title, message, time}
  let alerts = [];    // current attention items: {key, type, title, meta, go}
  let alertsSignature = '';
  let panelOpen = false;
  let seen = loadSeen();

  // ---------------------------------------------------------------------
  // Toasts
  // ---------------------------------------------------------------------
  function getStack() {
    if (stackEl && document.body.contains(stackEl)) return stackEl;
    stackEl = document.createElement('section');
    stackEl.className = 'notify-stack';
    stackEl.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(stackEl);
    return stackEl;
  }

  function show(opts) {
    opts = opts || {};
    const type = TYPE_ICON[opts.type] ? opts.type : 'info';
    const title = opts.title || DEFAULT_TITLE[type];
    const message = opts.message || '';
    const duration = opts.duration != null ? opts.duration : DURATION[type];

    const stack = getStack();
    while (stack.children.length >= MAX_VISIBLE) removeNow(stack.firstElementChild);

    const el = document.createElement('div');
    el.className = 'notify notify-' + type;
    // Errors interrupt (assertive); everything else is announced politely.
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.style.setProperty('--notify-duration', duration + 'ms');
    el.innerHTML =
      '<span class="notify-icon">' + Icon(TYPE_ICON[type]) + '</span>' +
      '<div class="notify-body">' +
        '<p class="notify-title">' + UI.escapeHtml(title) + '</p>' +
        (message ? '<p class="notify-message">' + UI.escapeHtml(message) + '</p>' : '') +
        (opts.action ? '<button type="button" class="notify-action">' + UI.escapeHtml(opts.action.label) + '</button>' : '') +
      '</div>' +
      '<button type="button" class="notify-close" aria-label="Dismiss notification">' + Icon('x', 'icon-sm') + '</button>';
    stack.appendChild(el);

    el.querySelector('.notify-close').addEventListener('click', () => dismiss(el));
    if (opts.action) {
      el.querySelector('.notify-action').addEventListener('click', () => {
        try { opts.action.onClick(); } finally { dismiss(el); }
      });
    }

    // Auto-dismiss, paused while the pointer is over the card or focus is
    // inside it, so nobody loses a message they're in the middle of reading.
    if (duration > 0) {
      let remaining = duration;
      let startedAt = 0;
      let timer = null;
      let paused = false;
      const start = () => {
        paused = false;
        startedAt = Date.now();
        timer = setTimeout(() => dismiss(el), remaining);
      };
      const pause = () => {
        if (paused) return;
        paused = true;
        clearTimeout(timer);
        remaining = Math.max(600, remaining - (Date.now() - startedAt));
      };
      el.addEventListener('mouseenter', pause);
      el.addEventListener('mouseleave', () => { if (!el.contains(document.activeElement)) start(); });
      el.addEventListener('focusin', pause);
      el.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget) && !el.matches(':hover')) start(); });
      start();
    }

    history.unshift({ type, title, message, time: Date.now() });
    if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
    if (panelOpen) renderPanel();

    return el;
  }

  // Fade the card out, then fold its space so the cards below glide up.
  function dismiss(el) {
    if (!el || el.dataset.leaving) return;
    el.dataset.leaving = '1';
    el.classList.add('is-leaving');
    let folded = false;
    const fold = () => {
      if (folded) return;
      folded = true;
      Motion.collapse(el, '8px').then(() => removeNow(el));
    };
    el.addEventListener('animationend', fold, { once: true });
    setTimeout(fold, 260); // in case no animation runs
    setTimeout(() => removeNow(el), 900);
  }

  function removeNow(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // ---------------------------------------------------------------------
  // Bell menu
  // ---------------------------------------------------------------------
  function loadSeen() {
    try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
    catch (e) { return new Set(); }
  }

  function saveSeen() {
    // Only keep keys that still exist, so an item that runs low again
    // later shows up as new instead of staying silently "seen" forever.
    const current = new Set(alerts.map((a) => a.key));
    seen = new Set([...seen].filter((k) => current.has(k)));
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch (e) { /* storage full / blocked */ }
  }

  function unseenCount() {
    return alerts.filter((a) => !seen.has(a.key)).length;
  }

  function goTo(tab, search) {
    if (typeof window.switchTab === 'function') window.switchTab(tab);
    if (tab === 'inventory' && search) {
      Inventory.setStatusFilter('all');
      const input = document.getElementById('inventorySearch');
      if (input) { input.value = search; input.dispatchEvent(new Event('input')); }
    }
  }

  // Called by main.js on login and on every live-sync tick with fresh data.
  function updateCenter(items, sales) {
    const next = [];
    (items || []).forEach((it) => {
      const threshold = it.lowStockThreshold != null ? it.lowStockThreshold : LOW_STOCK_DEFAULT;
      if (it.stock <= 0) {
        next.push({ key: 'stock:' + it.id + ':out', rank: 0, type: 'error', title: it.name + ' is out of stock', meta: 'Restock to keep selling it', go: () => goTo('inventory', it.name) });
      } else if (it.stock <= threshold) {
        next.push({ key: 'stock:' + it.id + ':low', rank: 1, type: 'warning', title: it.name + ' is running low', meta: it.stock + ' left in stock', go: () => goTo('inventory', it.name) });
      }
    });
    (sales || [])
      .filter((s) => s.paymentMethod === 'Pay Later' && !s.isSettled)
      .sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
      .forEach((s) => {
        next.push({ key: 'utang:' + s.id, rank: 2, type: 'info', title: (s.customerName || 'A customer') + ' owes ' + UI.peso(s.total), meta: 'Pay Later since ' + UI.formatDate(s.datetime), go: () => goTo('reports') });
      });
    next.sort((a, b) => a.rank - b.rank);

    const signature = next.map((a) => a.key + '|' + a.title + '|' + a.meta).join('#');
    alerts = next;
    updateBadge();
    // Re-render an open menu only when something actually changed, so the
    // 6s background sync doesn't reset scroll position under the cashier.
    if (panelOpen && signature !== alertsSignature) renderPanel();
    alertsSignature = signature;
  }

  function updateBadge() {
    const btn = document.getElementById('notifBellBtn');
    const countEl = document.getElementById('notifBellCount');
    const n = unseenCount();
    if (countEl) {
      countEl.textContent = n > 99 ? '99+' : String(n);
      countEl.classList.toggle('hidden', n === 0);
    }
    if (btn) btn.setAttribute('aria-label', n ? 'Notifications, ' + n + ' new' : 'Notifications');
  }

  function relativeTime(t) {
    const secs = Math.round((Date.now() - t) / 1000);
    if (secs < 45) return 'Just now';
    const mins = Math.round(secs / 60);
    if (mins < 60) return mins + ' min ago';
    return new Date(t).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
  }

  function renderPanel() {
    const body = document.getElementById('notifPanelBody');
    if (!body) return;

    const attentionHtml = alerts.length
      ? alerts.map((a, i) => (
          '<button type="button" class="notif-item notif-item-' + a.type + (seen.has(a.key) ? '' : ' is-unread') + '" data-index="' + i + '">' +
          '<span class="notif-item-icon">' + Icon(TYPE_ICON[a.type], 'icon-sm') + '</span>' +
          '<span class="notif-item-text">' +
          '<span class="notif-item-title">' + UI.escapeHtml(a.title) + '</span>' +
          '<span class="notif-item-meta">' + UI.escapeHtml(a.meta) + '</span>' +
          '</span>' +
          '</button>'
        )).join('')
      : '<div class="notif-empty">' + Icon('checkCircle', 'icon-sm') + '<span>No stock or payment alerts.</span></div>';

    const historyHtml = history.length
      ? history.map((h) => (
          '<div class="notif-item notif-item-static notif-item-' + h.type + '">' +
          '<span class="notif-item-icon">' + Icon(TYPE_ICON[h.type], 'icon-sm') + '</span>' +
          '<span class="notif-item-text">' +
          '<span class="notif-item-title">' + UI.escapeHtml(h.title) + '</span>' +
          (h.message ? '<span class="notif-item-meta">' + UI.escapeHtml(h.message) + '</span>' : '') +
          '<span class="notif-item-time">' + relativeTime(h.time) + '</span>' +
          '</span>' +
          '</div>'
        )).join('')
      : '<p class="notif-empty-quiet">Nothing yet this session.</p>';

    body.innerHTML =
      '<p class="notif-section-label">Needs attention' + (alerts.length ? ' <span class="notif-section-count">' + alerts.length + '</span>' : '') + '</p>' +
      attentionHtml +
      '<p class="notif-section-label">Recent activity</p>' +
      historyHtml;

    body.querySelectorAll('button.notif-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = alerts[Number(btn.dataset.index)];
        closePanel();
        if (a && a.go) a.go();
      });
    });
  }

  function markAllRead() {
    alerts.forEach((a) => seen.add(a.key));
    saveSeen();
    updateBadge();
    if (panelOpen) renderPanel();
  }

  function openPanel() {
    const panel = document.getElementById('notifPanel');
    const btn = document.getElementById('notifBellBtn');
    if (!panel) return;
    panelOpen = true;
    renderPanel();
    clearTimeout(panel._closeTimer);
    panel.classList.remove('is-closing');
    panel.classList.remove('hidden');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    const title = document.getElementById('notifPanelTitle');
    if (title) title.focus();
  }

  function closePanel(returnFocus) {
    const panel = document.getElementById('notifPanel');
    const btn = document.getElementById('notifBellBtn');
    if (!panel || !panelOpen) return;
    panelOpen = false;
    // Short exit, then hide. Reopening during it cancels the hide.
    panel.classList.add('is-closing');
    clearTimeout(panel._closeTimer);
    const hide = () => {
      if (panelOpen) return;
      panel.classList.remove('is-closing');
      panel.classList.add('hidden');
    };
    if (Motion.reduced()) hide();
    else panel._closeTimer = setTimeout(hide, 120);
    if (btn) btn.setAttribute('aria-expanded', 'false');
    // Closing the menu counts as having seen everything that was in it.
    markAllRead();
    if (returnFocus && btn) btn.focus();
  }

  function init() {
    const btn = document.getElementById('notifBellBtn');
    const panel = document.getElementById('notifPanel');
    const markBtn = document.getElementById('notifMarkReadBtn');
    if (btn) btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (panelOpen) closePanel(); else openPanel();
    });
    if (markBtn) markBtn.addEventListener('click', markAllRead);
    if (panel) panel.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => { if (panelOpen) closePanel(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelOpen) closePanel(true); });
    updateBadge();
  }

  return { show, dismiss, init, updateCenter, openPanel, closePanel, markAllRead };
})();
