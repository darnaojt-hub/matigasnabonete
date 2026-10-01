/**
 * main.js
 * App bootstrap: tab switching, clock, cashier name, mobile sidebar,
 * the "At a glance" sidebar counts, and the live cross-device sync.
 * Data is only loaded after a successful login (see App.onLogin).
 */
const LIVE_SYNC_INTERVAL_MS = 6000;
const DEFAULT_LOW_STOCK = 5;
const TAB_TITLES = { pos: 'Shop', inventory: 'Inventory', reports: 'Sales reports' };

let liveSyncTimer = null;

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === 'tab-' + tabName);
  });

  const titleEl = document.getElementById('topbarTitle');
  if (titleEl) titleEl.textContent = TAB_TITLES[tabName] || 'TinDARhan';

  // The top-bar search filters the Shop's product grid only.
  const topSearch = document.querySelector('.topbar-search');
  if (topSearch) topSearch.classList.toggle('hidden', tabName !== 'pos');
  POS.updateCartBar();

  closeSidebar();
  window.scrollTo(0, 0);

  if (tabName === 'pos') POS.renderItemGrid();
  else if (tabName === 'inventory') Inventory.render();
  else if (tabName === 'reports') Reports.render();
}

function getActiveTab() {
  const active = document.querySelector('.tab-btn.active');
  return active ? active.dataset.tab : 'pos';
}

function startClock() {
  const el = document.getElementById('liveClock');
  if (!el) return;
  const tick = () => {
    el.textContent = new Date().toLocaleString('en-PH', {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  };
  tick();
  setInterval(tick, 15000);
}

function initCashierName() {
  const KEY = 'tindarhan_cashier';
  const input = document.getElementById('cashierName');
  if (!input) return;
  try { input.value = localStorage.getItem(KEY) || ''; } catch (e) { /* storage unavailable */ }
  input.addEventListener('change', () => {
    try { localStorage.setItem(KEY, input.value.trim()); } catch (e) { /* storage unavailable */ }
  });
}

// ---- Mobile sidebar drawer ----
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarScrim').classList.add('visible');
  document.getElementById('sidebarToggleBtn').setAttribute('aria-expanded', 'true');
  const current = document.querySelector('.nav-item.active');
  if (current) current.focus();
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || !sidebar.classList.contains('open')) return;
  sidebar.classList.remove('open');
  document.getElementById('sidebarScrim').classList.remove('visible');
  const toggle = document.getElementById('sidebarToggleBtn');
  toggle.setAttribute('aria-expanded', 'false');
  if (sidebar.contains(document.activeElement)) toggle.focus();
}

function initSidebar() {
  document.getElementById('sidebarToggleBtn').addEventListener('click', () => {
    if (document.getElementById('sidebar').classList.contains('open')) closeSidebar(); else openSidebar();
  });
  document.getElementById('sidebarCloseBtn').addEventListener('click', closeSidebar);
  document.getElementById('sidebarScrim').addEventListener('click', closeSidebar);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSidebar(); });

  document.getElementById('glanceRestockBtn').addEventListener('click', () => {
    switchTab('inventory');
    Inventory.setStatusFilter('restock');
  });
  document.getElementById('glancePendingBtn').addEventListener('click', () => switchTab('reports'));
}

// ---- "At a glance" counts + bell menu ----
async function refreshSidebarSnapshot() {
  let items = null;
  let sales = null;
  try { items = await DB.getItems(); } catch (e) { /* try again next tick */ }
  try { sales = await DB.getSales(); } catch (e) { /* try again next tick */ }

  const lowStockEl = document.getElementById('snapshotLowStock');
  const pendingEl = document.getElementById('snapshotPending');
  if (items && lowStockEl) {
    lowStockEl.textContent = String(items.filter((it) => {
      const threshold = it.lowStockThreshold != null ? it.lowStockThreshold : DEFAULT_LOW_STOCK;
      return it.stock <= threshold;
    }).length);
  }
  if (sales && pendingEl) {
    pendingEl.textContent = UI.peso(sales
      .filter((s) => s.paymentMethod === 'Pay Later' && !s.isSettled)
      .reduce((sum, s) => sum + (Number(s.total) || 0), 0));
  }
  if (items && sales) Notify.updateCenter(items, sales);
}

function startLiveSync() {
  if (liveSyncTimer) clearInterval(liveSyncTimer);
  liveSyncTimer = setInterval(() => {
    if (document.hidden || !Auth.isAuthenticated()) return;
    const tab = getActiveTab();
    if (tab === 'pos') POS.renderItemGrid({ silent: true });
    else if (tab === 'inventory') Inventory.render();
    else if (tab === 'reports') Reports.render();
    refreshSidebarSnapshot();
  }, LIVE_SYNC_INTERVAL_MS);
}

function stopLiveSync() {
  if (liveSyncTimer) clearInterval(liveSyncTimer);
  liveSyncTimer = null;
}

window.App = {
  onLogin() {
    switchTab('pos');
    GCash.loadQr();
    refreshSidebarSnapshot();
    startLiveSync();
  },
  onLogout() {
    stopLiveSync();
  },
};

document.addEventListener('DOMContentLoaded', () => {
  Icons.hydrate(document);
  Theme.init();
  Notify.init();
  Receipt.init();
  POS.init();
  Inventory.init();
  Reports.init();
  GCash.init();
  initSidebar();
  initCashierName();
  startClock();

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  Auth.init(); // shows the login screen, or the app (and calls App.onLogin) if already logged in
});
