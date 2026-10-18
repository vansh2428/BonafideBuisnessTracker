import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { initializeDatabase, saveDatabase, snapshotPaymentSummary } from '../storage/storageService';
import type { Account, AccountType, AppDatabase, Product, RawMaterial, SaleRecord, Recipe, RecipeVersion, PurchaseRecord, ExpenseRecord, WastageRecord, StockAdjustmentRecord, SupplierRecord, AuditLog, PaymentSummary, CashReconciliation, PaymentMethod } from '../types';
import { generateId } from '../utils/ids';
import { toBusinessDateKey } from '../utils/dates';
import { calculateRecipeConsumption } from '../utils/bom';
import { convertQuantity } from '../utils/units';
import { calculateWeightedAverageCost } from '../utils/inventory';
import { roundToUnit } from '../utils/units';
import { appendIdempotentEntries, buildPaymentEntries, buildReversalEntry, buildTransferEntries, getAccountBalance, getUnreversedEntries } from '../utils/accounts';

interface AppContextValue {
  database: AppDatabase;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  products: Product[];
  rawMaterials: RawMaterial[];
  recipes: RecipeVersion[];
  sales: SaleRecord[];
  purchases: PurchaseRecord[];
  expenses: ExpenseRecord[];
  inventoryTransactions: AppDatabase['inventoryTransactions'];
  wastage: WastageRecord[];
  stockAdjustments: StockAdjustmentRecord[];
  suppliers: SupplierRecord[];
  accounts: Account[];
  accountTransactions: AppDatabase['accountTransactions'];
  cashReconciliations: CashReconciliation[];
  auditLogs: AuditLog[];
  setDatabase: (db: AppDatabase) => void;
  addProduct: (product: Product) => void;
  updateProduct: (product: Product) => void;
  deleteProduct: (productId: string) => boolean;
  addRawMaterial: (material: RawMaterial) => void;
  updateRawMaterial: (material: RawMaterial) => void;
  deleteRawMaterial: (materialId: string) => boolean;
  addSupplier: (supplier: SupplierRecord) => void;
  updateSupplier: (supplier: SupplierRecord) => void;
  deleteSupplier: (supplierId: string) => boolean;
  addAccount: (account: Omit<Account, 'createdAt' | 'updatedAt'>) => void;
  deleteAccount: (accountId: string) => string | null;
  restoreAccount: (accountId: string) => string | null;
  transferAccounts: (fromAccountId: string, toAccountId: string, amount: number, date: string) => void;
  saveCashReconciliation: (record: Omit<CashReconciliation, 'id' | 'createdAt' | 'updatedAt' | 'expectedBalance'>) => void;
  saveRecipeForProduct: (productId: string, ingredients: { rawMaterialId: string; quantity: number; unit: RawMaterial['unit'] }[]) => void;
  addPurchase: (record: PurchaseRecord) => void;
  updatePurchase: (record: PurchaseRecord) => boolean;
  deletePurchase: (purchaseId: string) => boolean;
  addExpense: (record: ExpenseRecord) => void;
  updateExpense: (record: ExpenseRecord) => void;
  deleteExpense: (expenseId: string) => void;
  addWastage: (record: WastageRecord) => void;
  saveSaleDraft: (draft: { id?: string; date: string; basket: Array<{ productId: string; quantity: number }>; paymentSummary: PaymentSummary; cashAccountId?: string; onlineAccountId?: string }) => SaleRecord;
  finalizeSale: (draft: { date: string; basket: Array<{ productId: string; quantity: number }>; paymentSummary: PaymentSummary; cashAccountId?: string; onlineAccountId?: string; saleId?: string; idempotencyKey?: string }) => SaleRecord;
  reopenSale: (saleId: string) => SaleRecord | null;
  addAuditLog: (entry: Omit<AuditLog, 'id' | 'createdAt' | 'updatedAt'>) => void;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

const rebuildRawMaterialBalances = (
  rawMaterials: AppDatabase['rawMaterials'],
  purchases: PurchaseRecord[],
  inventoryTransactions: AppDatabase['inventoryTransactions'],
) => rawMaterials.map((material) => {
  const materialTransactions = inventoryTransactions.filter((entry) => entry.rawMaterialId === material.id);
  const currentStock = materialTransactions.reduce((balance, entry) => {
    const isIncoming = ['OPENING_STOCK', 'PURCHASE', 'ADJUSTMENT_IN', 'TRANSFER_IN'].includes(entry.type);
    return balance + (isIncoming ? entry.quantity : -entry.quantity);
  }, 0);

  const openingTransactions = materialTransactions.filter((entry) => entry.type === 'OPENING_STOCK');
  const openingQuantity = openingTransactions.reduce((sum, entry) => sum + entry.quantity, 0);
  const openingValue = openingTransactions.reduce((sum, entry) => sum + entry.value, 0);
  let costQuantity = openingQuantity;
  let inventoryValue = openingValue;
  const purchaseItems = purchases
    .flatMap((purchase) => purchase.items
      .filter((item) => item.rawMaterialId === material.id)
      .map((item) => ({ date: purchase.date, createdAt: purchase.createdAt, item })))
    .sort((left, right) => left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt));

  for (const { item } of purchaseItems) {
    const nextQuantity = costQuantity + item.quantity;
    inventoryValue += item.total;
    costQuantity = nextQuantity;
  }

  return {
    ...material,
    currentStock,
    averageCost: costQuantity > 0 ? inventoryValue / costQuantity : material.averageCost,
    updatedAt: new Date().toISOString(),
  };
});

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [database, setDatabaseState] = useState<AppDatabase>(() => initializeDatabase());
  const [selectedDate, setSelectedDate] = useState(toBusinessDateKey());

  const setDatabase = (db: AppDatabase) => {
    setDatabaseState(db);
    saveDatabase(db);
  };

  useEffect(() => {
    saveDatabase(database);
  }, [database]);

  const addProduct = (product: Product) => {
    const next = { ...database, products: [...database.products, product] };
    setDatabase(next);
  };

  const updateProduct = (product: Product) => {
    const nextProducts = database.products.map((item) => (item.id === product.id ? product : item));
    setDatabase({ ...database, products: nextProducts });
  };

  const deleteProduct = (productId: string) => {
    if (database.saleDays.some((sale) => sale.items.some((item) => item.productId === productId))) return false;
    setDatabase({
      ...database,
      products: database.products.filter((item) => item.id !== productId),
      recipes: database.recipes.filter((recipe) => recipe.productId !== productId),
      recipeVersions: database.recipeVersions.filter((recipe) => recipe.productId !== productId),
    });
    return true;
  };

  const addRawMaterial = (material: RawMaterial) => {
    const now = new Date().toISOString();
    const openingTransaction = material.currentStock > 0 ? [{
      id: generateId('opening-transaction'),
      createdAt: now,
      updatedAt: now,
      rawMaterialId: material.id,
      type: 'OPENING_STOCK' as const,
      reference: `Opening-${material.id}`,
      quantity: material.currentStock,
      unit: material.unit,
      rate: material.averageCost,
      value: material.currentStock * material.averageCost,
      balanceAfter: material.currentStock,
      notes: 'Opening stock',
      date: toBusinessDateKey(),
    }] : [];
    const next = {
      ...database,
      rawMaterials: [...database.rawMaterials, material],
      inventoryTransactions: [...database.inventoryTransactions, ...openingTransaction],
    };
    setDatabase(next);
  };

  const updateRawMaterial = (material: RawMaterial) => {
    const nextMaterials = database.rawMaterials.map((item) => (item.id === material.id ? material : item));
    setDatabase({ ...database, rawMaterials: nextMaterials });
  };

  const deleteRawMaterial = (materialId: string) => {
    const hasInventoryHistory = database.inventoryTransactions.some(
      (entry) => entry.rawMaterialId === materialId && entry.type !== 'OPENING_STOCK',
    )
      || database.recipeVersions.some((recipe) => recipe.ingredients.some((ingredient) => ingredient.rawMaterialId === materialId))
      || database.purchases.some((purchase) => purchase.items.some((item) => item.rawMaterialId === materialId))
      || database.wastage.some((entry) => entry.rawMaterialId === materialId)
      || database.stockAdjustments.some((entry) => entry.rawMaterialId === materialId);
    if (hasInventoryHistory) return false;
    setDatabase({
      ...database,
      rawMaterials: database.rawMaterials.filter((item) => item.id !== materialId),
      inventoryTransactions: database.inventoryTransactions.filter(
        (entry) => entry.rawMaterialId !== materialId || entry.type !== 'OPENING_STOCK',
      ),
    });
    return true;
  };

  const addSupplier = (supplier: SupplierRecord) => {
    setDatabase({ ...database, suppliers: [...database.suppliers, supplier] });
  };

  const updateSupplier = (supplier: SupplierRecord) => {
    setDatabase({
      ...database,
      suppliers: database.suppliers.map((item) => item.id === supplier.id ? supplier : item),
    });
  };

  const deleteSupplier = (supplierId: string) => {
    const supplier = database.suppliers.find((item) => item.id === supplierId);
    if (database.purchases.some((purchase) => purchase.supplierId === supplierId || (supplier && purchase.supplierName === supplier.name))) return false;
    setDatabase({ ...database, suppliers: database.suppliers.filter((item) => item.id !== supplierId) });
    return true;
  };

  const resolveAccountId = (accountId: string | undefined, type: AccountType): string => {
    const selected = accountId ? database.accounts.find((account) => account.id === accountId && account.active !== false) : undefined;
    if (selected && selected.type !== type) throw new Error(`Choose a ${type} account for this payment.`);
    const account = selected ?? database.accounts.find((item) => item.active !== false && item.type === type);
    if (!account) throw new Error(`Create a ${type} account before posting this payment.`);
    return account.id;
  };

  const addAccount = (record: Omit<Account, 'createdAt' | 'updatedAt'>) => {
    if (!record.name.trim() || !Number.isFinite(record.openingBalance) || record.openingBalance < 0) {
      throw new Error('Enter an account name and a valid nonnegative opening balance.');
    }
    if (database.accounts.some((account) => account.active !== false && account.name.trim().toLowerCase() === record.name.trim().toLowerCase())) {
      throw new Error('An account with this name already exists.');
    }
    const now = new Date().toISOString();
    setDatabase({ ...database, accounts: [...database.accounts, { ...record, name: record.name.trim(), active: true, createdAt: now, updatedAt: now }] });
  };

  const deleteAccount = (accountId: string): string | null => {
    const account = database.accounts.find((item) => item.id === accountId);
    if (!account) return 'This account no longer exists.';
    const isReferenced = database.accountTransactions.some((entry) => entry.accountId === accountId)
      || database.cashReconciliations.some((entry) => entry.accountId === accountId)
      || database.saleDays.some((sale) => sale.cashAccountId === accountId || sale.onlineAccountId === accountId)
      || database.purchases.some((purchase) => purchase.accountId === accountId)
      || database.expenses.some((expense) => expense.accountId === accountId);
    if (isReferenced) {
      setDatabase({ ...database, accounts: database.accounts.map((item) => item.id === accountId ? { ...item, active: false, updatedAt: new Date().toISOString() } : item) });
      return null;
    }
    setDatabase({ ...database, accounts: database.accounts.filter((item) => item.id !== accountId) });
    return null;
  };

  const restoreAccount = (accountId: string): string | null => {
    const account = database.accounts.find((item) => item.id === accountId);
    if (!account) return 'This account no longer exists.';
    if (database.accounts.some((item) => item.active !== false && item.name.trim().toLowerCase() === account.name.trim().toLowerCase())) {
      return 'An active account already uses this name. Rename the active account before restoring this one.';
    }
    setDatabase({ ...database, accounts: database.accounts.map((item) => item.id === accountId ? { ...item, active: true, updatedAt: new Date().toISOString() } : item) });
    return null;
  };

  const transferAccounts = (fromAccountId: string, toAccountId: string, amount: number, date: string) => {
    if (!database.accounts.some((account) => account.id === fromAccountId && account.active !== false) || !database.accounts.some((account) => account.id === toAccountId && account.active !== false)) {
      throw new Error('Choose two valid accounts for the transfer.');
    }
    const sourceAccount = database.accounts.find((account) => account.id === fromAccountId)!;
    if (getAccountBalance(sourceAccount, database.accountTransactions, date) + 0.000001 < amount) {
      throw new Error('The source account does not have enough available balance on that date.');
    }
    const transferId = generateId('transfer');
    const methods = Object.fromEntries(database.accounts.map((account) => [account.id, account.type === 'cash' ? 'cash' : 'upi'])) as Record<string, PaymentMethod>;
    const transactions = buildTransferEntries(fromAccountId, toAccountId, amount, date, transferId, methods);
    setDatabase({ ...database, accountTransactions: [...database.accountTransactions, ...transactions] });
  };

  const saveCashReconciliation = (record: Omit<CashReconciliation, 'id' | 'createdAt' | 'updatedAt' | 'expectedBalance'>) => {
    const account = database.accounts.find((item) => item.id === record.accountId && item.type === 'cash' && item.active !== false);
    if (!account || !Number.isFinite(record.countedBalance) || record.countedBalance < 0) throw new Error('Choose a cash account and enter a valid physical count.');
    const now = new Date().toISOString();
    const reconciliation: CashReconciliation = {
      ...record,
      id: database.cashReconciliations.find((item) => item.date === record.date && item.accountId === record.accountId)?.id ?? generateId('cash-reconciliation'),
      expectedBalance: getAccountBalance(account, database.accountTransactions, record.date),
      createdAt: database.cashReconciliations.find((item) => item.date === record.date && item.accountId === record.accountId)?.createdAt ?? now,
      updatedAt: now,
    };
    setDatabase({
      ...database,
      cashReconciliations: [
        ...database.cashReconciliations.filter((item) => item.date !== record.date || item.accountId !== record.accountId),
        reconciliation,
      ],
    });
  };

  const reverseSourceTransactions = (sourceIds: string[], date: string, reason: string) => getUnreversedEntries(database.accountTransactions)
    .filter((entry) => sourceIds.includes(entry.source) && entry.sourceType !== 'reversal')
    .map((entry) => buildReversalEntry(entry, date, reason));

  const saveRecipeForProduct = (productId: string, ingredients: { rawMaterialId: string; quantity: number; unit: RawMaterial['unit'] }[]) => {
    const existingRecipe = database.recipes.find((recipe) => recipe.productId === productId);
    const recipeId = existingRecipe?.id ?? generateId('recipe');
    const nextVersionNumber = database.recipeVersions
      .filter((recipe) => recipe.productId === productId)
      .reduce((maximum, recipe) => Math.max(maximum, recipe.versionNumber), 0) + 1;
    const nextRecipe: RecipeVersion = {
      id: generateId('recipe_version'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      recipeId,
      productId,
      versionNumber: nextVersionNumber,
      effectiveFrom: toBusinessDateKey(),
      ingredients: ingredients.map((ingredient) => ({
        id: generateId('ingredient'),
        rawMaterialId: ingredient.rawMaterialId,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
      })),
    };
    const product = database.products.find((item) => item.id === productId);
    const recipeDefinition: Recipe = {
      id: recipeId,
      createdAt: existingRecipe?.createdAt ?? nextRecipe.createdAt,
      updatedAt: nextRecipe.updatedAt,
      productId,
      name: existingRecipe?.name ?? `${product?.name ?? 'Product'} recipe`,
      activeVersionId: nextRecipe.id,
    };

    setDatabase({
      ...database,
      recipes: existingRecipe
        ? database.recipes.map((recipe) => recipe.id === recipeId ? recipeDefinition : recipe)
        : [...database.recipes, recipeDefinition],
      recipeVersions: [...database.recipeVersions, nextRecipe],
    });
  };

  const addPurchase = (record: PurchaseRecord) => {
    if (!Number.isFinite(record.paidAmount) || record.paidAmount < 0 || record.paidAmount > record.total) throw new Error('Purchase payment must be between zero and the purchase total.');
    const now = new Date().toISOString();
    const purchaseItems = record.items || [];
    const rawMaterials = database.rawMaterials.map((material) => {
      const purchaseItem = purchaseItems.find((item) => item.rawMaterialId === material.id);
      if (!purchaseItem) return material;

      const existingQuantity = material.currentStock;
      const existingValue = existingQuantity * material.averageCost;
      const newValue = purchaseItem.quantity * purchaseItem.rate;
      const newAverageCost = calculateWeightedAverageCost(
        existingQuantity,
        existingValue,
        purchaseItem.quantity,
        newValue,
      );
      const nextQuantity = existingQuantity + purchaseItem.quantity;

      return {
        ...material,
        currentStock: nextQuantity,
        averageCost: newAverageCost,
        updatedAt: now,
      };
    });

    const inventoryTransactions = purchaseItems.flatMap((item) => {
      const material = rawMaterials.find((entry) => entry.id === item.rawMaterialId);
      if (!material) return [];
      const balanceAfter = rawMaterials
        .filter((entry) => entry.id === item.rawMaterialId)
        .reduce((sum, entry) => sum + entry.currentStock, 0);
      return [{
        id: generateId('inventory-transaction'),
        createdAt: now,
        updatedAt: now,
        rawMaterialId: item.rawMaterialId,
        type: 'PURCHASE' as const,
        reference: `Purchase-${record.id}`,
        quantity: item.quantity,
        unit: item.unit,
        rate: item.rate,
        value: item.total,
        balanceAfter,
        notes: `${record.invoiceNumber || record.supplierName} · ${record.notes || ''}`.trim(),
        date: record.date,
      }];
    });

    const accountTransactions = record.paidAmount > 0 ? buildPaymentEntries([{
      accountId: resolveAccountId(record.accountId, record.paymentMethod === 'cash' ? 'cash' : 'online'),
      amount: record.paidAmount,
      method: record.paymentMethod,
    }], {
      date: record.date,
      label: record.supplierName,
      source: record.id,
      sourceType: 'purchase',
      direction: 'out',
      idempotencyPrefix: `purchase:${record.id}:initial`,
      notes: record.notes,
    }, now) : [];

    const supplierOutstanding = Math.max(0, record.total - record.paidAmount);
    const auditLog: AuditLog = {
      id: generateId('audit'),
      createdAt: now,
      updatedAt: now,
      timestamp: now,
      action: 'Purchase finalized',
      entity: 'purchase',
      entityId: record.id,
      newValue: JSON.stringify({
        invoiceNumber: record.invoiceNumber,
        rawMaterialId: purchaseItems.map((item) => item.rawMaterialId),
        total: record.total,
        paidAmount: record.paidAmount,
        supplierOutstanding,
      }),
    };

    setDatabase({
      ...database,
      purchases: [...database.purchases, record],
      rawMaterials,
      inventoryTransactions: [...database.inventoryTransactions, ...inventoryTransactions],
      accountTransactions: [...database.accountTransactions, ...accountTransactions],
      auditLogs: [auditLog, ...database.auditLogs],
    });
  };

  const updatePurchase = (record: PurchaseRecord) => {
    if (!Number.isFinite(record.paidAmount) || record.paidAmount < 0 || record.paidAmount > record.total) throw new Error('Purchase payment must be between zero and the purchase total.');
    const previous = database.purchases.find((purchase) => purchase.id === record.id);
    if (!previous) return false;

    const now = new Date().toISOString();
    const purchases = database.purchases.map((purchase) => purchase.id === record.id
      ? { ...record, updatedAt: now }
      : purchase);
    const retainedTransactions = database.inventoryTransactions.filter((entry) => entry.reference !== `Purchase-${record.id}`);
    const addedTransactions = record.items.flatMap((item) => {
      const material = database.rawMaterials.find((entry) => entry.id === item.rawMaterialId);
      if (!material) return [];
      return [{
        id: generateId('inventory-transaction'),
        createdAt: now,
        updatedAt: now,
        rawMaterialId: item.rawMaterialId,
        type: 'PURCHASE' as const,
        reference: `Purchase-${record.id}`,
        quantity: item.quantity,
        unit: item.unit,
        rate: item.rate,
        value: item.total,
        balanceAfter: material.currentStock,
        notes: `${record.invoiceNumber || record.supplierName} · ${record.notes || ''}`.trim(),
        date: record.date,
      }];
    });
    const inventoryTransactions = [...retainedTransactions, ...addedTransactions];
    const rawMaterials = rebuildRawMaterialBalances(database.rawMaterials, purchases, inventoryTransactions);
    if (rawMaterials.some((material) => material.currentStock < -0.000001)) return false;

    const oldSources = [previous.id, previous.invoiceNumber].filter(Boolean);
    const correctionDate = toBusinessDateKey();
    const reversals = reverseSourceTransactions(oldSources, correctionDate, 'Purchase payment corrected');
    const newPayments = record.paidAmount > 0 ? buildPaymentEntries([{
      accountId: resolveAccountId(record.accountId, record.paymentMethod === 'cash' ? 'cash' : 'online'),
      amount: record.paidAmount,
      method: record.paymentMethod,
    }], {
      date: correctionDate,
      label: record.supplierName,
      source: record.id,
      sourceType: 'purchase',
      direction: 'out',
      idempotencyPrefix: `purchase:${record.id}:edit:${now}`,
      notes: record.notes,
    }, now) : [];

    setDatabase({
      ...database,
      purchases,
      rawMaterials,
      inventoryTransactions,
      accountTransactions: [...database.accountTransactions, ...reversals, ...newPayments],
    });
    return true;
  };

  const deletePurchase = (purchaseId: string) => {
    const purchase = database.purchases.find((item) => item.id === purchaseId);
    if (!purchase) return false;
    const purchases = database.purchases.filter((item) => item.id !== purchaseId);
    const inventoryTransactions = database.inventoryTransactions.filter((entry) => entry.reference !== `Purchase-${purchaseId}`);
    const rawMaterials = rebuildRawMaterialBalances(database.rawMaterials, purchases, inventoryTransactions);
    if (rawMaterials.some((material) => material.currentStock < -0.000001)) return false;

    const oldSources = [purchase.id, purchase.invoiceNumber].filter(Boolean);
    const reversals = reverseSourceTransactions(oldSources, toBusinessDateKey(), 'Purchase deleted');
    setDatabase({ ...database, purchases, rawMaterials, inventoryTransactions, accountTransactions: [...database.accountTransactions, ...reversals] });
    return true;
  };

  const addExpense = (record: ExpenseRecord) => {
    const paidAmount = record.paidAmount ?? record.amount;
    if (!Number.isFinite(record.amount) || record.amount < 0 || !Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount > record.amount) throw new Error('Expense payment must be between zero and the expense amount.');
    const accountTransaction = paidAmount > 0 ? buildPaymentEntries([{
      accountId: resolveAccountId(record.accountId, record.paymentMethod === 'cash' ? 'cash' : 'online'),
      amount: paidAmount,
      method: record.paymentMethod,
    }], {
      date: record.date,
      label: record.category,
      source: `Expense-${record.id}`,
      sourceType: 'expense',
      direction: 'out',
      idempotencyPrefix: `expense:${record.id}:initial`,
      notes: record.description,
    }) : [];
    setDatabase({
      ...database,
      expenses: [...database.expenses, record],
      accountTransactions: [...database.accountTransactions, ...accountTransaction],
    });
  };

  const updateExpense = (record: ExpenseRecord) => {
    const correctionDate = toBusinessDateKey();
    const reversals = reverseSourceTransactions([`Expense-${record.id}`, record.id], correctionDate, 'Expense payment corrected');
    const paidAmount = record.paidAmount ?? record.amount;
    if (!Number.isFinite(record.amount) || record.amount < 0 || !Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount > record.amount) throw new Error('Expense payment must be between zero and the expense amount.');
    const newPayments = paidAmount > 0 ? buildPaymentEntries([{
      accountId: resolveAccountId(record.accountId, record.paymentMethod === 'cash' ? 'cash' : 'online'),
      amount: paidAmount,
      method: record.paymentMethod,
    }], {
      date: correctionDate,
      label: record.category,
      source: `Expense-${record.id}`,
      sourceType: 'expense',
      direction: 'out',
      idempotencyPrefix: `expense:${record.id}:edit:${record.updatedAt}`,
      notes: record.description,
    }) : [];
    setDatabase({
      ...database,
      expenses: database.expenses.map((item) => item.id === record.id ? record : item),
      accountTransactions: [...database.accountTransactions, ...reversals, ...newPayments],
    });
  };

  const deleteExpense = (expenseId: string) => {
    const reversals = reverseSourceTransactions([`Expense-${expenseId}`, expenseId], toBusinessDateKey(), 'Expense deleted');
    setDatabase({
      ...database,
      expenses: database.expenses.filter((item) => item.id !== expenseId),
      accountTransactions: [...database.accountTransactions, ...reversals],
    });
  };

  const addWastage = (record: WastageRecord) => {
    const material = database.rawMaterials.find((item) => item.id === record.rawMaterialId);
    if (!material || record.quantity <= 0 || !Number.isFinite(record.quantity)) throw new Error('Select a material and enter a valid wastage quantity.');
    const nextStock = material.currentStock - record.quantity;
    if (database.settings.preventNegativeStock && nextStock < -0.000001) {
      throw new Error(`Not enough ${material.name} in stock. Available: ${material.currentStock} ${material.unit}.`);
    }
    const now = new Date().toISOString();
    const transaction = {
      id: generateId('inventory-transaction'),
      createdAt: now,
      updatedAt: now,
      rawMaterialId: material.id,
      type: 'WASTAGE' as const,
      reference: `Wastage-${record.id}`,
      quantity: record.quantity,
      unit: record.unit,
      rate: material.averageCost,
      value: record.cost,
      balanceAfter: database.settings.preventNegativeStock ? Math.max(0, nextStock) : nextStock,
      notes: record.reason,
      date: record.date,
    };
    setDatabase({
      ...database,
      rawMaterials: database.rawMaterials.map((item) => item.id === material.id
        ? { ...item, currentStock: roundToUnit(database.settings.preventNegativeStock ? Math.max(0, nextStock) : nextStock, 6), updatedAt: now }
        : item),
      wastage: [...database.wastage, record],
      inventoryTransactions: [...database.inventoryTransactions, transaction],
    });
  };

  const addAuditLog = (entry: Omit<AuditLog, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const audit: AuditLog = {
      id: generateId('audit'),
      createdAt: now,
      updatedAt: now,
      ...entry,
      timestamp: now,
    };

    setDatabase({ ...database, auditLogs: [audit, ...database.auditLogs] });
  };

  const getLatestRecipe = (productId: string, date: string): RecipeVersion | undefined => {
    return [...database.recipeVersions]
      .filter((recipe) => recipe.productId === productId)
      .sort((a, b) => Number(new Date(b.effectiveFrom)) - Number(new Date(a.effectiveFrom)) || b.versionNumber - a.versionNumber)
      .find((recipe) => recipe.effectiveFrom.slice(0, 10) <= date);
  };

  const saveSaleDraft = (draft: { id?: string; date: string; basket: Array<{ productId: string; quantity: number }>; paymentSummary: PaymentSummary; cashAccountId?: string; onlineAccountId?: string }) => {
    const existing = draft.id ? database.saleDays.find((sale) => sale.id === draft.id && sale.status === 'draft') : undefined;
    if (draft.id && !existing) throw new Error('The selected draft no longer exists.');
    const now = new Date().toISOString();
    const items: SaleRecord['items'] = draft.basket.flatMap((basketItem) => {
      const product = database.products.find((item) => item.id === basketItem.productId);
      if (!product || !Number.isFinite(basketItem.quantity) || basketItem.quantity <= 0) return [];
      return [{
        id: generateId('sale-item'),
        productId: product.id,
        productName: product.name,
        quantity: basketItem.quantity,
        unitPrice: product.sellingPrice,
        total: product.sellingPrice * basketItem.quantity,
        cost: 0,
        grossProfit: 0,
      }];
    });
    if (items.length === 0) throw new Error('Add at least one valid product before saving a draft.');

    const sale: SaleRecord = {
      id: existing?.id ?? generateId('sale-draft'),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      date: draft.date,
      items,
      paymentSummary: snapshotPaymentSummary(draft.paymentSummary),
      cashAccountId: draft.cashAccountId,
      onlineAccountId: draft.onlineAccountId,
      totalItems: items.reduce((sum, item) => sum + item.quantity, 0),
      totalAmount: items.reduce((sum, item) => sum + item.total, 0),
      totalCOGS: 0,
      totalGrossProfit: 0,
      status: 'draft',
    };
    setDatabase({
      ...database,
      saleDays: existing
        ? database.saleDays.map((item) => item.id === sale.id ? sale : item)
        : [...database.saleDays, sale],
    });
    return sale;
  };

  const finalizeSale = (draft: { date: string; basket: Array<{ productId: string; quantity: number }>; paymentSummary: PaymentSummary; cashAccountId?: string; onlineAccountId?: string; saleId?: string; idempotencyKey?: string }) => {
    const normalizedPayment = snapshotPaymentSummary(draft.paymentSummary);
    if (Object.values(normalizedPayment).some((amount) => !Number.isFinite(amount) || amount < 0)) {
      throw new Error('Payment amounts must be valid nonnegative numbers.');
    }
    const knownSale = draft.saleId ? database.saleDays.find((sale) => sale.id === draft.saleId) : undefined;
    if (knownSale?.status === 'finalized') return knownSale;
    const existing = draft.saleId ? database.saleDays.find((sale) => sale.id === draft.saleId && sale.status === 'draft') : undefined;
    if (draft.saleId && !existing) throw new Error('The selected draft no longer exists.');
    const idempotencyKey = draft.idempotencyKey ?? draft.saleId ?? generateId('sale-submission');
    const alreadyPosted = database.accountTransactions.find((entry) => entry.idempotencyKey?.startsWith(`sale:${idempotencyKey}:`));
    if (alreadyPosted) {
      const committedSale = database.saleDays.find((sale) => sale.id === alreadyPosted.source);
      if (committedSale) return committedSale;
    }

    const items: SaleRecord['items'] = [];
    let totalCOGS = 0;
    let totalGrossProfit = 0;
    let totalItems = 0;
    const materialConsumption = new Map<string, { quantity: number; cost: number }>();

    for (const basketItem of draft.basket) {
      const product = database.products.find((item) => item.id === basketItem.productId);
      if (!product || !product.active || !Number.isFinite(basketItem.quantity) || basketItem.quantity <= 0) {
        throw new Error('Every sale item must be an active product with a quantity greater than zero.');
      }
      const recipe = getLatestRecipe(product.id, draft.date);
      if (!recipe || recipe.ingredients.length === 0) throw new Error(`${product.name} needs a recipe effective on the sale date.`);
      if (recipe.ingredients.some((ingredient) => !database.rawMaterials.some((material) => material.id === ingredient.rawMaterialId && material.active))) {
        throw new Error(`${product.name} has a recipe ingredient that is missing or inactive.`);
      }
      const consumption = calculateRecipeConsumption(recipe, database.rawMaterials, basketItem.quantity);
      if (consumption.length !== recipe.ingredients.length) throw new Error(`Unable to calculate all recipe ingredients for ${product.name}.`);
      const productCost = consumption.reduce((sum, ingredient) => sum + ingredient.cost, 0);
      for (const ingredient of consumption) {
        const current = materialConsumption.get(ingredient.rawMaterialId) ?? { quantity: 0, cost: 0 };
        materialConsumption.set(ingredient.rawMaterialId, {
          quantity: current.quantity + ingredient.quantity,
          cost: current.cost + ingredient.cost,
        });
      }

      const itemRevenue = product.sellingPrice * basketItem.quantity;
      const itemGross = itemRevenue - productCost;
      totalCOGS += productCost;
      totalGrossProfit += itemGross;
      totalItems += basketItem.quantity;

      items.push({
        id: generateId('sale-item'),
        productId: product.id,
        productName: product.name,
        quantity: basketItem.quantity,
        unitPrice: product.sellingPrice,
        total: itemRevenue,
        cost: productCost,
        grossProfit: itemGross,
        recipeVersionId: recipe.id,
      });
    }

    if (items.length !== draft.basket.length) throw new Error('Unable to process every product in this sale.');
    const totalSale = items.reduce((sum, item) => sum + item.total, 0);
    const paymentTotal = normalizedPayment.cash + normalizedPayment.upi + normalizedPayment.card + normalizedPayment.other;
    if (paymentTotal - totalSale > 0.001) throw new Error('Collected payment cannot exceed the sale total.');

    const now = new Date().toISOString();
    const hasPriorReversal = existing && database.accountTransactions.some((entry) => entry.source === existing.id && entry.sourceType === 'reversal');
    const paymentDate = hasPriorReversal ? toBusinessDateKey() : draft.date;
    const cashAccountId = normalizedPayment.cash > 0
      ? resolveAccountId(draft.cashAccountId ?? existing?.cashAccountId, 'cash')
      : undefined;
    const onlinePayment = normalizedPayment.upi + normalizedPayment.card + normalizedPayment.other;
    const onlineAccountId = onlinePayment > 0
      ? resolveAccountId(draft.onlineAccountId ?? existing?.onlineAccountId, 'online')
      : undefined;
    const nextMaterials = database.rawMaterials.map((material) => {
      const consumption = materialConsumption.get(material.id);
      if (!consumption) return material;
      const nextStock = material.currentStock - consumption.quantity;
      if (database.settings.preventNegativeStock && nextStock < -0.000001) {
        throw new Error(`Not enough ${material.name} in stock. Available: ${material.currentStock} ${material.unit}; required: ${consumption.quantity} ${material.unit}.`);
      }
      return {
        ...material,
        currentStock: roundToUnit(database.settings.preventNegativeStock ? Math.max(0, nextStock) : nextStock, 6),
        updatedAt: now,
      };
    });

    const saleRecord: SaleRecord = {
      id: existing?.id ?? generateId('sale'),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      date: draft.date,
      items,
      paymentSummary: normalizedPayment,
      cashAccountId,
      onlineAccountId,
      totalItems,
      totalAmount: items.reduce((sum, item) => sum + item.total, 0),
      totalCOGS,
      totalGrossProfit,
      status: 'finalized',
      finalizedAt: now,
    };

    const saleTransactions = [...materialConsumption].map(([rawMaterialId, consumption]) => {
      const material = database.rawMaterials.find((item) => item.id === rawMaterialId)!;
      return {
        id: generateId('inventory-transaction'),
        createdAt: now,
        updatedAt: now,
        rawMaterialId,
        type: 'SALE_CONSUMPTION' as const,
        reference: `Sale-${saleRecord.id}`,
        quantity: consumption.quantity,
        unit: material.unit,
        rate: consumption.quantity > 0 ? consumption.cost / consumption.quantity : 0,
        value: consumption.cost,
        balanceAfter: nextMaterials.find((item) => item.id === rawMaterialId)?.currentStock ?? 0,
        notes: `Sale ${saleRecord.id}`,
        date: draft.date,
      };
    });
    const salePayments = buildPaymentEntries((Object.entries(normalizedPayment) as Array<[keyof PaymentSummary, number]>)
      .filter(([, amount]) => amount > 0)
      .map(([method, amount]) => ({
        accountId: method === 'cash' ? cashAccountId! : onlineAccountId!,
        amount,
        method,
      })), {
      date: paymentDate,
      label: 'Sale payment',
      source: saleRecord.id,
      sourceType: 'sale',
      direction: 'in',
      idempotencyPrefix: `sale:${idempotencyKey}`,
    }, now);

    const nextDb = {
      ...database,
      saleDays: existing
        ? database.saleDays.map((sale) => sale.id === saleRecord.id ? saleRecord : sale)
        : [...database.saleDays, saleRecord],
      rawMaterials: nextMaterials,
      inventoryTransactions: [
        ...database.inventoryTransactions.filter((entry) => entry.reference !== `Sale-${saleRecord.id}`),
        ...saleTransactions,
      ],
      accountTransactions: appendIdempotentEntries(database.accountTransactions, salePayments),
      auditLogs: [{
        id: generateId('audit'),
        createdAt: now,
        updatedAt: now,
        timestamp: now,
        action: 'Sale finalized',
        entity: 'sale',
        entityId: saleRecord.id,
        newValue: JSON.stringify({ date: draft.date, amount: saleRecord.totalAmount }),
      }, ...database.auditLogs],
    };

    setDatabase(nextDb);
    return saleRecord;
  };

  const reopenSale = (saleId: string) => {
    const sale = database.saleDays.find((item) => item.id === saleId && item.status === 'finalized');
    if (!sale) return null;
    const saleTransactions = database.inventoryTransactions.filter((entry) => entry.reference === `Sale-${sale.id}`);
    const stockByMaterial = new Map<string, number>();
    for (const transaction of saleTransactions) {
      stockByMaterial.set(transaction.rawMaterialId, (stockByMaterial.get(transaction.rawMaterialId) ?? 0) + transaction.quantity);
    }
    const now = new Date().toISOString();
    const rawMaterials = database.rawMaterials.map((material) => ({
      ...material,
      currentStock: roundToUnit(material.currentStock + (stockByMaterial.get(material.id) ?? 0), 6),
      updatedAt: now,
    }));
    const reopenedSale: SaleRecord = { ...sale, status: 'draft', finalizedAt: undefined, updatedAt: now };
    const reversals = reverseSourceTransactions([sale.id], toBusinessDateKey(), 'Sale reopened');
    setDatabase({
      ...database,
      saleDays: database.saleDays.map((item) => item.id === sale.id ? reopenedSale : item),
      rawMaterials,
      inventoryTransactions: database.inventoryTransactions.filter((entry) => entry.reference !== `Sale-${sale.id}`),
      accountTransactions: [...database.accountTransactions, ...reversals],
    });
    return reopenedSale;
  };

  const value = useMemo<AppContextValue>(() => ({
    database,
    selectedDate,
    setSelectedDate,
    products: database.products,
    rawMaterials: database.rawMaterials,
    recipes: database.recipeVersions,
    sales: database.saleDays,
    purchases: database.purchases,
    expenses: database.expenses,
    inventoryTransactions: database.inventoryTransactions,
    wastage: database.wastage,
    stockAdjustments: database.stockAdjustments,
    suppliers: database.suppliers,
    accounts: database.accounts,
    accountTransactions: database.accountTransactions,
    cashReconciliations: database.cashReconciliations,
    auditLogs: database.auditLogs,
    setDatabase,
    addProduct,
    updateProduct,
    deleteProduct,
    addRawMaterial,
    updateRawMaterial,
    deleteRawMaterial,
    addSupplier,
    updateSupplier,
    deleteSupplier,
    addAccount,
    deleteAccount,
    restoreAccount,
    transferAccounts,
    saveCashReconciliation,
    saveRecipeForProduct,
    addPurchase,
    updatePurchase,
    deletePurchase,
    addExpense,
    updateExpense,
    deleteExpense,
    addWastage,
    saveSaleDraft,
    finalizeSale,
    reopenSale,
    addAuditLog,
  }), [database, selectedDate]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
};
