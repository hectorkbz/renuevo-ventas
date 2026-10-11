export function saleTotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function resolvePaidAmount(mode, total, partialAmount = 0) {
  if (mode === 'paid') return total;
  if (mode === 'pending') return 0;
  const amount = Number(partialAmount);
  if (!(amount > 0) || amount >= total) throw new Error('El abono debe ser mayor que $0 y menor que el total.');
  return amount;
}

const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

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

export function addCartItem(cart, product, quantity) {
  const next = cart.map(item => ({ ...item }));
  const existing = next.find(item => item.productId === product.id && item.price === product.price);
  if (existing) existing.quantity += quantity;
  else next.push({ productId: product.id, name: product.name, price: product.price, quantity });
  return next;
}

export function findCustomerByName(customers, name) {
  const normalized = String(name || '').trim().toLocaleLowerCase('es');
  return customers.find(customer => customer.name.trim().toLocaleLowerCase('es') === normalized) || null;
}
