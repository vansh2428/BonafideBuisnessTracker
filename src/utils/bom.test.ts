import assert from 'node:assert/strict';
import type { Ingredient, RawMaterial, RecipeVersion } from '../types';
import {
  calculateProductMargin,
  calculateRecipeConsumption,
  calculateRecipeCost,
} from './bom';
import { convertQuantity } from './units';

const materials: RawMaterial[] = [
  {
    id: 'rm_waffle_base',
    name: 'Waffle Base',
    category: 'Base',
    unit: 'kg',
    currentStock: 5,
    minimumStock: 1,
    reorderLevel: 2,
    averageCost: 100,
    active: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'rm_dark_chocolate',
    name: 'Dark Chocolate',
    category: 'Chocolate',
    unit: 'kg',
    currentStock: 2,
    minimumStock: 1,
    reorderLevel: 2,
    averageCost: 400,
    active: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
];

const ingredients: Ingredient[] = [
  { id: 'ing_1', rawMaterialId: 'rm_waffle_base', quantity: 100, unit: 'g' },
  { id: 'ing_2', rawMaterialId: 'rm_dark_chocolate', quantity: 20, unit: 'g' },
];

const recipe: RecipeVersion = {
  id: 'recipe_test',
  recipeId: 'recipe_dark_chocolate',
  productId: 'prod_dark_choco',
  versionNumber: 1,
  effectiveFrom: '2026-10-01',
  ingredients,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const cost = calculateRecipeCost(recipe, materials);
const consumption = calculateRecipeConsumption(recipe, materials);
const margin = calculateProductMargin(49, cost);

assert.equal(cost, 18);
assert.equal(consumption.length, 2);
assert.equal(consumption[0].quantity, 0.1);
assert.equal(consumption[0].unit, 'kg');
assert.equal(consumption[0].cost, 10);
assert.equal(consumption[1].cost, 8);
assert.equal(margin.grossProfit, 31);
assert.ok(Math.abs(margin.marginPercentage - 63.26530612244898) < 0.000001);
assert.equal(convertQuantity(1000, 'g', 'kg'), 1);
assert.throws(() => convertQuantity(1, 'g', 'ml'), /Cannot convert/);

console.log('BOM dynamic calculation test passed:', JSON.stringify({ cost, margin }));
