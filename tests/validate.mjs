import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root), 'utf8'));
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, './');
assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));

const serviceWorker = await readFile(new URL('sw.js', root), 'utf8');
for (const asset of ['./index.html', './styles.css', './app.js', './billing.js', './db.js', './manifest.webmanifest']) {
  assert.ok(serviceWorker.includes(asset), `${asset} debe estar en la caché offline`);
}

const database = await readFile(new URL('db.js', root), 'utf8');
for (const store of ['products', 'customers', 'sales', 'settings']) assert.ok(database.includes(`'${store}'`));
assert.ok(database.includes("transaction(['sales', 'products'], 'readwrite')"), 'venta e inventario deben compartir transacción');

const html = await readFile(new URL('index.html', root), 'utf8');
assert.ok(html.includes('apple-mobile-web-app-capable'));
assert.ok(html.includes('viewport-fit=cover'));
for (const relativeReference of ['href="manifest.webmanifest"', 'src="app.js"', 'href="styles.css"']) assert.ok(html.includes(relativeReference));

for (const icon of manifest.icons) await access(new URL(icon.src, root));
console.log('Validación PWA completada correctamente.');
