export const PRODUCT_CATALOG = Object.freeze([
  { name: 'Agua saborizada', price: 1.15 },
  { name: 'Café', price: 0.5 },
  { name: 'Combo Tequeños', price: 2.5 },
  { name: 'Malta', price: 1 },
  { name: 'Palmeritas', price: 2.5 },
  { name: 'Papas', price: 1 },
  { name: 'Pasteles de manzana', price: 2.5 },
  { name: 'Tequeños', price: 1.5 },
  { name: 'Tostón', price: 1 }
]);

export function normalizeProductName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es');
}

export function reconcileProductCatalog(existingProducts = []) {
  const canonicalNames = new Set(PRODUCT_CATALOG.map(product => normalizeProductName(product.name)));
  const existingByName = new Map();
  for (const product of [...existingProducts].sort((a, b) => (a.id ?? Infinity) - (b.id ?? Infinity))) {
    const key = normalizeProductName(product.name);
    if (canonicalNames.has(key) && !existingByName.has(key)) existingByName.set(key, product);
  }
  return PRODUCT_CATALOG.map(canonical => {
    const existing = existingByName.get(normalizeProductName(canonical.name));
    return existing ? { ...existing, name: canonical.name, price: canonical.price } : { ...canonical };
  });
}
