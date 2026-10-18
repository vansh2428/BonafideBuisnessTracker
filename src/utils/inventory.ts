export interface WeightedAverageInputs {
  existingQuantity: number;
  existingValue: number;
  newQuantity: number;
  newValue: number;
}

export const calculateWeightedAverageCost = (
  existingQuantity: number,
  existingValue: number,
  newQuantity: number,
  newValue: number,
): number => {
  const totalQuantity = existingQuantity + newQuantity;
  if (totalQuantity <= 0) return 0;
  return (existingValue + newValue) / totalQuantity;
};

export const calculateInventoryBalance = (
  transactions: Array<{ type: string; quantity: number }>,
): number => transactions.reduce((balance, transaction) => {
  const quantity = Math.max(0, transaction.quantity);
  if (transaction.type === 'OPENING_STOCK' || transaction.type === 'PURCHASE' || transaction.type === 'ADJUSTMENT_IN' || transaction.type === 'TRANSFER_IN') {
    return balance + quantity;
  }
  if (transaction.type === 'SALE_CONSUMPTION' || transaction.type === 'WASTAGE' || transaction.type === 'ADJUSTMENT_OUT' || transaction.type === 'TRANSFER_OUT') {
    return balance - quantity;
  }
  return balance;
}, 0);
