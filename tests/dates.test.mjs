import assert from 'node:assert/strict';
import {
  caracasLongDate,
  caracasShortDate,
  caracasToday,
  clearSelectedSaleDate,
  planSaleDateCorrection,
  readSavedSaleDate,
  saveSelectedSaleDate,
  shouldRefreshDefaultSaleDate,
  withCorrectedSaleDate
} from '../dates.js';
import { summarizeSales } from '../sales.js';

assert.equal(caracasToday(new Date('2026-10-12T01:40:00Z')), '2026-10-11', 'a las 21:40 en Caracas debe seguir siendo 11 de octubre');
assert.equal(caracasShortDate('2026-10-11'), '11 oct.', 'la pantalla de venta debe mostrar 11 oct.');
assert.match(caracasLongDate('2026-10-11'), /11.*2026/, 'el historial debe conservar la fecha calendario');
assert.equal(caracasToday(new Date('2026-10-12T04:00:00Z')), '2026-10-12', 'al llegar la medianoche de Caracas cambia al día 12');
assert.equal(shouldRefreshDefaultSaleDate('2026-10-11', '2026-10-12', false, false), true, 'actualiza la fecha automática al cambiar de día');
assert.equal(shouldRefreshDefaultSaleDate('2026-10-11', '2026-10-12', true, false), false, 'no reemplaza una fecha elegida manualmente');
assert.equal(shouldRefreshDefaultSaleDate('2026-10-11', '2026-10-12', false, true), false, 'no cambia la fecha con una venta en curso');

const savedValues = new Map();
const storage = {
  getItem: key => savedValues.get(key) ?? null,
  setItem: (key, value) => savedValues.set(key, value),
  removeItem: key => savedValues.delete(key)
};
assert.equal(readSavedSaleDate(storage), null, 'sin selección manual usa la fecha actual');
saveSelectedSaleDate(storage, '2026-10-24');
assert.equal(readSavedSaleDate(storage), '2026-10-24', 'conserva el 24/10/2026 al reabrir');
for (let sale = 0; sale < 10; sale += 1) {
  assert.equal(readSavedSaleDate(storage), '2026-10-24', 'varias ventas mantienen la fecha elegida');
  assert.equal(shouldRefreshDefaultSaleDate('2026-10-24', '2026-10-27', true, false), false);
}
clearSelectedSaleDate(storage);
assert.equal(readSavedSaleDate(storage), null, 'Hoy quita la selección persistida');
assert.equal(caracasToday(new Date('2026-10-27T02:00:00Z')), '2026-10-26', 'Hoy respeta la fecha de Venezuela');
savedValues.set('renuevo-ventas:selected-sale-date', '2026-02-31');
assert.equal(readSavedSaleDate(storage), null, 'una fecha guardada inválida no se usa');

const sourceSale = {
  id: 1,
  customerId: 10,
  date: '2026-10-12',
  paidAmount: 3,
  monetaryPaidAmount: 1,
  items: [{ name: 'Café', price: 2, quantity: 2, paidQuantity: 1 }],
  payments: [{ amount: 3, at: '2026-10-12T13:40:00Z', kind: 'partial' }],
  paymentCorrections: [{ at: '2026-10-12T13:45:00Z', previousAmount: 0, newAmount: 3 }],
  purchaseMovements: [{ at: '2026-10-12T13:40:00Z', items: [{ name: 'Café', price: 2, quantity: 2 }] }],
  phone: '+58 412 0000000'
};
const safeSale = { id: 2, customerId: 20, date: '2026-10-12', paidAmount: 0, items: [{ name: 'Malta', price: 1, quantity: 2, paidQuantity: 0 }] };
const targetSale = { id: 3, customerId: 10, date: '2026-10-11', paidAmount: 1, items: [{ name: 'Agua', price: 1, quantity: 1, paidQuantity: 1 }] };
const otherDateSale = { id: 4, customerId: 30, date: '2026-10-10', paidAmount: 0, items: [{ name: 'Pan', price: 1, quantity: 1, paidQuantity: 0 }] };
const sales = [sourceSale, safeSale, targetSale, otherDateSale];
const before = structuredClone(sales);

const blockedPlan = planSaleDateCorrection(sales, [1, 2], '2026-10-12', '2026-10-11');
assert.equal(blockedPlan.canApply, false, 'conflicto para el mismo cliente debe detener la operación seleccionada');
assert.ok(blockedPlan.conflicts.some(conflict => conflict.type === 'destination-exists' && conflict.customerId === 10));

const safePlan = planSaleDateCorrection(sales, [2], '2026-10-12', '2026-10-11');
assert.equal(safePlan.canApply, true, 'puede corregirse una venta sin conflicto');
const corrected = withCorrectedSaleDate(safePlan.selected, '2026-10-11');
assert.equal(corrected[0].date, '2026-10-11');
assert.deepEqual({ ...corrected[0], date: safeSale.date }, safeSale, 'solo cambia la fecha superior de la venta');
assert.deepEqual(sales, before, 'el plan y la transformación no mutan los datos originales');

const correctionPlan = planSaleDateCorrection(sales, [1], '2026-10-12', '2026-10-09');
const correctedSource = withCorrectedSaleDate(correctionPlan.selected, '2026-10-09')[0];
assert.deepEqual(summarizeSales([correctedSource]), summarizeSales([sourceSale]), 'totales, pagos y saldos permanecen exactamente iguales');
assert.deepEqual(correctedSource.payments, sourceSale.payments, 'no cambia la fecha ni el historial independiente de pagos');
assert.deepEqual(correctedSource.paymentCorrections, sourceSale.paymentCorrections);
assert.deepEqual(correctedSource.purchaseMovements, sourceSale.purchaseMovements);

const duplicateMovePlan = planSaleDateCorrection([
  { id: 5, customerId: 40, date: '2026-10-12' },
  { id: 6, customerId: 40, date: '2026-10-12' }
], [5, 6], '2026-10-12', '2026-10-11');
assert.equal(duplicateMovePlan.canApply, false, 'no crea duplicados al mover varias ventas del mismo cliente al mismo día');
assert.ok(duplicateMovePlan.conflicts.some(conflict => conflict.type === 'duplicate-after-move'));

console.log('Pruebas de fechas y corrección segura completadas correctamente.');

