# Renuevo Ventas

PWA local para registrar ventas dominicales, cobros e inventario. No requiere servidor de aplicación, cuentas ni servicios externos: los datos permanecen en IndexedDB en el dispositivo.

## Probar localmente

Los service workers requieren HTTP o HTTPS. Desde esta carpeta:

```sh
python3 -m http.server 4173
```

Abre `http://localhost:4173`. En iPhone, publícala mediante cualquier alojamiento HTTPS estático, ábrela en Safari y usa **Compartir → Agregar a pantalla de inicio**.

## Datos y respaldos

- **CSV** exporta las ventas en un formato que Excel puede abrir.
- **Descargar respaldo** guarda productos, clientes y ventas en JSON.
- **Restaurar respaldo** reemplaza los datos locales tras pedir confirmación.

Cada instalación del navegador conserva su propia copia. Conviene descargar respaldos periódicamente, en especial antes de borrar datos de Safari o cambiar de teléfono.

## Validación

```sh
node tests/validate.mjs
node --check app.js
node --check db.js
node --check sw.js
```
