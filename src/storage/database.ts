import type { Account, AccountTransaction, AppDatabase, Business, DailySaleAdjustment, PaymentMethod, Purchase, PurchaseItem, Recipe, RecipeVersion, SaleDay, Settings, InventoryTransaction } from '../types';
import { generateId } from '../utils/ids';
import { toBusinessDateKey } from '../utils/dates';
import { createDefaultDatabase } from './databaseDefaults';

export const DB_KEY = 'bonafide_business_db';

export { createDefaultDatabase } from './databaseDefaults';

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asRecord = (value: unknown): UnknownRecord => isRecord(value) ? value : {};
const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const stringValue = (value: unknown, fallback: string): string => typeof value === 'string' ? value : fallback;
const numberValue = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const booleanValue = (value: unknown, fallback: boolean): boolean => typeof value === 'boolean' ? value : fallback;

const paymentMethods = (value: unknown, fallback: PaymentMethod[]): PaymentMethod[] => {
  if (!Array.isArray(value)) return fallback;
  const allowed: PaymentMethod[] = ['cash', 'upi', 'card', 'other'];
  return value.filter((method): method is PaymentMethod => allowed.includes(method as PaymentMethod));
};

const migrateRecipeVersions = (source: UnknownRecord): RecipeVersion[] => {
  const currentVersions = asArray<unknown>(source.recipeVersions);
  const legacyRecipes = asArray<unknown>(source.recipes);
  const versions = currentVersions.length > 0
    ? currentVersions
    : legacyRecipes.filter((recipe) => isRecord(recipe) && Array.isArray(recipe.ingredients));

  return versions.filter(isRecord).map((version, index) => {
    const productId = stringValue(version.productId, '');
    const createdAt = stringValue(version.createdAt, new Date().toISOString());
    return {
      ...version,
      id: stringValue(version.id, `recipe_version_${index + 1}`),
      recipeId: stringValue(version.recipeId, `recipe_${productId || index + 1}`),
      productId,
      versionNumber: numberValue(version.versionNumber, 1),
      effectiveFrom: stringValue(version.effectiveFrom, createdAt),
      ingredients: asArray(version.ingredients),
      createdAt,
      updatedAt: stringValue(version.updatedAt, createdAt),
    } as RecipeVersion;
  });
};

const migrateRecipes = (source: UnknownRecord, versions: RecipeVersion[], products: AppDatabase['products']): Recipe[] => {
  const definitions = asArray<unknown>(source.recipes)
    .filter((recipe): recipe is UnknownRecord => isRecord(recipe) && !Array.isArray(recipe.ingredients));

  if (definitions.length > 0) {
    return definitions.map((recipe, index) => {
      const createdAt = stringValue(recipe.createdAt, new Date().toISOString());
      return {
        ...recipe,
        id: stringValue(recipe.id, `recipe_${index + 1}`),
        productId: stringValue(recipe.productId, ''),
        name: stringValue(recipe.name, 'Product recipe'),
        createdAt,
        updatedAt: stringValue(recipe.updatedAt, createdAt),
      } as Recipe;
    });
  }

  const productIds = [...new Set(versions.map((version) => version.productId).filter(Boolean))];
  return productIds.map((productId) => {
    const productVersions = versions.filter((version) => version.productId === productId);
    const latest = [...productVersions].sort((left, right) => right.versionNumber - left.versionNumber)[0];
    const product = products.find((item) => item.id === productId);
    const recipeId = latest?.recipeId ?? `recipe_${productId}`;
    const now = new Date().toISOString();
    return {
      id: recipeId,
      productId,
      name: `${product?.name ?? 'Product'} recipe`,
      activeVersionId: latest?.id,
      createdAt: latest?.createdAt ?? now,
      updatedAt: latest?.updatedAt ?? now,
    };
  });
};

const migratePurchases = (value: unknown): Purchase[] => asArray<unknown>(value).filter(isRecord).map((purchase, index) => {
  const createdAt = stringValue(purchase.createdAt, new Date().toISOString());
  const currentItems = asArray<unknown>(purchase.items).filter(isRecord);
  const items: PurchaseItem[] = currentItems.length > 0
    ? currentItems.map((item, itemIndex) => ({
      ...item,
      id: stringValue(item.id, `purchase_item_${index + 1}_${itemIndex + 1}`),
      rawMaterialId: stringValue(item.rawMaterialId, ''),
      rawMaterialName: stringValue(item.rawMaterialName, 'Raw material'),
      quantity: numberValue(item.quantity, 0),
      unit: stringValue(item.unit, 'piece') as PurchaseItem['unit'],
      rate: numberValue(item.rate, 0),
      total: numberValue(item.total, 0),
    }))
    : [{
      id: `${stringValue(purchase.id, `purchase_${index + 1}`)}_item`,
      rawMaterialId: stringValue(purchase.rawMaterialId, ''),
      rawMaterialName: stringValue(purchase.rawMaterialName, 'Raw material'),
      quantity: numberValue(purchase.quantity, 0),
      unit: stringValue(purchase.unit, 'piece') as PurchaseItem['unit'],
      rate: numberValue(purchase.rate, 0),
      total: numberValue(purchase.total, 0),
    }];

  return {
    id: stringValue(purchase.id, `purchase_${index + 1}`),
    createdAt,
    updatedAt: stringValue(purchase.updatedAt, createdAt),
    date: stringValue(purchase.date, createdAt.slice(0, 10)),
    supplierId: typeof purchase.supplierId === 'string' ? purchase.supplierId : undefined,
    supplierName: stringValue(purchase.supplierName, stringValue(purchase.supplier, 'General Supplier')),
    invoiceNumber: stringValue(purchase.invoiceNumber, ''),
    items,
    total: numberValue(purchase.total, items.reduce((sum, item) => sum + item.total, 0)),
    paymentMethod: paymentMethods([purchase.paymentMethod], ['cash'])[0] ?? 'cash',
    paidAmount: numberValue(purchase.paidAmount, 0),
    creditAmount: numberValue(purchase.creditAmount, 0),
    notes: typeof purchase.notes === 'string' ? purchase.notes : undefined,
  };
});

export const migrateDatabase = (input: unknown): AppDatabase => {
  const source = asRecord(input);
  const defaults = createDefaultDatabase();
  const oldBusiness = asRecord(source.business);
  const oldSettings = asRecord(source.settings);
  const products = asArray<AppDatabase['products'][number]>(source.products);
  const rawMaterials = asArray<AppDatabase['rawMaterials'][number]>(source.rawMaterials);
  const accounts = asArray<unknown>(source.accounts)
    .filter((account): account is UnknownRecord => isRecord(account) && typeof account.name === 'string' && (account.type === 'cash' || account.type === 'online'))
    .map((account, index): Account => {
      const createdAt = stringValue(account.createdAt, defaults.business.createdAt);
      return {
        id: stringValue(account.id, `account_${index + 1}`),
        name: stringValue(account.name, 'Account'),
        type: account.type === 'cash' ? 'cash' : 'online',
        openingBalance: numberValue(account.openingBalance, 0),
        openingDate: stringValue(account.openingDate, '0001-01-01'),
        active: booleanValue(account.active, true),
        createdAt,
        updatedAt: stringValue(account.updatedAt, createdAt),
      };
    });
  const legacyAccountRows = asArray<unknown>(source.accounts).filter(isRecord).filter((entry) => 'direction' in entry && 'amount' in entry);
  const accountTransactions = asArray<unknown>(source.accountTransactions ?? legacyAccountRows)
    .filter(isRecord)
    .map((entry, index): AccountTransaction => {
      const method = paymentMethods([entry.type], ['cash'])[0] ?? 'cash';
      const matchingAccount = (accounts.length ? accounts : defaults.accounts).find((account) => account.type === (method === 'cash' ? 'cash' : 'online'));
      const createdAt = stringValue(entry.createdAt, defaults.business.createdAt);
      return {
        id: stringValue(entry.id, `account_transaction_${index + 1}`),
        transactionId: stringValue(entry.transactionId, stringValue(entry.id, `account_transaction_${index + 1}`)),
        accountId: stringValue(entry.accountId, matchingAccount?.id ?? defaults.accounts[0].id),
        date: stringValue(entry.date, createdAt.slice(0, 10)),
        type: method,
        label: stringValue(entry.label, 'Imported transaction'),
        amount: numberValue(entry.amount, 0),
        direction: entry.direction === 'out' ? 'out' : 'in',
        source: stringValue(entry.source, 'imported'),
        sourceType: ['sale', 'purchase', 'expense', 'transfer', 'refund', 'reversal', 'opening', 'manual'].includes(String(entry.sourceType)) ? entry.sourceType as AccountTransaction['sourceType'] : undefined,
        idempotencyKey: typeof entry.idempotencyKey === 'string' ? entry.idempotencyKey : undefined,
        transferId: typeof entry.transferId === 'string' ? entry.transferId : undefined,
        reversesTransactionId: typeof entry.reversesTransactionId === 'string' ? entry.reversesTransactionId : undefined,
        reversedByTransactionId: typeof entry.reversedByTransactionId === 'string' ? entry.reversedByTransactionId : undefined,
        notes: typeof entry.notes === 'string' ? entry.notes : undefined,
        createdAt,
        updatedAt: stringValue(entry.updatedAt, createdAt),
      };
    });
  const accountOpeningDate = accountTransactions.reduce((earliest, entry) => entry.date < earliest ? entry.date : earliest, defaults.business.createdAt.slice(0, 10));
  const normalizedAccounts = accounts.length
    ? accounts
    : defaults.accounts.map((account) => ({ ...account, openingDate: accountOpeningDate }));

  const business: Business = {
    ...defaults.business,
    id: stringValue(oldBusiness.id, defaults.business.id),
    businessName: stringValue(oldBusiness.businessName, stringValue(oldBusiness.name, defaults.business.businessName)),
    address: stringValue(oldBusiness.address, defaults.business.address),
    phone: typeof oldBusiness.phone === 'string' ? oldBusiness.phone : undefined,
    email: typeof oldBusiness.email === 'string' ? oldBusiness.email : undefined,
    taxRegistrationNumber: typeof oldBusiness.taxRegistrationNumber === 'string' ? oldBusiness.taxRegistrationNumber : undefined,
    createdAt: stringValue(oldBusiness.createdAt, defaults.business.createdAt),
    updatedAt: stringValue(oldBusiness.updatedAt, stringValue(oldBusiness.createdAt, defaults.business.updatedAt)),
  };

  const oldLowStock = asRecord(oldSettings.lowStockDefaults);
  const settings: Settings = {
    ...defaults.settings,
    id: stringValue(oldSettings.id, defaults.settings.id),
    businessId: business.id,
    currency: stringValue(oldSettings.currency, defaults.settings.currency),
    lowStockDefaults: {
      minimum: numberValue(oldLowStock.minimum, defaults.settings.lowStockDefaults.minimum),
      reorder: numberValue(oldLowStock.reorder, defaults.settings.lowStockDefaults.reorder),
    },
    paymentMethods: paymentMethods(oldSettings.paymentMethods, defaults.settings.paymentMethods),
    preventNegativeStock: booleanValue(oldSettings.preventNegativeStock, defaults.settings.preventNegativeStock),
    dateFormat: stringValue(oldSettings.dateFormat, defaults.settings.dateFormat),
    createdAt: stringValue(oldSettings.createdAt, defaults.settings.createdAt),
    updatedAt: stringValue(oldSettings.updatedAt, stringValue(oldSettings.createdAt, defaults.settings.updatedAt)),
  };

  const versions = migrateRecipeVersions(source);
  const oldSaleDays = source.saleDays ?? source.sales ?? source.finalizedDays;

  return {
    ...defaults,
    version: 1,
    business,
    settings,
    products,
    rawMaterials,
    recipes: migrateRecipes(source, versions, products),
    recipeVersions: versions,
    saleDays: asArray<SaleDay>(oldSaleDays),
    dailySaleAdjustments: asArray<DailySaleAdjustment>(source.dailySaleAdjustments),
    purchases: migratePurchases(source.purchases),
    suppliers: asArray<AppDatabase['suppliers'][number]>(source.suppliers),
    expenses: asArray<AppDatabase['expenses'][number]>(source.expenses),
    inventoryTransactions: asArray<AppDatabase['inventoryTransactions'][number]>(source.inventoryTransactions),
    wastage: asArray<AppDatabase['wastage'][number]>(source.wastage),
    stockAdjustments: asArray<AppDatabase['stockAdjustments'][number]>(source.stockAdjustments),
    accounts: normalizedAccounts,
    accountTransactions,
    cashReconciliations: asArray<AppDatabase['cashReconciliations'][number]>(source.cashReconciliations),
    auditLogs: asArray<AppDatabase['auditLogs'][number]>(source.auditLogs).map((entry) => ({
      ...entry,
      updatedAt: entry.updatedAt || entry.createdAt || new Date().toISOString(),
    })),
  };
};

export const createInventoryTransaction = (
  rawMaterialId: string,
  type: InventoryTransaction['type'],
  reference: string,
  quantity: number,
  unit: InventoryTransaction['unit'],
  rate: number,
  value: number,
  balanceAfter: number,
  notes?: string,
): InventoryTransaction => {
  const now = new Date().toISOString();
  return {
    id: generateId('inv'),
    createdAt: now,
    updatedAt: now,
    rawMaterialId,
    type,
    reference,
    quantity,
    unit,
    rate,
    value,
    balanceAfter,
    notes,
    date: toBusinessDateKey(),
  };
};
