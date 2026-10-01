/**
 * theme.js
 * Light (default) and dark themes. The choice is remembered per device;
 * index.html applies it before first paint.
 */
const Theme = (() => {
  const KEY = 'tindarhan_theme';

  function apply(mode) {
    document.documentElement.setAttribute('data-theme', mode === 'light' ? 'light' : 'dark');
  }

  function init() {
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) { /* storage unavailable */ }
    apply(saved || 'light');
    updateIcon();

    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.addEventListener('click', toggle);
  }

  function isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function toggle() {
    const next = isDark() ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (e) { /* not remembered, still applied */ }
    apply(next);
    updateIcon();
  }

  function updateIcon() {
    const iconEl = document.getElementById('themeToggleIcon');
    const labelEl = document.getElementById('themeToggleLabel');
    const btn = document.getElementById('themeToggleBtn');
    const dark = isDark();
    if (iconEl) iconEl.innerHTML = dark ? Icons.sun : Icons.moon;
    if (labelEl) labelEl.textContent = dark ? 'Light mode' : 'Dark mode';
    if (btn) {
      const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
    }
  }

  return { init, isDark, toggle, updateIcon };
})();
