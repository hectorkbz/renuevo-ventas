import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root), 'utf8'));
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, './');
assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));

const serviceWorker = await readFile(new URL('sw.js', root), 'utf8');
for (const asset of ['./index.html', './styles.css', './app.js', './billing.js', './catalog.js', './sales.js', './dates.js', './db.js', './manifest.webmanifest']) {
  assert.ok(serviceWorker.includes(asset), `${asset} debe estar en la caché offline`);
}

const database = await readFile(new URL('db.js', root), 'utf8');
for (const store of ['products', 'customers', 'sales', 'settings']) assert.ok(database.includes(`'${store}'`));
assert.ok(database.includes('DB_VERSION = 5'), 'la migración de pagos independientes debe ejecutarse automáticamente');
assert.ok(database.includes('migrateSaleRecord'), 'la migración debe conservar y ampliar ventas existentes');
assert.ok(database.includes('monetaryPaidAmount') || (await readFile(new URL('sales.js', root), 'utf8')).includes('monetaryPaidAmount'), 'los abonos monetarios deben persistir separados de las unidades');
assert.ok(database.includes('reconcileProductCatalog'), 'la restauración debe reconciliar el catálogo');
assert.ok(database.includes("transaction('sales', 'readwrite')"), 'las ventas deben guardarse directamente');
assert.ok(!database.includes("transaction(['sales', 'products']"), 'guardar una venta no debe modificar productos');

const html = await readFile(new URL('index.html', root), 'utf8');
assert.ok(html.includes('apple-mobile-web-app-capable'));
assert.ok(html.includes('viewport-fit=cover'));
assert.ok(html.includes('<select id="saleQuantity"'), 'la cantidad debe usar selector nativo');
assert.ok(html.includes('id="saleDateDisplay"'), 'la fecha visible debe usar el formato compacto sin año');
assert.ok(html.includes('id="todaySaleDate"') && html.includes('id="saleDate" type="date"'), 'la fecha permite calendario y regreso a Hoy');
assert.ok(html.includes('id="saleCustomerPhone" type="tel" inputmode="tel"'), 'el teléfono debe activar el teclado telefónico');
assert.ok(!html.match(/id="saleCustomerPhone"[^>]*required/), 'el teléfono no debe ser obligatorio');
assert.ok(html.includes('<option value="" selected>Elegir producto...</option>'), 'el selector de productos debe iniciar sin selección');
assert.ok(html.includes('id="pendingButton" class="payment-button active"'), 'Pendiente debe aparecer seleccionado al iniciar');
for (const relativeReference of ['href="manifest.webmanifest"', 'src="app.js"', 'href="styles.css"']) assert.ok(html.includes(relativeReference));

const app = await readFile(new URL('app.js', root), 'utf8');
const paymentButtons = ['>Pago total<', '>Pago parcial<', '>Cobrar por WhatsApp<'].map(label => app.indexOf(label));
assert.ok(paymentButtons.every(index => index >= 0) && paymentButtons[0] < paymentButtons[1] && paymentButtons[1] < paymentButtons[2], 'las tres acciones de cobro deben aparecer en el orden solicitado');
assert.match(app, /paymentMode: 'pending'/, 'la lógica debe comenzar cada formulario con Pendiente');
assert.ok(!app.includes('data-cart-paid') && !app.includes('cart-paid-label'), 'el registro de venta no debe mostrar controles de unidades pagadas');
assert.ok(app.includes("state.paymentMode === 'paid' ? item.quantity"), 'Pagó debe marcar todas las unidades como pagadas');
assert.ok(app.includes("state.paymentMode = 'pending';"), 'al guardar y reiniciar, el estado vuelve a Pendiente');
assert.ok(app.includes('caracasToday') && !app.includes('new Date().toISOString().slice(0, 10)'), 'la fecha automática debe basarse en la zona horaria de Caracas');
assert.ok(app.includes("state.saleDateManuallySelected = true;") && app.includes('setInterval(refreshDefaultSaleDate'), 'la fecha manual se conserva y la predeterminada se actualiza con la aplicación abierta');
assert.ok(app.includes('saveSelectedSaleDate(window.localStorage') && app.includes('readSavedSaleDate(window.localStorage') && app.includes('clearSelectedSaleDate(window.localStorage'), 'la fecha se recuerda y Hoy restablece el modo automático');
const saleSaveFlow = app.slice(app.indexOf("$('#saleForm').addEventListener('submit'"), app.indexOf("document.body.addEventListener('click'"));
assert.ok(!saleSaveFlow.includes('setSaleDate(today())') && !saleSaveFlow.includes('state.saleDateManuallySelected = false'), 'guardar una venta no debe reiniciar la fecha');
assert.ok(html.includes('id="correctSaleDatesButton"'), 'la herramienta de corrección debe estar en Más');
assert.ok(app.includes('planSaleDateCorrection') && app.includes('correctSalesDate(saleIds'), 'la corrección debe validar conflictos y guardar solo ventas seleccionadas');
assert.ok(app.includes('sortSalesPendingFirst(rows)'), 'el historial debe ordenar primero las ventas con saldo pendiente');
assert.ok(html.includes('id="massCollectionButton"') && app.includes('function openMassCollection()'), 'el historial debe ofrecer cobranza masiva por cliente');
assert.ok(app.includes("$('#toggleMassContact').addEventListener") && app.includes('updateCustomerContact(customer, customer.collectionContact?.status !== \'contacted\')'), 'el indicador de contacto solo cambia al pulsar su acción manual');
assert.ok(app.includes('editSaleProducts') && app.includes('removeSaleProduct') && app.includes('changeSaleProductQuantity'), 'el detalle debe permitir editar productos con validaciones contables');
assert.ok(app.includes("button.textContent = 'Procesando…'") && app.includes("No se pudo eliminar el producto. No se modificaron los pagos."), 'eliminar producto debe dar respuesta y capturar errores de guardado');
assert.ok(app.includes('No se puede eliminar ${item.name}: tiene unidades o movimientos de pago vinculados') && app.includes('Producto eliminado; total, saldo e historial actualizados.'), 'la eliminación protegida debe explicar conflictos y refrescar totales e historial');
assert.ok(app.includes("$('#modalBody').addEventListener('click'") && app.includes("event.target.closest('#removeSaleProduct')"), 'el clic debe manejarse por delegación desde el contenedor estable del modal');
assert.ok(app.includes('id="removeSaleProductConfirm"') && app.includes('data-sale-product-action="confirm"'), 'la confirmación se muestra dentro del modal y no depende de window.confirm');
const removalFlow = app.slice(app.indexOf('function requestSaleProductRemoval'), app.indexOf('function openSale(sale)'));
assert.ok(removalFlow && !removalFlow.includes('confirm('), 'la confirmación no debe invocar prompts nativos dentro del dialog');
assert.ok(app.includes('collectionContact') && app.includes('buildDetailedCollectionMessage(customer, summary, state.settings)'), 'cada mensaje masivo usa la plantilla común y el indicador separado');
assert.ok(serviceWorker.includes('renuevo-ventas-v18'), 'la caché offline se actualiza con los cambios');
const styles = await readFile(new URL('styles.css', root), 'utf8');
assert.ok(styles.includes('minmax(76px,15fr) minmax(0,50fr) minmax(150px,35fr)'), 'el ancho de escritorio debe aproximarse a 15/50/35');
assert.ok(styles.includes('.sale-phone-field input'), 'el campo de teléfono debe tener ancho y formato numérico adaptables');

for (const icon of manifest.icons) await access(new URL(icon.src, root));
console.log('Validación PWA completada correctamente.');

