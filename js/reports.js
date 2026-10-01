/**
 * reports.js
 * Sales reports tab: date range (quick presets or custom), summary stats,
 * top sellers, the transactions list (receipt, Mark paid / undo, delete),
 * the Excel export in the DAR Sales & Inventory Report layout, and
 * "Delete all sales records".
 */
const Reports = (() => {
  let filterFrom = null;
  let filterTo = null;
  let salesCache = [];
  let lastRenderKey = '';
  let loadFailed = false;
  let highlightId = null; // sale row to flash after Mark paid / Undo

  function init() {
    const fromInput = document.getElementById('reportsFilterFrom');
    const toInput = document.getElementById('reportsFilterTo');
    const applyBtn = document.getElementById('reportsApplyFilterBtn');
    const resetBtn = document.getElementById('reportsResetFilterBtn');
    if (applyBtn) applyBtn.addEventListener('click', () => applyFilter(fromInput.value, toInput.value));
    if (resetBtn) resetBtn.addEventListener('click', resetFilter);

    const exportBtn = document.getElementById('exportCsvBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportXlsx);

    const deleteAllBtn = document.getElementById('deleteAllReportsBtn');
    if (deleteAllBtn) deleteAllBtn.addEventListener('click', openDeleteAllModal);
    const deleteAllModalClose = document.getElementById('deleteAllReportsModalClose');
    if (deleteAllModalClose) deleteAllModalClose.addEventListener('click', closeDeleteAllModal);
    const deleteAllCancelBtn = document.getElementById('cancelDeleteAllBtn');
    if (deleteAllCancelBtn) deleteAllCancelBtn.addEventListener('click', closeDeleteAllModal);
    const confirmInput = document.getElementById('deleteAllConfirmInput');
    if (confirmInput) {
      confirmInput.addEventListener('input', () => {
        const btn = document.getElementById('confirmDeleteAllBtn');
        if (btn) btn.disabled = confirmInput.value.trim() !== 'DELETE';
      });
    }
    const confirmBtn = document.getElementById('confirmDeleteAllBtn');
    if (confirmBtn) confirmBtn.addEventListener('click', deleteAllReports);

    document.querySelectorAll('.report-preset').forEach((btn) => {
      btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
    });
    markPreset('all');
  }

  function isoDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function markPreset(name) {
    document.querySelectorAll('.report-preset').forEach((btn) => {
      const active = btn.dataset.preset === name;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function applyPreset(name) {
    if (name === 'all') { resetFilter(); return; }
    const to = new Date();
    const from = new Date();
    if (name === '7d') from.setDate(from.getDate() - 6);
    if (name === '30d') from.setDate(from.getDate() - 29);
    document.getElementById('reportsFilterFrom').value = isoDate(from);
    document.getElementById('reportsFilterTo').value = isoDate(to);
    filterFrom = isoDate(from);
    filterTo = isoDate(to);
    markPreset(name);
    render();
  }

  function applyFilter(from, to) {
    filterFrom = from || null;
    filterTo = to || null;
    markPreset(filterFrom || filterTo ? null : 'all');
    render();
  }

  function resetFilter() {
    filterFrom = null;
    filterTo = null;
    document.getElementById('reportsFilterFrom').value = '';
    document.getElementById('reportsFilterTo').value = '';
    markPreset('all');
    render();
  }

  function getFilteredSales() {
    if (!filterFrom && !filterTo) return salesCache;
    return salesCache.filter((s) => {
      const d = new Date(s.datetime);
      if (filterFrom && d < new Date(filterFrom + 'T00:00:00')) return false;
      if (filterTo && d > new Date(filterTo + 'T23:59:59')) return false;
      return true;
    });
  }

  // Pay Later sales settled within the report range, whenever they were
  // sold. Used for cash-drawer reconciliation in the Excel export.
  function getSalesSettledInRange() {
    return salesCache.filter((s) => {
      if (s.paymentMethod !== 'Pay Later' || !s.isSettled || !s.settledAt) return false;
      if (!filterFrom && !filterTo) return true;
      const d = new Date(s.settledAt);
      if (filterFrom && d < new Date(filterFrom + 'T00:00:00')) return false;
      if (filterTo && d > new Date(filterTo + 'T23:59:59')) return false;
      return true;
    });
  }

  async function render() {
    try {
      salesCache = await DB.getSales();
      loadFailed = false;
    } catch (err) {
      // Keep showing the last good data; tell the user once, not every sync.
      if (!loadFailed) UI.notify('error', 'Couldn’t load sales', err.message);
      loadFailed = true;
      return;
    }

    const sales = getFilteredSales();
    // Leave the page (and keyboard focus) alone if nothing changed.
    const key = [filterFrom, filterTo].join('|') + '|' + JSON.stringify(sales.map((s) => [s.id, s.total, s.isSettled, s.settledMethod, s.items.length]));
    if (key === lastRenderKey) return;
    lastRenderKey = key;

    let totalSales = 0, itemsSold = 0, payLaterPending = 0;
    sales.forEach((s) => {
      totalSales += Number(s.total) || 0;
      (s.items || []).forEach((it) => { itemsSold += Number(it.qty) || 0; });
      if (s.paymentMethod === 'Pay Later' && !s.isSettled) payLaterPending += Number(s.total) || 0;
    });
    const avgSale = sales.length ? totalSales / sales.length : 0;

    setStat('statTotalSales', totalSales, UI.peso);
    setStat('statTransactions', sales.length, String);
    setStat('statItemsSold', itemsSold, String);
    setStat('statAvgSale', avgSale, UI.peso);
    setStat('statPendingPayLater', payLaterPending, UI.peso);

    renderTopProducts(sales);
    renderSalesTable(sales);
  }

  function setStat(id, value, formatFn) {
    Motion.countTo(document.getElementById(id), value, formatFn);
  }

  function renderTopProducts(sales) {
    const container = document.getElementById('topProductsChart');
    if (!container) return;

    const byName = {};
    sales.forEach((s) => (s.items || []).forEach((it) => {
      const row = byName[it.name] || (byName[it.name] = { qty: 0, amount: 0 });
      row.qty += Number(it.qty) || 0;
      row.amount += Number(it.subtotal) || 0;
    }));
    const ranked = Object.entries(byName).sort((a, b) => b[1].qty - a[1].qty || b[1].amount - a[1].amount).slice(0, 8);

    if (ranked.length === 0) {
      container.innerHTML = '<p class="empty-state">No sales in this range yet.</p>';
      return;
    }

    const max = ranked[0][1].qty || 1;
    container.innerHTML = '<ol class="bar-list-items">' + ranked.map(([name, r], i) => (
      '<li class="bar-row" style="--i:' + i + '">' +
      '<span class="bar-label">' + UI.escapeHtml(name) + '</span>' +
      '<span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:' + Math.max(3, (r.qty / max) * 100).toFixed(1) + '%"></span></span>' +
      '<span class="bar-value num">' + r.qty + ' sold</span>' +
      '<span class="bar-amount num">' + UI.peso(r.amount) + '</span>' +
      '</li>'
    )).join('') + '</ol>';
  }

  function renderSalesTable(sales) {
    const tbody = document.getElementById('reportsTableBody');
    if (!tbody) return;

    if (sales.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6" class="empty-state">No transactions in this range.</td></tr>';
      return;
    }

    const sorted = [...sales].sort((a, b) => new Date(b.datetime) - new Date(a.datetime));

    tbody.innerHTML = sorted.map((s) => {
      let paymentCell;
      if (s.paymentMethod === 'Pay Later') {
        if (s.isSettled) {
          const settledVia = s.settledMethod || 'Cash'; // pre-existing settled sales predate this field
          const viaBadgeClass = settledVia === 'GCash' ? 'badge-teal' : 'badge-ok';
          paymentCell =
            '<span class="badge ' + viaBadgeClass + '">Paid · ' + UI.escapeHtml(settledVia) + '</span> <span class="pay-who">' + UI.escapeHtml(s.customerName || '') + '</span> ' +
            '<button type="button" class="icon-btn undo-settle-btn" data-id="' + UI.escapeHtml(s.id) + '" data-name="' + UI.escapeHtml(s.customerName || '') + '" aria-label="Undo payment for ' + UI.escapeHtml(s.customerName || '') + '" title="Undo payment">' + Icon('undo') + '</button>';
        } else {
          paymentCell =
            '<span class="badge badge-warn">Unpaid</span> <span class="pay-who">' + UI.escapeHtml(s.customerName || '') + '</span> ' +
            '<button type="button" class="btn btn-sm btn-secondary mark-paid-btn" data-id="' + UI.escapeHtml(s.id) + '" data-name="' + UI.escapeHtml(s.customerName || '') + '" data-total="' + s.total + '">Mark paid</button>';
        }
      } else {
        const methodBadgeClass = s.paymentMethod === 'GCash' ? 'badge-teal' : 'badge-ok';
        paymentCell = '<span class="badge ' + methodBadgeClass + '">' + UI.escapeHtml(s.paymentMethod) + '</span>';
      }

      const itemCount = (s.items || []).reduce((n, it) => n + Number(it.qty || 0), 0);
      // data-cell names drive the stacked-card layout on phones (style.css).
      return (
        '<tr data-id="' + UI.escapeHtml(s.id) + '"' + (s.id === highlightId ? ' class="is-highlighted"' : '') + '>' +
        '<td class="cell-datetime" data-cell="date">' + UI.formatDate(s.datetime) +
        '<span class="cell-sub">' + new Date(s.datetime).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) + '</span></td>' +
        '<td data-cell="cashier">' + UI.escapeHtml(s.cashier) + '</td>' +
        '<td data-cell="payment"><div class="pay-cell">' + paymentCell + '</div></td>' +
        '<td class="num" data-cell="total">' + UI.peso(s.total) + '</td>' +
        '<td class="num" data-cell="items">' + itemCount + '</td>' +
        '<td class="actions-col" data-cell="actions">' +
        '<button type="button" class="icon-btn view-receipt-btn" data-id="' + UI.escapeHtml(s.id) + '" aria-label="View receipt for sale ' + UI.escapeHtml(s.id) + '" title="View receipt">' + Icon('receipt') + '</button>' +
        '<button type="button" class="icon-btn icon-btn-danger delete-sale-btn" data-id="' + UI.escapeHtml(s.id) + '" aria-label="Delete sale ' + UI.escapeHtml(s.id) + '" title="Delete sale">' + Icon('trash') + '</button>' +
        '</td>' +
        '</tr>'
      );
    }).join('');

    highlightId = null;

    tbody.querySelectorAll('.mark-paid-btn').forEach((btn) => {
      btn.addEventListener('click', () => markAsPaid(btn.dataset.id, btn.dataset.name, parseFloat(btn.dataset.total)));
    });
    tbody.querySelectorAll('.undo-settle-btn').forEach((btn) => {
      btn.addEventListener('click', () => undoSettle(btn.dataset.id, btn.dataset.name));
    });
    tbody.querySelectorAll('.view-receipt-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sale = salesCache.find((s) => s.id === btn.dataset.id);
        if (sale) Receipt.show(sale);
      });
    });
    tbody.querySelectorAll('.delete-sale-btn').forEach((btn) => {
      btn.addEventListener('click', () => deleteSale(btn.dataset.id));
    });
  }

  // Delete one sale. Its items go back into stock -- except on sales
  // recorded before the checkout stock fix, which never lowered stock and
  // have no item id on their lines (the server skips those the same way).
  async function deleteSale(saleId) {
    const sale = salesCache.find((s) => s.id === saleId);
    if (!sale) return;
    const restoreQty = (sale.items || [])
      .filter((l) => l.itemId || l.id)
      .reduce((n, l) => n + (Number(l.qty) || 0), 0);
    const stockNote = restoreQty
      ? ' ' + restoreQty + (restoreQty === 1 ? ' item goes' : ' items go') + ' back into stock.'
      : '';
    const ok = await UI.confirm(
      'Delete sale ' + sale.id + ' (' + UI.peso(sale.total) + ', ' + UI.formatDateTime(sale.datetime) + ')?' + stockNote + ' This cannot be undone.',
      { title: 'Delete sale?', okText: 'Delete sale', okClass: 'btn-danger' }
    );
    if (!ok) return;
    try {
      const result = await DB.deleteSale(saleId);
      const n = result && result.restoredQty ? result.restoredQty : 0;
      UI.notify('success', 'Sale deleted',
        sale.id + ' was removed' + (n ? ' and ' + n + (n === 1 ? ' item went' : ' items went') + ' back into stock.' : '.'));
      const row = [...document.querySelectorAll('#reportsTableBody tr[data-id]')].find((r) => r.dataset.id === saleId);
      const hadFocus = !!row && row.contains(document.activeElement);
      const index = await UI.removeRow(row);
      lastRenderKey = '';
      await render();
      if (hadFocus) UI.focusRow(document.getElementById('reportsTableBody'), index, '.delete-sale-btn', 'reportsFilterFrom');
      if (typeof refreshSidebarSnapshot === 'function') refreshSidebarSnapshot();
    } catch (err) {
      UI.notify('error', "Couldn't delete the sale", err.message);
    }
  }

  async function markAsPaid(saleId, customerName, total) {
    const method = await UI.choosePaymentMethod(
      'Mark ' + (customerName || 'this customer') + '’s Pay Later balance of ' + UI.peso(total) + ' as paid. How did they pay?'
    );
    if (!method) return;
    try {
      await DB.settleSale(saleId, method);
      lastRenderKey = '';
      highlightId = saleId;
      UI.notify('success', 'Marked as paid', (customerName || 'Customer') + ' paid ' + UI.peso(total) + ' via ' + method + '.');
      render();
    } catch (err) {
      UI.notify('error', "Couldn't update the sale", err.message);
    }
  }

  async function undoSettle(saleId, customerName) {
    const ok = await UI.confirm(
      'Undo payment confirmation for ' + (customerName || 'this customer') + '? This will mark the balance as pending again.',
      { title: 'Undo payment?', okText: 'Undo payment' }
    );
    if (!ok) return;
    try {
      await DB.unsettleSale(saleId);
      lastRenderKey = '';
      highlightId = saleId;
      UI.notify('info', 'Moved back to pending', (customerName || 'This customer') + '\u2019s balance is unpaid again.');
      render();
    } catch (err) {
      UI.notify('error', "Couldn't update the sale", err.message);
    }
  }

  // ---- Excel export: the DAR Sales & Inventory Report template (sheet
  // names, headings, merges, widths and borders), built with ExcelJS. ----
  const PESO_FMT = '"P"#,##0.00'; // plain "P", not the ₱ sign -- same reasoning as UI.peso() in ui.js
  const THIN = { style: 'thin' };
  const ALL_BORDERS = { top: THIN, left: THIN, bottom: THIN, right: THIN };

  function borderCell(cell) {
    cell.border = ALL_BORDERS;
    return cell;
  }
  function headerCell(cell, opts) {
    opts = opts || {};
    cell.font = { bold: true, size: 11 };
    cell.alignment = { horizontal: opts.align || 'center', vertical: 'center', wrapText: !!opts.wrap };
    return borderCell(cell);
  }
  function dataCell(cell, opts) {
    opts = opts || {};
    cell.font = { size: 11 };
    if (opts.wrap) cell.alignment = { wrapText: true, vertical: opts.valign || 'top' };
    return borderCell(cell);
  }
  function titleCell(cell, size) {
    cell.font = { bold: true, size: size || 16 };
    cell.alignment = { horizontal: 'center' };
    return cell;
  }
  function labelCell(cell, size) {
    cell.font = { size: size || 14 };
    return cell;
  }

  // Beginning / ending inventory for the report range, worked back from
  // current stock: add back what sold since the range started (beginning)
  // or after it ended (ending). Only sale lines that actually lowered
  // stock (they carry an item id) are counted. Manual stock edits made
  // after the range can't be seen, so treat past ranges as approximate.
  function stockPositions(items) {
    const start = filterFrom ? new Date(filterFrom + 'T00:00:00') : null;
    const end = filterTo ? new Date(filterTo + 'T23:59:59') : null;
    const soldSinceStart = {};
    const soldAfterEnd = {};
    salesCache.forEach((s) => {
      const d = new Date(s.datetime);
      (s.items || []).forEach((line) => {
        const id = line.itemId || line.id;
        if (!id) return;
        const qty = Number(line.qty) || 0;
        if (!start || d >= start) soldSinceStart[id] = (soldSinceStart[id] || 0) + qty;
        if (end && d > end) soldAfterEnd[id] = (soldAfterEnd[id] || 0) + qty;
      });
    });
    const out = {};
    items.forEach((it) => {
      const stock = Number(it.stock) || 0;
      out[it.id] = { beginning: stock + (soldSinceStart[it.id] || 0), ending: stock + (soldAfterEnd[it.id] || 0) };
    });
    return out;
  }

  function buildProductInvSheet(workbook, items) {
    const positions = stockPositions(items);

    const ws = workbook.addWorksheet('Product Inv');
    ws.getColumn(2).width = 38;      // B
    ws.getColumn(3).width = 28.55;   // C
    ws.getColumn(4).width = 19.55;   // D
    ws.getColumn(5).width = 20.66;   // E
    ws.getColumn(6).width = 19.55;   // F - Total (D*E)
    ws.getColumn(7).width = 17.55;   // G
    ws.getColumn(8).width = 19.55;   // H - Total (D*G)
    ws.getColumn(9).width = 20;      // I

    // Column-level peso format so rows typed in later in Excel match.
    ws.getColumn(4).numFmt = PESO_FMT; // D - Unit Price
    ws.getColumn(6).numFmt = PESO_FMT; // F - Total (D*E)
    ws.getColumn(8).numFmt = PESO_FMT; // H - Total (D*G)

    ws.mergeCells('B6:I6');
    titleCell(ws.getCell('B6'), 16).value = 'PRODUCT INVENTORY REPORT';
    ws.getRow(6).height = 21;

    labelCell(ws.getCell('B8')).value = 'Name of In-charge: ____________________________';
    labelCell(ws.getCell('B9')).value = 'Date Prepared: ' + new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
    ws.getRow(8).height = 18;
    ws.getRow(9).height = 18;

    ws.getCell('B11').value = 'INVENTORY SUMMARY';
    ws.getCell('B11').font = { bold: true, size: 11 };

    const HEADER_ROW = 13;
    const headers = [
      ['B', 'ARBO Name', false],
      ['C', 'Product Name', false],
      ['D', 'Unit Price', false],
      ['E', 'AM - Beginning Inventory', true],
      ['F', 'Total', true],
      ['G', 'Units Sold', false],
      ['H', 'Total', false],
      ['I', 'PM - Ending Inventory', true],
    ];
    headers.forEach(([col, text, wrap]) => {
      const cell = ws.getCell(col + HEADER_ROW);
      cell.value = text;
      headerCell(cell, { wrap });
    });
    ws.getRow(HEADER_ROW).height = 27.75;

    // Long ARBO and product names wrap; the row grows to fit the longest.
    function estimateWrapLines(text, colWidth) {
      const charsPerLine = Math.max(8, Math.round(colWidth * 0.95));
      return Math.max(1, Math.ceil(String(text || '').length / charsPerLine));
    }

    const DATA_START = HEADER_ROW + 1;
    items.forEach((it, idx) => {
      const row = DATA_START + idx;
      const { beginning, ending } = positions[it.id];

      dataCell(ws.getCell('B' + row), { wrap: true }).value = it.farm || '';
      dataCell(ws.getCell('C' + row), { wrap: true }).value = it.name;
      const priceCell = dataCell(ws.getCell('D' + row));
      priceCell.value = Number(it.price);
      priceCell.numFmt = PESO_FMT;
      dataCell(ws.getCell('E' + row)).value = beginning;
      const totalBeginCell = dataCell(ws.getCell('F' + row));
      totalBeginCell.value = { formula: 'D' + row + '*E' + row, result: Number(it.price) * beginning };
      totalBeginCell.numFmt = PESO_FMT;
      const reportSales = getFilteredSales();

const unitsSold = reportSales.reduce((sum, sale) => {
  return sum + (sale.items || [])
    .filter(line => (line.itemId || line.id) === it.id)
    .reduce((n, line) => n + (Number(line.qty) || 0), 0);
}, 0);

dataCell(ws.getCell('G' + row)).value = unitsSold;

const totalSoldCell = dataCell(ws.getCell('H' + row));
totalSoldCell.value = {
  formula: 'D' + row + '*G' + row,
  result: Number(it.price) * unitsSold
};
totalSoldCell.numFmt = PESO_FMT;

      totalSoldCell.numFmt = PESO_FMT;
      dataCell(ws.getCell('I' + row)).value = ending;
      const bLines = estimateWrapLines(it.farm || '', 38);
      const cLines = estimateWrapLines(it.name || '', 28.55);
      ws.getRow(row).height = Math.max(27.75, Math.max(bLines, cLines) * 15 + 8);
    });

    const lastDataRow = DATA_START + items.length - 1;
    const TOTAL_ROW = DATA_START + items.length;
    ws.mergeCells('B' + TOTAL_ROW + ':C' + TOTAL_ROW);
    const totalLabel = ws.getCell('B' + TOTAL_ROW);
    totalLabel.value = 'TOTAL';
    totalLabel.font = { bold: true, size: 12 };
    totalLabel.alignment = { horizontal: 'center', vertical: 'center' };
    borderCell(totalLabel);
    ['D', 'E', 'G', 'H', 'I'].forEach((col) => borderCell(ws.getCell(col + TOTAL_ROW)));
    const grandTotal = items.reduce((sum, it) => {
      return sum + Number(it.price) * positions[it.id].beginning;
    }, 0);
    const grandTotalCell = ws.getCell('F' + TOTAL_ROW);
    grandTotalCell.value = items.length ? { formula: 'SUM(F' + DATA_START + ':F' + lastDataRow + ')', result: grandTotal } : 0;
    grandTotalCell.numFmt = PESO_FMT;
    grandTotalCell.font = { bold: true, size: 11 };
    grandTotalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    borderCell(grandTotalCell);
    ws.getRow(TOTAL_ROW).height = 18;

    const PREPARED_ROW = TOTAL_ROW + 2;
    labelCell(ws.getCell('B' + PREPARED_ROW)).value = 'Prepared by:';
    const notedCell = labelCell(ws.getCell('E' + PREPARED_ROW));
    notedCell.value = 'Noted by:';
    notedCell.alignment = { horizontal: 'right' };
    ws.getRow(PREPARED_ROW).height = 18;

    const SIG_ROW = PREPARED_ROW + 3;
    ws.mergeCells('B' + SIG_ROW + ':C' + SIG_ROW);
    ws.mergeCells('G' + SIG_ROW + ':H' + SIG_ROW);
    const sigLine1 = labelCell(ws.getCell('B' + SIG_ROW));
    sigLine1.value = '____________________________';
    sigLine1.alignment = { horizontal: 'center' };
    const sigLine2 = labelCell(ws.getCell('G' + SIG_ROW));
    sigLine2.value = '____________________________';
    sigLine2.alignment = { horizontal: 'center' };
    ws.getRow(SIG_ROW).height = 18;
    ws.getRow(SIG_ROW + 1).height = 18;

    const CAPTION_ROW = SIG_ROW + 2;
    ws.mergeCells('B' + CAPTION_ROW + ':C' + CAPTION_ROW);
    ws.mergeCells('G' + CAPTION_ROW + ':H' + CAPTION_ROW);
    const cap1 = labelCell(ws.getCell('B' + CAPTION_ROW));
    cap1.value = 'Signature over Printed Name';
    cap1.alignment = { horizontal: 'center', vertical: 'top' };
    const cap2 = labelCell(ws.getCell('G' + CAPTION_ROW));
    cap2.value = 'Signature over Printed Name';
    cap2.alignment = { horizontal: 'center', vertical: 'top' };
    ws.getRow(CAPTION_ROW).height = 18;

    ws.views = [{ showGridLines: true }];
  }

  function buildDailySalesSheet(workbook, sales) {
    const ws = workbook.addWorksheet('Daily Sales');
    ws.getColumn(2).width = 33.22; // B Time
    ws.getColumn(3).width = 22;    // C Product
    ws.getColumn(5).width = 14.89; // E Price/Item
    ws.getColumn(6).width = 14;    // F Total
    ws.getColumn(7).width = 13;    // G Payment method
    ws.getColumn(8).width = 30;    // H Notes (Pay Later customer + status)

    // Peso format for the number columns (text cells ignore it).
    ws.getColumn(3).numFmt = PESO_FMT; // C - Amount (Cash Flow section)
    ws.getColumn(5).numFmt = PESO_FMT; // E - Price/Item
    ws.getColumn(6).numFmt = PESO_FMT; // F - Total

    ws.mergeCells('B5:H5');
    titleCell(ws.getCell('B5'), 14).value = 'DAILY SALES RECORD';
    ws.getRow(5).height = 18;

    const dateLabel = filterFrom || filterTo
      ? (filterFrom ? UI.formatDate(filterFrom) : 'Start') + ' – ' + (filterTo ? UI.formatDate(filterTo) : 'Present')
      : 'All Dates';
    ws.getCell('B7').value = 'Date: ' + dateLabel;
    ws.getCell('B7').font = { size: 11 };
    ws.getCell('B8').value = 'Name of In-charge: ____________________';
    ws.getCell('B8').font = { size: 11 };

    const HEADER_ROW = 10;
    ['B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach((col, i) => {
      const cell = ws.getCell(col + HEADER_ROW);
      cell.value = ['Time', 'Product', 'Qty.', 'Price/Item', 'Total', 'Payment', 'Notes'][i];
      headerCell(cell);
    });

    // One row per line item, oldest first. Pay Later customer and status
    // go in Notes so the Payment column stays a plain method name.
    const lines = [];
    [...sales].sort((a, b) => new Date(a.datetime) - new Date(b.datetime)).forEach((s) => {
      const time = new Date(s.datetime).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
      const payment = s.paymentMethod;
      let notes = '';
      if (s.paymentMethod === 'Pay Later') {
        const who = s.customerName || 'Customer';
        notes = s.isSettled ? who + ' – Paid via ' + (s.settledMethod || 'Cash') : who + ' – Pending';
      }
      (s.items || []).forEach((it) => {
        lines.push({ time, product: it.name, qty: Number(it.qty) || 0, price: Number(it.price) || 0, total: Number(it.subtotal) || 0, payment, notes });
      });
    });

    const DATA_START = HEADER_ROW + 1;
    lines.forEach((line, idx) => {
      const row = DATA_START + idx;
      dataCell(ws.getCell('B' + row)).value = line.time;
      dataCell(ws.getCell('C' + row), { wrap: true }).value = line.product;
      dataCell(ws.getCell('D' + row)).value = line.qty;
      const priceCell = dataCell(ws.getCell('E' + row));
      priceCell.value = line.price;
      priceCell.numFmt = PESO_FMT;
      const totalCell = dataCell(ws.getCell('F' + row));
      totalCell.value = line.total;
      totalCell.numFmt = PESO_FMT;
      dataCell(ws.getCell('G' + row)).value = line.payment;
      dataCell(ws.getCell('H' + row), { wrap: true }).value = line.notes;
      ws.getRow(row).height = line.notes ? 30 : 19.5;
    });

    const lastDataRow = DATA_START + lines.length - 1;
    const TOTAL_ROW = DATA_START + lines.length;
    const totalLabel = ws.getCell('B' + TOTAL_ROW);
    totalLabel.value = 'Total';
    totalLabel.font = { bold: true, size: 11 };
    borderCell(totalLabel);
    ['C', 'D', 'E'].forEach((col) => borderCell(ws.getCell(col + TOTAL_ROW)));
    const lineTotalSum = lines.reduce((sum, l) => sum + l.total, 0);
    const totalCell = ws.getCell('F' + TOTAL_ROW);
    totalCell.value = lines.length ? { formula: 'SUM(F' + DATA_START + ':F' + lastDataRow + ')', result: lineTotalSum } : 0;
    totalCell.numFmt = PESO_FMT;
    totalCell.font = { bold: true, size: 11 };
    borderCell(totalCell);
    borderCell(ws.getCell('G' + TOTAL_ROW));
    borderCell(ws.getCell('H' + TOTAL_ROW));

    // ---- Sales by payment type (live SUMIF over the Payment column) ----
    const PAYTYPE_HEADER_ROW = TOTAL_ROW + 2;
    const ptHead = ws.getCell('B' + PAYTYPE_HEADER_ROW);
    ptHead.value = 'SALES BY PAYMENT TYPE';
    headerCell(ptHead, { wrap: true });
    const ptAmtHead = ws.getCell('C' + PAYTYPE_HEADER_ROW);
    ptAmtHead.value = 'Amount';
    headerCell(ptAmtHead, { align: 'right' });

    const payTypes = ['Cash', 'GCash', 'Pay Later'];
    payTypes.forEach((label, i) => {
      const row = PAYTYPE_HEADER_ROW + 1 + i;
      const labelC = ws.getCell('B' + row);
      labelC.value = label.toUpperCase();
      labelC.font = { bold: true, size: 11 };
      labelC.alignment = { vertical: 'center' };
      borderCell(labelC);
      const amount = lines.filter((l) => l.payment === label).reduce((sum, l) => sum + l.total, 0);
      const valC = ws.getCell('C' + row);
      valC.value = lines.length
        ? { formula: 'SUMIF(G' + DATA_START + ':G' + lastDataRow + ',"' + label + '",F' + DATA_START + ':F' + lastDataRow + ')', result: amount }
        : 0;
      valC.numFmt = PESO_FMT;
      valC.font = { bold: true, size: 11 };
      valC.alignment = { horizontal: 'right', vertical: 'center' };
      borderCell(valC);
    });
    const PAYTYPE_TOTAL_ROW = PAYTYPE_HEADER_ROW + 1 + payTypes.length;
    const ptTotalLabel = ws.getCell('B' + PAYTYPE_TOTAL_ROW);
    ptTotalLabel.value = 'TOTAL';
    ptTotalLabel.font = { bold: true, size: 11 };
    borderCell(ptTotalLabel);
    const ptTotalCell = ws.getCell('C' + PAYTYPE_TOTAL_ROW);
    ptTotalCell.value = { formula: 'SUM(C' + (PAYTYPE_HEADER_ROW + 1) + ':C' + (PAYTYPE_TOTAL_ROW - 1) + ')', result: lineTotalSum };
    ptTotalCell.numFmt = PESO_FMT;
    ptTotalCell.font = { bold: true, size: 11 };
    borderCell(ptTotalCell);

    // ---- End-of-day summary: cash drawer reconciliation ----
    const EOD_ROW = PAYTYPE_TOTAL_ROW + 2;
    ws.getCell('B' + EOD_ROW).value = 'END-OF-DAY SUMMARY';
    ws.getCell('B' + EOD_ROW).font = { bold: true, size: 11 };
    const NOTE_ROW = EOD_ROW + 1;
    ws.getCell('B' + NOTE_ROW).value = 'Yellow cells: type in your own count/amount. Cash Over/(Short) stays negative until "Actual Cash on Hand" is filled in.';
    ws.getCell('B' + NOTE_ROW).font = { italic: true, size: 10, color: { argb: 'FF6B6B6B' } };

    const CASHFLOW_HEADER_ROW = EOD_ROW + 2;
    const cfHead = ws.getCell('B' + CASHFLOW_HEADER_ROW);
    cfHead.value = 'Cash Flow (Cash Drawer Only)';
    headerCell(cfHead, { wrap: true });
    const amtHead = ws.getCell('C' + CASHFLOW_HEADER_ROW);
    amtHead.value = 'Amount';
    headerCell(amtHead, { align: 'right', wrap: true });
    const compHead = ws.getCell('E' + CASHFLOW_HEADER_ROW);
    compHead.value = 'Computation';
    compHead.font = { bold: true, size: 11 };

    // Cash drawer only (GCash never touches it). Utang collected in cash
    // during the range is its own line, since the sale may be older.
    let cashDirect = 0, cashFromPayLater = 0;
    sales.forEach((s) => {
      if (s.paymentMethod !== 'Cash') return;
      cashDirect += Number(s.total) || 0;
    });
    getSalesSettledInRange().forEach((s) => {
      if ((s.settledMethod || 'Cash') === 'Cash') cashFromPayLater += Number(s.total) || 0;
    });
    const cashTotalAll = cashDirect + cashFromPayLater;

    const R = CASHFLOW_HEADER_ROW; // shorthand base
    const ROW_OPENING = R + 1;
    const ROW_CASH_DIRECT = R + 2;
    const ROW_CASH_PAYLATER = R + 3;
    const ROW_CASH_TOTAL = R + 4;
    const ROW_OTHER_RECEIPTS = R + 5;
    const ROW_CASH_EXPENSES = R + 6;
    const ROW_EXPECTED_CLOSING = R + 7;
    const ROW_ACTUAL_CASH = R + 8;

    // "input" rows are left blank and shaded for the cashier to fill in.
    const rows = [
      { label: 'Opening Cash/Change Fund', value: '', bold: false, input: true, comp: 'Type the cash the drawer started the day with' },
      { label: 'Cash Sales (Walk-in)', value: cashDirect, bold: false, comp: 'Same as CASH above' },
      { label: 'Pay Later Collected – Cash', value: cashFromPayLater, bold: false, comp: 'Utang settled in cash today' },
      { label: 'TOTAL CASH IN', value: { formula: 'SUM(C' + ROW_CASH_DIRECT + ':C' + ROW_CASH_PAYLATER + ')', result: cashTotalAll }, bold: true, comp: '= Cash Sales (Walk-in) + Pay Later Collected – Cash' },
      { label: 'Add: Other Cash Receipts', value: '', bold: false, input: true, comp: 'Type any other cash received, not from a sale' },
      { label: 'Less: Cash Expenses/Payments', value: '', bold: false, input: true, comp: 'Type cash paid out (supplies, etc.)' },
      { label: 'Expected Closing Cash', value: { formula: 'C' + ROW_OPENING + '+C' + ROW_CASH_TOTAL + '+C' + ROW_OTHER_RECEIPTS + '-C' + ROW_CASH_EXPENSES, result: cashTotalAll }, bold: true, comp: '= Opening Cash + Total Cash In + Other Cash Receipts − Cash Expenses' },
      { label: 'Actual Cash on Hand', value: '', bold: false, input: true, comp: 'Count the drawer at closing and type the total here' },
      { label: 'Cash Over/(Short)', value: { formula: 'C' + ROW_ACTUAL_CASH + '-C' + ROW_EXPECTED_CLOSING, result: -cashTotalAll }, bold: true, comp: 'Negative until "Actual Cash on Hand" above is filled in – = Actual Cash on Hand − Expected Closing Cash' },
    ];
    const INPUT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    rows.forEach((r, i) => {
      const row = R + 1 + i;
      const labelC = ws.getCell('B' + row);
      labelC.value = r.label;
      labelC.font = { bold: r.bold, size: 11, italic: !!r.input };
      labelC.alignment = { vertical: 'center', wrapText: true };
      borderCell(labelC);
      const valC = ws.getCell('C' + row);
      valC.value = r.value;
      valC.numFmt = PESO_FMT;
      valC.font = { bold: r.bold, size: 11 };
      valC.alignment = { horizontal: 'right', vertical: 'center', wrapText: true };
      if (r.input) valC.fill = INPUT_FILL;
      borderCell(valC);
      if (r.comp) {
        const compC = ws.getCell('E' + row);
        compC.value = r.comp;
        compC.font = { size: 11 };
      }
    });

    ws.views = [{ showGridLines: true }];
  }

  function buildSalesSummarySheet(workbook, sales) {
    const ws = workbook.addWorksheet('Sales Summary');
    ws.getColumn(4).width = 22.89; // D
    ws.getColumn(5).width = 26;    // E - Date
    ws.getColumn(6).width = 19.55; // F - Total Sales
    ws.getColumn(6).numFmt = PESO_FMT;

    const HEADER_ROW = 2;
    ['D', 'E', 'F', 'G'].forEach((col, i) => {
      const cell = ws.getCell(col + HEADER_ROW);
      cell.value = ['Day', 'Date', 'Total Sales', 'Remarks'][i];
      cell.font = { size: 11 };
      borderCell(cell);
    });

    // One row per calendar date, in date order.
    const totalsByDate = {}; // 'YYYY-MM-DD' -> total
    sales.forEach((s) => {
      const d = new Date(s.datetime);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      totalsByDate[key] = (totalsByDate[key] || 0) + (Number(s.total) || 0);
    });

    // With a date range, list every day in it (including zero-sale days);
    // otherwise list only days that have sales.
    let dateKeys;
    if (filterFrom && filterTo) {
      dateKeys = [];
      const cursor = new Date(filterFrom + 'T00:00:00');
      const end = new Date(filterTo + 'T00:00:00');
      while (cursor <= end) {
        dateKeys.push(cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0') + '-' + String(cursor.getDate()).padStart(2, '0'));
        cursor.setDate(cursor.getDate() + 1);
      }
    } else {
      dateKeys = Object.keys(totalsByDate).sort();
    }

    dateKeys.forEach((key, idx) => {
      const row = HEADER_ROW + 1 + idx;
      const d = new Date(key + 'T00:00:00');
      const dayCell = ws.getCell('D' + row);
      dayCell.value = d.toLocaleDateString('en-PH', { weekday: 'long' });
      dayCell.font = { size: 11 };
      borderCell(dayCell);
      const dateCell = ws.getCell('E' + row);
      dateCell.value = d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
      dateCell.font = { size: 11 };
      dateCell.alignment = { wrapText: true, vertical: 'center' };
      borderCell(dateCell);
      const totalCell = ws.getCell('F' + row);
      totalCell.value = totalsByDate[key] || 0;
      totalCell.numFmt = PESO_FMT;
      totalCell.font = { size: 11 };
      borderCell(totalCell);
      borderCell(ws.getCell('G' + row));
      ws.getRow(row).height = 19.2;
    });

    const TOTAL_ROW = HEADER_ROW + 1 + dateKeys.length;
    const totalLabel = ws.getCell('D' + TOTAL_ROW);
    totalLabel.value = 'TOTAL SALES';
    totalLabel.font = { size: 11 };
    borderCell(totalLabel);
    borderCell(ws.getCell('E' + TOTAL_ROW));
    const grandTotal = dateKeys.reduce((sum, k) => sum + (totalsByDate[k] || 0), 0);
    const totalCell = ws.getCell('F' + TOTAL_ROW);
    totalCell.value = dateKeys.length
      ? { formula: 'SUM(F' + (HEADER_ROW + 1) + ':F' + (TOTAL_ROW - 1) + ')', result: grandTotal }
      : 0;
    totalCell.numFmt = PESO_FMT;
    totalCell.font = { size: 11 };
    borderCell(totalCell);
    borderCell(ws.getCell('G' + TOTAL_ROW));
    ws.getRow(TOTAL_ROW).height = 19.2;

    ws.views = [{ showGridLines: true }];
  }

  async function exportXlsx() {
    if (typeof ExcelJS === 'undefined') {
      UI.notify('error', 'Export unavailable', 'The Excel tool did not load. Check the internet connection and reload the page.');
      return;
    }
    let items;
    try {
      items = await DB.getItems();
    } catch (err) {
      UI.notify('error', "Couldn't load items for the report", err.message);
      return;
    }
    const sales = getFilteredSales();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'TinDARhan';
    workbook.created = new Date();
    buildProductInvSheet(workbook, items);
    buildDailySalesSheet(workbook, sales);
    buildSalesSummarySheet(workbook, sales);

    const filename = 'TinDARhan_Sales_Report_' + new Date().toISOString().slice(0, 10) + '.xlsx';
    try {
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      // Inside the hosted preview, downloads go through window.claude;
      // on the real site that object doesn't exist and this is skipped.
      if (window.claude && typeof window.claude.use === 'function') {
        try {
          const downloads = await window.claude.use('downloads');
          if (downloads) {
            await downloads.save({ filename, data: blob });
            UI.notify('success', 'Report exported', filename);
            return;
          }
        } catch (capErr) {
          // Fall through to the ordinary browser download.
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      UI.notify('success', 'Report exported', filename);
    } catch (err) {
      UI.notify('error', "Couldn't build the report", err.message);
    }
  }

  // ---- Delete all sales records ----
  function openDeleteAllModal() {
    const input = document.getElementById('deleteAllConfirmInput');
    if (input) input.value = '';
    const btn = document.getElementById('confirmDeleteAllBtn');
    if (btn) btn.disabled = true;
    UI.openModal('deleteAllReportsModal');
  }

  function closeDeleteAllModal() {
    UI.closeModal('deleteAllReportsModal');
  }

  async function deleteAllReports() {
    const input = document.getElementById('deleteAllConfirmInput');
    if (!input || input.value.trim() !== 'DELETE') return;
    const btn = document.getElementById('confirmDeleteAllBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Deleting...'; }
    try {
      await DB.deleteAllSales();
      UI.notify('success', 'All reports deleted', 'Sales records and receipt numbering were reset.');
      closeDeleteAllModal();
      render();
    } catch (err) {
      UI.notify('error', "Couldn't delete the reports", err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Delete Everything'; }
    }
  }

  return {
    init, applyFilter, resetFilter, getFilteredSales, render,
    markAsPaid, undoSettle, deleteSale, exportXlsx,
    openDeleteAllModal, closeDeleteAllModal, deleteAllReports,
  };
})();
