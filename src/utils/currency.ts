export const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(value || 0);
};

export const roundCurrency = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
