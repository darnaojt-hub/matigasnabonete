/**
 * ui.js
 * Shared small helpers used across modules: currency formatting, date
 * formatting, HTML escaping, modal open/close, notifications (a thin
 * wrapper over js/notify.js), and a promise-based confirm() replacement
 * for the native browser popup.
 */
const UI = (() => {
  function peso(n) {
    const num = Number(n) || 0;
    // Plain "P" instead of the ₱ Unicode sign: the character itself is
    // correct, but it isn't in every font's set, so a browser/OS can fall
    // back to an unfamiliar-looking glyph for just that one symbol. A plain
    // ASCII "P" renders identically everywhere, no font fallback involved.
    return 'P' + num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Product image, or a lettered tile when there's no photo. The tile tone
  // is picked from the name so the same product always looks the same.
  function itemThumb(item, cls) {
    const extra = cls ? ' ' + cls : '';
    if (item.image) {
      return '<img src="' + escapeHtml(item.image) + '" alt="" class="thumb' + extra + '" loading="lazy">';
    }
    const words = String(item.name || '?').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
    const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2);
    let hash = 0;
    for (const ch of String(item.name || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return '<span class="thumb thumb-mono tone-' + (hash % 6) + extra + '" aria-hidden="true">' + escapeHtml(letters.toUpperCase()) + '</span>';
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString('en-PH', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // ---- Dialogs ----
  // Keeps keyboard focus inside the open dialog, closes it on Escape, and
  // returns focus to whatever opened it. Closing plays a short exit
  // (.is-closing) before the dialog is hidden; focus and the dialog stack
  // are updated at once, so nothing waits on the animation.
  const MODAL_EXIT_MS = 140;
  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const openStack = []; // [{ id, returnTo }]

  function visibleFocusables(container) {
    return [...container.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
  }

  function isModalOpen(id) {
    const el = document.getElementById(id);
    return !!el && !el.classList.contains('hidden') && !el.classList.contains('is-closing');
  }

  function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!openStack.some((m) => m.id === id)) openStack.push({ id, returnTo: document.activeElement });
    clearTimeout(el._closeTimer);
    el.inert = false;
    el.classList.remove('is-closing');
    el.classList.remove('hidden');
    document.body.classList.add('modal-open');
    // Move focus in unless the caller already focused something inside.
    requestAnimationFrame(() => {
      if (el.contains(document.activeElement)) return;
      const first = visibleFocusables(el).find((f) => !f.classList.contains('icon-btn')) || visibleFocusables(el)[0];
      if (first) first.focus();
    });
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (!el || el.classList.contains('hidden') || el.classList.contains('is-closing')) return;
    // A confirm()/choosePaymentMethod() still waiting for an answer is
    // settled as "cancel", so its buttons can never act later.
    if (typeof el._cancelPending === 'function') {
      const cancel = el._cancelPending;
      el._cancelPending = null;
      cancel(); // calls back into closeModal
      return;
    }
    const hide = () => {
      if (!el.classList.contains('is-closing')) return; // reopened meanwhile
      el.classList.remove('is-closing');
      el.classList.add('hidden');
      el.inert = false;
    };
    el.classList.add('is-closing');
    const idx = openStack.findIndex((m) => m.id === id);
    const entry = idx >= 0 ? openStack.splice(idx, 1)[0] : null;
    if (!document.querySelector('.modal-backdrop:not(.hidden):not(.is-closing)')) document.body.classList.remove('modal-open');
    restoreFocus(el, entry && entry.returnTo);
    // The fading dialog can't be clicked or typed into.
    el.inert = true;
    if (Motion.reduced()) hide();
    else el._closeTimer = setTimeout(hide, MODAL_EXIT_MS);
  }

  // Back to whatever opened the dialog; if that is gone or disabled, to the
  // page title, so keyboard focus never falls back to the top of the page.
  function restoreFocus(dialog, returnTo) {
    if (returnTo && document.body.contains(returnTo) && typeof returnTo.focus === 'function') {
      returnTo.focus({ preventScroll: true });
    }
    const active = document.activeElement;
    if (!active || active === document.body || dialog.contains(active)) {
      const top = openStack[openStack.length - 1];
      const fallback = top ? document.getElementById(top.id) : document.getElementById('topbarTitle');
      if (fallback && fallback.getClientRects().length) {
        if (top) { const first = visibleFocusables(fallback)[0]; if (first) first.focus(); }
        else fallback.focus({ preventScroll: true });
      }
    }
  }

  // Tables: after a row is deleted and the table redrawn, put focus on the
  // same button in the row that took its place (or on fallbackId).
  function focusRow(tbody, index, selector, fallbackId) {
    if (!tbody || index < 0) return;
    const rows = tbody.querySelectorAll('tr[data-id]');
    const row = rows[Math.min(index, rows.length - 1)];
    const target = (row && row.querySelector(selector)) || document.getElementById(fallbackId);
    if (target) target.focus({ preventScroll: true });
  }

  // Fade a table row out and take it out of the DOM. Returns its index.
  async function removeRow(row) {
    if (!row || !row.parentNode) return -1;
    const index = [...row.parentNode.querySelectorAll('tr[data-id]')].indexOf(row);
    row.inert = true;
    await Motion.leave(row);
    row.remove();
    return index;
  }

  document.addEventListener('keydown', (e) => {
    const top = openStack[openStack.length - 1];
    if (!top) return;
    const el = document.getElementById(top.id);
    if (!el || !isModalOpen(top.id)) return;
    if (e.key === 'Escape') {
      // confirm() and choosePaymentMethod() resolve their own promise on Escape.
      if (el.dataset.managed !== 'true') { e.preventDefault(); closeModal(top.id); }
      return;
    }
    if (e.key !== 'Tab') return;
    const items = visibleFocusables(el);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) {
      e.preventDefault(); first.focus();
    }
  });
  // Clicking the dimmed area outside a dialog closes it -- except dialogs
  // with a form, where a stray click shouldn't throw away what was typed.
  document.addEventListener('mousedown', (e) => {
    const top = openStack[openStack.length - 1];
    if (!top || e.target.id !== top.id) return;
    if (e.target.dataset.managed === 'true' || e.target.querySelector('form')) return;
    closeModal(top.id);
  });

  // Notification card: UI.notify('success', 'Item added', 'Calamansi Juice is now in inventory.')
  // type is one of 'success' | 'info' | 'warning' | 'error'. See js/notify.js.
  function notify(type, title, message, opts) {
    return Notify.show(Object.assign({ type, title, message }, opts || {}));
  }

  // Older one-line form, kept so any remaining UI.toast('...') call still
  // works: the type is guessed from the wording.
  function toast(msg, type) {
    let t = type;
    if (!t) {
      if (/could not|couldn't|failed|error/i.test(msg)) t = 'error';
      else if (/^please|only \d+ left|less than/i.test(msg)) t = 'warning';
      else t = 'success';
    }
    return Notify.show({ type: t, title: msg });
  }

  // Promise-based confirm() that uses the styled #confirmModal markup
  // instead of the native browser confirm() popup.
  function confirm(message, opts) {
    opts = opts || {};
    const title = opts.title || 'Are you sure?';
    const okText = opts.okText || 'Confirm';
    const okClass = opts.okClass || 'btn-primary';

    return new Promise((resolve) => {
      const modal = document.getElementById('confirmModal');
      if (!modal) { resolve(window.confirm(message)); return; }

      const titleEl = document.getElementById('confirmModalTitle');
      const msgEl = document.getElementById('confirmModalMessage');
      const okBtn = document.getElementById('confirmModalOk');
      const cancelBtn = document.getElementById('confirmModalCancel');

      if (titleEl) titleEl.textContent = title;
      if (msgEl) msgEl.textContent = message;
      if (okBtn) {
        okBtn.textContent = okText;
        okBtn.className = 'btn ' + okClass;
      }
      modal.dataset.managed = 'true';

      function cleanup(result) {
        modal._cancelPending = null;
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
        closeModal('confirmModal');
        resolve(result);
      }
      function onOk() { cleanup(true); }
      function onCancel() { cleanup(false); }
      function onBackdrop(e) { if (e.target === modal) cleanup(false); }
      function onKey(e) { if (e.key === 'Escape') cleanup(false); }

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      modal.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKey);
      modal._cancelPending = () => cleanup(false);

      openModal('confirmModal');
      // Destructive actions start on Cancel so Enter can't delete by accident.
      (okClass.indexOf('danger') >= 0 ? cancelBtn : okBtn).focus();
    });
  }

  // Promise-based "which payment method" prompt, used by Mark Paid. Shows
  // #markPaidModal and resolves with 'Cash' / 'GCash', or null if the
  // person backs out (Cancel, backdrop click, or Escape).
  function choosePaymentMethod(message) {
    return new Promise((resolve) => {
      const modal = document.getElementById('markPaidModal');
      if (!modal) { resolve(null); return; }

      const msgEl = document.getElementById('markPaidModalMessage');
      const cashBtn = document.getElementById('markPaidCashBtn');
      const gcashBtn = document.getElementById('markPaidGcashBtn');
      const cancelBtn = document.getElementById('markPaidCancelBtn');

      if (msgEl) msgEl.textContent = message;
      modal.dataset.managed = 'true';

      function cleanup(result) {
        modal._cancelPending = null;
        cashBtn.removeEventListener('click', onCash);
        gcashBtn.removeEventListener('click', onGcash);
        cancelBtn.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
        closeModal('markPaidModal');
        resolve(result);
      }
      function onCash() { cleanup('Cash'); }
      function onGcash() { cleanup('GCash'); }
      function onCancel() { cleanup(null); }
      function onBackdrop(e) { if (e.target === modal) cleanup(null); }
      function onKey(e) { if (e.key === 'Escape') cleanup(null); }

      cashBtn.addEventListener('click', onCash);
      gcashBtn.addEventListener('click', onGcash);
      cancelBtn.addEventListener('click', onCancel);
      modal.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKey);

      modal._cancelPending = () => cleanup(null);
      openModal('markPaidModal');
      cashBtn.focus();
    });
  }

  return { peso, itemThumb, escapeHtml, formatDateTime, formatDate, openModal, closeModal, isModalOpen, focusRow, removeRow, notify, toast, confirm, choosePaymentMethod };
})();
