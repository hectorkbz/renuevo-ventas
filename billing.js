export const DEFAULT_MESSAGE_SETTINGS = {
  id: 'whatsapp',
  greeting: '¡Hola, {nombre}! 👋🏼',
  introduction: 'Muchísimas gracias por apoyarnos en la vendimia a beneficio del Encuentro Renuevo. 🙏🏼',
  bankDetails: '📲 04121541371\n🏦 Banco de Venezuela\n🆔 V-21023200',
  paymentInstructions: 'Cuando realices el pago, por favor envíanos el comprobante por este medio para registrar tu abono.',
  farewell: '¡Gracias por tu generosidad! Dios te bendiga. Un abrazo. ✨'
};

const totalOf = sale => sale.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
const usd = value => `$${Number(value).toFixed(2)} USD`;

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
  return { sales: pendingSales, items: [...grouped.values()], original, paid, pending: Math.max(0, original - paid) };
}

export function buildCollectionMessage(customer, summary, customSettings = {}) {
  const settings = { ...DEFAULT_MESSAGE_SETTINGS, ...customSettings };
  const productLines = summary.items.map(item => `• ${item.quantity} × ${item.name} (${usd(item.price)} c/u): ${usd(item.quantity * item.price)}`).join('\n');
  const totals = summary.paid > 0
    ? `💵 Total original: ${usd(summary.original)}\n✅ Abonado: ${usd(summary.paid)}\n💰 Total pendiente: ${usd(summary.pending)} (tasa BCV)`
    : `💰 Total pendiente: ${usd(summary.pending)} (tasa BCV)`;
  return `${settings.greeting.replaceAll('{nombre}', customer.name)}\n\n${settings.introduction}\n\nTe compartimos el detalle de tus compras pendientes:\n\n🧾 Detalle de compra:\n${productLines}\n\n${totals}\n\nPuedes realizar tu pago mediante Pago Móvil a los siguientes datos:\n\n${settings.bankDetails}\n\n${settings.paymentInstructions}\n\n${settings.farewell}`;
}

export function summarizeCollectionByDate(customerId, sales, saleId = null) {
  const entries = sales
    .filter(sale => sale.customerId === customerId && (saleId === null || sale.id === saleId))
    .map(sale => {
      const total = totalOf(sale);
      const paid = Math.min(total, Math.max(0, Number(sale.paidAmount) || 0));
      const pending = Math.max(0, total - paid);
      const items = sale.items.map(item => ({ ...item, pendingQuantity: Math.max(0, item.quantity - (Number(item.paidQuantity) || 0)) })).filter(item => item.pendingQuantity > 0);
      return { saleId: sale.id, date: sale.date, total, paid, pending, items };
    })
    .filter(entry => entry.pending > 0.005)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { entries, pending: entries.reduce((sum, entry) => sum + entry.pending, 0) };
}

export function buildDetailedCollectionMessage(customer, summary, customSettings = {}) {
  const settings = { ...DEFAULT_MESSAGE_SETTINGS, ...customSettings };
  const dates = summary.entries.map(entry => {
    const label = new Intl.DateTimeFormat('es-VE', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${entry.date}T12:00:00`));
    const products = entry.items.length
      ? entry.items.map(item => `• ${item.pendingQuantity} × ${item.name} (${usd(item.price)} c/u)`).join('\n')
      : '• Saldo pendiente después de abonos registrados';
    const paidLine = entry.paid > 0 ? `\n✅ Ya abonado: ${usd(entry.paid)}` : '';
    return `📅 ${label}\n${products}${paidLine}\n💰 Saldo de esta fecha: ${usd(entry.pending)}`;
  }).join('\n\n');
  return `${settings.greeting.replaceAll('{nombre}', customer.name)}\n\n${settings.introduction}\n\nTe compartimos el detalle de tus compras pendientes:\n\n${dates}\n\n💰 Total acumulado por cobrar: ${usd(summary.pending)} (tasa BCV)\n\nLos abonos registrados ya están descontados de los saldos indicados.\n\nPuedes realizar tu pago mediante Pago Móvil a los siguientes datos:\n\n${settings.bankDetails}\n\n${settings.paymentInstructions}\n\n${settings.farewell}`;
}

export function whatsappPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 11) return `58${digits.slice(1)}`;
  return digits;
}
