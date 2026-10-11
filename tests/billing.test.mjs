import assert from 'node:assert/strict';
import { buildCollectionMessage, summarizePendingSales, whatsappPhone } from '../billing.js';

const sales = [
  { customerId: 7, paidAmount: 5, items: [{ productId: 1, name: 'Café', price: 3, quantity: 2 }] },
  { customerId: 7, paidAmount: 0, items: [{ productId: 1, name: 'Café', price: 4, quantity: 2 }, { productId: 2, name: 'Pan', price: 2, quantity: 1 }] },
  { customerId: 7, paidAmount: 5, items: [{ productId: 3, name: 'Agua', price: 5, quantity: 1 }] },
  { customerId: 8, paidAmount: 0, items: [{ productId: 1, name: 'Café', price: 3, quantity: 9 }] }
];

const summary = summarizePendingSales(7, sales);
assert.equal(summary.sales.length, 2, 'debe excluir ventas pagadas y compras de otros clientes');
assert.equal(summary.items.length, 3, 'el mismo producto con precios distintos no debe mezclarse');
assert.equal(summary.original, 16);
assert.equal(summary.paid, 5);
assert.equal(summary.pending, 11);

const message = buildCollectionMessage({ name: 'María' }, summary);
assert.match(message, /¡Hola, María!/);
assert.match(message, /Total original: \$16\.00 USD/);
assert.match(message, /Abonado: \$5\.00 USD/);
assert.match(message, /Total pendiente: \$11\.00 USD \(tasa BCV\)/);
assert.doesNotMatch(message, /bolívares|Bs\./i, 'no debe inventar una conversión a bolívares');

assert.equal(whatsappPhone('0412-123.4567'), '584121234567');
assert.equal(whatsappPhone('+58 412 1234567'), '584121234567');
assert.equal(whatsappPhone(''), '');
console.log('Pruebas de cobranza completadas correctamente.');
