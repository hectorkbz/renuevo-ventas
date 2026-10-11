# Renuevo Ventas

PWA local para registrar ventas dominicales y cobros. No requiere servidor de aplicación, cuentas ni servicios externos: los datos permanecen en IndexedDB en el dispositivo.

Incluye venta rápida, clientes, productos y mensajes editables de cobranza por WhatsApp. Los precios quedan copiados en cada venta para conservar el historial aunque luego cambie el producto.

## Probar localmente

Los service workers requieren HTTP o HTTPS. Desde esta carpeta:

```sh
python3 -m http.server 4173
```

Abre `http://localhost:4173`. En iPhone, publícala mediante cualquier alojamiento HTTPS estático, ábrela en Safari y usa **Compartir → Agregar a pantalla de inicio**.

## Publicar en GitHub Pages

1. Crea un repositorio en GitHub y sube la rama `main`.
2. En **Settings → Pages → Build and deployment**, selecciona **GitHub Actions**.
3. El flujo incluido en `.github/workflows/deploy-pages.yml` publicará cada cambio enviado a `main`.

Todas las rutas son relativas, por lo que la aplicación funciona bajo un subdirectorio como `usuario.github.io/renuevo-ventas/`.

## Datos y respaldos

- **CSV** exporta las ventas en un formato que Excel puede abrir.
- **Descargar respaldo** guarda productos, clientes y ventas en JSON.
- **Restaurar respaldo** reemplaza los datos locales tras pedir confirmación.

Cada instalación del navegador conserva su propia copia. Conviene descargar respaldos periódicamente, en especial antes de borrar datos de Safari o cambiar de teléfono.

## Validación

```sh
node tests/validate.mjs
node tests/billing.test.mjs
node tests/sales.test.mjs
node tests/catalog.test.mjs
node --check app.js
node --check db.js
node --check sw.js
```
