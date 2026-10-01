/**
 * storage.js
 * API client for the Express/PostgreSQL backend. Every call sends the
 * session token from auth.js; a 401 on a signed-in request sends the user
 * back to the login screen.
 */
const DB = (() => {
  const inflight = new Map(); // path -> promise, so simultaneous GETs share one request

  function request(method, path, body) {
    if (method !== 'GET') return send(method, path, body);
    if (!inflight.has(path)) inflight.set(path, send(method, path).finally(() => inflight.delete(path)));
    return inflight.get(path);
  }

  async function send(method, path, body) {
    const headers = {};
    const token = typeof Auth !== 'undefined' ? Auth.getToken() : null;
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw new Error('Can’t reach the server. Check the internet connection.');
    }

    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }

    if (res.status === 401 && path !== '/api/login' && typeof Auth !== 'undefined') Auth.handleUnauthorized();
    if (!res.ok) throw new Error((data && data.error) || ('Request failed (' + res.status + ').'));
    return data;
  }

  const enc = encodeURIComponent;

  return {
    // Items
    getItems: () => request('GET', '/api/items'),
    addItem: (item) => request('POST', '/api/items', item),
    updateItem: (id, item) => request('PUT', '/api/items/' + enc(id), item),
    deleteItem: (id) => request('DELETE', '/api/items/' + enc(id)),

    // Sales
    getSales: () => request('GET', '/api/sales'),
    addSale: (sale) => request('POST', '/api/sales', sale),
    settleSale: (id, paymentMethod) => request('POST', '/api/sales/' + enc(id) + '/settle', { paymentMethod: paymentMethod || 'Cash' }),
    unsettleSale: (id) => request('POST', '/api/sales/' + enc(id) + '/unsettle', {}),
    deleteSale: (id) => request('DELETE', '/api/sales/' + enc(id)),
    deleteAllSales: () => request('DELETE', '/api/sales', { confirm: 'DELETE' }),

    // Settings
    getSetting: async (key) => {
      const data = await request('GET', '/api/settings/' + enc(key));
      return data ? data.value : null;
    },
    setSetting: (key, value) => request('PUT', '/api/settings/' + enc(key), { value }),

    // Auth
    login: (username, password) => request('POST', '/api/login', { username, password }),
    logout: () => request('POST', '/api/logout', {}),
    changePassword: (currentPassword, newPassword) => request('POST', '/api/password', { currentPassword, newPassword }),
  };
})();
