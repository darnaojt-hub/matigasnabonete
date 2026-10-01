/**
 * receipt.js
 * Receipt dialog shown after checkout and from the sales list. Pay Later
 * sales show either a balance-due notice or when/how they were paid.
 * Straight after a checkout the receipt opens with a confirmation at the
 * top (a check that draws itself, and the change to hand back). It is not
 * printed.
 */
const Receipt = (() => {
  let printing = false;

  function init() {
    const closeBtn = document.getElementById('receiptCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', () => UI.closeModal('receiptModal'));
    const modalCloseBtn = document.getElementById('receiptModalClose');
    if (modalCloseBtn) modalCloseBtn.addEventListener('click', () => UI.closeModal('receiptModal'));
    const printBtn = document.getElementById('receiptPrintBtn');
    if (printBtn) printBtn.addEventListener('click', print);
  }

  // What the cashier needs to know right after charging.
  function successBlock(sale) {
    let title = 'Payment received';
    let detail = '';
    if (sale.paymentMethod === 'Pay Later') {
      title = 'Recorded as Pay Later';
      detail = UI.escapeHtml(sale.customerName || 'Customer') + ' owes ' + UI.peso(sale.total);
    } else if (sale.paymentMethod === 'GCash') {
      detail = UI.peso(sale.total) + ' by GCash';
    } else {
      detail = Number(sale.change) > 0 ? 'Give change: <strong>' + UI.peso(sale.change) + '</strong>' : 'Exact amount, no change';
    }
    return (
      '<div class="receipt-success">' +
      '<svg class="success-check" viewBox="0 0 52 52" aria-hidden="true">' +
      '<circle class="success-ring" cx="26" cy="26" r="23"></circle>' +
      '<path class="success-mark" d="M15.5 27l7 7 14-14"></path>' +
      '</svg>' +
      '<p class="receipt-success-title">' + title + '</p>' +
      '<p class="receipt-success-detail">' + detail + '</p>' +
      '</div>'
    );
  }

  function show(sale, opts) {
    opts = opts || {};
    const body = document.getElementById('receiptBody');
    if (!body) return;

    const itemRows = (sale.items || []).map((it) => (
      '<div class="receipt-line">' +
      '<span>' + UI.escapeHtml(it.name) + ' x' + it.qty + '</span>' +
      '<span>' + UI.peso(it.subtotal) + '</span>' +
      '</div>'
    )).join('');

    let paymentBlock;
    if (sale.paymentMethod === 'Pay Later') {
      if (sale.isSettled) {
        paymentBlock = (
          '<div class="receipt-line receipt-total"><span>Total</span><span>' + UI.peso(sale.total) + '</span></div>' +
          '<div class="receipt-status receipt-status-paid">' + Icon('check', 'icon-sm') + ' PAID' +
          ' via ' + UI.escapeHtml(sale.settledMethod || 'Cash') +
          (sale.settledAt ? ' — ' + UI.formatDateTime(sale.settledAt) : '') +
          '</div>' +
          '<div class="receipt-line"><span>Customer</span><span>' + UI.escapeHtml(sale.customerName || '') + '</span></div>'
        );
      } else {
        paymentBlock = (
          '<div class="receipt-line receipt-total"><span>Total</span><span>' + UI.peso(sale.total) + '</span></div>' +
          '<div class="receipt-status receipt-status-due">' + Icon('alertTriangle', 'icon-sm') + ' BALANCE DUE</div>' +
          '<div class="receipt-line"><span>Customer (Pay Later)</span><span>' + UI.escapeHtml(sale.customerName || '') + '</span></div>'
        );
      }
    } else {
      paymentBlock = (
        '<div class="receipt-line receipt-total"><span>Total</span><span>' + UI.peso(sale.total) + '</span></div>' +
        '<div class="receipt-line"><span>Amount Paid</span><span>' + UI.peso(sale.amountPaid) + '</span></div>' +
        '<div class="receipt-line"><span>Change</span><span>' + UI.peso(sale.change) + '</span></div>'
      );
    }

    body.innerHTML =
      (opts.justCompleted ? successBlock(sale) : '') +
      '<div class="receipt-header">' +
      '<img src="assets/dar-logo.png" alt="" class="receipt-logo">' +
      '<img src="assets/tindarhan-logo.png" alt="TinDARhan" class="receipt-brand">' +
      '<p>DAR Batangas ARBO Shop</p>' +
      '</div>' +
      '<div class="receipt-meta">' +
      '<div class="receipt-line"><span>Receipt No.</span><span>' + UI.escapeHtml(sale.id) + '</span></div>' +
      '<div class="receipt-line"><span>Date</span><span>' + UI.formatDateTime(sale.datetime) + '</span></div>' +
      '<div class="receipt-line"><span>Cashier</span><span>' + UI.escapeHtml(sale.cashier) + '</span></div>' +
      '<div class="receipt-line"><span>Payment Method</span><span>' + UI.escapeHtml(sale.paymentMethod) + '</span></div>' +
      '</div>' +
      '<div class="receipt-items">' + itemRows + '</div>' +
      '<div class="receipt-summary">' + paymentBlock + '</div>';

    UI.openModal('receiptModal');
  }

  function print() {
    printing = true;
    document.body.classList.add('printing');
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing');
      printing = false;
    }, 300);
  }

  return { init, show, print };
})();
