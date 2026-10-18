import type { Unit } from '../types';

const unitToBase: Record<Unit, number> = {
  g: 1,
  kg: 1000,
  ml: 1,
  litre: 1000,
  piece: 1,
  packet: 1,
  box: 1,
  bottle: 1,
};

const unitDimension: Record<Unit, 'mass' | 'volume' | Unit> = {
  g: 'mass',
  kg: 'mass',
  ml: 'volume',
  litre: 'volume',
  piece: 'piece',
  packet: 'packet',
  box: 'box',
  bottle: 'bottle',
};

export const areUnitsCompatible = (fromUnit: Unit, toUnit: Unit): boolean => unitDimension[fromUnit] === unitDimension[toUnit];

export const normalizeQuantity = (value: number, fromUnit: Unit): number => value * unitToBase[fromUnit];

export const convertQuantity = (value: number, fromUnit: Unit, toUnit: Unit): number => {
  if (!areUnitsCompatible(fromUnit, toUnit)) {
    throw new Error(`Cannot convert ${fromUnit} to ${toUnit}.`);
  }
  const base = normalizeQuantity(value, fromUnit);
  const toBase = unitToBase[toUnit] || 1;
  return base / toBase;
};

export const formatQuantity = (value: number, unit: Unit): string => {
  const rounded = Math.abs(value) < 0.01 ? 0 : Number(value.toFixed(3));
  return `${rounded} ${unit}`;
};

export const roundToUnit = (value: number, decimals = 6): number => Number(value.toFixed(decimals));
