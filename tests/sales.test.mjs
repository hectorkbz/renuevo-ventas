import assert from 'node:assert/strict';
import { addCartItem, applySubsequentPayment, correctPaidAmount, findCustomerByName, resolvePaidAmount, saleTotal, summarizeSales } from '../sales.js';

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

const customers = [{ id: 1, name: 'Venta general' }, { id: 2, name: 'María Pérez' }];
assert.equal(findCustomerByName(customers, '  maría PÉREZ ').id, 2, 'debe evitar duplicados por mayúsculas o espacios');
assert.equal(findCustomerByName(customers, 'Cliente nuevo'), null);
console.log('Pruebas de venta rápida completadas correctamente.');
