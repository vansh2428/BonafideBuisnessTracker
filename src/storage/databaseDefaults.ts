import type { Account, AppDatabase, Business, Settings } from '../types';
import { toBusinessDateKey } from '../utils/dates';

export const DATABASE_VERSION = 1 as const;

export const createDefaultBusiness = (now = new Date().toISOString()): Business => ({
  id: 'business_default',
  businessName: '',
  address: '',
  createdAt: now,
  updatedAt: now,
});

export const createDefaultSettings = (businessId = 'business_default', now = new Date().toISOString()): Settings => ({
  id: 'settings_default',
  businessId,
  currency: 'INR',
  lowStockDefaults: { minimum: 1, reorder: 5 },
  paymentMethods: ['cash', 'upi', 'card', 'other'],
  preventNegativeStock: true,
  dateFormat: 'DD-MM-YYYY',
  createdAt: now,
  updatedAt: now,
});

export const createDefaultAccounts = (now = new Date().toISOString()): Account[] => {
  const openingDate = toBusinessDateKey(new Date(now));
  return [
    { id: 'account_cash_default', name: 'Cash', type: 'cash', openingBalance: 0, openingDate, active: true, createdAt: now, updatedAt: now },
    { id: 'account_online_default', name: 'Online', type: 'online', openingBalance: 0, openingDate, active: true, createdAt: now, updatedAt: now },
  ];
};

export const createDefaultDatabase = (now = new Date().toISOString()): AppDatabase => {
  const business = createDefaultBusiness(now);
  return {
    version: DATABASE_VERSION,
    business,
    settings: createDefaultSettings(business.id, now),
    products: [],
    rawMaterials: [],
    recipes: [],
    recipeVersions: [],
    saleDays: [],
    dailySaleAdjustments: [],
    purchases: [],
    suppliers: [],
    expenses: [],
    inventoryTransactions: [],
    wastage: [],
    stockAdjustments: [],
    accounts: createDefaultAccounts(now),
    accountTransactions: [],
    cashReconciliations: [],
    auditLogs: [],
  };
};