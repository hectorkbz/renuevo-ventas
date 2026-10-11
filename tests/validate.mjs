import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root), 'utf8'));
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, './');
assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));

const serviceWorker = await readFile(new URL('sw.js', root), 'utf8');
for (const asset of ['./index.html', './styles.css', './app.js', './billing.js', './catalog.js', './sales.js', './db.js', './manifest.webmanifest']) {
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
assert.ok(html.includes('id="saleCustomerPhone" type="tel" inputmode="tel"'), 'el teléfono debe activar el teclado telefónico');
assert.ok(!html.match(/id="saleCustomerPhone"[^>]*required/), 'el teléfono no debe ser obligatorio');
for (const relativeReference of ['href="manifest.webmanifest"', 'src="app.js"', 'href="styles.css"']) assert.ok(html.includes(relativeReference));

for (const icon of manifest.icons) await access(new URL(icon.src, root));
console.log('Validación PWA completada correctamente.');
