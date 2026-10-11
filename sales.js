export function saleTotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
}

export function isSameCustomerDate(sale, customerId, date) {
  return sale.customerId === customerId && sale.date === date;
}

export function resolvePaidAmount(mode, total, partialAmount = 0) {
  if (mode === 'paid') return total;
  if (mode === 'pending') return 0;
  const amount = Number(partialAmount);
  if (!(amount > 0) || amount >= total) throw new Error('El abono debe ser mayor que $0 y menor que el total.');
  return amount;
}

export const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function paidByUnits(items) {
  return roundMoney(items.reduce((sum, item) => sum + (Number(item.paidQuantity) || 0) * item.price, 0));
}

export function summarizeSales(sales) {
  return sales.reduce((summary, sale) => {
    const total = roundMoney(saleTotal(sale.items));
    const paid = Math.min(total, Math.max(0, roundMoney(sale.paidAmount || 0)));
    summary.total = roundMoney(summary.total + total);
    summary.paid = roundMoney(summary.paid + paid);
    summary.pending = roundMoney(summary.pending + Math.max(0, total - paid));
    return summary;
  }, { total: 0, paid: 0, pending: 0 });
}

export function applySubsequentPayment(total, alreadyPaid, paymentAmount) {
  const saleAmount = roundMoney(total);
  const paidBefore = Math.max(0, roundMoney(alreadyPaid));
  const remainingBefore = Math.max(0, roundMoney(saleAmount - paidBefore));
  const payment = roundMoney(paymentAmount);
  if (!(payment > 0) || payment > remainingBefore) {
    throw new Error('El pago debe ser mayor que $0 y no superar el saldo pendiente.');
  }
  const paidAmount = roundMoney(paidBefore + payment);
  return { paidAmount, remaining: Math.max(0, roundMoney(saleAmount - paidAmount)) };
}

export function correctPaidAmount(total, newAmount) {
  const saleAmount = roundMoney(total);
  if (String(newAmount).trim() === '') throw new Error('Escribe el nuevo total recibido.');
  const paidAmount = roundMoney(newAmount);
  if (!Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount > saleAmount) {
    throw new Error('El total recibido debe estar entre $0 y el total de la venta.');
  }
  return { paidAmount, remaining: Math.max(0, roundMoney(saleAmount - paidAmount)) };
}

export function allocatePaidUnits(items, paidAmount) {
  let available = Math.max(0, roundMoney(paidAmount));
  return items.map(item => {
    const price = roundMoney(item.price);
    const existing = Math.min(item.quantity, Math.max(0, Number(item.paidQuantity) || 0));
    let paidQuantity = existing;
    if (!('paidQuantity' in item)) {
      paidQuantity = price > 0 ? Math.min(item.quantity, Math.floor((available + 0.0001) / price)) : item.quantity;
      available = roundMoney(available - paidQuantity * price);
    } else {
      available = roundMoney(available - paidQuantity * price);
    }
    return { ...item, paidQuantity };
  });
}

export function migrateSaleRecord(sale) {
  const createdAt = sale.createdAt || new Date(`${sale.date}T12:00:00`).toISOString();
  const items = allocatePaidUnits(sale.items || [], sale.paidAmount || 0);
  const unitAmount = paidByUnits(items);
  const monetaryPaidAmount = 'monetaryPaidAmount' in sale ? roundMoney(sale.monetaryPaidAmount) : Math.max(0, roundMoney((sale.paidAmount || 0) - unitAmount));
  return {
    ...sale,
    items,
    paidAmount: roundMoney(sale.paidAmount || 0),
    monetaryPaidAmount,
    payments: sale.payments || ((sale.paidAmount || 0) > 0 ? [{ amount: roundMoney(sale.paidAmount), at: createdAt, kind: 'legacy' }] : []),
    paymentCorrections: sale.paymentCorrections || [],
    purchaseMovements: sale.purchaseMovements || [{ at: createdAt, items: (sale.items || []).map(item => ({ ...item })) }],
    mergedOperations: sale.mergedOperations || []
  };
}

export function appendPurchaseToSale(sale, purchase) {
  const current = migrateSaleRecord(sale);
  const addedItems = allocatePaidUnits(purchase.items, purchase.paidAmount);
  const paidAmount = roundMoney(current.paidAmount + purchase.paidAmount);
  const purchaseMonetary = Math.max(0, roundMoney(purchase.paidAmount - paidByUnits(addedItems)));
  return {
    ...current,
    items: [...current.items, ...addedItems],
    paidAmount,
    monetaryPaidAmount: roundMoney(current.monetaryPaidAmount + purchaseMonetary),
    payments: [...current.payments, ...(purchase.paidAmount > 0 ? [{ amount: roundMoney(purchase.paidAmount), at: purchase.createdAt, kind: 'purchase' }] : [])],
    purchaseMovements: [...current.purchaseMovements, { at: purchase.createdAt, items: purchase.items.map(item => ({ ...item })) }],
    updatedAt: purchase.createdAt
  };
}

export function mergeDailySales(sales, purchase) {
  const ordered = sales.map(migrateSaleRecord).sort((a, b) => a.id - b.id);
  let target = ordered[0];
  for (const source of ordered.slice(1)) {
    target = {
      ...target,
      items: [...target.items, ...source.items],
      paidAmount: roundMoney(target.paidAmount + source.paidAmount),
      monetaryPaidAmount: roundMoney(target.monetaryPaidAmount + source.monetaryPaidAmount),
      payments: [...target.payments, ...source.payments],
      paymentCorrections: [...target.paymentCorrections, ...source.paymentCorrections],
      purchaseMovements: [...target.purchaseMovements, ...source.purchaseMovements],
      mergedOperations: [...target.mergedOperations, ...source.mergedOperations, { ...source }]
    };
  }
  return { sale: purchase ? appendPurchaseToSale(target, purchase) : target, removedIds: ordered.slice(1).map(sale => sale.id) };
}

export function changeItemPaidQuantity(sale, itemIndex, newPaidQuantity, at = new Date().toISOString(), correction = false) {
  const current = migrateSaleRecord(sale);
  const item = current.items[itemIndex];
  const quantity = Number(newPaidQuantity);
  if (!item || !Number.isInteger(quantity) || quantity < 0 || quantity > item.quantity) throw new Error('La cantidad pagada no es válida.');
  const previousQuantity = item.paidQuantity || 0;
  if (quantity === previousQuantity) throw new Error('La cantidad pagada no cambió.');
  const items = current.items.map((value, index) => index === itemIndex ? { ...value, paidQuantity: quantity } : value);
  const difference = roundMoney((quantity - previousQuantity) * item.price);
  const nextPaid = roundMoney(paidByUnits(items) + current.monetaryPaidAmount);
  if (nextPaid > roundMoney(saleTotal(current.items))) throw new Error('Los abonos existentes no dejan saldo suficiente para marcar esas unidades. Corrige primero el importe abonado.');
  const event = { at, previousAmount: current.paidAmount, newAmount: nextPaid, itemIndex, previousQuantity, newQuantity: quantity };
  return {
    ...current,
    items,
    paidAmount: nextPaid,
    payments: difference > 0 && !correction ? [...current.payments, { amount: difference, at, kind: 'product', itemIndex, quantity: quantity - previousQuantity }] : current.payments,
    paymentCorrections: correction || difference < 0 ? [...current.paymentCorrections, event] : current.paymentCorrections,
    updatedAt: at
  };
}

export function addMonetaryPayment(sale, amount, at = new Date().toISOString(), kind = 'amount') {
  const current = migrateSaleRecord(sale);
  const result = applySubsequentPayment(saleTotal(current.items), current.paidAmount, amount);
  const payment = roundMoney(result.paidAmount - current.paidAmount);
  return {
    ...current,
    paidAmount: result.paidAmount,
    monetaryPaidAmount: roundMoney(current.monetaryPaidAmount + payment),
    payments: [...current.payments, { amount: payment, at, kind }],
    updatedAt: at
  };
}

export function capPaidUnitAllocations(items, maximumAmount) {
  let available = Math.max(0, roundMoney(maximumAmount));
  return items.map(item => {
    const current = Math.min(item.quantity, Math.max(0, Number(item.paidQuantity) || 0));
    const paidQuantity = item.price > 0 ? Math.min(current, Math.floor((available + 0.0001) / item.price)) : current;
    available = roundMoney(available - paidQuantity * item.price);
    return { ...item, paidQuantity };
  });
}

export function allocateNewPaymentToUnits(items, paymentAmount) {
  let available = Math.max(0, roundMoney(paymentAmount));
  return items.map(item => {
    const current = Math.min(item.quantity, Math.max(0, Number(item.paidQuantity) || 0));
    const pending = item.quantity - current;
    const added = item.price > 0 ? Math.min(pending, Math.floor((available + 0.0001) / item.price)) : pending;
    available = roundMoney(available - added * item.price);
    return { ...item, paidQuantity: current + added };
  });
}

export function addCartItem(cart, product, quantity) {
  const next = cart.map(item => ({ ...item }));
  const existing = next.find(item => item.productId === product.id && item.price === product.price);
  if (existing) existing.quantity += quantity;
  else next.push({ productId: product.id, name: product.name, price: product.price, quantity });
  return next;
}

export function findCustomerByName(customers, name) {
  const normalized = normalizeText(name);
  return customers.find(customer => normalizeText(customer.name) === normalized) || null;
}

export function findCustomerMatches(customers, value, limit = 3) {
  const query = normalizeText(value);
  if (!query) return [];
  const relevance = name => {
    const normalized = normalizeText(name);
    if (normalized.startsWith(query)) return 0;
    if (normalized.split(' ').some(word => word.startsWith(query))) return 1;
    return 2;
  };
  return customers
    .filter(customer => normalizeText(customer.name) !== 'venta general' && normalizeText(customer.name).includes(query))
    .sort((a, b) => relevance(a.name) - relevance(b.name) || a.name.localeCompare(b.name, 'es'))
    .slice(0, limit);
}
