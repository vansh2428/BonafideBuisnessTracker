import type { Ingredient, RawMaterial, RecipeVersion, Unit } from '../types';
import { convertQuantity } from './units';

export interface RecipeConsumption {
  ingredientId: string;
  rawMaterialId: string;
  rawMaterialName: string;
  quantity: number;
  unit: Unit;
  cost: number;
}

export interface ProductMargin {
  grossProfit: number;
  marginPercentage: number;
}

const getMaterial = (rawMaterials: RawMaterial[], rawMaterialId: string): RawMaterial | undefined =>
  rawMaterials.find((material) => material.id === rawMaterialId && material.active);

export const calculateRecipeConsumption = (
  recipe: RecipeVersion | null | undefined,
  rawMaterials: RawMaterial[],
  quantityScale = 1,
): RecipeConsumption[] => {
  if (!recipe) return [];

  return recipe.ingredients.reduce<RecipeConsumption[]>((consumption, ingredient: Ingredient) => {
    const material = getMaterial(rawMaterials, ingredient.rawMaterialId);
    if (!material) return consumption;

    const convertedQuantity = convertQuantity(
      ingredient.quantity * quantityScale,
      ingredient.unit,
      material.unit,
    );
    const cost = convertedQuantity * material.averageCost;

    consumption.push({
      ingredientId: ingredient.id,
      rawMaterialId: material.id,
      rawMaterialName: material.name,
      quantity: convertedQuantity,
      unit: material.unit,
      cost,
    });
    return consumption;
  }, []);
};

export const calculateRecipeCost = (
  recipe: RecipeVersion | null | undefined,
  rawMaterials: RawMaterial[],
  quantityScale = 1,
): number => calculateRecipeConsumption(recipe, rawMaterials, quantityScale)
  .reduce((total, item) => total + item.cost, 0);

export const calculateProductMargin = (
  sellingPrice: number,
  recipeCost: number,
): ProductMargin => {
  const grossProfit = sellingPrice - recipeCost;
  const marginPercentage = sellingPrice > 0 ? (grossProfit / sellingPrice) * 100 : 0;
  return { grossProfit, marginPercentage };
};
