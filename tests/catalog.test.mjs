import assert from 'node:assert/strict';
import { PRODUCT_CATALOG, reconcileProductCatalog } from '../catalog.js';

const oldProducts = [
  { id: 8, name: 'Sopa', price: 4 },
  { id: 2, name: 'Cafe', price: 99, stock: 12 },
  { id: 6, name: 'Café', price: 7 },
  { id: 3, name: 'Agua saborizada', price: 10 },
  { id: 9, name: 'Producto ficticio', price: 1 }
];
const snapshot = structuredClone(oldProducts);
const result = reconcileProductCatalog(oldProducts);

assert.equal(result.length, 9);
assert.deepEqual(result.map(({ name, price }) => ({ name, price })), PRODUCT_CATALOG);
assert.deepEqual(result.map(product => product.name), [...result].map(product => product.name).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })));
assert.equal(result.find(product => product.name === 'Café').id, 2, 'debe conservar una sola coincidencia existente');
assert.equal(result.find(product => product.name === 'Café').price, 0.5);
assert.equal(result.find(product => product.name === 'Café').stock, 12, 'los datos heredados pueden conservarse sin mostrarse');
assert.ok(!result.some(product => product.name === 'Sopa'));
assert.ok(!result.some(product => product.name === 'Producto ficticio'));
assert.equal(new Set(result.map(product => product.name)).size, 9);
assert.deepEqual(oldProducts, snapshot, 'la reconciliación no debe mutar la entrada');
console.log('Pruebas del catálogo completadas correctamente.');
