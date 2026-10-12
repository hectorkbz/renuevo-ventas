import { PRODUCT_CATALOG, reconcileProductCatalog } from './catalog.js';
import { isSameCustomerDate, mergeDailySales, migrateSaleRecord } from './sales.js';
import { planSaleDateCorrection, withCorrectedSaleDate } from './dates.js';

const DB_NAME = 'renuevo-ventas';
const DB_VERSION = 5;
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
      if (event.oldVersion < 3) {
        const products = request.transaction.objectStore('products');
        products.getAll().onsuccess = productsEvent => {
          const reconciled = reconcileProductCatalog(productsEvent.target.result);
          products.clear();
          for (const product of reconciled) products.put(product);
        };
      }
      if (event.oldVersion < 5) {
        const sales = request.transaction.objectStore('sales');
        sales.getAll().onsuccess = salesEvent => {
          for (const sale of salesEvent.target.result) sales.put(migrateSaleRecord(sale));
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

export async function saveOrAppendSale(purchase) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sales', 'readwrite');
    const store = tx.objectStore('sales');
    const request = store.index('customerId').getAll(purchase.customerId);
    let result;
    request.onsuccess = () => {
      const matches = request.result.filter(sale => isSameCustomerDate(sale, purchase.customerId, purchase.date));
      if (!matches.length) {
        const add = store.add(migrateSaleRecord(purchase));
        add.onsuccess = () => { result = { id: add.result, accumulated: false, grouped: 0 }; };
        return;
      }
      const merged = mergeDailySales(matches, purchase);
      store.put(merged.sale);
      for (const id of merged.removedIds) store.delete(id);
      result = { id: merged.sale.id, accumulated: true, grouped: merged.removedIds.length };
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function consolidateCustomerSales(customerId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sales', 'readwrite');
    const store = tx.objectStore('sales');
    const request = store.index('customerId').getAll(customerId);
    let grouped = 0;
    request.onsuccess = () => {
      const byDate = new Map();
      for (const sale of request.result) byDate.set(sale.date, [...(byDate.get(sale.date) || []), sale]);
      for (const sales of byDate.values()) {
        if (sales.length < 2) continue;
        const merged = mergeDailySales(sales);
        store.put(merged.sale);
        for (const id of merged.removedIds) store.delete(id);
        grouped += merged.removedIds.length;
      }
    };
    tx.oncomplete = () => resolve(grouped);
    tx.onerror = () => reject(tx.error);
  });
}

export async function correctSalesDate(saleIds, sourceDate, destinationDate) {
  const db = await openDatabase();
  const ids = [...new Set(saleIds.map(Number))];
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sales', 'readwrite');
    const store = tx.objectStore('sales');
    const request = store.getAll();
    let result = { updated: 0, conflicts: [{ type: 'not-completed' }] };
    request.onsuccess = () => {
      const plan = planSaleDateCorrection(request.result, ids, sourceDate, destinationDate);
      if (!plan.canApply) {
        result = { updated: 0, conflicts: plan.conflicts, missingIds: plan.missingIds };
        return;
      }
      const updatedSales = withCorrectedSaleDate(plan.selected, destinationDate);
      for (const sale of updatedSales) store.put(sale);
      result = { updated: updatedSales.length, conflicts: [], missingIds: [] };
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('No se pudo corregir la fecha de las ventas.'));
  });
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
      const values = storeName === 'products' ? reconcileProductCatalog(data.products) : storeName === 'sales' ? (data.sales || []).map(migrateSaleRecord) : (data[storeName] || []);
      for (const value of values) store.put(value);
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function exportAll() {
  const [products, customers, sales, settings] = await Promise.all(STORES.map(getAll));
  return { version: 5, exportedAt: new Date().toISOString(), products, customers, sales, settings };
}
