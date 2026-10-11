import assert from 'node:assert/strict';
import { addCartItem, addMonetaryPayment, appendPurchaseToSale, applySubsequentPayment, changeItemPaidQuantity, correctPaidAmount, findCustomerByName, findCustomerMatches, isSameCustomerDate, mergeDailySales, migrateSaleRecord, normalizeText, resolvePaidAmount, saleTotal, summarizeSales } from '../sales.js';

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

const halfPaidTen = migrateSaleRecord({ id: 5, customerId: 2, date: '2026-10-11', paidAmount: 5, items: [{ name: 'Compra', price: 10, quantity: 1, paidQuantity: 0 }] });
const fullyPaidTen = addMonetaryPayment(halfPaidTen, 5, '2026-10-11T10:00:00Z', 'full');
assert.deepEqual(summarizeSales([fullyPaidTen]), { total: 10, paid: 10, pending: 0 }, 'pago total debe cobrar solo los $5 restantes');
assert.throws(() => addMonetaryPayment(fullyPaidTen, 1), 'una venta pagada no admite otro cobro');
const partiallyPaidTen = addMonetaryPayment(halfPaidTen, 2, '2026-10-11T10:05:00Z', 'partial');
assert.deepEqual(summarizeSales([partiallyPaidTen]), { total: 10, paid: 7, pending: 3 }, 'pago parcial de $2 debe dejar $3 pendientes');

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
daniela = addMonetaryPayment(daniela, 3, '2026-10-11T12:20:00Z');
assert.deepEqual(summarizeSales([daniela]), { total: 6, paid: 5, pending: 1 }, 'un abono posterior de $3 debe dejar $1');
assert.deepEqual(daniela.items.map(item => item.paidQuantity), [1, 0, 0], 'el abono monetario no debe marcar automáticamente productos completos');
assert.equal(daniela.monetaryPaidAmount, 3);
const danielaPaid = addMonetaryPayment(daniela, 1, '2026-10-11T12:30:00Z', 'full');
assert.deepEqual(summarizeSales([danielaPaid]), { total: 6, paid: 6, pending: 0 }, 'cobrar el saldo restante debe pagar la venta');
assert.throws(() => addMonetaryPayment(danielaPaid, 1), 'no debe permitir cobrar dos veces una venta pagada');
assert.throws(() => changeItemPaidQuantity(daniela, 1, 1, '2026-10-11T12:25:00Z', true), /abonos existentes/, 'debe explicar el conflicto entre unidades y abonos');
const danielaCorrected = changeItemPaidQuantity(daniela, 0, 0, '2026-10-11T12:26:00Z', true);
assert.equal(danielaCorrected.monetaryPaidAmount, 3, 'corregir unidades no debe eliminar el abono monetario');
assert.deepEqual(summarizeSales([danielaCorrected]), { total: 6, paid: 3, pending: 3 });

const paidSeven = migrateSaleRecord({ id: 30, customerId: 7, date: '2026-10-11', paidAmount: 7, items: [{ name: 'Producto', price: 7, quantity: 1 }] });
const correctedSeven = changeItemPaidQuantity(paidSeven, 0, 0, '2026-10-11T14:00:00Z', true);
assert.deepEqual(summarizeSales([correctedSeven]), { total: 7, paid: 0, pending: 7 }, 'una venta de $7 debe poder corregirse completamente a pendiente');
assert.equal(correctedSeven.paymentCorrections.length, 1, 'la corrección de unidades debe quedar auditada');
assert.equal(correctedSeven.payments.length, paidSeven.payments.length, 'corregir no debe eliminar el pago histórico');
const correctedUp = changeItemPaidQuantity(correctedSeven, 0, 1, '2026-10-11T14:05:00Z', true);
assert.equal(correctedUp.paidAmount, 7, 'la corrección también debe permitir aumentar unidades pagadas');
assert.equal(correctedUp.paymentCorrections.length, 2);
assert.equal(correctedUp.payments.length, paidSeven.payments.length, 'aumentar mediante corrección no debe crear un pago duplicado');
let maltas = migrateSaleRecord({ id: 31, customerId: 7, date: '2026-10-11', paidAmount: 3, items: [{ name: 'Malta', price: 1, quantity: 3 }] });
maltas = changeItemPaidQuantity(maltas, 0, 1, '2026-10-11T15:00:00Z', true);
assert.deepEqual(summarizeSales([maltas]), { total: 3, paid: 1, pending: 2 });
maltas = changeItemPaidQuantity(maltas, 0, 0, '2026-10-11T15:01:00Z', true);
assert.deepEqual(summarizeSales([maltas]), { total: 3, paid: 0, pending: 3 });
maltas = changeItemPaidQuantity(maltas, 0, 3, '2026-10-11T15:02:00Z', true);
assert.deepEqual(summarizeSales([maltas]), { total: 3, paid: 3, pending: 0 }, 'la cantidad final debe poder volver de 0 a 3 sin sumar unidades');

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
const fiftyCustomers = Array.from({ length: 50 }, (_, index) => ({ id: index + 10, name: `Cliente ${index + 1}` }));
fiftyCustomers.push({ id: 100, name: 'Daniela Pérez', phone: '04120000000' }, { id: 101, name: 'Ana Daniela' }, { id: 102, name: 'Danilo' }, { id: 103, name: 'Jordan' });
assert.deepEqual(findCustomerMatches(fiftyCustomers, ''), [], 'enfocar el campo vacío no debe mostrar la lista completa');
assert.deepEqual(findCustomerMatches(fiftyCustomers, 'dán').map(customer => customer.name), ['Daniela Pérez', 'Danilo', 'Ana Daniela'], 'debe devolver como máximo tres coincidencias relevantes');
console.log('Pruebas de venta rápida completadas correctamente.');
