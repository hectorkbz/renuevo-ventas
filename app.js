import { consolidateCustomerSales, correctSalesDate, count, deleteSale, exportAll, getAll, put, remove, replaceAll, saveOrAppendSale } from './db.js';
import { buildDetailedCollectionMessage, DEFAULT_MESSAGE_SETTINGS, summarizeCollectionByDate, whatsappUrl } from './billing.js';
import { PRODUCT_CATALOG } from './catalog.js';
import { caracasLongDate, caracasShortDate, caracasToday, planSaleDateCorrection, shouldRefreshDefaultSaleDate } from './dates.js';
import { addCartItem, addMonetaryPayment, changeItemPaidQuantity, correctPaidAmount, findCustomerByName, findCustomerMatches, normalizeText, paidByUnits, resolvePaidAmount, roundMoney, saleTotal as itemsTotal, summarizeSales } from './sales.js';

const $ = selector => document.querySelector(selector);
const state = { products: [], customers: [], sales: [], settings: {}, cart: [], paymentMode: 'pending', selectedCustomerId: null, saleDateManuallySelected: false, savingSale: false, deletingSales: new Set(), payingSales: new Set() };
const money = new Intl.NumberFormat('es-US', { style: 'currency', currency: 'USD' });
const dateLabel = caracasLongDate;
const compactDateLabel = caracasShortDate;
const dateTimeLabel = value => new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const today = caracasToday;
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

function setSaleDate(dateValue) {
  $('#saleDate').value = dateValue;
  $('#saleDateDisplay').textContent = compactDateLabel(dateValue);
}

function refreshDefaultSaleDate() {
  const currentDate = today();
  if (shouldRefreshDefaultSaleDate($('#saleDate').value, currentDate, state.saleDateManuallySelected, state.cart.length > 0)) {
    setSaleDate(currentDate);
  }
}

function correctionConflictMessage(plan) {
  const messages = plan.conflicts.map(conflict => {
    if (conflict.type === 'invalid-dates') return 'La fecha de origen y destino deben ser diferentes.';
    const customer = customerName(conflict.customerId);
    return conflict.type === 'duplicate-after-move'
      ? `${customer}: hay más de una venta seleccionada para la misma fecha.`
      : `${customer}: ya existe una venta en la fecha de destino.`;
  });
  if (plan.missingIds.length) messages.push('La selección cambió. Actualiza la lista antes de continuar.');
  return messages;
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
  if (view === 'sale') refreshDefaultSaleDate();
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
  $('#saleProduct').innerHTML = `<option value="" selected>Elegir producto...</option>${state.products.map(item => `<option value="${item.id}">${esc(item.name)} — ${money.format(item.price)}</option>`).join('')}`;
  if (!$('#saleQuantity').options.length) $('#saleQuantity').innerHTML = Array.from({ length: 20 }, (_, index) => `<option value="${index + 1}">${index + 1}</option>`).join('');
  $('#saleItems').innerHTML = state.cart.map((item, index) =>
    `<div class="sale-item"><span class="item-main"><strong>${esc(item.name)} × ${item.quantity}</strong></span><span class="item-side"><strong>${money.format(item.price * item.quantity)}</strong><button type="button" class="remove-button" data-cart-index="${index}" aria-label="Quitar">×</button></span></div>`
  ).join('') || '<p class="empty compact-empty">Agrega uno o más productos.</p>';
  updatePaymentUI();
}

function renderCustomerSuggestions() {
  const input = $('#saleCustomerName');
  const query = normalizeText(input.value);
  const matches = findCustomerMatches(state.customers, query, 3);
  const suggestions = $('#customerSuggestions');
  suggestions.innerHTML = matches.map(customer => `<button type="button" class="customer-suggestion" role="option" data-select-customer="${customer.id}"><strong>${esc(customer.name)}</strong><span>${esc(customer.phone || 'Sin teléfono')}</span></button>`).join('');
  suggestions.hidden = !input.matches(':focus') || !matches.length;
  $('.sale-basics').style.marginBottom = suggestions.hidden ? '' : `${Math.min(matches.length, 4) * 47 + 8}px`;
  input.setAttribute('aria-expanded', String(!suggestions.hidden));
}

function selectSaleCustomer(customer) {
  state.selectedCustomerId = customer?.id || null;
  $('#saleCustomerName').value = customer?.name === 'Venta general' ? '' : (customer?.name || '');
  $('#saleCustomerPhone').value = customer?.name === 'Venta general' ? '' : (customer?.phone || '');
  $('#customerSuggestions').hidden = true;
  $('.sale-basics').style.marginBottom = '';
  $('#saleCustomerName').setAttribute('aria-expanded', 'false');
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
  const query = normalizeText($('#historySearch').value);
  const filter = $('#historyStatus').value;
  const rows = state.sales.filter(sale => {
    const status = saleStatus(saleTotal(sale), sale.paidAmount);
    return normalizeText(customerName(sale.customerId)).includes(query) && (!filter || status === filter);
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
  $('#modalSave').disabled = false;
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
    const duplicate = findCustomerByName(state.customers.filter(item => item.id !== customer.id), name);
    if (duplicate) throw new Error('Ya existe un cliente con ese nombre.');
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

function openSaleDateCorrection() {
  openModal('Corregir fecha de ventas', `
    <p class="muted">Antes de corregir, descarga un respaldo JSON desde esta pantalla. Solo cambiaremos la fecha de las ventas seleccionadas; productos, precios, pagos e historiales quedan intactos.</p>
    <label>Fecha de origen<input id="correctionSourceDate" name="sourceDate" type="date" required value="2026-10-12"></label>
    <label>Fecha de destino<input id="correctionDestinationDate" name="destinationDate" type="date" required value="2026-10-11"></label>
    <div id="dateCorrectionPreview" class="date-correction-preview" aria-live="polite"></div>
  `, async data => {
    const sourceDate = String(data.get('sourceDate'));
    const destinationDate = String(data.get('destinationDate'));
    const saleIds = data.getAll('saleIds').map(Number);
    const plan = planSaleDateCorrection(state.sales, saleIds, sourceDate, destinationDate);
    if (!plan.canApply) throw new Error(correctionConflictMessage(plan).join(' ' ) || 'Selecciona al menos una venta.');
    const clients = [...new Set(plan.selected.map(sale => customerName(sale.customerId)))];
    if (!confirm(`Vas a cambiar ${plan.selected.length} venta(s) del ${dateLabel(sourceDate)} al ${dateLabel(destinationDate)} para: ${clients.join(', ')}.\n\nExporta un respaldo JSON antes de continuar. ¿Confirmas la corrección?`)) return;
    const result = await correctSalesDate(saleIds, sourceDate, destinationDate);
    if (result.conflicts.length || result.missingIds.length || !result.updated) {
      const latestPlan = { ...plan, conflicts: result.conflicts, missingIds: result.missingIds };
      throw new Error(correctionConflictMessage(latestPlan).join(' ') || 'No se modificó ninguna venta.');
    }
    await refresh(`${result.updated} venta(s) corregida(s).`);
  }, 'Confirmar corrección');

  const renderPreview = (resetSelection = false) => {
    const sourceDate = $('#correctionSourceDate').value;
    const destinationDate = $('#correctionDestinationDate').value;
    const previouslySelected = resetSelection
      ? new Set()
      : new Set([...$('#dateCorrectionPreview').querySelectorAll('[name="saleIds"]:checked')].map(input => Number(input.value)));
    const matchingSales = state.sales.filter(sale => sale.date === sourceDate);
    const chosen = matchingSales.filter(sale => previouslySelected.has(Number(sale.id)));
    $('#dateCorrectionPreview').innerHTML = matchingSales.length
      ? `<p><strong>Ventas encontradas con fecha de origen: ${matchingSales.length}</strong></p><button id="selectAllDateCorrection" type="button" class="text-button">Seleccionar todas las ventas encontradas</button><div class="date-correction-list">${matchingSales.map(sale => `<label class="date-correction-sale"><input type="checkbox" name="saleIds" value="${sale.id}" ${previouslySelected.has(Number(sale.id)) ? 'checked' : ''}><span><strong>${esc(customerName(sale.customerId))}</strong><small>Venta #${sale.id} · ${sale.items.length} productos · ${money.format(saleTotal(sale))}</small></span></label>`).join('')}</div>`
      : '<p class="muted">No hay ventas con esa fecha de origen.</p>';
    const saleIds = chosen.map(sale => sale.id);
    const plan = planSaleDateCorrection(state.sales, saleIds, sourceDate, destinationDate);
    const clients = [...new Set(plan.selected.map(sale => customerName(sale.customerId)))];
    const affected = plan.selected.length
      ? `<p id="dateCorrectionCount">Se modificarán <strong>${plan.selected.length}</strong> de ${matchingSales.length} venta(s) encontradas. Clientes: ${clients.map(esc).join(', ')}.</p>`
      : `<p id="dateCorrectionCount">Selecciona las ventas que deseas corregir. Encontradas: ${matchingSales.length}.</p>`;
    const conflicts = correctionConflictMessage(plan);
    const conflictSummary = conflicts.length
      ? `<div class="date-correction-conflicts"><strong>No se aplicará ningún cambio:</strong><ul>${conflicts.map(message => `<li>${esc(message)}</li>`).join('')}</ul></div>`
      : '';
    $('#dateCorrectionPreview').insertAdjacentHTML('beforeend', `${affected}${conflictSummary}`);
    $('#modalSave').disabled = !plan.canApply;
  };
  renderPreview(true);
  $('#correctionSourceDate').addEventListener('change', () => renderPreview(true));
  $('#correctionDestinationDate').addEventListener('change', () => renderPreview(false));
  $('#dateCorrectionPreview').addEventListener('change', event => {
    if (event.target.matches('[name="saleIds"]')) renderPreview(false);
  });
  $('#dateCorrectionPreview').addEventListener('click', event => {
    if (!event.target.matches('#selectAllDateCorrection')) return;
    $('#dateCorrectionPreview').querySelectorAll('[name="saleIds"]').forEach(input => { input.checked = true; });
    renderPreview(false);
  });
}

function saleItemPaymentRow(item, index) {
  const paidQuantity = Math.min(item.quantity, Math.max(0, Number(item.paidQuantity) || 0));
  const stateLabel = paidQuantity === item.quantity ? 'Pagado' : paidQuantity === 0 ? 'Pendiente' : `${paidQuantity} de ${item.quantity} pagadas`;
  const stateClass = paidQuantity === item.quantity ? 'paid' : paidQuantity ? 'partial' : 'pending';
  return `<div class="sale-product-payment">
    <div class="product-payment-top"><span class="item-main"><strong>${esc(item.name)} × ${item.quantity}</strong><span>${money.format(item.price)} c/u</span></span><strong>${money.format(item.price * item.quantity)}</strong></div>
    <div class="product-payment-bottom"><span class="compact-payment-state ${stateClass}">${stateLabel}</span><button type="button" class="change-payment-button" data-change-item="${index}">Cambiar</button></div>
  </div>`;
}

function openSale(sale) {
  const total = saleTotal(sale);
  const debt = Math.max(0, total - sale.paidAmount);
  const corrections = sale.paymentCorrections || [];
  const payments = sale.payments || [];
  openModal('Detalle de venta', `
    <div class="sale-detail-heading"><strong>${esc(customerName(sale.customerId))}</strong><span>${dateLabel(sale.date)}</span></div>
    <div class="sale-products-list">${sale.items.map(saleItemPaymentRow).join('')}</div>
    <div class="sale-payment-totals" aria-label="Resumen de pago">
      <div><span>Total vendido</span><strong>${money.format(total)}</strong></div>
      <div><span>Cobrado</span><strong>${money.format(sale.paidAmount)}</strong></div>
      <div class="payment-balance"><span>Pendiente</span><strong>${money.format(debt)}</strong></div>
    </div>
    ${debt > 0.005 ? `<div class="sale-collection-actions"><button id="collectFullBalance" type="button" class="primary-action later-payment-button">Pago total</button><button id="openPartialPayment" type="button" class="secondary-button later-payment-button">Pago parcial</button><button id="collectSaleWhatsApp" type="button" class="whatsapp-button">Cobrar por WhatsApp</button></div>` : '<p class="status-preview status-Pagado">Pagado</p>'}
    <button id="showPaymentCorrection" type="button" class="discreet-button correction-toggle">Corregir pago existente</button>
    <div id="paymentCorrectionFields" class="later-partial-fields" hidden>
      <p class="correction-note">Importe recibido actual: <strong>${money.format(sale.paidAmount)}</strong></p>
      <label>Nuevo total recibido acumulado<input id="correctedPaidAmount" type="number" min="0" max="${total}" step="0.01" inputmode="decimal" value="${sale.paidAmount}"></label>
      <button id="confirmPaymentCorrection" type="button" class="secondary-button later-payment-button">Revisar y corregir</button>
    </div>
    ${payments.length ? `<details class="payment-history"><summary>Pagos registrados (${payments.length})</summary>${payments.map(payment => `<div><span>${dateTimeLabel(payment.at)}</span><strong>${money.format(payment.amount)}</strong></div>`).join('')}</details>` : ''}
    ${corrections.length ? `<details class="payment-history"><summary>Correcciones (${corrections.length})</summary>${corrections.slice().reverse().map(correction => `<div><span>${dateTimeLabel(correction.at)}</span><strong>${money.format(correction.previousAmount)} → ${money.format(correction.newAmount)}</strong></div>`).join('')}</details>` : ''}
    <div class="danger-zone"><button id="deleteSale" type="button" class="delete-sale-button">Eliminar venta</button></div>
  `, async () => {}, 'Cerrar');
  $('#modalForm .modal-actions .secondary-button').hidden = true;
  $('#collectFullBalance')?.addEventListener('click', () => {
    if (!confirm(`¿Registrar el cobro exacto de ${money.format(debt)}?`)) return;
    recordLaterPayment(sale.id, debt, 'Pago completo registrado.', 'full');
  });
  $('#openPartialPayment')?.addEventListener('click', () => { $('#modal').close(); openPartialPaymentEditor(sale.id); });
  $('#collectSaleWhatsApp')?.addEventListener('click', () => {
    const customer = state.customers.find(item => item.id === sale.customerId);
    $('#modal').close();
    openCollectionMessage(customer, sale.id);
  });
  $('#showPaymentCorrection').addEventListener('click', () => {
    $('#paymentCorrectionFields').hidden = false;
    $('#correctedPaidAmount').focus();
  });
  $('#confirmPaymentCorrection').addEventListener('click', () => correctSalePayment(sale.id, $('#correctedPaidAmount').value));
  $('#modalBody').querySelectorAll('[data-change-item]').forEach(button => button.addEventListener('click', () => { $('#modal').close(); openItemPaymentEditor(sale.id, Number(button.dataset.changeItem)); }));
  $('#deleteSale').addEventListener('click', async () => {
    if (state.deletingSales.has(sale.id)) return;
    if (confirm('¿Eliminar esta venta? Esta acción no se puede deshacer.')) {
      state.deletingSales.add(sale.id);
      try { await deleteSale(sale.id); $('#modal').close(); await refresh('Venta eliminada.'); }
      finally { state.deletingSales.delete(sale.id); }
    }
  });
}

function reopenSaleAfterCancel(saleId) {
  const modal = $('#modal');
  modal.addEventListener('close', () => {
    if (modal.returnValue !== 'cancel') return;
    setTimeout(() => {
      const sale = state.sales.find(item => item.id === saleId);
      if (sale) openSale(sale);
    }, 0);
  }, { once: true });
}

function openItemPaymentEditor(saleId, itemIndex) {
  const sale = state.sales.find(item => item.id === saleId);
  const item = sale?.items[itemIndex];
  if (!sale || !item) return toast('No se encontró el producto.');
  const current = Number(item.paidQuantity) || 0;
  const options = Array.from({ length: item.quantity + 1 }, (_, quantity) => `<option value="${quantity}" ${quantity === current ? 'selected' : ''}>${quantity}</option>`).join('');
  openModal('Cambiar unidades pagadas', `
    <div class="editor-product"><strong>${esc(item.name)}</strong><span>${item.quantity} unidad(es) · ${money.format(item.price)} c/u</span></div>
    <p class="muted">Actualmente: <strong>${current} pagada(s)</strong></p>
    <label>Unidades que deben quedar pagadas<select id="finalPaidQuantity" name="paidQuantity">${options}</select></label>
    <div id="itemChangePreview" class="change-preview"></div>
  `, async data => updateItemPayment(saleId, itemIndex, Number(data.get('paidQuantity'))), 'Confirmar');
  reopenSaleAfterCancel(saleId);
  const renderPreview = () => {
    const target = Number($('#finalPaidQuantity').value);
    const delta = roundMoney((target - current) * item.price);
    const nextPaid = roundMoney(sale.paidAmount + delta);
    const nextDebt = roundMoney(saleTotal(sale) - nextPaid);
    const preview = $('#itemChangePreview');
    if (target === current) {
      preview.innerHTML = '<span>Selecciona una cantidad diferente.</span>';
      $('#modalSave').disabled = true;
      return;
    }
    try {
      changeItemPaidQuantity(sale, itemIndex, target, new Date().toISOString(), true);
      preview.classList.remove('conflict');
      $('#modalSave').disabled = false;
      preview.innerHTML = `<span>Cobrado: <strong>${money.format(nextPaid)}</strong></span><span>Pendiente: <strong>${money.format(nextDebt)}</strong></span><small>${delta > 0 ? `Se sumarán ${money.format(delta)}.` : `Se descontarán ${money.format(Math.abs(delta))}.`}</small>`;
    } catch (error) {
      preview.classList.add('conflict');
      preview.textContent = error.message;
      $('#modalSave').disabled = true;
    }
  };
  $('#finalPaidQuantity').addEventListener('change', renderPreview);
  renderPreview();
}

function openPartialPaymentEditor(saleId) {
  const sale = state.sales.find(item => item.id === saleId);
  if (!sale) return toast('No se encontró la venta.');
  const debt = roundMoney(saleTotal(sale) - sale.paidAmount);
  if (debt <= 0) return toast('Esta venta ya está pagada.');
  openModal('Registrar abono parcial', `
    <p class="muted">Saldo pendiente actual: <strong>${money.format(debt)}</strong></p>
    <label>Importe recibido<input id="partialPaymentAmount" name="amount" type="number" min="0.01" max="${debt}" step="0.01" inputmode="decimal" placeholder="0.00" required></label>
    <div id="partialPaymentPreview" class="change-preview"><span>Escribe el importe recibido.</span></div>
  `, async data => recordLaterPayment(saleId, data.get('amount'), 'Abono parcial registrado.', 'partial'), 'Confirmar abono');
  reopenSaleAfterCancel(saleId);
  $('#modalSave').disabled = true;
  $('#partialPaymentAmount').addEventListener('input', () => {
    const amount = Number($('#partialPaymentAmount').value);
    const preview = $('#partialPaymentPreview');
    if (!(amount > 0) || amount > debt) {
      $('#modalSave').disabled = true;
      preview.classList.toggle('conflict', amount > debt);
      preview.textContent = amount > debt ? 'El abono supera el saldo pendiente.' : 'Escribe el importe recibido.';
      return;
    }
    preview.classList.remove('conflict');
    $('#modalSave').disabled = false;
    preview.innerHTML = `<span>Cobrado: <strong>${money.format(sale.paidAmount + amount)}</strong></span><span>Pendiente: <strong>${money.format(debt - amount)}</strong></span>`;
  });
  $('#partialPaymentAmount').focus();
}

async function updateItemPayment(saleId, itemIndex, paidQuantity) {
  if (state.payingSales.has(saleId)) return;
  const currentSale = state.sales.find(item => item.id === saleId);
  if (!currentSale) return toast('No se encontró la venta.');
  let updated;
  try { updated = changeItemPaidQuantity(currentSale, itemIndex, paidQuantity, new Date().toISOString(), true); }
  catch (error) { return toast(error.message); }
  state.payingSales.add(saleId);
  document.querySelectorAll('.later-payment-button').forEach(button => { button.disabled = true; });
  try {
    await put('sales', updated);
    if ($('#modal').open) $('#modal').close();
    await refresh('Unidades pagadas actualizadas.');
    const refreshed = state.sales.find(item => item.id === saleId);
    if (refreshed) openSale(refreshed);
  } catch (error) { toast(error.message); }
  finally { state.payingSales.delete(saleId); }
}

async function recordLaterPayment(saleId, amount, message, kind = 'amount') {
  if (state.payingSales.has(saleId)) return;
  const currentSale = state.sales.find(item => item.id === saleId);
  if (!currentSale) return toast('No se encontró la venta.');
  let updated;
  try { updated = addMonetaryPayment(currentSale, amount, new Date().toISOString(), kind); }
  catch (error) { return toast(error.message); }
  state.payingSales.add(saleId);
  document.querySelectorAll('.later-payment-button').forEach(button => { button.disabled = true; });
  try {
    await put('sales', updated);
    if ($('#modal').open) $('#modal').close();
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
    const unitAmount = paidByUnits(currentSale.items);
    if (result.paidAmount < unitAmount) throw new Error(`Primero reduce las unidades pagadas. Esas unidades representan ${money.format(unitAmount)}.`);
    await put('sales', { ...currentSale, paidAmount: result.paidAmount, monetaryPaidAmount: roundMoney(result.paidAmount - unitAmount), paymentCorrections: [...(currentSale.paymentCorrections || []), correction], updatedAt: at });
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

function openCollectionMessage(customer, saleId = null) {
  if (!customer) return toast('No se encontró el cliente de esta venta.');
  const allDebt = summarizeCollectionByDate(customer.id, state.sales);
  const thisSale = saleId === null ? allDebt : summarizeCollectionByDate(customer.id, state.sales, saleId);
  if (!thisSale.entries.length) return toast('Esta venta no tiene saldo pendiente.');
  let scope = saleId === null ? 'all' : 'sale';
  const currentSummary = () => scope === 'all' ? allDebt : thisSale;
  const canChooseAll = saleId !== null && allDebt.entries.length > 1;
  openModal('Cobrar por WhatsApp', `
    <p class="muted">Revisa o edita el mensaje. Abrir WhatsApp no modifica la deuda.</p>
    ${canChooseAll ? `<div class="collection-scope"><button type="button" class="scope-button active" data-scope="sale">Esta venta · ${money.format(thisSale.pending)}</button><button type="button" class="scope-button" data-scope="all">Toda la deuda · ${money.format(allDebt.pending)}</button></div>` : ''}
    ${customer.phone ? `<p><strong>Se enviará a:</strong> ${esc(customer.phone)}</p>` : '<label>Teléfono<input id="collectionPhone" name="phone" type="tel" inputmode="tel" maxlength="30" placeholder="0412 1234567"><span class="muted">Si lo dejas vacío, podrás elegir el contacto en WhatsApp.</span></label>'}
    <label>Mensaje<textarea id="collectionMessage" class="message-preview" name="message" required>${esc(buildDetailedCollectionMessage(customer, currentSummary(), state.settings))}</textarea></label>
  `, async data => {
    const message = String(data.get('message')).trim();
    if (!message) throw new Error('El mensaje no puede estar vacío.');
    const enteredPhone = String(data.get('phone') || '').trim();
    if (enteredPhone && enteredPhone !== customer.phone) {
      await put('customers', { ...customer, phone: enteredPhone });
      customer.phone = enteredPhone;
    }
    window.location.href = whatsappUrl(message, enteredPhone || customer.phone);
  }, 'Abrir WhatsApp');
  if (saleId !== null) reopenSaleAfterCancel(saleId);
  $('#modalBody').querySelectorAll('[data-scope]').forEach(button => button.addEventListener('click', () => {
    scope = button.dataset.scope;
    $('#modalBody').querySelectorAll('[data-scope]').forEach(item => item.classList.toggle('active', item === button));
    $('#collectionMessage').value = buildDetailedCollectionMessage(customer, currentSummary(), state.settings);
  }));
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
  const hasSameDayDuplicates = new Set(sales.map(sale => sale.date)).size < sales.length;
  const summary = summarizeSales(sales);
  const debt = summary.pending;
  openModal(customer.name, `<div class="payment-summary customer-payment-summary"><div><span>Comprado</span><strong>${money.format(summary.total)}</strong></div><div><span>Cobrado</span><strong>${money.format(summary.paid)}</strong></div><div class="payment-balance"><span>Pendiente</span><strong>${money.format(summary.pending)}</strong></div></div>${debt > 0.005 ? '<button id="collectWhatsApp" type="button" class="whatsapp-button">Cobrar por WhatsApp</button>' : ''}${hasSameDayDuplicates ? '<button id="groupDailySales" type="button" class="secondary-button">Agrupar compras del mismo día</button>' : ''}<p class="muted">Toca una venta para registrar o corregir su pago.</p><div>${sales.map(saleRow).join('') || '<p class="empty">Sin compras.</p>'}</div>`, async () => openCustomer(customer), 'Editar cliente');
  $('#collectWhatsApp')?.addEventListener('click', () => { $('#modal').close(); openCollectionMessage(customer); });
  $('#groupDailySales')?.addEventListener('click', async () => {
    if (!confirm('¿Agrupar las compras de este cliente que comparten fecha? Se conservarán productos, pagos y movimientos originales.')) return;
    const grouped = await consolidateCustomerSales(customer.id);
    $('#modal').close();
    await refresh(`${grouped} operación(es) agrupada(s).`);
    openCustomerHistory(state.customers.find(item => item.id === customer.id));
  });
  $('#modalBody').querySelectorAll('.sale-open').forEach(button => button.addEventListener('click', () => { $('#modal').close(); openSale(state.sales.find(sale => sale.id === Number(button.dataset.saleId))); }));
}

async function refresh(message) { await loadState(); renderAll(); if (message) toast(message); }

function csvCell(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
function exportCsv() {
  const header = ['Fecha', 'Cliente', 'Producto', 'Cantidad', 'Unidades pagadas', 'Unidades pendientes', 'Precio unitario', 'Subtotal', 'Total venta', 'Pagado', 'Saldo', 'Estado'];
  const rows = state.sales.flatMap(sale => {
    const total = saleTotal(sale);
    return sale.items.map(item => [sale.date, customerName(sale.customerId), item.name, item.quantity, item.paidQuantity || 0, item.quantity - (item.paidQuantity || 0), item.price, item.quantity * item.price, total, sale.paidAmount, Math.max(0, total - sale.paidAmount), saleStatus(total, sale.paidAmount)]);
  });
  download(`renuevo-ventas-${today()}.csv`, '\ufeff' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8');
}

async function resolveSaleCustomer() {
  const typedName = $('#saleCustomerName').value.trim();
  const phone = $('#saleCustomerPhone').value.trim();
  const requestedName = typedName || 'Venta general';
  const selected = state.customers.find(customer => customer.id === state.selectedCustomerId);
  if (selected && normalizeText(selected.name) === normalizeText(requestedName)) {
    if (selected.phone !== phone) {
      await put('customers', { ...selected, phone });
      selected.phone = phone;
    }
    return selected.id;
  }
  const existing = findCustomerByName(state.customers, requestedName);
  if (existing) {
    const resolvedPhone = phone || existing.phone || '';
    if (existing.name !== 'Venta general' && existing.phone !== resolvedPhone) {
      await put('customers', { ...existing, phone: resolvedPhone });
      existing.phone = resolvedPhone;
    }
    return existing.id;
  }
  const id = await put('customers', { name: requestedName, phone });
  state.customers.push({ id, name: requestedName, phone });
  state.customers.sort((a, b) => a.name.localeCompare(b.name));
  return id;
}

function bindEvents() {
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.go)));
  $('#summaryDate').addEventListener('change', renderSummary);
  $('#historySearch').addEventListener('input', renderHistory);
  $('#historyStatus').addEventListener('change', renderHistory);
  $('#saleCustomerName').addEventListener('input', () => {
    state.selectedCustomerId = null;
    renderCustomerSuggestions();
  });
  $('#saleCustomerName').addEventListener('focus', renderCustomerSuggestions);
  $('#saleCustomerName').addEventListener('blur', () => setTimeout(() => { $('#customerSuggestions').hidden = true; $('.sale-basics').style.marginBottom = ''; $('#saleCustomerName').setAttribute('aria-expanded', 'false'); }, 150));
  $('#saleDate').addEventListener('change', () => {
    state.saleDateManuallySelected = true;
    $('#saleDateDisplay').textContent = compactDateLabel($('#saleDate').value);
  });
  $('#salePaid').addEventListener('input', () => {
    state.cart = state.cart.map(item => ({ ...item, paidQuantity: 0 }));
    renderSaleForm();
  });
  document.querySelectorAll('[data-payment]').forEach(button => button.addEventListener('click', () => {
    state.paymentMode = button.dataset.payment;
    state.cart = state.cart.map(item => ({ ...item, paidQuantity: state.paymentMode === 'paid' ? item.quantity : 0 }));
    $('#salePaid').value = '';
    updatePaymentUI();
  }));
  $('#partialPaymentButton').addEventListener('click', () => {
    state.paymentMode = state.paymentMode === 'partial' ? 'pending' : 'partial';
    state.cart = state.cart.map(item => ({ ...item, paidQuantity: state.paymentMode === 'paid' ? item.quantity : 0 }));
    $('#salePaid').value = '';
    updatePaymentUI();
    if (state.paymentMode === 'partial') $('#salePaid').focus();
  });
  $('#newCustomerButton').addEventListener('click', () => openCustomer());
  $('#newProductButton').addEventListener('click', () => openProduct());
  $('#correctSaleDatesButton').addEventListener('click', openSaleDateCorrection);
  $('#messageSettingsButton').addEventListener('click', openMessageSettings);
  $('#addItemButton').addEventListener('click', () => {
    const product = state.products.find(item => item.id === Number($('#saleProduct').value));
    const quantity = Number($('#saleQuantity').value);
    if (!product || !Number.isInteger(quantity) || quantity < 1) return toast('Selecciona un producto y cantidad válida.');
    state.cart = addCartItem(state.cart, product, quantity);
    state.cart = state.cart.map(item => ({ ...item, paidQuantity: state.paymentMode === 'paid' ? item.quantity : (Number(item.paidQuantity) || 0) }));
    $('#saleProduct').value = '';
    $('#saleQuantity').value = 1;
    renderSaleForm();
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
      const result = await saveOrAppendSale({ customerId, date: $('#saleDate').value, items: state.cart.map(item => ({ ...item })), paidAmount, createdAt });
      state.cart = [];
      state.paymentMode = 'pending';
      state.saleDateManuallySelected = false;
      setSaleDate(today());
      $('#salePaid').value = '';
      $('#saleCustomerName').value = '';
      $('#saleCustomerPhone').value = '';
      state.selectedCustomerId = null;
      $('#saleQuantity').value = 1;
      await refresh(result.accumulated ? 'Compra añadida a la venta del día.' : 'Venta guardada.');
      navigate('home');
    } catch (error) { toast(error.message); }
    finally { state.savingSale = false; if (saveButton) saveButton.disabled = false; }
  });
  document.body.addEventListener('click', event => {
    const selectCustomerButton = event.target.closest('[data-select-customer]');
    const saleButton = event.target.closest('.sale-open');
    const customerButton = event.target.closest('.customer-open');
    const productButton = event.target.closest('.product-edit');
    if (selectCustomerButton) selectSaleCustomer(state.customers.find(customer => customer.id === Number(selectCustomerButton.dataset.selectCustomer)));
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
}

async function init() {
  $('#summaryDate').value = today();
  setSaleDate(today());
  bindEvents();
  try { await seedDefaults(); await loadState(); renderAll(); } catch (error) { console.error(error); toast('No se pudo abrir el almacenamiento local.'); }
  setInterval(refreshDefaultSaleDate, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDefaultSaleDate(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.error);
}

init();
