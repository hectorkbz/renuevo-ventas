import assert from 'node:assert/strict';
import { buildCollectionMessage, buildDetailedCollectionMessage, summarizeCollectionByDate, summarizePendingSales, whatsappPhone } from '../billing.js';

const sales = [
  { customerId: 7, paidAmount: 5, items: [{ productId: 1, name: 'Café', price: 3, quantity: 2 }] },
  { customerId: 7, paidAmount: 0, items: [{ productId: 1, name: 'Café', price: 4, quantity: 2 }, { productId: 2, name: 'Pan', price: 2, quantity: 1 }] },
  { customerId: 7, paidAmount: 0, items: [{ productId: 1, name: 'Producto histórico', price: 3, quantity: 1 }] },
  { customerId: 7, paidAmount: 5, items: [{ productId: 3, name: 'Agua', price: 5, quantity: 1 }] },
  { customerId: 8, paidAmount: 0, items: [{ productId: 1, name: 'Café', price: 3, quantity: 9 }] }
];

const summary = summarizePendingSales(7, sales);
assert.equal(summary.sales.length, 3, 'debe excluir ventas pagadas y compras de otros clientes');
assert.equal(summary.items.length, 4, 'no debe mezclar nombres o precios históricos distintos');
assert.equal(summary.original, 19);
assert.equal(summary.paid, 5);
assert.equal(summary.pending, 14);

const message = buildCollectionMessage({ name: 'María' }, summary);
assert.match(message, /¡Hola, María!/);
assert.match(message, /Total original: \$19\.00 USD/);
assert.match(message, /Abonado: \$5\.00 USD/);
assert.match(message, /Total pendiente: \$14\.00 USD \(tasa BCV\)/);
assert.doesNotMatch(message, /bolívares|Bs\./i, 'no debe inventar una conversión a bolívares');

const datedSales = [
  { id: 20, customerId: 7, date: '2026-10-04', paidAmount: 5, items: [{ name: 'Malta', price: 5, quantity: 2, paidQuantity: 1 }] },
  { id: 21, customerId: 7, date: '2026-10-11', paidAmount: 0, items: [{ name: 'Tequeños', price: 7, quantity: 1, paidQuantity: 0 }] },
  { id: 22, customerId: 8, date: '2026-10-11', paidAmount: 0, items: [{ name: 'Otro', price: 20, quantity: 1 }] }
];
const datedSalesBefore = structuredClone(datedSales);
const oneSale = summarizeCollectionByDate(7, datedSales, 20);
const allDebt = summarizeCollectionByDate(7, datedSales);
assert.equal(oneSale.pending, 5, 'la cobranza individual debe incluir solo $5');
assert.equal(allDebt.pending, 12, 'la cobranza acumulada debe sumar $5 y $7');
assert.equal(allDebt.entries.length, 2, 'debe conservar separadas las fechas');
const detailedMessage = buildDetailedCollectionMessage({ name: 'Daniela' }, allDebt);
assert.match(detailedMessage, /Daniela/);
assert.match(detailedMessage, /1 × Malta/);
assert.match(detailedMessage, /1 × Tequeños/);
assert.match(detailedMessage, /Total acumulado por cobrar: \$12\.00 USD/);
assert.match(detailedMessage, /Banco de Venezuela/);
assert.doesNotMatch(detailedMessage, /Otro/);
assert.deepEqual(datedSales, datedSalesBefore, 'generar la cobranza no debe modificar saldos');

assert.equal(whatsappPhone('0412-123.4567'), '584121234567');
assert.equal(whatsappPhone('+58 412 1234567'), '584121234567');
assert.equal(whatsappPhone(''), '');
console.log('Pruebas de cobranza completadas correctamente.');
