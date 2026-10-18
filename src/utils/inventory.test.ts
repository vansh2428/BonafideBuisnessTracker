import assert from 'node:assert/strict';
import { calculateInventoryBalance, calculateWeightedAverageCost } from './inventory';

const openingQuantity = 5;
const openingValue = 5 * 400;
const purchaseQuantity = 10;
const purchaseRate = 500;
const averageCost = calculateWeightedAverageCost(
  openingQuantity,
  openingValue,
  purchaseQuantity,
  purchaseQuantity * purchaseRate,
);
const totalQuantity = openingQuantity + purchaseQuantity;
const totalValue = openingValue + purchaseQuantity * purchaseRate;

assert.equal(totalQuantity, 15);
assert.equal(totalValue, 7000);
assert.ok(Math.abs(averageCost - 466.6666666666667) < 0.000001);
assert.equal(calculateWeightedAverageCost(0, 0, 0, 0), 0);
assert.equal(calculateInventoryBalance([
  { type: 'OPENING_STOCK', quantity: 8 },
  { type: 'PURCHASE', quantity: 4 },
  { type: 'SALE_CONSUMPTION', quantity: 3 },
  { type: 'WASTAGE', quantity: 1 },
]), 8);
console.log('Weighted average cost test passed:', JSON.stringify({ totalQuantity, totalValue, averageCost }));
