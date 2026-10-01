/**
 * storage.mock.js
 * In-memory stand-in for storage.js, used ONLY in the standalone preview
 * artifact so the UI can be reviewed without a live backend. Implements
 * the exact same async method signatures as the real DB object.
 */
const DB = (() => {
  const delay = (v) => new Promise((resolve) => setTimeout(() => resolve(v), 120));

  let itemSeq = 12;
  let items = [
    { id: 'ITM0001', name: 'Banana Chips', farm: 'Lipa ARBO Producers', image: '', price: 60, stock: 40, lowStockThreshold: 10, dateAdded: daysAgo(40) },
    { id: 'ITM0002', name: 'Rice Chips (Ampao)', farm: 'Malvar Farmers ARBO', image: '', price: 55, stock: 8, lowStockThreshold: 10, dateAdded: daysAgo(38) },
    { id: 'ITM0003', name: 'Boiled Peanuts', farm: 'Sto. Tomas Growers ARBO', image: '', price: 45, stock: 30, lowStockThreshold: 8, dateAdded: daysAgo(35) },
    { id: 'ITM0004', name: 'Calamansi Juice Concentrate', farm: 'Rosario Citrus ARBO', image: '', price: 90, stock: 0, lowStockThreshold: 5, dateAdded: daysAgo(30) },
    { id: 'ITM0005', name: 'Batangas Kapeng Barako', farm: 'Lipa Barako Growers ARBO', image: '', price: 150, stock: 20, lowStockThreshold: 5, dateAdded: daysAgo(28) },
    { id: 'ITM0006', name: 'Pure Honey (Bottle)', farm: 'Ibaan Beekeepers ARBO', image: '', price: 180, stock: 18, lowStockThreshold: 4, dateAdded: daysAgo(25) },
    { id: 'ITM0007', name: 'Turmeric Powder (Dilaw)', farm: 'San Jose Herb Growers ARBO', image: '', price: 70, stock: 22, lowStockThreshold: 5, dateAdded: daysAgo(20) },
    { id: 'ITM0008', name: 'Spiced Vinegar', farm: 'Taal Food Processors ARBO', image: '', price: 65, stock: 28, lowStockThreshold: 6, dateAdded: daysAgo(18) },
    { id: 'ITM0009', name: 'Batangas Lambanog', farm: 'Lian Coconut Farmers ARBO', image: '', price: 220, stock: 15, lowStockThreshold: 3, dateAdded: daysAgo(15) },
    { id: 'ITM0010', name: 'Coco Jam (Minatamis)', farm: 'Lian Coconut Farmers ARBO', image: '', price: 95, stock: 20, lowStockThreshold: 5, dateAdded: daysAgo(10) },
    { id: 'ITM0011', name: 'Bagoong / Sardines Pack', farm: 'Nasugbu Fisherfolk ARBO', image: '', price: 85, stock: 24, lowStockThreshold: 6, dateAdded: daysAgo(6) },
    { id: 'ITM0012', name: 'Woven Souvenir Item', farm: 'Padre Garcia Weavers ARBO', image: '', price: 120, stock: 12, lowStockThreshold: 3, dateAdded: daysAgo(2) },
  ];

  let saleSeq = 5;
  let sales = [
    {
      id: 'SALE00001', datetime: hoursAgo(50), cashier: 'Maria', paymentMethod: 'Cash', customerName: '',
      total: 205, amountPaid: 250, change: 45, isSettled: true, settledAt: null,
      items: [
        { itemId: 'ITM0001', name: 'Banana Chips', price: 60, qty: 2, subtotal: 120 },
        { itemId: 'ITM0003', name: 'Boiled Peanuts', price: 45, qty: 1, subtotal: 45 },
        { itemId: 'ITM0002', name: 'Rice Chips (Ampao)', price: 55, qty: 1, subtotal: 55 },
      ],
    },
    {
      id: 'SALE00002', datetime: hoursAgo(30), cashier: 'Maria', paymentMethod: 'GCash', customerName: '',
      total: 150, amountPaid: 150, change: 0, isSettled: true, settledAt: null,
      items: [{ itemId: 'ITM0005', name: 'Batangas Kapeng Barako', price: 150, qty: 1, subtotal: 150 }],
    },
    {
      id: 'SALE00003', datetime: hoursAgo(20), cashier: 'Joel', paymentMethod: 'Pay Later', customerName: 'Aling Nena',
      total: 180, amountPaid: 0, change: 0, isSettled: false, settledAt: null,
      items: [{ itemId: 'ITM0006', name: 'Pure Honey (Bottle)', price: 180, qty: 1, subtotal: 180 }],
    },
    {
      id: 'SALE00004', datetime: hoursAgo(10), cashier: 'Joel', paymentMethod: 'Pay Later', customerName: 'Mang Tonyo',
      total: 220, amountPaid: 0, change: 0, isSettled: true, settledAt: hoursAgo(2), settledMethod: 'GCash',
      items: [{ itemId: 'ITM0009', name: 'Batangas Lambanog', price: 220, qty: 1, subtotal: 220 }],
    },
    {
      id: 'SALE00005', datetime: hoursAgo(1), cashier: 'Maria', paymentMethod: 'Cash', customerName: '',
      total: 95, amountPaid: 100, change: 5, isSettled: true, settledAt: null,
      items: [{ itemId: 'ITM0010', name: 'Coco Jam (Minatamis)', price: 95, qty: 1, subtotal: 95 }],
    },
  ];

  let settings = { gcash_qr: '' };
  const users = { DAR: 'TINDAHAN' };

  function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); }
  function hoursAgo(n) { const d = new Date(); d.setHours(d.getHours() - n); return d.toISOString(); }

  return {
    async getItems() { return delay(items.map((i) => ({ ...i }))); },
    async addItem(item) {
      itemSeq += 1;
      const id = 'ITM' + String(itemSeq).padStart(4, '0');
      const newItem = { id, name: item.name, farm: item.farm || '', image: item.image || '', price: Number(item.price), stock: Number(item.stock), lowStockThreshold: item.lowStockThreshold != null ? Number(item.lowStockThreshold) : 5, dateAdded: new Date().toISOString() };
      items.push(newItem);
      return delay(newItem);
    },
    async updateItem(id, patch) {
      const item = items.find((i) => i.id === id);
      if (!item) throw new Error('Item not found');
      Object.assign(item, patch);
      return delay(item);
    },
    async deleteItem(id) {
      items = items.filter((i) => i.id !== id);
      return delay({ ok: true });
    },

    async getSales(range) {
      let result = sales;
      if (range && (range.from || range.to)) {
        result = result.filter((s) => {
          const d = new Date(s.datetime);
          if (range.from && d < new Date(range.from + 'T00:00:00')) return false;
          if (range.to && d > new Date(range.to + 'T23:59:59')) return false;
          return true;
        });
      }
      return delay(result.map((s) => ({ ...s, items: s.items.map((it) => ({ ...it })) })));
    },
    async addSale(sale) {
      for (const line of sale.items) {
        const item = items.find((i) => i.id === (line.itemId || line.id));
        if (!item) throw new Error('An item in the sale was deleted from inventory. Remove it and try again.');
        if (item.stock < line.qty) throw new Error('Only ' + item.stock + ' ' + item.name + ' left in stock. Update the sale and try again.');
      }
      saleSeq += 1;
      const id = 'SALE' + String(saleSeq).padStart(5, '0');
      const newSale = { id, datetime: new Date().toISOString(), settledAt: null, ...sale };
      sales.push(newSale);
      sale.items.forEach((line) => {
        const item = items.find((i) => i.id === (line.itemId || line.id));
        if (item) item.stock = Math.max(0, item.stock - line.qty);
      });
      return delay(newSale);
    },
    async settleSale(id, paymentMethod) {
      const sale = sales.find((s) => s.id === id);
      if (!sale) throw new Error('Sale not found');
      sale.isSettled = true;
      sale.settledAt = new Date().toISOString();
      sale.settledMethod = paymentMethod === 'GCash' ? 'GCash' : 'Cash';
      return delay(sale);
    },
    async unsettleSale(id) {
      const sale = sales.find((s) => s.id === id);
      if (!sale) throw new Error('Sale not found');
      sale.isSettled = false;
      sale.settledAt = null;
      sale.settledMethod = null;
      return delay(sale);
    },
    async deleteSale(id) {
      const sale = sales.find((s) => s.id === id);
      if (!sale) throw new Error('Sale not found. It may already have been deleted.');
      let restoredQty = 0;
      sale.items.forEach((line) => {
        const item = items.find((i) => i.id === (line.itemId || line.id));
        if (item) { item.stock += Number(line.qty) || 0; restoredQty += Number(line.qty) || 0; }
      });
      sales = sales.filter((s) => s.id !== id);
      return delay({ ok: true, id, restoredQty });
    },
    async deleteAllSales() {
      sales = [];
      saleSeq = 0;
      return delay({ ok: true });
    },

    async logout() { return delay({ ok: true }); },
    async changePassword(current, next) {
      if (users.DAR !== current) throw new Error('Your current password is incorrect.');
      users.DAR = next;
      return delay({ ok: true });
    },

    async getSetting(key) { return delay(settings[key] || ''); },
    async setSetting(key, value) { settings[key] = value; return delay({ ok: true }); },

    async login(username, password) {
      if (users[username] && users[username] === password) return delay({ ok: true, username, token: 'preview' });
      const err = new Error('Invalid username or password.');
      throw err;
    },
  };
})();
