import { count, deleteSale, exportAll, getAll, put, remove, replaceAll, saveSale } from './db.js';
import { buildCollectionMessage, DEFAULT_MESSAGE_SETTINGS, summarizePendingSales, whatsappPhone } from './billing.js';
import { PRODUCT_CATALOG } from './catalog.js';
import { addCartItem, applySubsequentPayment, correctPaidAmount, findCustomerByName, resolvePaidAmount, roundMoney, saleTotal as itemsTotal, summarizeSales } from './sales.js';

const $ = selector => document.querySelector(selector);
const state = { products: [], customers: [], sales: [], settings: {}, cart: [], paymentMode: 'paid', savingSale: false, deletingSales: new Set(), payingSales: new Set() };
const money = new Intl.NumberFormat('es-US', { style: 'currency', currency: 'USD' });
const dateLabel = value => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`));
const dateTimeLabel = value => new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const today = () => new Date().toISOString().slice(0, 10);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));

function saleStatus(total, paid) {
  if (paid >= total) return 'Pagado';
  if (paid > 0) return 'Abono parcial';
  return 'Pendiente';
}

function statusClass(status) { return `status-${status.replaceAll(' ', '-')}`; }
function customerName(id) { return state.customers.find(item => item.id === id)?.name || 'Cliente eliminado'; }
function saleTotal(sale) { return itemsTotal(sale.items); }
function cartTotal() { return itemsTotal(state.cart); }

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2400);
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadState() {
  const [products, customers, sales, settings] = await Promise.all(['products', 'customers', 'sales', 'settings'].map(getAll));
  state.products = products;
  state.customers = customers;
  state.sales = sales;
  state.settings = settings.find(item => item.id === 'whatsapp') || { ...DEFAULT_MESSAGE_SETTINGS };
  state.products.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  state.customers.sort((a, b) => a.name.localeCompare(b.name));
  state.sales.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

async function seedDefaults() {
  if (await count('products') === 0) {
    await Promise.all(PRODUCT_CATALOG.map(product => put('products', product)));
  }
  if (await count('customers') === 0) await put('customers', { name: 'Venta general', phone: '' });
  if (await count('settings') === 0) await put('settings', DEFAULT_MESSAGE_SETTINGS);
}

function navigate(view) {
  document.querySelectorAll('.view').forEach(item => item.classList.toggle('active', item.id === `view-${view}`));
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  renderAll();
}

function renderSummary() {
  const selected = $('#summaryDate').value;
  const sales = state.sales.filter(sale => sale.date === selected);
  const { total, paid, pending: debt } = summarizeSales(sales);
  $('#homeTitle').textContent = selected === today() ? 'Hoy' : dateLabel(selected);
  $('#summaryCards').innerHTML = [
    ['Vendido', money.format(total)], ['Cobrado', money.format(paid)], ['Por cobrar', money.format(debt)], ['Operaciones', sales.length]
  ].map(([label, value]) => `<div class="summary-card"><span>${label}</span><strong>${value}</strong></div>`).join('');
  $('#recentSales').innerHTML = sales.slice(0, 5).map(saleRow).join('') || '<p class="empty">Aún no hay ventas en esta fecha.</p>';
}

function saleRow(sale) {
  const total = saleTotal(sale);
  const status = saleStatus(total, sale.paidAmount);
  return `<button type="button" class="list-row sale-open text-button" data-sale-id="${sale.id}">
    <span class="item-main"><strong>${esc(customerName(sale.customerId))}</strong><span>${dateLabel(sale.date)} · ${sale.items.length} producto(s)</span></span>
    <span class="item-side"><strong>${money.format(total)}</strong><span class="status-pill ${statusClass(status)}">${status}</span></span>
  </button>`;
}

function renderSaleForm() {
  const productValue = $('#saleProduct').value;
  $('#customerSuggestions').innerHTML = state.customers.filter(item => item.name !== 'Venta general').map(item => `<option value="${esc(item.name)}"></option>`).join('');
  $('#saleProduct').innerHTML = state.products.map(item => `<option value="${item.id}">${esc(item.name)} — ${money.format(item.price)}</option>`).join('') || '<option value="">Agrega un producto en Configuración</option>';
  if (productValue) $('#saleProduct').value = productValue;
  if (!$('#saleQuantity').options.length) $('#saleQuantity').innerHTML = Array.from({ length: 20 }, (_, index) => `<option value="${index + 1}">${index + 1}</option>`).join('');
  $('#saleItems').innerHTML = state.cart.map((item, index) => `<div class="sale-item"><span class="item-main"><strong>${esc(item.name)} × ${item.quantity}</strong><span>${money.format(item.price)} c/u</span></span><span class="item-side"><strong>${money.format(item.price * item.quantity)}</strong><button type="button" class="remove-button" data-cart-index="${index}" aria-label="Quitar">×</button></span></div>`).join('') || '<p class="empty compact-empty">Agrega uno o más productos.</p>';
  updatePaymentUI();
}

function updatePaymentUI() {
  const total = cartTotal();
  $('#saleTotal').textContent = money.format(total);
  $('#saveSaleButton').textContent = total ? `Guardar venta · ${money.format(total)}` : 'Guardar venta';
  document.querySelectorAll('[data-payment]').forEach(button => button.classList.toggle('active', button.dataset.payment === state.paymentMode));
  const isPartial = state.paymentMode === 'partial';
  $('#partialPaymentFields').hidden = !isPartial;
  $('#partialPaymentButton').textContent = isPartial ? 'Cancelar abono' : 'Registrar abono';
  if (isPartial) {
    const paid = Math.max(0, Number($('#salePaid').value) || 0);
    $('#paymentStatus').className = `status-preview ${statusClass(paid > 0 ? 'Abono parcial' : 'Pendiente')}`;
    $('#paymentStatus').textContent = `Falta por cobrar ${money.format(Math.max(0, total - paid))}`;
  }
}

function renderHistory() {
  const query = $('#historySearch').value.trim().toLowerCase();
  const filter = $('#historyStatus').value;
  const rows = state.sales.filter(sale => {
    const status = saleStatus(saleTotal(sale), sale.paidAmount);
    return customerName(sale.customerId).toLowerCase().includes(query) && (!filter || status === filter);
  });
  $('#historyList').innerHTML = rows.map(saleRow).join('') || '<p class="empty">No se encontraron ventas.</p>';
}

function customerDebt(customerId) {
  return summarizeSales(state.sales.filter(sale => sale.customerId === customerId)).pending;
}

function renderCustomers() {
  $('#customerList').innerHTML = state.customers.map(customer => {
    const purchases = state.sales.filter(sale => sale.customerId === customer.id);
    const debt = customerDebt(customer.id);
    return `<button class="list-row customer-open text-button" data-customer-id="${customer.id}"><span class="item-main"><strong>${esc(customer.name)}</strong><span>${purchases.length} compra(s)${customer.phone ? ` · ${esc(customer.phone)}` : ''}</span></span><span class="item-side"><span>Debe</span><strong class="${debt ? 'has-debt' : ''}">${money.format(debt)}</strong></span></button>`;
  }).join('') || '<p class="empty">Agrega tu primer cliente.</p>';
}

function renderProducts() {
  $('#productList').innerHTML = state.products.map(product => `<div>
    <div class="list-row"><span class="item-main"><strong>${esc(product.name)}</strong><span>${money.format(product.price)}</span></span><button class="secondary-button compact-button product-edit" data-product-id="${product.id}">Editar</button></div>
  </div>`).join('') || '<p class="empty">No hay productos.</p>';
}

function renderAll() { renderSummary(); renderSaleForm(); renderHistory(); renderCustomers(); renderProducts(); }

function openModal(title, body, onSave, saveText = 'Guardar') {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = body;
  $('#modalSave').textContent = saveText;
  $('#modalForm .modal-actions .secondary-button').hidden = false;
  const modal = $('#modal');
  modal.returnValue = '';
  modal.showModal();
  modal.onclose = async () => {
    if (modal.returnValue !== 'default') return;
    try { await onSave(new FormData($('#modalForm'))); } catch (error) { toast(error.message); }
  };
}

function openCustomer(customer = {}) {
  openModal(customer.id ? 'Editar cliente' : 'Nuevo cliente', `
    <label>Nombre<input name="name" required maxlength="80" value="${esc(customer.name || '')}"></label>
    <label>Teléfono WhatsApp (opcional)<input name="phone" inputmode="tel" maxlength="30" placeholder="Ej. +58 412 1234567" value="${esc(customer.phone || '')}"></label>
    ${customer.id && customer.name !== 'Venta general' ? '<button id="deleteCustomer" type="button" class="secondary-button">Eliminar cliente</button>' : ''}
  `, async data => {
    const name = String(data.get('name')).trim();
    if (!name) throw new Error('Escribe el nombre del cliente.');
    await put('customers', { ...customer, name, phone: String(data.get('phone')).trim() });
    await refresh('Cliente guardado.');
  });
  $('#deleteCustomer')?.addEventListener('click', async () => {
    if (state.sales.some(sale => sale.customerId === customer.id)) return toast('No se puede eliminar: tiene compras registradas.');
    if (confirm(`¿Eliminar a ${customer.name}?`)) { await remove('customers', customer.id); $('#modal').close(); await refresh('Cliente eliminado.'); }
  });
}

function openProduct(product = {}) {
  openModal(product.id ? 'Editar producto' : 'Nuevo producto', `
    <label>Producto<input name="name" required maxlength="80" value="${esc(product.name || '')}"></label>
    <label>Precio USD<input name="price" type="number" min="0" step="0.01" inputmode="decimal" required value="${product.price ?? ''}"></label>
  `, async data => {
    const name = String(data.get('name')).trim();
    const price = Number(data.get('price'));
    if (!name || !Number.isFinite(price) || price < 0) throw new Error('Revisa los datos del producto.');
    await put('products', { ...product, name, price });
    await refresh('Producto guardado.');
  });
}

function openSale(sale) {
  const total = saleTotal(sale);
  const debt = Math.max(0, total - sale.paidAmount);
  const corrections = sale.paymentCorrections || [];
  const payments = sale.payments || [];
  openModal('Detalle de venta', `
    <div><strong>${esc(customerName(sale.customerId))}</strong><p class="muted">${dateLabel(sale.date)}</p></div>
    ${sale.items.map(item => `<div class="sale-item"><span>${esc(item.name)} × ${item.quantity}</span><strong>${money.format(item.price * item.quantity)}</strong></div>`).join('')}
    <div class="payment-summary" aria-label="Resumen de pago">
      <div><span>Total de la venta</span><strong>${money.format(total)}</strong></div>
      <div><span>Total pagado</span><strong>${money.format(sale.paidAmount)}</strong></div>
      <div class="payment-balance"><span>Saldo pendiente</span><strong>${money.format(debt)}</strong></div>
    </div>
    ${debt > 0.005 ? `<div class="payment-action-label">Registrar nuevo pago</div><div class="later-payment-actions">
      <button id="showPartialPayment" type="button" class="secondary-button later-payment-button">Pago parcial</button>
      <button id="payFullBalance" type="button" class="primary-action later-payment-button">Pago completo</button>
    </div>
    <div id="laterPartialFields" class="later-partial-fields" hidden>
      <label>Monto que está pagando<input id="laterPaymentAmount" type="number" min="0.01" max="${debt}" step="0.01" inputmode="decimal" placeholder="0.00"></label>
      <button id="confirmPartialPayment" type="button" class="primary-action later-payment-button">Confirmar pago parcial</button>
    </div>` : '<p class="status-preview status-Pagado">Pagado</p>'}
    <button id="showPaymentCorrection" type="button" class="discreet-button correction-toggle">Corregir pago existente</button>
    <div id="paymentCorrectionFields" class="later-partial-fields" hidden>
      <p class="correction-note">Importe recibido actual: <strong>${money.format(sale.paidAmount)}</strong></p>
      <label>Nuevo total recibido acumulado<input id="correctedPaidAmount" type="number" min="0" max="${total}" step="0.01" inputmode="decimal" value="${sale.paidAmount}"></label>
      <button id="confirmPaymentCorrection" type="button" class="secondary-button later-payment-button">Revisar y corregir</button>
    </div>
    ${payments.length ? `<details class="payment-history"><summary>Pagos registrados (${payments.length})</summary>${payments.map(payment => `<div><span>${dateTimeLabel(payment.at)}</span><strong>${money.format(payment.amount)}</strong></div>`).join('')}</details>` : ''}
    ${corrections.length ? `<details class="payment-history"><summary>Correcciones (${corrections.length})</summary>${corrections.slice().reverse().map(correction => `<div><span>${dateTimeLabel(correction.at)}</span><strong>${money.format(correction.previousAmount)} → ${money.format(correction.newAmount)}</strong></div>`).join('')}</details>` : ''}
    <button id="deleteSale" type="button" class="secondary-button">Eliminar venta</button>
  `, async () => {}, 'Cerrar');
  $('#modalForm .modal-actions .secondary-button').hidden = true;
  $('#showPartialPayment')?.addEventListener('click', () => {
    $('#laterPartialFields').hidden = false;
    $('#laterPaymentAmount').value = '';
    $('#laterPaymentAmount').focus();
  });
  $('#confirmPartialPayment')?.addEventListener('click', () => recordLaterPayment(sale.id, $('#laterPaymentAmount').value, 'Pago parcial registrado.'));
  $('#payFullBalance')?.addEventListener('click', () => recordLaterPayment(sale.id, debt, 'Pago completo registrado.'));
  $('#showPaymentCorrection').addEventListener('click', () => {
    $('#paymentCorrectionFields').hidden = false;
    $('#correctedPaidAmount').focus();
  });
  $('#confirmPaymentCorrection').addEventListener('click', () => correctSalePayment(sale.id, $('#correctedPaidAmount').value));
  $('#deleteSale').addEventListener('click', async () => {
    if (state.deletingSales.has(sale.id)) return;
    if (confirm('¿Eliminar esta venta? Esta acción no se puede deshacer.')) {
      state.deletingSales.add(sale.id);
      try { await deleteSale(sale.id); $('#modal').close(); await refresh('Venta eliminada.'); }
      finally { state.deletingSales.delete(sale.id); }
    }
  });
}

async function recordLaterPayment(saleId, amount, message) {
  if (state.payingSales.has(saleId)) return;
  const currentSale = state.sales.find(item => item.id === saleId);
  if (!currentSale) return toast('No se encontró la venta.');
  let result;
  try { result = applySubsequentPayment(saleTotal(currentSale), currentSale.paidAmount, amount); }
  catch (error) { return toast(error.message); }
  state.payingSales.add(saleId);
  document.querySelectorAll('.later-payment-button').forEach(button => { button.disabled = true; });
  try {
    const at = new Date().toISOString();
    const payment = roundMoney(result.paidAmount - Number(currentSale.paidAmount || 0));
    await put('sales', { ...currentSale, paidAmount: result.paidAmount, payments: [...(currentSale.payments || []), { amount: payment, at }], updatedAt: at });
    $('#modal').close();
    await refresh(message);
    const updatedSale = state.sales.find(item => item.id === saleId);
    if (updatedSale) openSale(updatedSale);
  } catch (error) { toast(error.message); }
  finally {
    state.payingSales.delete(saleId);
    document.querySelectorAll('.later-payment-button').forEach(button => { button.disabled = false; });
  }
}

async function correctSalePayment(saleId, amount) {
  if (state.payingSales.has(saleId)) return;
  const currentSale = state.sales.find(item => item.id === saleId);
  if (!currentSale) return toast('No se encontró la venta.');
  let result;
  try { result = correctPaidAmount(saleTotal(currentSale), amount); }
  catch (error) { return toast(error.message); }
  const previousAmount = Number(currentSale.paidAmount || 0);
  if (result.paidAmount === previousAmount) return toast('El importe nuevo es igual al actual.');
  if (!confirm(`¿Corregir el total recibido?\n\nImporte anterior: ${money.format(previousAmount)}\nImporte nuevo: ${money.format(result.paidAmount)}`)) return;
  state.payingSales.add(saleId);
  document.querySelectorAll('.later-payment-button').forEach(button => { button.disabled = true; });
  try {
    const at = new Date().toISOString();
    const correction = { at, previousAmount, newAmount: result.paidAmount };
    await put('sales', { ...currentSale, paidAmount: result.paidAmount, paymentCorrections: [...(currentSale.paymentCorrections || []), correction], updatedAt: at });
    $('#modal').close();
    await refresh('Pago corregido.');
    const updatedSale = state.sales.find(item => item.id === saleId);
    if (updatedSale) openSale(updatedSale);
  } catch (error) { toast(error.message); }
  finally {
    state.payingSales.delete(saleId);
    document.querySelectorAll('.later-payment-button').forEach(button => { button.disabled = false; });
  }
}

function openCollectionMessage(customer) {
  const summary = summarizePendingSales(customer.id, state.sales);
  if (!summary.sales.length) return toast('Este cliente no tiene saldo pendiente.');
  const phone = whatsappPhone(customer.phone);
  openModal('Cobrar por WhatsApp', `
    <p class="muted">Revisa o edita el mensaje. Abrir WhatsApp no modifica la deuda.</p>
    ${phone ? `<p><strong>Se enviará a:</strong> ${esc(customer.phone)}</p>` : '<p><strong>Sin teléfono:</strong> podrás elegir el contacto en WhatsApp.</p>'}
    <label>Mensaje<textarea class="message-preview" name="message" required>${esc(buildCollectionMessage(customer, summary, state.settings))}</textarea></label>
  `, async data => {
    const message = String(data.get('message')).trim();
    if (!message) throw new Error('El mensaje no puede estar vacío.');
    const url = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.location.href = url;
  }, 'Abrir WhatsApp');
}

function openMessageSettings() {
  const settings = { ...DEFAULT_MESSAGE_SETTINGS, ...state.settings };
  openModal('Mensaje de cobranza', `
    <p class="muted">Usa <strong>{nombre}</strong> en el saludo para insertar el nombre del cliente.</p>
    <label>Saludo<textarea name="greeting" required>${esc(settings.greeting)}</textarea></label>
    <label>Introducción<textarea name="introduction" required>${esc(settings.introduction)}</textarea></label>
    <label>Datos bancarios<textarea name="bankDetails" required>${esc(settings.bankDetails)}</textarea></label>
    <label>Instrucciones de pago<textarea name="paymentInstructions" required>${esc(settings.paymentInstructions)}</textarea></label>
    <label>Despedida<textarea name="farewell" required>${esc(settings.farewell)}</textarea></label>
  `, async data => {
    const updated = { id: 'whatsapp' };
    for (const field of ['greeting', 'introduction', 'bankDetails', 'paymentInstructions', 'farewell']) {
      updated[field] = String(data.get(field)).trim();
      if (!updated[field]) throw new Error('Completa todos los campos del mensaje.');
    }
    await put('settings', updated);
    await refresh('Configuración guardada.');
  });
}

function openCustomerHistory(customer) {
  const sales = state.sales.filter(sale => sale.customerId === customer.id);
  const summary = summarizeSales(sales);
  const debt = summary.pending;
  openModal(customer.name, `<div class="payment-summary customer-payment-summary"><div><span>Comprado</span><strong>${money.format(summary.total)}</strong></div><div><span>Cobrado</span><strong>${money.format(summary.paid)}</strong></div><div class="payment-balance"><span>Pendiente</span><strong>${money.format(summary.pending)}</strong></div></div>${debt > 0.005 ? '<button id="collectWhatsApp" type="button" class="whatsapp-button">Cobrar por WhatsApp</button>' : ''}<p class="muted">Toca una venta para registrar o corregir su pago.</p><div>${sales.map(saleRow).join('') || '<p class="empty">Sin compras.</p>'}</div>`, async () => openCustomer(customer), 'Editar cliente');
  $('#collectWhatsApp')?.addEventListener('click', () => { $('#modal').close(); openCollectionMessage(customer); });
  $('#modalBody').querySelectorAll('.sale-open').forEach(button => button.addEventListener('click', () => { $('#modal').close(); openSale(state.sales.find(sale => sale.id === Number(button.dataset.saleId))); }));
}

async function refresh(message) { await loadState(); renderAll(); if (message) toast(message); }

function csvCell(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
function exportCsv() {
  const header = ['Fecha', 'Cliente', 'Producto', 'Cantidad', 'Precio unitario', 'Subtotal', 'Total venta', 'Pagado', 'Saldo', 'Estado'];
  const rows = state.sales.flatMap(sale => {
    const total = saleTotal(sale);
    return sale.items.map(item => [sale.date, customerName(sale.customerId), item.name, item.quantity, item.price, item.quantity * item.price, total, sale.paidAmount, Math.max(0, total - sale.paidAmount), saleStatus(total, sale.paidAmount)]);
  });
  download(`renuevo-ventas-${today()}.csv`, '\ufeff' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8');
}

async function resolveSaleCustomer() {
  const typedName = $('#saleCustomerName').value.trim();
  const requestedName = typedName || 'Venta general';
  const existing = findCustomerByName(state.customers, requestedName);
  if (existing) return existing.id;
  const id = await put('customers', { name: requestedName, phone: '' });
  state.customers.push({ id, name: requestedName, phone: '' });
  state.customers.sort((a, b) => a.name.localeCompare(b.name));
  return id;
}

function bindEvents() {
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.go)));
  $('#summaryDate').addEventListener('change', renderSummary);
  $('#historySearch').addEventListener('input', renderHistory);
  $('#historyStatus').addEventListener('change', renderHistory);
  $('#salePaid').addEventListener('input', updatePaymentUI);
  document.querySelectorAll('[data-payment]').forEach(button => button.addEventListener('click', () => {
    state.paymentMode = button.dataset.payment;
    $('#salePaid').value = '';
    updatePaymentUI();
  }));
  $('#partialPaymentButton').addEventListener('click', () => {
    state.paymentMode = state.paymentMode === 'partial' ? 'paid' : 'partial';
    $('#salePaid').value = '';
    updatePaymentUI();
    if (state.paymentMode === 'partial') $('#salePaid').focus();
  });
  $('#newCustomerButton').addEventListener('click', () => openCustomer());
  $('#newProductButton').addEventListener('click', () => openProduct());
  $('#messageSettingsButton').addEventListener('click', openMessageSettings);
  $('#addItemButton').addEventListener('click', () => {
    const product = state.products.find(item => item.id === Number($('#saleProduct').value));
    const quantity = Number($('#saleQuantity').value);
    if (!product || !Number.isInteger(quantity) || quantity < 1) return toast('Selecciona un producto y cantidad válida.');
    state.cart = addCartItem(state.cart, product, quantity);
    $('#saleQuantity').value = 1;
    renderSaleForm();
    $('#saleProduct').focus({ preventScroll: true });
  });
  $('#saleItems').addEventListener('click', event => { const button = event.target.closest('[data-cart-index]'); if (button) { state.cart.splice(Number(button.dataset.cartIndex), 1); renderSaleForm(); } });
  $('#saleForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (state.savingSale) return;
    const total = cartTotal();
    if (!state.cart.length) return toast('Agrega al menos un producto.');
    let paidAmount;
    try { paidAmount = resolvePaidAmount(state.paymentMode, total, $('#salePaid').value); }
    catch (error) { return toast(error.message); }
    state.savingSale = true;
    const saveButton = event.submitter;
    if (saveButton) saveButton.disabled = true;
    try {
      const customerId = await resolveSaleCustomer();
      const createdAt = new Date().toISOString();
      await saveSale({ customerId, date: $('#saleDate').value, items: state.cart.map(item => ({ ...item })), paidAmount, payments: paidAmount > 0 ? [{ amount: paidAmount, at: createdAt }] : [], paymentCorrections: [], createdAt });
      state.cart = [];
      state.paymentMode = 'paid';
      $('#salePaid').value = '';
      $('#saleCustomerName').value = '';
      $('#saleQuantity').value = 1;
      await refresh('Venta guardada.');
      navigate('home');
    } catch (error) { toast(error.message); }
    finally { state.savingSale = false; if (saveButton) saveButton.disabled = false; }
  });
  document.body.addEventListener('click', event => {
    const saleButton = event.target.closest('.sale-open');
    const customerButton = event.target.closest('.customer-open');
    const productButton = event.target.closest('.product-edit');
    if (saleButton && !saleButton.closest('dialog')) openSale(state.sales.find(sale => sale.id === Number(saleButton.dataset.saleId)));
    if (customerButton) openCustomerHistory(state.customers.find(item => item.id === Number(customerButton.dataset.customerId)));
    if (productButton) openProduct(state.products.find(item => item.id === Number(productButton.dataset.productId)));
  });
  $('#exportCsvButton').addEventListener('click', exportCsv);
  $('#backupButton').addEventListener('click', async () => download(`renuevo-respaldo-${today()}.json`, JSON.stringify(await exportAll(), null, 2), 'application/json'));
  $('#restoreInput').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.products) || !Array.isArray(data.customers) || !Array.isArray(data.sales)) throw new Error('El archivo no es un respaldo válido.');
      if (!confirm('Esto reemplazará todos los datos actuales. ¿Continuar?')) return;
      await replaceAll(data); await seedDefaults(); await refresh('Respaldo restaurado.');
    } catch (error) { toast(error.message); } finally { event.target.value = ''; }
  });
  const updateConnection = () => { $('#connectionBadge').textContent = navigator.onLine ? 'En línea' : 'Sin conexión'; $('#connectionBadge').classList.toggle('online', navigator.onLine); };
  addEventListener('online', updateConnection); addEventListener('offline', updateConnection); updateConnection();
}

async function init() {
  $('#summaryDate').value = today();
  $('#saleDate').value = today();
  bindEvents();
  try { await seedDefaults(); await loadState(); renderAll(); } catch (error) { console.error(error); toast('No se pudo abrir el almacenamiento local.'); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.error);
}

init();
