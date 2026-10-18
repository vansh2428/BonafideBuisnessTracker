export type Unit = 'g' | 'kg' | 'ml' | 'litre' | 'piece' | 'packet' | 'box' | 'bottle';
export type PaymentMethod = 'cash' | 'upi' | 'card' | 'other';
export type AccountType = 'cash' | 'online';
export type InventoryTransactionType =
  | 'PURCHASE'
  | 'SALE_CONSUMPTION'
  | 'WASTAGE'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'OPENING_STOCK';

export interface BaseRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface Business extends BaseRecord {
  businessName: string;
  address: string;
  phone?: string;
  email?: string;
  taxRegistrationNumber?: string;
}

export interface Settings extends BaseRecord {
  businessId: string;
  currency: string;
  lowStockDefaults: {
    minimum: number;
    reorder: number;
  };
  paymentMethods: PaymentMethod[];
  preventNegativeStock: boolean;
  dateFormat: string;
}

export interface Product extends BaseRecord {
  name: string;
  category: string;
  sku: string;
  sellingPrice: number;
  active: boolean;
  image?: string;
  description?: string;
}

export interface RawMaterial extends BaseRecord {
  name: string;
  category: string;
  unit: Unit;
  currentStock: number;
  minimumStock: number;
  reorderLevel: number;
  averageCost: number;
  active: boolean;
  supplierId?: string;
}

export interface Ingredient {
  id: string;
  rawMaterialId: string;
  quantity: number;
  unit: Unit;
}

export interface Recipe extends BaseRecord {
  productId: string;
  name: string;
  activeVersionId?: string;
}

export interface RecipeVersion extends BaseRecord {
  recipeId: string;
  productId: string;
  versionNumber: number;
  effectiveFrom: string;
  ingredients: Ingredient[];
}

export interface SaleItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  cost: number;
  grossProfit: number;
  recipeVersionId?: string;
}

export interface PaymentSummary {
  cash: number;
  upi: number;
  card: number;
  other: number;
}

export interface SaleDay extends BaseRecord {
  date: string;
  items: SaleItem[];
  paymentSummary: PaymentSummary;
  cashAccountId?: string;
  onlineAccountId?: string;
  totalItems: number;
  totalAmount: number;
  totalCOGS: number;
  totalGrossProfit: number;
  status: 'draft' | 'finalized';
  finalizedAt?: string;
}

export interface PurchaseItem {
  id: string;
  rawMaterialId: string;
  rawMaterialName: string;
  quantity: number;
  unit: Unit;
  rate: number;
  total: number;
}

export interface Purchase extends BaseRecord {
  date: string;
  supplierId?: string;
  supplierName: string;
  invoiceNumber: string;
  items: PurchaseItem[];
  total: number;
  paymentMethod: PaymentMethod;
  paidAmount: number;
  accountId?: string;
  creditAmount: number;
  notes?: string;
}

export interface Supplier extends BaseRecord {
  name: string;
  phone: string;
  address: string;
  gst?: string;
  notes?: string;
}

export interface Expense extends BaseRecord {
  date: string;
  category: string;
  amount: number;
  paidAmount?: number;
  paymentMethod: PaymentMethod;
  accountId?: string;
  description: string;
}

export interface InventoryTransaction extends BaseRecord {
  rawMaterialId: string;
  type: InventoryTransactionType;
  reference: string;
  quantity: number;
  unit: Unit;
  rate: number;
  value: number;
  balanceAfter: number;
  notes?: string;
  date: string;
}

export interface Wastage extends BaseRecord {
  date: string;
  rawMaterialId: string;
  rawMaterialName: string;
  quantity: number;
  unit: Unit;
  reason: string;
  notes?: string;
  cost: number;
}

export interface StockAdjustment extends BaseRecord {
  date: string;
  rawMaterialId: string;
  rawMaterialName: string;
  quantity: number;
  reason: string;
  direction: 'IN' | 'OUT';
  notes?: string;
}

export interface Account extends BaseRecord {
  name: string;
  type: AccountType;
  openingBalance: number;
  openingDate: string;
  active?: boolean;
}

export interface AccountTransaction extends BaseRecord {
  transactionId?: string;
  idempotencyKey?: string;
  accountId?: string;
  date: string;
  type: PaymentMethod;
  label: string;
  amount: number;
  direction: 'in' | 'out';
  source: string;
  sourceType?: 'sale' | 'purchase' | 'expense' | 'transfer' | 'refund' | 'reversal' | 'opening' | 'manual';
  transferId?: string;
  reversesTransactionId?: string;
  reversedByTransactionId?: string;
  notes?: string;
}

export interface CashReconciliation extends BaseRecord {
  date: string;
  accountId: string;
  countedBalance: number;
  expectedBalance: number;
  notes?: string;
}

export interface AuditLog extends BaseRecord {
  timestamp: string;
  action: string;
  entity: string;
  entityId: string;
  oldValue?: string;
  newValue?: string;
}

export interface Database {
  version: 1;
  business: Business;
  settings: Settings;
  products: Product[];
  rawMaterials: RawMaterial[];
  recipes: Recipe[];
  recipeVersions: RecipeVersion[];
  saleDays: SaleDay[];
  purchases: Purchase[];
  suppliers: Supplier[];
  expenses: Expense[];
  inventoryTransactions: InventoryTransaction[];
  wastage: Wastage[];
  stockAdjustments: StockAdjustment[];
  accounts: Account[];
  accountTransactions: AccountTransaction[];
  cashReconciliations: CashReconciliation[];
  auditLogs: AuditLog[];
}

export type AppDatabase = Database;
export type BusinessSettings = Settings;
export type SaleRecord = SaleDay;
export type PurchaseRecord = Purchase;
export type SupplierRecord = Supplier;
export type AccountRecord = AccountTransaction;
export type ExpenseRecord = Expense;
export type WastageRecord = Wastage;
export type StockAdjustmentRecord = StockAdjustment;

export interface DashboardMetrics {
  sales: number;
  items: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  cash: number;
  online: number;
}