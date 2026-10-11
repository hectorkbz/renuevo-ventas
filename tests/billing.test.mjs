import assert from 'node:assert/strict';
import { buildCollectionMessage, buildDetailedCollectionMessage, summarizeCollectionByDate, summarizePendingSales, whatsappPhone, whatsappUrl } from '../billing.js';

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

const unitOnlySummary = summarizePendingSales(7, [
  { customerId: 7, paidAmount: 5, monetaryPaidAmount: 0, items: [{ name: 'Malta', price: 5, quantity: 2, paidQuantity: 1 }] }
]);
assert.equal(unitOnlySummary.monetaryPaid, 0);
assert.doesNotMatch(buildCollectionMessage({ name: 'Daniela' }, unitOnlySummary), /Abonado:/, 'el pago por unidades no se presenta como abono monetario');

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
assert.match(detailedMessage, /2 × Malta \(1 pendiente\)/);
assert.match(detailedMessage, /1 × Tequeños/);
assert.match(detailedMessage, /Total pendiente: \$12\.00 BCV/);
assert.match(detailedMessage, /Banco de Venezuela/);
assert.doesNotMatch(detailedMessage, /Otro/);
assert.deepEqual(datedSales, datedSalesBefore, 'generar la cobranza no debe modificar saldos');

const mixedPaymentSales = [
  { id: 30, customerId: 7, date: '2026-10-04', paidAmount: 5, monetaryPaidAmount: 0, items: [{ name: 'Malta', price: 5, quantity: 2, paidQuantity: 1 }] },
  { id: 31, customerId: 7, date: '2026-10-11', paidAmount: 3, monetaryPaidAmount: 3, items: [{ name: 'Tequeños', price: 7, quantity: 1, paidQuantity: 0 }] }
];
const mixedSummary = summarizeCollectionByDate(7, mixedPaymentSales);
assert.equal(mixedSummary.pending, 9, 'el saldo debe coincidir con los importes registrados');
assert.equal(mixedSummary.entries[0].unitPaid, 5);
assert.equal(mixedSummary.entries[0].monetaryPaid, 0);
assert.equal(mixedSummary.entries[1].monetaryPaid, 3);
const mixedMessage = buildDetailedCollectionMessage({ name: 'Daniela' }, mixedSummary);
assert.match(mixedMessage, /Total de venta: \$10\.00/);
assert.match(mixedMessage, /Pagado por productos: \$5\.00/);
assert.match(mixedMessage, /Abonado: \$3\.00/);
assert.match(mixedMessage, /Saldo pendiente de esta fecha: \$5\.00[\s\S]*Saldo pendiente de esta fecha: \$4\.00/);
assert.equal((mixedMessage.match(/Abonado:/g) || []).length, 1, 'solo la fecha con abono monetario muestra esa línea');
assert.doesNotMatch(mixedMessage, /Abonado: \$0\.00/, 'no debe mostrar abonos en cero');

const urlMessage = '¡Hola, Daniela! 💚\n📋 Cuenta: $12.00 🙌';
const encodedUrl = whatsappUrl(urlMessage, '0412-123.4567');
const encodedText = new URL(encodedUrl).searchParams.get('text');
assert.equal(encodedText, urlMessage, 'el enlace debe decodificar al texto original sin doble codificación');
assert.match(encodedUrl, /wa\.me\/584121234567\?/);
assert.doesNotMatch(urlMessage, /�/, 'el mensaje Unicode no debe contener caracteres de reemplazo');
assert.match(urlMessage, /💚|📋|🙌/, 'los emojis deben conservarse en el mensaje');

const oldTemplate = buildDetailedCollectionMessage({ name: 'María' }, oneSale, {
  greeting: '¡Hola, {nombre}! 👋🏼',
  introduction: 'Muchísimas gracias por apoyarnos en la vendimia a beneficio del Encuentro Renuevo. 🙏🏼',
  paymentInstructions: 'Cuando realices el pago, por favor envíanos el comprobante por este medio para registrar tu abono.',
  farewell: '¡Gracias por tu generosidad! Dios te bendiga. Un abrazo. ✨',
  bankDetails: '📱 04121541371\n🏦 Banco de Venezuela\n🪪 V-21023200'
});
assert.match(oldTemplate, /Gracias por apoyar nuestro Encuentro Renuevo\. 💚/, 'actualiza los valores predeterminados antiguos guardados localmente');
assert.match(oldTemplate, /📱 04121541371/, 'conserva los datos bancarios configurados');

assert.equal(whatsappPhone('0412-123.4567'), '584121234567');
assert.equal(whatsappPhone('+58 412 1234567'), '584121234567');
assert.equal(whatsappPhone(''), '');
console.log('Pruebas de cobranza completadas correctamente.');
