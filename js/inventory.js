/**
 * inventory.js
 * Inventory tab: item table with search, stock-status and date-added
 * filters, and the add/edit dialog (with photo upload).
 */
const Inventory = (() => {
  const DEFAULT_LOW_STOCK = 5;
  const MAX_PHOTO_DIMENSION = 500;

  let filterFrom = null;
  let filterTo = null;
  let statusFilter = 'all';
  let allItems = [];
  let editingId = null;
  let pendingPhoto; // undefined = unchanged, null = removed, string = new photo
  let lastTableKey = '';
  let highlightId = null; // row to flash after it was added or edited

  function init() {
    document.getElementById('inventorySearch').addEventListener('input', render);
    document.getElementById('inventoryStatusFilter').addEventListener('change', (e) => setStatusFilter(e.target.value));
    document.getElementById('inventoryApplyFilterBtn').addEventListener('click', () => {
      filterFrom = document.getElementById('inventoryFilterFrom').value || null;
      filterTo = document.getElementById('inventoryFilterTo').value || null;
      render();
    });
    document.getElementById('inventoryResetFilterBtn').addEventListener('click', resetFilters);
    document.getElementById('addItemBtn').addEventListener('click', () => openForm(null));
    document.getElementById('itemForm').addEventListener('submit', saveForm);
    document.getElementById('itemFormCancelBtn').addEventListener('click', () => UI.closeModal('itemModal'));
    document.getElementById('itemModalClose').addEventListener('click', () => UI.closeModal('itemModal'));
    document.getElementById('itemPhotoInput').addEventListener('change', handlePhotoSelect);
    document.getElementById('itemPhotoClearBtn').addEventListener('click', () => { pendingPhoto = null; showPhoto(null); });
  }

  function setStatusFilter(value) {
    statusFilter = value || 'all';
    const select = document.getElementById('inventoryStatusFilter');
    if (select) select.value = statusFilter;
    render();
  }

  function resetFilters() {
    filterFrom = null;
    filterTo = null;
    document.getElementById('inventoryFilterFrom').value = '';
    document.getElementById('inventoryFilterTo').value = '';
    document.getElementById('inventorySearch').value = '';
    setStatusFilter('all');
  }

  function thresholdOf(it) {
    return it.lowStockThreshold != null ? it.lowStockThreshold : DEFAULT_LOW_STOCK;
  }

  function statusOf(it) {
    if (it.stock <= 0) return { key: 'out', text: 'Out of stock' };
    if (it.stock <= thresholdOf(it)) return { key: 'low', text: 'Low stock' };
    return { key: 'ok', text: 'In stock' };
  }

  function matchesFilters(it, term) {
    if (term && !it.name.toLowerCase().includes(term) && !(it.farm || '').toLowerCase().includes(term)) return false;
    const status = statusOf(it).key;
    if (statusFilter === 'restock' && status === 'ok') return false;
    if (statusFilter === 'out' && status !== 'out') return false;
    if (filterFrom || filterTo) {
      const added = new Date(it.dateAdded || it.date_added);
      if (!isNaN(added)) {
        if (filterFrom && added < new Date(filterFrom + 'T00:00:00')) return false;
        if (filterTo && added > new Date(filterTo + 'T23:59:59')) return false;
      }
    }
    return true;
  }

  async function render() {
    // Don't redraw the table under someone who is editing an item.
    if (UI.isModalOpen('itemModal')) return;
    const tbody = document.getElementById('inventoryTableBody');

    try {
      allItems = await DB.getItems();
    } catch (err) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7" class="empty-state">Couldn’t load inventory. ' + UI.escapeHtml(err.message) + '</td></tr>';
      return;
    }

    const term = document.getElementById('inventorySearch').value.trim().toLowerCase();
    const rows = allItems.filter((it) => matchesFilters(it, term));

    // Leave the table (and keyboard focus) alone if nothing visible changed.
    const key = [term, statusFilter, filterFrom, filterTo].join('|') + '|' +
      rows.map((it) => [it.id, it.name, it.farm, it.price, it.stock, it.lowStockThreshold, (it.image || '').length].join(':')).join(',');
    if (key === lastTableKey && tbody.querySelector('tr')) return;
    lastTableKey = key;

    if (rows.length === 0) {
      const filtered = term || statusFilter !== 'all' || filterFrom || filterTo;
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7" class="empty-state">' +
        (filtered ? 'No items match these filters.' : 'No items yet. Use “Add item” to create one.') + '</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map((it) => {
      const status = statusOf(it);
      const name = UI.escapeHtml(it.name);
      return (
        '<tr data-id="' + UI.escapeHtml(it.id) + '">' +
        '<td data-cell="thumb">' + UI.itemThumb(it, 'thumb-sm') + '</td>' +
        '<td data-cell="item"><span class="cell-primary">' + name + '</span>' +
        (it.farm ? '<span class="cell-secondary">' + UI.escapeHtml(it.farm) + '</span>' : '') + '</td>' +
        '<td class="num" data-cell="price">' + UI.peso(it.price) + '</td>' +
        '<td class="num" data-cell="stock">' + it.stock + '</td>' +
        '<td data-cell="added" class="nowrap">' + UI.formatDate(it.dateAdded || it.date_added) + '</td>' +
        '<td data-cell="status"><span class="status status-' + status.key + '">' + status.text + '</span></td>' +
        '<td class="actions-col" data-cell="actions">' +
        '<button type="button" class="icon-btn" data-action="edit" aria-label="Edit ' + name + '" title="Edit">' + Icon('edit') + '</button>' +
        '<button type="button" class="icon-btn icon-btn-danger" data-action="delete" aria-label="Delete ' + name + '" title="Delete">' + Icon('trash') + '</button>' +
        '</td>' +
        '</tr>'
      );
    }).join('');

    tbody.querySelectorAll('tr[data-id]').forEach((row) => {
      row.querySelector('[data-action="edit"]').addEventListener('click', () => openForm(row.dataset.id));
      row.querySelector('[data-action="delete"]').addEventListener('click', () => confirmDelete(row.dataset.id));
      if (row.dataset.id === highlightId) row.classList.add('is-highlighted');
    });
    highlightId = null;
  }

  function rowFor(itemId) {
    return [...document.querySelectorAll('#inventoryTableBody tr[data-id]')].find((r) => r.dataset.id === itemId) || null;
  }

  // ---- Add / edit dialog ----
  function openForm(itemId) {
    const form = document.getElementById('itemForm');
    form.reset();
    hideFormError();
    editingId = itemId;
    pendingPhoto = undefined;

    const item = itemId ? allItems.find((it) => it.id === itemId) : null;
    document.getElementById('itemModalTitle').textContent = item ? 'Edit item' : 'Add item';
    document.getElementById('itemFormSaveBtn').textContent = item ? 'Save changes' : 'Add item';
    document.getElementById('itemName').value = item ? item.name : '';
    document.getElementById('itemFarm').value = item ? (item.farm || '') : '';
    document.getElementById('itemPrice').value = item ? item.price : '';
    document.getElementById('itemStock').value = item ? item.stock : '';
    document.getElementById('itemLowStock').value = item ? thresholdOf(item) : DEFAULT_LOW_STOCK;
    showPhoto(item && item.image ? item.image : null);

    UI.openModal('itemModal');
    document.getElementById('itemName').focus();
  }

  function showPhoto(src) {
    const preview = document.getElementById('itemPhotoPreview');
    preview.src = src || '';
    preview.classList.toggle('hidden', !src);
    document.getElementById('itemPhotoPlaceholder').classList.toggle('hidden', !!src);
    document.getElementById('itemPhotoClearBtn').classList.toggle('hidden', !src);
    if (!src) document.getElementById('itemPhotoInput').value = '';
  }

  function handlePhotoSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        pendingPhoto = canvas.toDataURL('image/jpeg', 0.82);
        showPhoto(pendingPhoto);
      };
      img.onerror = () => showFormError('That file isn’t an image we can read. Try a JPG or PNG.');
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  function showFormError(message) {
    const el = document.getElementById('itemFormError');
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function hideFormError() {
    document.getElementById('itemFormError').classList.add('hidden');
    document.querySelectorAll('#itemForm [aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  }

  async function saveForm(e) {
    e.preventDefault();
    hideFormError();

    const nameEl = document.getElementById('itemName');
    const priceEl = document.getElementById('itemPrice');
    const stockEl = document.getElementById('itemStock');
    const lowEl = document.getElementById('itemLowStock');
    const name = nameEl.value.trim();
    const price = parseFloat(priceEl.value);
    const stock = parseInt(stockEl.value, 10);
    const lowStockThreshold = parseInt(lowEl.value, 10);

    const problems = [];
    if (!name) problems.push([nameEl, 'an item name']);
    if (isNaN(price) || price < 0) problems.push([priceEl, 'a price of 0 or more']);
    if (isNaN(stock) || stock < 0) problems.push([stockEl, 'a stock count of 0 or more']);
    if (isNaN(lowStockThreshold) || lowStockThreshold < 0) problems.push([lowEl, 'a low-stock alert of 0 or more']);
    if (problems.length) {
      problems.forEach(([el]) => el.setAttribute('aria-invalid', 'true'));
      showFormError('Please enter ' + problems.map((p) => p[1]).join(', ') + '.');
      problems[0][0].focus();
      return;
    }

    const payload = { name, farm: document.getElementById('itemFarm').value.trim(), price, lowStockThreshold };
    const existing = editingId ? allItems.find((it) => it.id === editingId) : null;
    // Send stock only if it was edited, with the value the form started
    // from, so a sale made meanwhile on another device isn't undone.
    if (!existing) payload.stock = stock;
    else if (stock !== existing.stock) { payload.stock = stock; payload.expectedStock = existing.stock; }
    // Photo: only send it when it was replaced or removed.
    if (typeof pendingPhoto === 'string') payload.image = pendingPhoto;
    else if (pendingPhoto === null) payload.image = '';

    const saveBtn = document.getElementById('itemFormSaveBtn');
    const label = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      if (editingId) {
        await DB.updateItem(editingId, payload);
        highlightId = editingId;
        UI.notify('success', 'Item updated', name + ' has been saved.');
      } else {
        const added = await DB.addItem(payload);
        highlightId = added && added.id ? added.id : null;
        UI.notify('success', 'Item added', name + ' is now in inventory.');
      }
      UI.closeModal('itemModal');
      lastTableKey = '';
      render();
      if (typeof POS !== 'undefined') POS.renderItemGrid({ silent: true });
      if (typeof refreshSidebarSnapshot === 'function') refreshSidebarSnapshot();
    } catch (err) {
      showFormError('Couldn’t save the item. ' + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = label;
    }
  }

  // ---- Delete ----
  async function confirmDelete(itemId) {
    const item = allItems.find((it) => it.id === itemId);
    if (!item) return;
    const ok = await UI.confirm('“' + item.name + '” will be removed from inventory. Past sales that include it are kept.', {
      title: 'Delete item?', okText: 'Delete item', okClass: 'btn-danger',
    });
    if (!ok) return;
    try {
      await DB.deleteItem(itemId);
      UI.notify('success', 'Item deleted', item.name + ' was removed from inventory.');
      const row = rowFor(itemId);
      const hadFocus = !!row && row.contains(document.activeElement);
      const index = await UI.removeRow(row);
      lastTableKey = '';
      await render();
      if (hadFocus) UI.focusRow(document.getElementById('inventoryTableBody'), index, '[data-action="delete"]', 'inventorySearch');
      if (typeof POS !== 'undefined') POS.renderItemGrid({ silent: true });
      if (typeof refreshSidebarSnapshot === 'function') refreshSidebarSnapshot();
    } catch (err) {
      UI.notify('error', 'Couldn’t delete the item', err.message);
    }
  }

  return { init, render, setStatusFilter, resetFilters, openForm, confirmDelete };
})();
