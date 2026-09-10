import { isDiscreteInventoryUnit } from '@/services/inventoryApi';

export function formatInventoryQuantity(value: string | number, unit: string): string {
  const quantity = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(quantity)) return String(value);

  const maximumFractionDigits = isDiscreteInventoryUnit(unit) && Number.isInteger(quantity) ? 0 : 3;
  return new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(quantity);
}
