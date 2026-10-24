import { DB_KEY, createDefaultDatabase, migrateDatabase } from './database';
import type {
  AccountTransaction,
  AppDatabase,
  AuditLog,
  ExpenseRecord,
  InventoryTransaction,
  PaymentSummary,
  Product,
  Purchase,
  RawMaterial,
  Recipe,
  RecipeVersion,
  SaleDay,
  Settings,
  StockAdjustmentRecord,
  Supplier,
  WastageRecord,
} from '../types';

const getStorage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

export interface DatabaseValidationResult {
  valid: boolean;
  errors: string[];
  database?: AppDatabase;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasStableIds = (records: unknown[], collectionName: string, errors: string[]): void => {
  records.forEach((record, index) => {
    if (!isRecord(record) || typeof record.id !== 'string' || record.id.trim() === '') {
      errors.push(`${collectionName}[${index}] is missing a stable id.`);
    }
  });
};

export const validateDatabase = (input: unknown): DatabaseValidationResult => {
  const errors: string[] = [];
  if (!isRecord(input)) return { valid: false, errors: ['Database JSON must be an object.'] };
  if (input.version !== 1) errors.push('Unsupported or missing database version.');
  if (!isRecord(input.business)) errors.push('Business data is missing or invalid.');
  if (!isRecord(input.settings)) errors.push('Settings data is missing or invalid.');

  const collectionKeys = [
    'products', 'rawMaterials', 'recipes', 'recipeVersions', 'saleDays', 'purchases', 'suppliers',
    'expenses', 'inventoryTransactions', 'wastage', 'stockAdjustments', 'accountTransactions', 'auditLogs',
  ] as const;
  const legacyAliases: Partial<Record<(typeof collectionKeys)[number], string>> = {
    recipeVersions: 'recipes',
    saleDays: 'sales',
    accountTransactions: 'accounts',
  };

  for (const key of collectionKeys) {
    const value = input[key] ?? (legacyAliases[key] ? input[legacyAliases[key] as string] : undefined);
    if (!Array.isArray(value)) errors.push(`Database collection "${key}" must be an array.`);
    else hasStableIds(value, key, errors);
  }
  if (input.accounts !== undefined) {
    if (!Array.isArray(input.accounts)) errors.push('Database collection "accounts" must be an array.');
    else hasStableIds(input.accounts, 'accounts', errors);
  }
  if (input.cashReconciliations !== undefined) {
    if (!Array.isArray(input.cashReconciliations)) errors.push('Database collection "cashReconciliations" must be an array.');
    else hasStableIds(input.cashReconciliations, 'cashReconciliations', errors);
  }
  if (input.dailySaleAdjustments !== undefined) {
    if (!Array.isArray(input.dailySaleAdjustments)) errors.push('Database collection "dailySaleAdjustments" must be an array.');
    else hasStableIds(input.dailySaleAdjustments, 'dailySaleAdjustments', errors);
  }

  if (errors.length > 0) return { valid: false, errors };

  try {
    const database = migrateDatabase(input);
    return { valid: true, errors: [], database };
  } catch {
    return { valid: false, errors: ['Database JSON could not be normalized.'] };
  }
};

export const loadDatabase = (): AppDatabase => {
  try {
    const raw = getStorage()?.getItem(DB_KEY);
    return raw ? migrateDatabase(JSON.parse(raw) as unknown) : createDefaultDatabase();
  } catch {
    return createDefaultDatabase();
  }
};

export const initializeDatabase = (): AppDatabase => {
  try {
    const storage = getStorage();
    const raw = storage?.getItem(DB_KEY);
    if (!raw) {
      const database = createDefaultDatabase();
      saveDatabase(database);
      return database;
    }
    const result = validateDatabase(JSON.parse(raw) as unknown);
    if (!result.valid || !result.database) {
      const database = createDefaultDatabase();
      saveDatabase(database);
      return database;
    }
    if (!result.database.business.id || !result.database.settings.id) {
      const database = createDefaultDatabase();
      saveDatabase(database);
      return database;
    }
    if (JSON.stringify(result.database) !== raw) saveDatabase(result.database);
    return result.database;
  } catch {
    const database = createDefaultDatabase();
    saveDatabase(database);
    return database;
  }
};

export const saveDatabase = (database: AppDatabase): boolean => {
  try {
    const storage = getStorage();
    if (!storage) return false;
    const validation = validateDatabase(database);
    if (!validation.valid || !validation.database) return false;
    storage.setItem(DB_KEY, JSON.stringify(validation.database));
    return true;
  } catch {
    return false;
  }
};

export const clearDatabase = (): boolean => {
  try {
    const storage = getStorage();
    if (!storage) return false;
    storage.removeItem(DB_KEY);
    return true;
  } catch {
    return false;
  }
};

export const readDatabase = loadDatabase;

export const writeDatabase = (database: AppDatabase): AppDatabase => {
  saveDatabase(database);
  return database;
};

export const getProducts = (): Product[] => loadDatabase().products;
export const saveProducts = (products: Product[]): AppDatabase => writeDatabase({ ...loadDatabase(), products });

export const getRawMaterials = (): RawMaterial[] => loadDatabase().rawMaterials;
export const saveRawMaterials = (rawMaterials: RawMaterial[]): AppDatabase => writeDatabase({ ...loadDatabase(), rawMaterials });

export const getRecipes = (): RecipeVersion[] => loadDatabase().recipeVersions;
export const saveRecipes = (recipeVersions: RecipeVersion[]): AppDatabase => writeDatabase({ ...loadDatabase(), recipeVersions });
export const getRecipeDefinitions = (): Recipe[] => loadDatabase().recipes;

export const getSales = (): SaleDay[] => loadDatabase().saleDays;
export const saveSales = (saleDays: SaleDay[]): AppDatabase => writeDatabase({ ...loadDatabase(), saleDays });

export const getPurchases = (): Purchase[] => loadDatabase().purchases;
export const savePurchases = (purchases: Purchase[]): AppDatabase => writeDatabase({ ...loadDatabase(), purchases });

export const getExpenses = (): ExpenseRecord[] => loadDatabase().expenses;
export const saveExpenses = (expenses: ExpenseRecord[]): AppDatabase => writeDatabase({ ...loadDatabase(), expenses });

export const getInventoryTransactions = (): InventoryTransaction[] => loadDatabase().inventoryTransactions;
export const saveInventoryTransactions = (inventoryTransactions: InventoryTransaction[]): AppDatabase => writeDatabase({ ...loadDatabase(), inventoryTransactions });

export const getWastage = (): WastageRecord[] => loadDatabase().wastage;
export const saveWastage = (wastage: WastageRecord[]): AppDatabase => writeDatabase({ ...loadDatabase(), wastage });

export const getStockAdjustments = (): StockAdjustmentRecord[] => loadDatabase().stockAdjustments;
export const saveStockAdjustments = (stockAdjustments: StockAdjustmentRecord[]): AppDatabase => writeDatabase({ ...loadDatabase(), stockAdjustments });

export const getSuppliers = (): Supplier[] => loadDatabase().suppliers;
export const saveSuppliers = (suppliers: Supplier[]): AppDatabase => writeDatabase({ ...loadDatabase(), suppliers });

export const getAccountTransactions = (): AccountTransaction[] => loadDatabase().accountTransactions;
export const saveAccountTransactions = (accountTransactions: AccountTransaction[]): AppDatabase => writeDatabase({ ...loadDatabase(), accountTransactions });

export const getAuditLogs = (): AuditLog[] => loadDatabase().auditLogs;
export const saveAuditLogs = (auditLogs: AuditLog[]): AppDatabase => writeDatabase({ ...loadDatabase(), auditLogs });

export const exportDatabase = (database: AppDatabase = loadDatabase()): string => JSON.stringify(database, null, 2);

export const importDatabase = (payload: string): AppDatabase | null => {
  try {
    const parsed: unknown = JSON.parse(payload);
    const result = validateDatabase(parsed);
    if (!result.valid || !result.database) return null;
    return saveDatabase(result.database) ? result.database : null;
  } catch {
    return null;
  }
};

export const getDatabase = loadDatabase;
export const getSettings = (): Settings => loadDatabase().settings;

export const snapshotPaymentSummary = (summary: PaymentSummary): PaymentSummary => ({
  cash: Number(summary.cash || 0),
  upi: Number(summary.upi || 0),
  card: Number(summary.card || 0),
  other: Number(summary.other || 0),
});
