/**
 * gcash.js
 * Manages the shop's GCash QR code: uploading/replacing it (stored as a
 * base64 data URL in the settings table), and showing it at checkout
 * whenever GCash is the selected payment method.
 */
const GCash = (() => {
  const SETTING_KEY = 'gcash_qr';
  const MAX_DIMENSION = 600;
  let currentQr = null;
  let pendingQr = null;

  async function loadQr() {
    try {
      currentQr = await DB.getSetting(SETTING_KEY);
    } catch (e) {
      currentQr = null;
    }
    renderManageModal();
    updatePaymentQrVisibility();
  }

  function hasQr() {
    return !!currentQr;
  }

  function updatePaymentQrVisibility() {
    const methodSelect = document.getElementById('paymentMethod');
    const box = document.getElementById('gcashQrBox');
    if (!methodSelect || !box) return;
    const isGcash = methodSelect.value === 'GCash';
    if (isGcash && currentQr) {
      box.classList.remove('hidden');
      const img = document.getElementById('gcashQrImage');
      if (img) img.src = currentQr;
    } else {
      box.classList.add('hidden');
    }
  }

  function renderManageModal() {
    const preview = document.getElementById('gcashManagePreview');
    const emptyState = document.getElementById('gcashManageEmpty');
    if (!preview || !emptyState) return;
    const showSrc = pendingQr || currentQr;
    if (showSrc) {
      preview.src = showSrc;
      preview.classList.remove('hidden');
      emptyState.classList.add('hidden');
    } else {
      preview.classList.add('hidden');
      emptyState.classList.remove('hidden');
    }
    const removeBtn = document.getElementById('gcashRemoveBtn');
    if (removeBtn) removeBtn.classList.toggle('hidden', !showSrc);
  }

  function openManageModal() {
    pendingQr = null;
    renderManageModal();
    UI.openModal('gcashQrModal');
  }

  function closeManageModal() {
    pendingQr = null;
    UI.closeModal('gcashQrModal');
  }

  function handleFileSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          const scale = MAX_DIMENSION / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        pendingQr = canvas.toDataURL('image/png');
        renderManageModal();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  function removePending() {
    pendingQr = null;
    currentQr = null;
    renderManageModal();
  }

  async function save() {
    const saveBtn = document.getElementById('gcashSaveBtn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
    try {
      const value = pendingQr !== null ? pendingQr : (currentQr || '');
      await DB.setSetting(SETTING_KEY, value);
      currentQr = value || null;
      pendingQr = null;
      updatePaymentQrVisibility();
      UI.notify('success', 'GCash QR code saved', 'Customers will see it when they pay by GCash.');
      closeManageModal();
    } catch (err) {
      UI.notify('error', "Couldn't save the QR code", err.message);
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    }
  }

  function init() {
    const openBtn = document.getElementById('gcashQrBtn');
    if (openBtn) openBtn.addEventListener('click', openManageModal);
    const closeBtn = document.getElementById('gcashQrModalClose');
    if (closeBtn) closeBtn.addEventListener('click', closeManageModal);
    const fileInput = document.getElementById('gcashFileInput');
    if (fileInput) fileInput.addEventListener('change', handleFileSelect);
    const removeBtn = document.getElementById('gcashRemoveBtn');
    if (removeBtn) removeBtn.addEventListener('click', removePending);
    const saveBtn = document.getElementById('gcashSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', save);
    const methodSelect = document.getElementById('paymentMethod');
    if (methodSelect) methodSelect.addEventListener('change', updatePaymentQrVisibility);
    // The QR is loaded after login (App.onLogin), since the API needs a session.
  }

  return { init, loadQr, hasQr, updatePaymentQrVisibility, openManageModal };
})();
