export const DEFAULT_MESSAGE_SETTINGS = {
  id: 'whatsapp',
  greeting: '¡Hola, {nombre}!',
  introduction: 'Gracias por apoyar nuestro Encuentro Renuevo.',
  bankDetails: '04121541371\nBanco de Venezuela\nV-21023200',
  paymentInstructions: 'Envíanos tu comprobante de pago',
  farewell: 'gracias una vez más, con tu aporte haremos de Renuevo 2026 una gran experiencia ¡Dios te bendiga!'
};

const totalOf = sale => sale.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
const usd = value => `$${Number(value).toFixed(2)}`;
const plainText = value => String(value ?? '')
  .normalize('NFC')
  .replace(/[\uFE0E\uFE0F\u200D\uFFFD]/g, '')
  .replace(/\p{Extended_Pictographic}/gu, '')
  .replace(/[^\p{L}\p{M}\p{N}\s.,'’()/-]/gu, '')
  .replace(/[\t ]+/g, ' ')
  .trim();

function monetaryPaymentsOf(sale) {
  if (Object.hasOwn(sale, 'monetaryPaidAmount')) return Math.max(0, Number(sale.monetaryPaidAmount) || 0);
  const unitPaid = sale.items.reduce((sum, item) => sum + (Number(item.paidQuantity) || 0) * Number(item.price || 0), 0);
  return Math.max(0, Number(sale.paidAmount || 0) - unitPaid);
}

export function whatsappUrl(message, phone = '') {
  const recipient = whatsappPhone(phone);
  const safeMessage = String(message)
    .normalize('NFC')
    .replace(/[\uFE0E\uFE0F\u200D\uFFFD]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[^\p{L}\p{M}\p{N}\s.,'’()/$!¡¿:-]/gu, '');
  const encodedMessage = encodeURIComponent(safeMessage);
  return recipient
    ? `https://wa.me/${recipient}?text=${encodedMessage}`
    : `https://wa.me/?text=${encodedMessage}`;
}

export function summarizePendingSales(customerId, sales) {
  const pendingSales = sales.filter(sale => sale.customerId === customerId && totalOf(sale) - sale.paidAmount > 0.005);
  const grouped = new Map();
  for (const sale of pendingSales) {
    for (const item of sale.items) {
      const key = `${item.productId ?? ''}|${item.name}|${item.price}`;
      const current = grouped.get(key) || { name: item.name, price: item.price, quantity: 0 };
      current.quantity += item.quantity;
      grouped.set(key, current);
    }
  }
  const original = pendingSales.reduce((sum, sale) => sum + totalOf(sale), 0);
  const paid = pendingSales.reduce((sum, sale) => sum + Math.min(sale.paidAmount, totalOf(sale)), 0);
  const monetaryPaid = pendingSales.reduce((sum, sale) => sum + Math.min(Number(sale.paidAmount) || 0, monetaryPaymentsOf(sale)), 0);
  return { sales: pendingSales, items: [...grouped.values()], original, paid, monetaryPaid, pending: Math.max(0, original - paid) };
}

export function buildCollectionMessage(customer, summary, customSettings = {}) {
  const customerId = customer.id ?? summary.sales?.[0]?.customerId;
  return buildDetailedCollectionMessage(customer, summarizeCollectionByDate(customerId, summary.sales || []), customSettings);
}

export function summarizeCollectionByDate(customerId, sales, saleId = null) {
  const saleEntries = sales
    .filter(sale => sale.customerId === customerId && (saleId === null || sale.id === saleId))
    .map(sale => {
      const total = totalOf(sale);
      const paid = Math.min(total, Math.max(0, Number(sale.paidAmount) || 0));
      const pending = Math.max(0, total - paid);
      const items = sale.items.map(item => ({ ...item, pendingQuantity: Math.max(0, item.quantity - (Number(item.paidQuantity) || 0)) })).filter(item => item.pendingQuantity > 0);
      const monetaryPaid = Math.min(paid, monetaryPaymentsOf(sale));
      const unitPaid = Math.min(paid, sale.items.reduce((sum, item) => sum + (Number(item.paidQuantity) || 0) * Number(item.price || 0), 0));
      return { saleId: sale.id, date: sale.date, total, paid, monetaryPaid, unitPaid, pending, items, allItems: sale.items.map(item => ({ ...item })) };
    })
    .filter(entry => entry.pending > 0.005)
    .sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map();
  for (const entry of saleEntries) {
    const dateEntry = byDate.get(entry.date) || { ...entry, saleId: null, total: 0, paid: 0, monetaryPaid: 0, unitPaid: 0, pending: 0, items: [], allItems: [] };
    dateEntry.total += entry.total;
    dateEntry.paid += entry.paid;
    dateEntry.monetaryPaid += entry.monetaryPaid;
    dateEntry.unitPaid += entry.unitPaid;
    dateEntry.pending += entry.pending;
    for (const item of entry.items) {
      const existing = dateEntry.items.find(value => value.productId === item.productId && value.name === item.name);
      if (existing) existing.pendingQuantity += item.pendingQuantity;
      else dateEntry.items.push({ ...item });
    }
    byDate.set(entry.date, dateEntry);
  }
  const entries = [...byDate.values()].map(entry => ({
    ...entry,
    total: Math.round((entry.total + Number.EPSILON) * 100) / 100,
    paid: Math.round((entry.paid + Number.EPSILON) * 100) / 100,
    monetaryPaid: Math.round((entry.monetaryPaid + Number.EPSILON) * 100) / 100,
    unitPaid: Math.round((entry.unitPaid + Number.EPSILON) * 100) / 100,
    pending: Math.round((entry.pending + Number.EPSILON) * 100) / 100
  }));
  return { entries, pending: entries.reduce((sum, entry) => sum + entry.pending, 0) };
}

export function buildDetailedCollectionMessage(customer, summary, customSettings = {}) {
  const settings = { ...DEFAULT_MESSAGE_SETTINGS, ...customSettings };
  const dates = summary.entries.map(entry => {
    const label = plainText(new Intl.DateTimeFormat('es-VE', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${entry.date}T12:00:00`)));
    const products = entry.items.map(item => `- ${item.pendingQuantity} ${plainText(item.name)}`).join('\n');
    // Product-unit payments and monetary abonos remain separate in the ledger.
    const paidLine = entry.monetaryPaid > 0 ? `\nAbonado: ${usd(entry.monetaryPaid)} USD` : '';
    return `Tu compra del ${label}:\n${products}${paidLine}`;
  }).join('\n\n');
  const bankDetails = String(settings.bankDetails || DEFAULT_MESSAGE_SETTINGS.bankDetails)
    .split(/\r?\n/).map(plainText).filter(Boolean).join('\n');
  return `¡Hola, ${plainText(customer.name)}! Gracias por apoyar nuestro Encuentro Renuevo.\n\n${dates}\n\nTOTAL PENDIENTE: ${usd(summary.pending)} BCV\n\nPago Móvil\n${bankDetails}\n\nEnvíanos tu comprobante de pago, gracias una vez más, con tu aporte haremos de Renuevo 2026 una gran experiencia ¡Dios te bendiga!`;
}

export function whatsappPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 11) return `58${digits.slice(1)}`;
  return digits;
}
