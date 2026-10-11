import { count, deleteSaleAndRestoreInventory, exportAll, getAll, put, remove, replaceAll, saveSaleWithInventory } from './db.js';
import { buildCollectionMessage, DEFAULT_MESSAGE_SETTINGS, summarizePendingSales, whatsappPhone } from './billing.js';

const $ = selector => document.querySelector(selector);
const state = { products: [], customers: [], sales: [], settings: {}, cart: [], savingSale: false, deletingSales: new Set() };
const money = new Intl.NumberFormat('es-US', { style: 'currency', currency: 'USD' });
const dateLabel = value => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`));
const today = () => new Date().toISOString().slice(0, 10);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));

function saleStatus(total, paid) {
  if (paid >= total) return 'Pagado';
  if (paid > 0) return 'Abono parcial';
  return 'Pendiente';
}

function statusClass(status) { return `status-${status.replaceAll(' ', '-')}`; }
function customerName(id) { return state.customers.find(item => item.id === id)?.name || 'Cliente eliminado'; }
function saleTotal(sale) { return sale.items.reduce((sum, item) => sum + item.price * item.quantity, 0); }
function cartTotal() { return state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0); }

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
  state.products.sort((a, b) => a.name.localeCompare(b.name));
  state.customers.sort((a, b) => a.name.localeCompare(b.name));
  state.sales.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

async function seedDefaults() {
  if (await count('products') === 0) {
    await Promise.all([
      put('products', { name: 'Desayuno', price: 60, stock: 30, active: true }),
      put('products', { name: 'Café', price: 25, stock: 40, active: true }),
      put('products', { name: 'Agua', price: 15, stock: 40, active: true })
    ]);
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
  const total = sales.reduce((sum, sale) => sum + saleTotal(sale), 0);
  const paid = sales.reduce((sum, sale) => sum + sale.paidAmount, 0);
  const debt = total - paid;
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
  const customerValue = $('#saleCustomer').value;
  const productValue = $('#saleProduct').value;
  $('#saleCustomer').innerHTML = state.customers.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join('');
  $('#saleProduct').innerHTML = state.products.filter(item => item.active !== false && item.stock > 0).map(item => `<option value="${item.id}">${esc(item.name)} — ${money.format(item.price)} (${item.stock})</option>`).join('') || '<option value="">Sin productos disponibles</option>';
  if (customerValue) $('#saleCustomer').value = customerValue;
  if (productValue) $('#saleProduct').value = productValue;
  $('#saleItems').innerHTML = state.cart.map((item, index) => `<div class="sale-item"><span class="item-main"><strong>${esc(item.name)} × ${item.quantity}</strong><span>${money.format(item.price)} c/u</span></span><span class="item-side"><strong>${money.format(item.price * item.quantity)}</strong><button type="button" class="remove-button" data-cart-index="${index}" aria-label="Quitar">×</button></span></div>`).join('') || '<p class="empty">Agrega uno o más productos.</p>';
  const total = cartTotal();
  const paid = Math.max(0, Number($('#salePaid').value) || 0);
  const status = saleStatus(total, paid);
  $('#saleTotal').textContent = money.format(total);
  $('#paymentStatus').className = `status-preview ${statusClass(status)}`;
  $('#paymentStatus').textContent = `${status} · Resta ${money.format(Math.max(0, total - paid))}`;
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
  return state.sales.filter(sale => sale.customerId === customerId).reduce((sum, sale) => sum + Math.max(0, saleTotal(sale) - sale.paidAmount), 0);
}

function renderCustomers() {
  $('#customerList').innerHTML = state.customers.map(customer => {
    const purchases = state.sales.filter(sale => sale.customerId === customer.id);
    const debt = customerDebt(customer.id);
    return `<button class="list-row customer-open text-button" data-customer-id="${customer.id}"><span class="item-main"><strong>${esc(customer.name)}</strong><span>${purchases.length} compra(s)${customer.phone ? ` · ${esc(customer.phone)}` : ''}</span></span><span class="item-side"><span>Debe</span><strong class="${debt ? 'low-stock' : ''}">${money.format(debt)}</strong></span></button>`;
  }).join('') || '<p class="empty">Agrega tu primer cliente.</p>';
}

function renderProducts() {
  $('#productList').innerHTML = state.products.map(product => `<div class="${product.active === false ? 'inactive' : ''}">
    <div class="list-row"><span class="item-main"><strong>${esc(product.name)}</strong><span>${money.format(product.price)}</span>${product.active === false ? '<span class="badge">Desactivado</span>' : ''}</span><span class="item-side"><span>Disponible</span><strong class="${product.stock <= 5 ? 'low-stock' : ''}">${product.stock}</strong></span></div>
    <div class="product-actions"><button class="secondary-button product-edit" data-product-id="${product.id}">Editar</button><button class="secondary-button product-restock" data-product-id="${product.id}">Reponer</button></div>
  </div>`).join('') || '<p class="empty">No hay productos.</p>';
}

function renderAll() { renderSummary(); renderSaleForm(); renderHistory(); renderCustomers(); renderProducts(); }

function openModal(title, body, onSave, saveText = 'Guardar') {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = body;
  $('#modalSave').textContent = saveText;
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
    ${product.id
      ? `<div class="summary-card"><span>Existencia disponible</span><strong>${product.stock}</strong></div><label><select name="active"><option value="true" ${product.active !== false ? 'selected' : ''}>Activo</option><option value="false" ${product.active === false ? 'selected' : ''}>Desactivado</option></select></label>`
      : '<label>Inventario inicial<input name="stock" type="number" min="0" step="1" inputmode="numeric" required value="0"></label>'}
  `, async data => {
    const name = String(data.get('name')).trim();
    const price = Number(data.get('price'));
    const stock = product.id ? product.stock : Number(data.get('stock'));
    if (!name || price < 0 || !Number.isInteger(stock) || stock < 0) throw new Error('Revisa los datos del producto.');
    await put('products', { ...product, name, price, stock, active: product.id ? data.get('active') === 'true' : true });
    await refresh('Producto guardado.');
  });
}

function openRestock(product) {
  openModal('Reponer inventario', `
    <div class="summary-card"><span>${esc(product.name)} · existencia actual</span><strong>${product.stock}</strong></div>
    <label>Unidades que ingresan<input name="units" type="number" min="1" step="1" inputmode="numeric" required value="1"></label>
  `, async data => {
    const units = Number(data.get('units'));
    if (!Number.isInteger(units) || units < 1) throw new Error('Escribe una cantidad válida.');
    await put('products', { ...product, stock: product.stock + units });
    await refresh(`Se agregaron ${units} unidades.`);
  }, 'Agregar unidades');
}

function openSale(sale) {
  const total = saleTotal(sale);
  const debt = Math.max(0, total - sale.paidAmount);
  openModal('Detalle de venta', `
    <div><strong>${esc(customerName(sale.customerId))}</strong><p class="muted">${dateLabel(sale.date)}</p></div>
    ${sale.items.map(item => `<div class="sale-item"><span>${esc(item.name)} × ${item.quantity}</span><strong>${money.format(item.price * item.quantity)}</strong></div>`).join('')}
    <div class="total-row"><span>Total</span><strong>${money.format(total)}</strong></div>
    <p>Pagado: <strong>${money.format(sale.paidAmount)}</strong><br>Saldo: <strong>${money.format(debt)}</strong></p>
    ${debt ? `<label>Registrar abono<input name="payment" type="number" min="0.01" max="${debt}" step="0.01" inputmode="decimal" value="${debt}"></label>` : '<p class="status-preview status-Pagado">Pagado</p>'}
    <button id="deleteSale" type="button" class="secondary-button">Eliminar venta</button>
  `, async data => {
    if (!debt) return;
    const payment = Number(data.get('payment'));
    if (!(payment > 0) || payment > debt) throw new Error('El abono no es válido.');
    await put('sales', { ...sale, paidAmount: sale.paidAmount + payment, updatedAt: new Date().toISOString() });
    await refresh('Abono registrado.');
  }, debt ? 'Registrar abono' : 'Cerrar');
  $('#deleteSale').addEventListener('click', async () => {
    if (state.deletingSales.has(sale.id)) return;
    if (confirm('¿Eliminar esta venta y devolver los productos al inventario?')) {
      state.deletingSales.add(sale.id);
      try { await deleteSaleAndRestoreInventory(sale); $('#modal').close(); await refresh('Venta eliminada.'); }
      finally { state.deletingSales.delete(sale.id); }
    }
  });
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
  const debt = customerDebt(customer.id);
  openModal(customer.name, `<div class="summary-card"><span>Deuda total</span><strong>${money.format(debt)}</strong></div>${debt > 0.005 ? '<button id="collectWhatsApp" type="button" class="whatsapp-button">Cobrar por WhatsApp</button>' : ''}<div>${sales.map(saleRow).join('') || '<p class="empty">Sin compras.</p>'}</div>`, async () => openCustomer(customer), 'Editar cliente');
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

function bindEvents() {
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.go)));
  $('#summaryDate').addEventListener('change', renderSummary);
  $('#historySearch').addEventListener('input', renderHistory);
  $('#historyStatus').addEventListener('change', renderHistory);
  $('#salePaid').addEventListener('input', renderSaleForm);
  $('#newCustomerButton').addEventListener('click', () => openCustomer());
  $('#newProductButton').addEventListener('click', () => openProduct());
  $('#messageSettingsButton').addEventListener('click', openMessageSettings);
  $('#addItemButton').addEventListener('click', () => {
    const product = state.products.find(item => item.id === Number($('#saleProduct').value));
    const quantity = Number($('#saleQuantity').value);
    if (!product || !Number.isInteger(quantity) || quantity < 1) return toast('Selecciona un producto y cantidad válida.');
    const existing = state.cart.find(item => item.productId === product.id);
    const desired = quantity + (existing?.quantity || 0);
    if (desired > product.stock) return toast(`Solo quedan ${product.stock} unidades.`);
    if (existing) existing.quantity = desired; else state.cart.push({ productId: product.id, name: product.name, price: product.price, quantity });
    $('#saleQuantity').value = 1;
    renderSaleForm();
  });
  $('#saleItems').addEventListener('click', event => { const button = event.target.closest('[data-cart-index]'); if (button) { state.cart.splice(Number(button.dataset.cartIndex), 1); renderSaleForm(); } });
  $('#saleForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (state.savingSale) return;
    const total = cartTotal();
    const paidAmount = Number($('#salePaid').value) || 0;
    if (!state.cart.length) return toast('Agrega al menos un producto.');
    if (paidAmount < 0 || paidAmount > total) return toast('El abono debe estar entre $0 y el total.');
    state.savingSale = true;
    const saveButton = event.submitter;
    if (saveButton) saveButton.disabled = true;
    try {
      await saveSaleWithInventory({ customerId: Number($('#saleCustomer').value), date: $('#saleDate').value, items: state.cart.map(item => ({ ...item })), paidAmount, createdAt: new Date().toISOString() });
      state.cart = []; $('#salePaid').value = 0; await refresh('Venta guardada.'); navigate('home');
    } catch (error) { toast(error.message); }
    finally { state.savingSale = false; if (saveButton) saveButton.disabled = false; }
  });
  document.body.addEventListener('click', event => {
    const saleButton = event.target.closest('.sale-open');
    const customerButton = event.target.closest('.customer-open');
    const productButton = event.target.closest('.product-edit');
    const restockButton = event.target.closest('.product-restock');
    if (saleButton && !saleButton.closest('dialog')) openSale(state.sales.find(sale => sale.id === Number(saleButton.dataset.saleId)));
    if (customerButton) openCustomerHistory(state.customers.find(item => item.id === Number(customerButton.dataset.customerId)));
    if (productButton) openProduct(state.products.find(item => item.id === Number(productButton.dataset.productId)));
    if (restockButton) openRestock(state.products.find(item => item.id === Number(restockButton.dataset.productId)));
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
