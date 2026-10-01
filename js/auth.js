/**
 * auth.js
 * Login and logout. A successful login returns a session token from the
 * server; storage.js sends it with every API request. The token lives in
 * sessionStorage, so each browser tab logs in once and closing the tab
 * logs out. If the server rejects the token (expired or revoked), the
 * app returns to the login screen.
 */
const Auth = (() => {
  const TOKEN_KEY = 'tindarhan_session';

  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }

  function setToken(token) {
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* storage unavailable: stays logged in for this page load only */ }
  }

  function isAuthenticated() {
    return !!getToken();
  }

  function showApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
  }

  function showLogin(message) {
    document.getElementById('appShell').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    const errorEl = document.getElementById('loginError');
    if (message) {
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
    } else {
      errorEl.classList.add('hidden');
    }
    const userInput = document.getElementById('loginUsername');
    if (userInput) userInput.focus();
  }

  async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const passwordInput = document.getElementById('loginPassword');
    const errorEl = document.getElementById('loginError');
    const submitBtn = document.getElementById('loginSubmitBtn');

    if (!username || !passwordInput.value) {
      errorEl.textContent = 'Enter your username and password.';
      errorEl.classList.remove('hidden');
      return;
    }

    errorEl.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Logging in…';
    submitBtn.classList.add('is-loading');

    try {
      const result = await DB.login(username, passwordInput.value);
      setToken((result && result.token) || 'local');
      passwordInput.value = '';
      const cashierInput = document.getElementById('cashierName');
      if (cashierInput && !cashierInput.value) cashierInput.value = username;
      showApp();
      window.App.onLogin();
    } catch (err) {
      errorEl.textContent = err.message || 'Incorrect username or password.';
      errorEl.classList.remove('hidden');
      Motion.replay(document.getElementById('loginForm'), 'is-shaking');
      passwordInput.select();
    } finally {
      submitBtn.classList.remove('is-loading');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Log in';
    }
  }

  async function handleLogout() {
    const ok = await UI.confirm('You’ll need to log in again to use the shop.', {
      title: 'Log out?', okText: 'Log out',
    });
    if (!ok) return;
    try { await DB.logout(); } catch (e) { /* token is dropped locally either way */ }
    setToken(null);
    window.App.onLogout();
    showLogin();
  }

  // ---- Change password ----
  function openChangePassword() {
    document.getElementById('passwordForm').reset();
    document.getElementById('passwordFormError').classList.add('hidden');
    UI.openModal('passwordModal');
    document.getElementById('currentPassword').focus();
  }

  async function submitChangePassword(e) {
    e.preventDefault();
    const current = document.getElementById('currentPassword');
    const next = document.getElementById('newPassword');
    const confirmEl = document.getElementById('confirmPassword');
    const errorEl = document.getElementById('passwordFormError');
    const fail = (msg, field) => {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
      if (field) field.focus();
    };
    errorEl.classList.add('hidden');
    if (!current.value) return fail('Enter your current password.', current);
    if (next.value.length < 8) return fail('The new password must be at least 8 characters.', next);
    if (next.value !== confirmEl.value) return fail('The new passwords don’t match.', confirmEl);

    const btn = document.getElementById('passwordSaveBtn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await DB.changePassword(current.value, next.value);
      UI.closeModal('passwordModal');
      UI.notify('success', 'Password changed', 'Other devices were logged out.');
    } catch (err) {
      fail(err.message, current);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Change password';
    }
  }

  // Called by storage.js when the server answers 401 to a signed-in request.
  function handleUnauthorized() {
    if (!isAuthenticated()) return;
    setToken(null);
    window.App.onLogout();
    document.querySelectorAll('.modal-backdrop:not(.hidden):not(.is-closing)').forEach((m) => UI.closeModal(m.id));
    showLogin('Your session has ended. Please log in again.');
  }

  function init() {
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
    document.getElementById('changePasswordBtn').addEventListener('click', openChangePassword);
    document.getElementById('passwordForm').addEventListener('submit', submitChangePassword);
    document.getElementById('passwordCancelBtn').addEventListener('click', () => UI.closeModal('passwordModal'));
    document.getElementById('passwordModalClose').addEventListener('click', () => UI.closeModal('passwordModal'));
    if (isAuthenticated()) {
      showApp();
      window.App.onLogin();
    } else {
      showLogin();
    }
  }

  return { init, getToken, isAuthenticated, handleUnauthorized, showApp, showLogin };
})();
