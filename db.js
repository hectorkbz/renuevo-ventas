const DB_NAME = 'renuevo-ventas';
const DB_VERSION = 2;
const STORES = ['products', 'customers', 'sales', 'settings'];

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = event => {
      const db = request.result;
      if (!db.objectStoreNames.contains('products')) db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('customers')) db.createObjectStore('customers', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sales')) {
        const sales = db.createObjectStore('sales', { keyPath: 'id', autoIncrement: true });
        sales.createIndex('date', 'date');
        sales.createIndex('customerId', 'customerId');
      }
      if (event.oldVersion > 0 && event.oldVersion < 2) {
        const products = request.transaction.objectStore('products');
        products.openCursor().onsuccess = cursorEvent => {
          const cursor = cursorEvent.target.result;
          if (!cursor) return;
          if (typeof cursor.value.active !== 'boolean') cursor.update({ ...cursor.value, active: true });
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll(storeName) {
  const db = await openDatabase();
  return requestResult(db.transaction(storeName).objectStore(storeName).getAll());
}

export async function put(storeName, value) {
  const db = await openDatabase();
  return requestResult(db.transaction(storeName, 'readwrite').objectStore(storeName).put(value));
}

export async function remove(storeName, id) {
  const db = await openDatabase();
  return requestResult(db.transaction(storeName, 'readwrite').objectStore(storeName).delete(id));
}

export async function count(storeName) {
  const db = await openDatabase();
  return requestResult(db.transaction(storeName).objectStore(storeName).count());
}

export async function saveSale(sale) {
  const db = await openDatabase();
  return requestResult(db.transaction('sales', 'readwrite').objectStore('sales').add(sale));
}

export async function deleteSale(saleId) {
  const db = await openDatabase();
  return requestResult(db.transaction('sales', 'readwrite').objectStore('sales').delete(saleId));
}

export async function replaceAll(data) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, 'readwrite');
    for (const storeName of STORES) {
      const store = tx.objectStore(storeName);
      store.clear();
      for (const value of data[storeName] || []) store.put(value);
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function exportAll() {
  const [products, customers, sales, settings] = await Promise.all(STORES.map(getAll));
  return { version: 2, exportedAt: new Date().toISOString(), products, customers, sales, settings };
}
