export const DEFAULT_MESSAGE_SETTINGS = {
  id: 'whatsapp',
  greeting: '¡Hola, {nombre}!',
  introduction: 'Gracias por apoyar nuestro Encuentro Renuevo. 💚',
  bankDetails: '📱 04121541371\n🏦 Banco de Venezuela\n🪪 V-21023200',
  paymentInstructions: 'Envíanos tu comprobante al pagar.',
  farewell: '¡Dios te bendiga! 🙌'
};

const totalOf = sale => sale.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
const usd = value => `$${Number(value).toFixed(2)}`;
const usdWithCurrency = value => `${usd(value)} USD`;

function monetaryPaymentsOf(sale) {
  if (Object.hasOwn(sale, 'monetaryPaidAmount')) return Math.max(0, Number(sale.monetaryPaidAmount) || 0);
  const unitPaid = sale.items.reduce((sum, item) => sum + (Number(item.paidQuantity) || 0) * Number(item.price || 0), 0);
  return Math.max(0, Number(sale.paidAmount || 0) - unitPaid);
}

export function whatsappUrl(message, phone = '') {
  const recipient = whatsappPhone(phone);
  const encodedMessage = encodeURIComponent(String(message));
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
  return { sales: pendingSales, items: [...grouped.values()], original, paid, pending: Math.max(0, original - paid) };
}

export function buildCollectionMessage(customer, summary, customSettings = {}) {
  const settings = { ...DEFAULT_MESSAGE_SETTINGS, ...customSettings };
  const productLines = summary.items.map(item => `• ${item.quantity} × ${item.name} (${usdWithCurrency(item.price)} c/u): ${usdWithCurrency(item.quantity * item.price)}`).join('\n');
  const totals = summary.paid > 0
    ? `💵 Total original: ${usdWithCurrency(summary.original)}\n✅ Abonado: ${usdWithCurrency(summary.paid)}\n💰 Total pendiente: ${usdWithCurrency(summary.pending)} (tasa BCV)`
    : `💰 Total pendiente: ${usdWithCurrency(summary.pending)} (tasa BCV)`;
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
      const monetaryPaid = Math.min(paid, monetaryPaymentsOf(sale));
      const unitPaid = Math.min(paid, sale.items.reduce((sum, item) => sum + (Number(item.paidQuantity) || 0) * Number(item.price || 0), 0));
      return { saleId: sale.id, date: sale.date, total, paid, monetaryPaid, unitPaid, pending, items, allItems: sale.items.map(item => ({ ...item })) };
    })
    .filter(entry => entry.pending > 0.005)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { entries, pending: entries.reduce((sum, entry) => sum + entry.pending, 0) };
}

export function buildDetailedCollectionMessage(customer, summary, customSettings = {}) {
  const settings = { ...DEFAULT_MESSAGE_SETTINGS, ...customSettings };
  const previousDefaults = {
    greeting: '¡Hola, {nombre}! 👋🏼',
    introduction: 'Muchísimas gracias por apoyarnos en la vendimia a beneficio del Encuentro Renuevo. 🙏🏼',
    bankDetails: '📲 04121541371\n🏦 Banco de Venezuela\n🆔 V-21023200',
    paymentInstructions: 'Cuando realices el pago, por favor envíanos el comprobante por este medio para registrar tu abono.',
    farewell: '¡Gracias por tu generosidad! Dios te bendiga. Un abrazo. ✨'
  };
  for (const [field, previous] of Object.entries(previousDefaults)) {
    // Existing installations may have the old defaults stored in IndexedDB.
    // Upgrade only those defaults, retaining any text the user customized.
    if (customSettings[field] === previous) settings[field] = DEFAULT_MESSAGE_SETTINGS[field];
  }
  const dates = summary.entries.map(entry => {
    const label = new Intl.DateTimeFormat('es-VE', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${entry.date}T12:00:00`));
    const products = entry.allItems.length
      ? entry.allItems.map(item => {
          const pendingQuantity = Math.max(0, item.quantity - (Number(item.paidQuantity) || 0));
          const pendingLabel = pendingQuantity > 0 && pendingQuantity < item.quantity ? ` (${pendingQuantity} pendiente${pendingQuantity === 1 ? '' : 's'})` : '';
          return `• ${item.quantity} × ${item.name}${pendingLabel}`;
        }).join('\n')
      : '• Saldo pendiente de la compra';
    // Product-level payments and monetary abonos are distinct in the ledger.
    const unitLine = entry.unitPaid > 0 ? `\nPagado por productos: ${usd(entry.unitPaid)}` : '';
    const paidLine = entry.monetaryPaid > 0 ? `\nAbonado: ${usd(entry.monetaryPaid)}` : '';
    return `📅 ${label}\n${products}\nTotal de venta: ${usd(entry.total)}${unitLine}${paidLine}\nSaldo pendiente de esta fecha: ${usd(entry.pending)}`;
  }).join('\n\n');
  return `${settings.greeting.replaceAll('{nombre}', customer.name).replaceAll('{cliente}', customer.name)}\n\n${settings.introduction}\n\n📋 Tu cuenta pendiente:\n${dates}\n\n💰 Total pendiente: ${usd(summary.pending)} BCV\n\nPago Móvil:\n${settings.bankDetails}\n\n${settings.paymentInstructions}\n${settings.farewell}`;
}

export function whatsappPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 11) return `58${digits.slice(1)}`;
  return digits;
}
