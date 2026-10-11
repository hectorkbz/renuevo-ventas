import assert from 'node:assert/strict';
import { addCartItem, allocateNewPaymentToUnits, appendPurchaseToSale, applySubsequentPayment, changeItemPaidQuantity, correctPaidAmount, findCustomerByName, isSameCustomerDate, mergeDailySales, migrateSaleRecord, normalizeText, resolvePaidAmount, saleTotal, summarizeSales } from '../sales.js';

const coffee = { id: 1, name: 'Café', price: 3 };
const bread = { id: 2, name: 'Pan', price: 2.5 };
let cart = addCartItem([], coffee, 2);
cart = addCartItem(cart, bread, 1);
cart = addCartItem(cart, coffee, 1);

assert.equal(cart.length, 2, 'debe permitir varios productos y agrupar productos repetidos');
assert.equal(cart[0].quantity, 3);
assert.equal(saleTotal(cart), 11.5);

assert.equal(resolvePaidAmount('paid', 11.5), 11.5, 'venta pagada');
assert.equal(resolvePaidAmount('pending', 11.5), 0, 'venta pendiente');
assert.equal(resolvePaidAmount('partial', 11.5, 4), 4, 'venta con abono');
assert.throws(() => resolvePaidAmount('partial', 11.5, 11.5));
assert.throws(() => resolvePaidAmount('partial', 11.5, 0));

let laterPayment = applySubsequentPayment(7, 0, 3);
assert.deepEqual(laterPayment, { paidAmount: 3, remaining: 4 }, 'un pago parcial de $3 sobre $7 debe dejar $4');
laterPayment = applySubsequentPayment(7, laterPayment.paidAmount, 4);
assert.deepEqual(laterPayment, { paidAmount: 7, remaining: 0 }, 'el pago completo posterior debe saldar los $4');
assert.throws(() => applySubsequentPayment(7, 3, 0));
assert.throws(() => applySubsequentPayment(7, 3, 4.01));

const sameCustomerSales = [
  { paidAmount: 5, items: [{ price: 5, quantity: 1 }] },
  { paidAmount: 0, items: [{ price: 7, quantity: 1 }] }
];
assert.deepEqual(summarizeSales(sameCustomerSales), { total: 12, paid: 5, pending: 7 }, 'debe agrupar totales sin mezclar saldos de ventas');
sameCustomerSales[1].paidAmount = applySubsequentPayment(7, 0, 3).paidAmount;
assert.deepEqual(summarizeSales(sameCustomerSales), { total: 12, paid: 8, pending: 4 }, 'el abono debe aplicarse solo a la venta pendiente');
assert.deepEqual(correctPaidAmount(5, 0), { paidAmount: 0, remaining: 5 }, 'debe permitir convertir una venta pagada en pendiente');
assert.deepEqual(correctPaidAmount(7, 2), { paidAmount: 2, remaining: 5 }, 'debe corregir una venta parcialmente pagada');
assert.throws(() => correctPaidAmount(7, ''));
assert.throws(() => correctPaidAmount(7, -1));
assert.throws(() => correctPaidAmount(7, 8));

const historical = migrateSaleRecord({ id: 10, customerId: 2, date: '2026-10-11', paidAmount: 2, items: [{ name: 'Uno', price: 2, quantity: 1 }, { name: 'Dos', price: 2, quantity: 2 }] });
assert.deepEqual(historical.items.map(item => item.paidQuantity), [1, 0], 'la migración debe conservar $2 y asignarlos sin cambiar precios');
const accumulated = appendPurchaseToSale(historical, { createdAt: '2026-10-11T12:20:00Z', paidAmount: 0, items: [{ name: 'Tres', price: 3, quantity: 1 }] });
assert.equal(accumulated.items.length, 3, 'debe añadir productos a la venta del mismo día');
assert.equal(accumulated.paidAmount, 2, 'añadir productos pendientes no debe duplicar cobros');
assert.equal(accumulated.purchaseMovements.length, 2, 'debe conservar los momentos de compra');

let daniela = migrateSaleRecord({ id: 20, customerId: 7, date: '2026-10-11', paidAmount: 0, items: [{ name: 'A', price: 2, quantity: 1 }, { name: 'B', price: 2, quantity: 1 }, { name: 'C', price: 2, quantity: 1 }] });
daniela = changeItemPaidQuantity(daniela, 0, 1, '2026-10-11T12:10:00Z');
assert.deepEqual(summarizeSales([daniela]), { total: 6, paid: 2, pending: 4 }, 'pagar un producto de $2 debe dejar $4');
const secondPayment = applySubsequentPayment(6, daniela.paidAmount, 3);
daniela.items = allocateNewPaymentToUnits(daniela.items, 3);
daniela.paidAmount = secondPayment.paidAmount;
assert.deepEqual(summarizeSales([daniela]), { total: 6, paid: 5, pending: 1 }, 'un abono posterior de $3 debe dejar $1');
assert.deepEqual(daniela.items.map(item => item.paidQuantity), [1, 1, 0], 'el dólar restante debe permanecer como abono sin marcar otro producto completo');

const grouped = mergeDailySales([
  { id: 1, customerId: 7, date: '2026-10-11', paidAmount: 2, items: [{ name: 'A', price: 2, quantity: 1 }] },
  { id: 2, customerId: 7, date: '2026-10-11', paidAmount: 0, items: [{ name: 'B', price: 2, quantity: 1 }] }
], { customerId: 7, date: '2026-10-11', createdAt: '2026-10-11T13:00:00Z', paidAmount: 0, items: [{ name: 'C', price: 2, quantity: 1 }] });
assert.equal(grouped.sale.id, 1);
assert.deepEqual(grouped.removedIds, [2]);
assert.equal(grouped.sale.mergedOperations.length, 1, 'debe conservar una copia de la operación agrupada');
assert.equal(isSameCustomerDate({ customerId: 7, date: '2026-10-11' }, 7, '2026-10-11'), true);
assert.equal(isSameCustomerDate({ customerId: 7, date: '2026-10-12' }, 7, '2026-10-11'), false, 'no debe acumular compras de fechas diferentes');

const customers = [{ id: 1, name: 'Venta general' }, { id: 2, name: 'María Pérez' }];
assert.equal(findCustomerByName(customers, '  maría PÉREZ ').id, 2, 'debe evitar duplicados por mayúsculas o espacios');
assert.equal(findCustomerByName(customers, 'maria   perez').id, 2, 'debe ignorar tildes y espacios adicionales');
assert.equal(normalizeText('  María   PÉREZ '), 'maria perez');
assert.equal(findCustomerByName(customers, 'Cliente nuevo'), null);
console.log('Pruebas de venta rápida completadas correctamente.');
