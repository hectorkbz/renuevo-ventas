const CARACAS = 'America/Caracas';
export const SALE_DATE_STORAGE_KEY = 'renuevo-ventas:selected-sale-date';

const calendarParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: CARACAS,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

function utcNoon(dateValue) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateValue || ''));
  if (!match) return new Date(dateValue);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}

export function caracasToday(now = new Date()) {
  const parts = Object.fromEntries(calendarParts.formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function caracasShortDate(dateValue) {
  const parts = new Intl.DateTimeFormat('es', { timeZone: CARACAS, day: 'numeric', month: 'short' })
    .formatToParts(utcNoon(dateValue));
  const day = parts.find(part => part.type === 'day')?.value || '';
  const month = (parts.find(part => part.type === 'month')?.value || '').replace('.', '');
  return `${day} ${month}.`;
}

export function caracasLongDate(dateValue) {
  return new Intl.DateTimeFormat('es-MX', { timeZone: CARACAS, dateStyle: 'medium' }).format(utcNoon(dateValue));
}

export function shouldRefreshDefaultSaleDate(selectedDate, currentDate, manuallySelected, hasCart) {
  return !manuallySelected && !hasCart && selectedDate !== currentDate;
}

export function readSavedSaleDate(storage) {
  try {
    const value = storage.getItem(SALE_DATE_STORAGE_KEY);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const parsed = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
  } catch { return null; }
}

export function saveSelectedSaleDate(storage, dateValue) {
  storage.setItem(SALE_DATE_STORAGE_KEY, dateValue);
}

export function clearSelectedSaleDate(storage) {
  storage.removeItem(SALE_DATE_STORAGE_KEY);
}

export function planSaleDateCorrection(sales, selectedSaleIds, sourceDate, destinationDate) {
  const ids = [...new Set(selectedSaleIds.map(Number))];
  const idSet = new Set(ids);
  const selected = sales.filter(sale => idSet.has(Number(sale.id)) && sale.date === sourceDate);
  const missingIds = ids.filter(id => !selected.some(sale => Number(sale.id) === id));
  const conflicts = [];

  if (!sourceDate || !destinationDate || sourceDate === destinationDate) {
    conflicts.push({ type: 'invalid-dates' });
  }

  const selectedByCustomer = new Map();
  for (const sale of selected) {
    selectedByCustomer.set(sale.customerId, [...(selectedByCustomer.get(sale.customerId) || []), sale]);
    const destinationSales = sales.filter(other => other.customerId === sale.customerId && other.date === destinationDate && !idSet.has(Number(other.id)));
    if (destinationSales.length) conflicts.push({ type: 'destination-exists', customerId: sale.customerId, saleIds: [sale.id, ...destinationSales.map(other => other.id)] });
  }
  for (const [customerId, customerSales] of selectedByCustomer) {
    if (customerSales.length > 1) conflicts.push({ type: 'duplicate-after-move', customerId, saleIds: customerSales.map(sale => sale.id) });
  }

  return { selected, missingIds, conflicts, canApply: ids.length > 0 && missingIds.length === 0 && conflicts.length === 0 };
}

export function withCorrectedSaleDate(sales, destinationDate) {
  return sales.map(sale => ({ ...sale, date: destinationDate }));
}

