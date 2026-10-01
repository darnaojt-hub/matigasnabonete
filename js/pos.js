/**
 * pos.js
 * Shop tab: product grid, current sale (cart) and checkout for Cash,
 * GCash and Pay Later (utang).
 *
 * Motion (see js/motion.js): tapping a product flies a copy of its photo
 * into the sale; the count pops and the new line slides in when it lands.
 * The cart itself updates at the tap, so fast tapping never loses an item.
 * Cart lines are updated in place rather than redrawn, which keeps
 * keyboard focus on the +/- buttons and lets removed lines fold away.
 */
const POS = (() => {
  let cart = []; // [{ id, name, price, qty, stock }]
  let allItems = [];
  let searchTerm = '';
  let hasLoadedOnce = false;
  let lastGridKey = '';
  let cartPanelInView = true;
  let saving = false; // a checkout is on its way to the server

  const cents = (n) => Math.round(Number(n) * 100);

  function init() {
    document.getElementById('posSearch').addEventListener('input', (e) => {
      searchTerm = e.target.value.trim().toLowerCase();
      renderItemGrid({ silent: true });
    });

    document.getElementById('paymentMethod').addEventListener('change', updatePaymentFieldsVisibility);
    document.querySelectorAll('.payment-method-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const select = document.getElementById('paymentMethod');
        if (select.value !== btn.dataset.paymentValue) {
          select.value = btn.dataset.paymentValue;
          select.dispatchEvent(new Event('change'));
        }
      });
    });

    document.getElementById('amountPaid').addEventListener('input', renderCartSummary);
    document.querySelectorAll('#quickCash [data-amount]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = document.getElementById('amountPaid');
        const v = btn.dataset.amount;
        input.value = v === 'exact' ? getTotal().toFixed(2) : v;
        renderCartSummary();
      });
    });

    document.getElementById('clearCartBtn').addEventListener('click', clearCart);
    document.getElementById('checkoutBtn').addEventListener('click', checkout);
    document.getElementById('cartBar').addEventListener('click', showCartPanel);

    // The phone cart bar only shows while the sale panel is off screen.
    const panel = document.querySelector('.pos-cart');
    if (panel && 'IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        cartPanelInView = entries[entries.length - 1].isIntersecting;
        updateCartBar();
      }).observe(panel);
    }

    document.querySelectorAll('.segmented').forEach((group) => Motion.segmented(group));

    updatePaymentFieldsVisibility();
    renderCart();
  }

  // ---- Product grid ----
  async function renderItemGrid(opts) {
    opts = opts || {};
    const grid = document.getElementById('itemGrid');
    if (!grid) return;

    const firstLoad = !hasLoadedOnce;
    if (firstLoad && !opts.silent) {
      grid.innerHTML = Array.from({ length: 8 }).map(() => '<div class="product-skeleton" aria-hidden="true"></div>').join('');
    }

    try {
      allItems = await DB.getItems();
    } catch (err) {
      grid.innerHTML = '<p class="empty-state">Couldn’t load products. ' + UI.escapeHtml(err.message) + '</p>';
      return;
    }
    hasLoadedOnce = true;

    const countEl = document.getElementById('itemCountChip');
    if (countEl) countEl.textContent = allItems.length + (allItems.length === 1 ? ' item' : ' items');

    const filtered = allItems.filter((it) => !searchTerm || it.name.toLowerCase().includes(searchTerm));
    // Background sync: leave the grid (and keyboard focus) alone if nothing changed.
    const key = searchTerm + '|' + filtered.map((it) => [it.id, it.name, it.price, it.stock, it.lowStockThreshold, (it.image || '').length].join(':')).join(',');
    if (opts.silent && key === lastGridKey && grid.querySelector('.product')) return;
    lastGridKey = key;
    if (filtered.length === 0) {
      grid.innerHTML = '<p class="empty-state">' + (searchTerm ? 'No products match “' + UI.escapeHtml(searchTerm) + '”.' : 'No products yet. Add them in Inventory.') + '</p>';
      return;
    }

    // The first time products appear they settle in one after another;
    // later redraws (search, live sync) are instant.
    const stagger = firstLoad && !opts.silent && !Motion.reduced();
    grid.innerHTML = filtered.map((it, i) => {
      const out = it.stock <= 0;
      const low = !out && it.stock <= (it.lowStockThreshold != null ? it.lowStockThreshold : 5);
      const stockText = out ? 'Out of stock' : it.stock + ' in stock';
      return (
        '<button type="button" class="product' + (out ? ' is-out' : '') + (stagger && i < 12 ? ' is-entering" style="--i:' + i : '') + '" data-id="' + UI.escapeHtml(it.id) + '"' +
        (out ? ' disabled' : '') + ' aria-label="Add ' + UI.escapeHtml(it.name) + ', ' + UI.peso(it.price) + ', ' + stockText + '">' +
        '<span class="product-media">' + UI.itemThumb(it) + '</span>' +
        '<span class="product-name">' + UI.escapeHtml(it.name) + '</span>' +
        '<span class="product-foot">' +
        '<span class="product-price num">' + UI.peso(it.price) + '</span>' +
        '<span class="product-stock' + (out ? ' is-out' : low ? ' is-low' : '') + '">' + stockText + '</span>' +
        '</span>' +
        '</button>'
      );
    }).join('');

    grid.querySelectorAll('.product').forEach((btn) => {
      btn.addEventListener('click', () => addToCart(btn.dataset.id, btn));
    });
  }

  // ---- Cart ----
  function addToCart(itemId, sourceBtn) {
    if (saving) return; // the cart is locked until the sale is saved
    const item = allItems.find((it) => it.id === itemId);
    if (!item || item.stock <= 0) return;
    const existing = cart.find((c) => c.id === itemId);
    if ((existing ? existing.qty : 0) + 1 > item.stock) {
      UI.notify('warning', 'Not enough stock', 'Only ' + item.stock + ' ' + item.name + ' left.');
      return;
    }
    if (existing) existing.qty += 1;
    else cart.push({ id: item.id, name: item.name, price: Number(item.price), qty: 1, stock: item.stock });
    renderCart({ changedId: itemId });
    playAddMotion(itemId, sourceBtn);
  }

  // The flight from the product to the cart, and what the cart does when
  // it lands. Purely visual: the cart was already updated.
  function playAddMotion(itemId, sourceBtn) {
    const target = flyTarget();
    const media = sourceBtn ? sourceBtn.querySelector('.product-media') : null;
    const flight = target && media ? Motion.fly(media, target.rect) : null;
    if (!flight) {
      if (target) Motion.replay(target.el, 'is-popping');
      return;
    }
    // Hold the new line (or the quantity pop) until the photo arrives.
    const landAt = Math.max(0, flight.duration - 140);
    const row = lineFor(itemId);
    if (row && row.classList.contains('is-entering')) row.style.setProperty('--delay', landAt + 'ms');
    else if (row) Motion.replay(row.querySelector('.stepper-value'), 'is-popping', landAt);
    flight.finished.then(() => Motion.replay(target.el, 'is-popping'));
  }

  // Aim at the count beside "Current sale" when it is on screen, otherwise
  // at the phone cart bar.
  function flyTarget() {
    const count = document.getElementById('cartCount');
    if (Motion.inView(count)) return { el: count, rect: count.getBoundingClientRect() };
    const bar = document.getElementById('cartBar');
    if (bar && bar.classList.contains('is-visible') && getComputedStyle(bar).display !== 'none') {
      const badge = document.getElementById('cartBarCount');
      return { el: badge, rect: Motion.settledRect(badge, bar) };
    }
    return null;
  }

  function lineFor(itemId) {
    return [...document.querySelectorAll('#cartList .cart-line:not(.is-leaving)')].find((r) => r.dataset.id === itemId) || null;
  }

  function changeQty(itemId, delta) {
    if (saving) return;
    const line = cart.find((c) => c.id === itemId);
    if (!line) return;
    const newQty = line.qty + delta;
    if (newQty <= 0) { removeFromCart(itemId); return; }
    if (newQty > line.stock) {
      UI.notify('warning', 'Not enough stock', 'Only ' + line.stock + ' ' + line.name + ' left.');
      return;
    }
    line.qty = newQty;
    renderCart({ changedId: itemId });
  }

  function removeFromCart(itemId) {
    if (saving) return;
    cart = cart.filter((c) => c.id !== itemId);
    renderCart();
  }

  function clearCart() {
    if (saving) return;
    cart = [];
    document.getElementById('paymentMethod').value = 'Cash';
    document.getElementById('amountPaid').value = '';
    document.getElementById('payLaterCustomerName').value = '';
    updatePaymentFieldsVisibility();
    renderCart();
  }

  function getTotal() {
    return cart.reduce((sum, c) => sum + cents(c.price) * c.qty, 0) / 100;
  }

  function lineSubtotal(c) {
    return UI.peso(cents(c.price) * c.qty / 100);
  }

  function createLine(c) {
    const row = document.createElement('div');
    row.className = 'cart-line';
    row.dataset.id = c.id;
    row.innerHTML =
      '<div class="cart-line-info">' +
      '<span class="cart-line-name">' + UI.escapeHtml(c.name) + '</span>' +
      '<span class="cart-line-price num">' + UI.peso(c.price) + ' each</span>' +
      '</div>' +
      '<div class="stepper" role="group" aria-label="Quantity of ' + UI.escapeHtml(c.name) + '">' +
      '<button type="button" class="stepper-btn" data-action="dec" aria-label="Decrease">' + Icon('minus') + '</button>' +
      '<span class="stepper-value num" aria-live="polite">' + c.qty + '</span>' +
      '<button type="button" class="stepper-btn" data-action="inc" aria-label="Increase">' + Icon('plus') + '</button>' +
      '</div>' +
      '<span class="cart-line-subtotal num">' + lineSubtotal(c) + '</span>' +
      '<button type="button" class="icon-btn icon-btn-sm cart-line-remove" data-action="remove" aria-label="Remove ' + UI.escapeHtml(c.name) + '">' + Icon('x') + '</button>';
    row.querySelector('[data-action="dec"]').addEventListener('click', () => changeQty(c.id, -1));
    row.querySelector('[data-action="inc"]').addEventListener('click', () => changeQty(c.id, 1));
    row.querySelector('[data-action="remove"]').addEventListener('click', () => removeFromCart(c.id));
    return row;
  }

  // A line that is going away fades and folds up. If it held keyboard
  // focus, focus moves to the same button on a neighbouring line (or to
  // the "Current sale" heading) first, so it is never lost.
  function removeLine(row, list) {
    row.classList.add('is-leaving');
    if (row.contains(document.activeElement)) {
      const action = document.activeElement.dataset.action;
      const sibling = [row.nextElementSibling, row.previousElementSibling]
        .find((r) => r && r.classList.contains('cart-line') && !r.classList.contains('is-leaving'));
      const next = sibling && sibling.querySelector('[data-action="' + action + '"]');
      (next || document.getElementById('cartTitle')).focus({ preventScroll: true });
    }
    row.inert = true;
    Motion.leave(row, { collapse: true }).then(() => {
      row.remove();
      if (!cart.length && !list.querySelector('.cart-line')) showEmptyCart(list);
    });
  }

  function showEmptyCart(list) {
    if (list.querySelector('.cart-empty')) return;
    list.insertAdjacentHTML('beforeend', '<p class="empty-state empty-state-sm cart-empty">No items yet. Tap a product to add it.</p>');
  }

  function renderCart(opts) {
    opts = opts || {};
    const list = document.getElementById('cartList');
    if (!list) return;

    const units = cart.reduce((n, c) => n + c.qty, 0);
    const countEl = document.getElementById('cartCount');
    if (countEl) countEl.textContent = units ? units + (units === 1 ? ' item' : ' items') : '';

    const rows = new Map();
    list.querySelectorAll('.cart-line:not(.is-leaving)').forEach((r) => rows.set(r.dataset.id, r));
    if (cart.length) {
      const empty = list.querySelector('.cart-empty');
      if (empty) empty.remove();
    }

    cart.forEach((c) => {
      const row = rows.get(c.id);
      if (row) {
        rows.delete(c.id);
        const qtyEl = row.querySelector('.stepper-value');
        if (qtyEl.textContent !== String(c.qty)) {
          qtyEl.textContent = c.qty;
          const subEl = row.querySelector('.cart-line-subtotal');
          subEl.textContent = lineSubtotal(c);
          Motion.replay(qtyEl, 'is-popping');
          Motion.replay(subEl, 'is-ticking');
        }
        return;
      }
      const fresh = createLine(c);
      if (!Motion.reduced()) {
        fresh.classList.add('is-entering');
        fresh.addEventListener('animationend', (e) => {
          if (e.animationName === 'line-flash') fresh.classList.remove('is-entering');
        });
      }
      list.appendChild(fresh);
      // Keep the newest line in sight inside the list (never scrolls the page).
      if (c.id === opts.changedId && list.scrollHeight > list.clientHeight) {
        list.scrollTo({ top: list.scrollHeight, behavior: Motion.reduced() ? 'auto' : 'smooth' });
      }
    });

    rows.forEach((row) => removeLine(row, list));
    if (!cart.length && !list.querySelector('.cart-line')) showEmptyCart(list);

    renderCartSummary();
  }

  function renderCartSummary() {
    const total = getTotal();
    const totalEl = document.getElementById('cartTotal');
    const totalText = UI.peso(total);
    if (totalEl.textContent !== totalText) {
      totalEl.textContent = totalText;
      Motion.replay(totalEl, 'is-ticking');
    }

    const paid = parseFloat(document.getElementById('amountPaid').value) || 0;
    document.getElementById('cartChange').textContent = UI.peso(Math.max(0, cents(paid) - cents(total)) / 100);

    const checkoutBtn = document.getElementById('checkoutBtn');
    if (!checkoutBtn.classList.contains('is-loading')) checkoutBtn.disabled = cart.length === 0;
    checkoutBtn.textContent = cart.length ? (isPayLater() ? 'Record Pay Later · ' : 'Charge ') + totalText : 'Charge';

    updateCartBar();
  }

  // ---- Phone cart bar ----
  function updateCartBar() {
    const bar = document.getElementById('cartBar');
    if (!bar) return;
    const units = cart.reduce((n, c) => n + c.qty, 0);
    const total = UI.peso(getTotal());
    const shopOpen = document.getElementById('tab-pos').classList.contains('active');
    const show = units > 0 && shopOpen && !cartPanelInView;
    bar.classList.toggle('is-visible', show);
    document.body.classList.toggle('has-cart-bar', units > 0 && shopOpen);
    document.getElementById('cartBarCount').textContent = String(units);
    document.getElementById('cartBarTotal').textContent = total;
    bar.setAttribute('aria-label', 'View current sale, ' + units + (units === 1 ? ' item, ' : ' items, ') + total);
  }

  function showCartPanel() {
    const panel = document.querySelector('.pos-cart');
    if (!panel) return;
    panel.scrollIntoView({ behavior: Motion.reduced() ? 'auto' : 'smooth', block: 'start' });
    document.getElementById('cartTitle').focus({ preventScroll: true });
  }

  function isPayLater() {
    return document.getElementById('paymentMethod').value === 'Pay Later';
  }

  function updatePaymentFieldsVisibility() {
    const payLater = isPayLater();
    document.getElementById('amountPaidRow').classList.toggle('hidden', payLater);
    document.getElementById('changeRow').classList.toggle('hidden', payLater);
    document.getElementById('payLaterBox').classList.toggle('hidden', !payLater);

    const current = document.getElementById('paymentMethod').value;
    document.querySelectorAll('.payment-method-btn').forEach((btn) => {
      const active = btn.dataset.paymentValue === current;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    if (typeof GCash !== 'undefined') GCash.updatePaymentQrVisibility();
    renderCartSummary();
  }

  // ---- Checkout ----
  async function checkout() {
    if (cart.length === 0) return;
    const total = getTotal();
    const method = document.getElementById('paymentMethod').value;
    const cashier = document.getElementById('cashierName').value.trim() || 'Unassigned';

    let amountPaid = total;
    let change = 0;
    let customerName = '';

    if (method === 'Pay Later') {
      const nameInput = document.getElementById('payLaterCustomerName');
      customerName = nameInput.value.trim();
      if (!customerName) {
        UI.notify('warning', 'Customer name needed', 'Enter the name of the customer who will pay later.');
        nameInput.focus();
        return;
      }
      amountPaid = 0;
    } else {
      const amountInput = document.getElementById('amountPaid');
      amountPaid = parseFloat(amountInput.value) || 0;
      if (cents(amountPaid) < cents(total)) {
        UI.notify('warning', 'Amount received is too low', 'The total is ' + UI.peso(total) + '.');
        amountInput.focus();
        return;
      }
      change = (cents(amountPaid) - cents(total)) / 100;
    }

    const sale = {
      cashier,
      paymentMethod: method,
      customerName,
      total,
      amountPaid,
      change,
      isSettled: method !== 'Pay Later',
      // id and itemId carry the same product id (the server accepts either).
      items: cart.map((c) => ({ itemId: c.id, id: c.id, name: c.name, price: c.price, qty: c.qty, subtotal: cents(c.price) * c.qty / 100 })),
    };

    const checkoutBtn = document.getElementById('checkoutBtn');
    if (saving) return; // already sending
    saving = true;
    checkoutBtn.disabled = true;
    checkoutBtn.classList.add('is-loading');
    checkoutBtn.setAttribute('aria-busy', 'true');
    document.querySelector('.pos-layout').setAttribute('aria-busy', 'true');

    try {
      const saved = await DB.addSale(sale);
      saving = false;
      // When the receipt closes, focus lands on "Current sale", ready for
      // the next customer (the Charge button is disabled by then).
      document.getElementById('cartTitle').focus({ preventScroll: true });
      Receipt.show(saved, { justCompleted: true });
      clearCart();
      renderItemGrid({ silent: true });
      if (typeof refreshSidebarSnapshot === 'function') refreshSidebarSnapshot();
      UI.notify('success', 'Sale recorded', method + ' · ' + UI.peso(saved && saved.total != null ? saved.total : total));
    } catch (err) {
      UI.notify('error', 'Checkout failed', err.message);
      renderItemGrid({ silent: true }); // stock may have changed on another device
    } finally {
      saving = false;
      document.querySelector('.pos-layout').removeAttribute('aria-busy');
      checkoutBtn.classList.remove('is-loading');
      checkoutBtn.removeAttribute('aria-busy');
      checkoutBtn.disabled = cart.length === 0;
    }
  }

  return {
    init, renderItemGrid, addToCart, changeQty, removeFromCart, clearCart,
    getTotal, renderCart, renderCartSummary, isPayLater, updatePaymentFieldsVisibility, checkout, updateCartBar,
  };
})();
