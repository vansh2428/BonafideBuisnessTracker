import React, { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useApp } from './context/AppContext';
import { clearDatabase, exportDatabase, importDatabase, validateDatabase } from './storage/storageService';
import { createDefaultDatabase } from './storage/databaseDefaults';
import { formatCurrency } from './utils/currency';
import { formatIndiaDate, toBusinessDateKey } from './utils/dates';
import { generateId } from './utils/ids';
import { areUnitsCompatible, formatQuantity } from './utils/units';
import { calculateProductMargin, calculateRecipeConsumption, calculateRecipeCost } from './utils/bom';
import type { AppDatabase, ExpenseRecord, PaymentMethod, Product, PurchaseRecord, RawMaterial, SaleRecord, SupplierRecord, Unit } from './types';
import type { DatabaseValidationResult } from './storage/storageService';
import type { AccountType } from './types';
import { getAccountBalance } from './utils/accounts';

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/daily-sale', label: 'Daily Sale' },
  { to: '/products', label: 'Products' },
  { to: '/recipes', label: 'Recipes' },
  { to: '/inventory', label: 'Inventory' },
  { to: '/wastage', label: 'Wastage' },
  { to: '/purchases', label: 'Purchases' },
  { to: '/expenses', label: 'Expenses' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/reports', label: 'Reports' },
  { to: '/settings', label: 'Settings' },
  { to: '/audit-log', label: 'Audit Log' },
];

const StatCard = ({ label, value, tone = 'primary' }: { label: string; value: string; tone?: 'primary' | 'success' | 'warning' | 'danger' }) => (
  <div className={`card stat-card ${tone}`}>
    <small>{label}</small>
    <strong>{value}</strong>
  </div>
);

const formatMoney = formatCurrency;
const TrendChart = lazy(() => import('./components/TrendChart'));

const DashboardPage = () => {
  const { products, rawMaterials, sales, expenses, purchases, accounts, accountTransactions, selectedDate } = useApp();
  const selectedSales = sales.filter((sale) => sale.date === selectedDate && sale.status === 'finalized');
  const selectedRevenue = selectedSales.reduce((sum, sale) => sum + sale.totalAmount, 0);
  const selectedItems = selectedSales.reduce((sum, sale) => sum + sale.totalItems, 0);
  const selectedCOGS = selectedSales.reduce((sum, sale) => sum + sale.totalCOGS, 0);
  const selectedCash = selectedSales.reduce((sum, sale) => sum + sale.paymentSummary.cash, 0);
  const selectedUPI = selectedSales.reduce((sum, sale) => sum + sale.paymentSummary.upi, 0);
  const selectedExpenses = expenses.filter((expense) => expense.date === selectedDate).reduce((sum, item) => sum + item.amount, 0);
  const selectedGross = selectedRevenue - selectedCOGS;
  const netProfit = selectedGross - selectedExpenses;
  const inventoryValue = rawMaterials.reduce((sum, material) => sum + material.currentStock * material.averageCost, 0);
  const receivables = sales.filter((sale) => sale.status === 'finalized').reduce((sum, sale) => sum + Math.max(0, sale.totalAmount - Object.values(sale.paymentSummary).reduce((paid, amount) => paid + amount, 0)), 0);
  const payables = purchases.reduce((sum, purchase) => sum + Math.max(0, purchase.total - purchase.paidAmount), 0);

  const lowStock = rawMaterials
    .filter((material) => material.currentStock <= material.reorderLevel)
    .slice(0, 4)
    .map((material) => ({ ...material, status: material.currentStock < material.minimumStock ? 'CRITICAL' : 'LOW' }));

  const topProducts = [...products]
    .map((product) => ({
      product,
      units: selectedSales.reduce((sum, sale) => sum + (sale.items.find((item) => item.productId === product.id)?.quantity ?? 0), 0),
    }))
    .filter((entry) => entry.units > 0)
    .sort((a, b) => b.units - a.units)
    .slice(0, 5);

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Business overview</p>
          <h1>Dashboard</h1>
        </div>
      </header>

      <section className="stats-grid">
        <StatCard label="Selected Date Sales" value={formatMoney(selectedRevenue)} />
        <StatCard label="Selected Date Items" value={String(selectedItems)} />
        <StatCard label="Selected Date Product Cost" value={formatMoney(selectedCOGS)} tone="warning" />
        <StatCard label="Selected Date Gross Profit" value={formatMoney(selectedGross)} tone="success" />
        <StatCard label="Selected Date Expenses" value={formatMoney(selectedExpenses)} tone="danger" />
        <StatCard label="Selected Date Net Profit" value={formatMoney(netProfit)} tone="success" />
        {accounts.filter((account) => account.active !== false).map((account) => <StatCard key={account.id} label={`${account.name} Balance`} value={formatMoney(getAccountBalance(account, accountTransactions))} />)}
        <StatCard label="Total Available" value={formatMoney(accounts.reduce((sum, account) => sum + getAccountBalance(account, accountTransactions), 0))} />
        <StatCard label="Inventory Value" value={formatMoney(inventoryValue)} tone="warning" />
        <StatCard label="Receivables" value={formatMoney(receivables)} />
        <StatCard label="Payables" value={formatMoney(payables)} tone="danger" />
        <StatCard label="Cash Received" value={formatMoney(selectedCash)} />
        <StatCard label="UPI Received" value={formatMoney(selectedUPI)} />
      </section>

      <section className="two-col">
        <div className="card">
          <h3>Low Stock Alerts</h3>
          {lowStock.length ? (
            <ul className="stack-list">
              {lowStock.map((item) => (
                <li key={item.id} className="list-row">
                  <span>{item.name}</span>
                  <strong>{item.status}</strong>
                  <small>{formatQuantity(item.currentStock, item.unit)}</small>
                </li>
              ))}
            </ul>
          ) : <p>No alerts.</p>}
        </div>

        <div className="card">
          <h3>Top Products</h3>
          {topProducts.length ? (
            <ul className="stack-list">
              {topProducts.map((entry) => (
                <li key={entry.product.id} className="list-row">
                  <span>{entry.product.name}</span>
                  <strong>{entry.units} sold</strong>
                </li>
              ))}
            </ul>
          ) : <p>No sales yet.</p>}
        </div>
      </section>
    </>
  );
};

const POSPage = () => {
  const { products, sales, accounts, saveSaleDraft, finalizeSale, reopenSale, selectedDate, setSelectedDate } = useApp();
  const [basket, setBasket] = useState<Record<string, number>>({});
  const [paymentSummary, setPaymentSummary] = useState({ cash: 0, upi: 0, card: 0, other: 0 });
  const [cashAccountSelection, setCashAccountSelection] = useState('');
  const [onlineAccountSelection, setOnlineAccountSelection] = useState('');
  const [draftSaleId, setDraftSaleId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [finalizeKey, setFinalizeKey] = useState(() => generateId('sale-submission'));
  const finalizeLock = useRef(false);
  const cashAccounts = accounts.filter((account) => account.active !== false && account.type === 'cash');
  const onlineAccounts = accounts.filter((account) => account.active !== false && account.type === 'online');
  const cashAccountId = cashAccounts.some((account) => account.id === cashAccountSelection) ? cashAccountSelection : cashAccounts[0]?.id || '';
  const onlineAccountId = onlineAccounts.some((account) => account.id === onlineAccountSelection) ? onlineAccountSelection : onlineAccounts[0]?.id || '';

  const addToBasket = (productId: string) => {
    setBasket((current) => ({ ...current, [productId]: (current[productId] || 0) + 1 }));
  };

  const updateQuantity = (productId: string, delta: number) => {
    setBasket((current) => {
      const next = (current[productId] || 0) + delta;
      if (next <= 0) {
        const { [productId]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [productId]: next };
    });
  };

  const entries = Object.entries(basket)
    .map(([productId, quantity]) => {
      const product = products.find((item) => item.id === productId);
      if (!product) return null;
      return { product, quantity, total: product.sellingPrice * quantity };
    })
    .filter(Boolean) as Array<{ product: Product; quantity: number; total: number }>;

  const totalItems = entries.reduce((sum, item) => sum + item.quantity, 0);
  const totalSale = entries.reduce((sum, item) => sum + item.total, 0);

  const saveDraft = () => {
    try {
      const draft = saveSaleDraft({
        id: draftSaleId || undefined,
        date: selectedDate,
        basket: entries.map((entry) => ({ productId: entry.product.id, quantity: entry.quantity })),
        paymentSummary,
        cashAccountId,
        onlineAccountId,
      });
      setDraftSaleId(draft.id);
      setToast('Sale draft saved. Inventory is unchanged.');
      setTimeout(() => setToast(''), 2200);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Unable to save sale draft.');
      setTimeout(() => setToast(''), 2600);
    }
  };

  const loadSale = (sale: SaleRecord) => {
    const draft = sale.status === 'finalized' ? reopenSale(sale.id) : sale;
    if (!draft) {
      setToast('Unable to reopen this sale.');
      setTimeout(() => setToast(''), 2600);
      return;
    }
    setSelectedDate(draft.date);
    setDraftSaleId(draft.id);
    setBasket(Object.fromEntries(draft.items.map((item) => [item.productId, item.quantity])));
    setPaymentSummary(draft.paymentSummary);
    setCashAccountSelection(draft.cashAccountId || '');
    setOnlineAccountSelection(draft.onlineAccountId || '');
    setFinalizeKey(generateId('sale-submission'));
    setToast(sale.status === 'finalized' ? 'Sale reopened; its stock and payment movements were reversed.' : 'Sale draft loaded.');
    setTimeout(() => setToast(''), 2600);
  };

  const handleFinalize = () => {
    if (finalizeLock.current) return;
    finalizeLock.current = true;
    try {
      finalizeSale({
        date: selectedDate,
        basket: entries.map((entry) => ({ productId: entry.product.id, quantity: entry.quantity })),
        paymentSummary,
        cashAccountId,
        onlineAccountId,
        saleId: draftSaleId || undefined,
        idempotencyKey: finalizeKey,
      });
      setBasket({});
      setPaymentSummary({ cash: 0, upi: 0, card: 0, other: 0 });
      setDraftSaleId(null);
      setFinalizeKey(generateId('sale-submission'));
      setToast(`Sale for ${formatIndiaDate(selectedDate)} finalized successfully.`);
      setTimeout(() => setToast(''), 2200);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Unable to finalize sale.');
      setTimeout(() => setToast(''), 2600);
    } finally {
      finalizeLock.current = false;
    }
  };

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Sale for {formatIndiaDate(selectedDate)}</p>
          <h1>Daily Sale</h1>
        </div>
      </header>

      <div className="pos-layout">
        <div className="card">
          <div className="product-grid">
            {products.filter((product) => product.active).map((product) => (
              <div key={product.id} className="product-card">
                <strong>{product.name}</strong>
                <span>{formatMoney(product.sellingPrice)}</span>
                <div className="qty-row">
                  <button type="button" aria-label={`Remove one ${product.name}`} onClick={() => updateQuantity(product.id, -1)}>-</button>
                  <span>{basket[product.id] || 0}</span>
                  <button type="button" aria-label={`Add one ${product.name}`} onClick={() => addToBasket(product.id)}>+</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card sale-side">
          <h3>Current Sale</h3>
          {entries.length ? (
            <ul className="sale-items">
              {entries.map((entry) => (
                <li key={entry.product.id}>
                  <span>{entry.product.name}</span>
                  <span>x {entry.quantity}</span>
                  <strong>{formatMoney(entry.total)}</strong>
                </li>
              ))}
            </ul>
          ) : <p>No products selected.</p>}

          <div className="totals-box">
            <div><span>Total Items</span><strong>{totalItems}</strong></div>
            <div><span>Total Sale</span><strong>{formatMoney(totalSale)}</strong></div>
          </div>

          <div className="payment-grid">
            {(['cash', 'upi', 'card', 'other'] as const).map((method) => (
              <label key={method}>
                <span>{method.toUpperCase()}</span>
                <input
                  type="number"
                  value={paymentSummary[method]}
                  onChange={(event) => setPaymentSummary((current) => ({ ...current, [method]: Number(event.target.value || 0) }))}
                />
              </label>
            ))}
          </div>
          <div className="grid-two">
            <label><span>Cash Account</span><select value={cashAccountId} onChange={(event) => setCashAccountSelection(event.target.value)}>{cashAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
            <label><span>Online Account</span><select value={onlineAccountId} onChange={(event) => setOnlineAccountSelection(event.target.value)}>{onlineAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          </div>
          <p>Outstanding: {formatMoney(Math.max(0, totalSale - Object.values(paymentSummary).reduce((sum, amount) => sum + amount, 0)))}. Collected amounts are posted to their selected accounts.</p>

          <div className="stack-actions">
            <button type="button" className="secondary" onClick={() => { setBasket({}); setPaymentSummary({ cash: 0, upi: 0, card: 0, other: 0 }); setDraftSaleId(null); setFinalizeKey(generateId('sale-submission')); }}>Reset</button>
            <button type="button" className="secondary" onClick={saveDraft}>Save Draft</button>
            <button type="button" className="primary" onClick={handleFinalize}>Finalize Sale</button>
          </div>
        </div>
      </div>

      <div className="card table-wrap">
        <h3>Sales for {formatIndiaDate(selectedDate)}</h3>
        <table>
          <thead><tr><th>Time</th><th>Status</th><th>Items</th><th>Total</th><th>Cash</th><th>UPI</th><th>Card</th><th>Other</th><th>Due</th><th>Actions</th></tr></thead>
          <tbody>
            {sales.filter((sale) => sale.date === selectedDate).map((sale) => (
              <tr key={sale.id}>
                <td>{new Date(sale.createdAt).toLocaleTimeString()}</td>
                <td>{sale.status}</td>
                <td>{sale.totalItems}</td>
                <td>{formatMoney(sale.totalAmount)}</td>
                <td>{formatMoney(sale.paymentSummary.cash)}</td>
                <td>{formatMoney(sale.paymentSummary.upi)}</td>
                <td>{formatMoney(sale.paymentSummary.card)}</td>
                <td>{formatMoney(sale.paymentSummary.other)}</td>
                <td>{formatMoney(Math.max(0, sale.totalAmount - Object.values(sale.paymentSummary).reduce((sum, amount) => sum + amount, 0)))}</td>
                <td><button type="button" className="secondary" onClick={() => loadSale(sale)}>{sale.status === 'finalized' ? 'Reopen' : 'Resume Draft'}</button></td>
              </tr>
            ))}
            {!sales.some((sale) => sale.date === selectedDate) && <tr><td colSpan={10}>No saved sales for this date.</td></tr>}
          </tbody>
        </table>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  );
};

const ProductsPage = () => {
  const { products, recipes, rawMaterials, addProduct, updateProduct, deleteProduct } = useApp();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [sellingPrice, setSellingPrice] = useState(0);
  const [active, setActive] = useState(true);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const resetForm = () => {
    setEditingProductId(null);
    setName('');
    setCategory('');
    setSellingPrice(0);
    setActive(true);
  };

  const getCurrentRecipe = (productId: string) => [...recipes]
    .filter((item) => item.productId === productId)
    .sort((a, b) => b.versionNumber - a.versionNumber)[0];

  const getProductMetrics = (productId: string) => {
    const recipe = getCurrentRecipe(productId);
    const recipeCost = calculateRecipeCost(recipe, rawMaterials);
    const margin = calculateProductMargin(
      products.find((item) => item.id === productId)?.sellingPrice ?? 0,
      recipeCost,
    );
    return { recipe, recipeCost, margin };
  };

  const submit = () => {
    if (!name.trim()) return;
    const existingProduct = products.find((product) => product.id === editingProductId);
    const product: Product = {
      id: existingProduct?.id ?? generateId('product'),
      name: name.trim(),
      category,
      sku: existingProduct?.sku ?? `SKU-${Date.now().toString().slice(-6)}`,
      sellingPrice: Number(sellingPrice || 0),
      active,
      createdAt: existingProduct?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (existingProduct) updateProduct(product);
    else addProduct(product);
    setMessage(existingProduct ? 'Product updated.' : 'Product added.');
    resetForm();
  };

  const editProduct = (product: Product) => {
    setEditingProductId(product.id);
    setName(product.name);
    setCategory(product.category);
    setSellingPrice(product.sellingPrice);
    setActive(product.active);
    setMessage('');
  };

  const removeProduct = (product: Product) => {
    if (!window.confirm(`Delete ${product.name}?`)) return;
    if (!deleteProduct(product.id)) {
      setMessage('This product is used by finalized sales and cannot be deleted. Edit it and disable it instead.');
      return;
    }
    if (editingProductId === product.id) resetForm();
    setMessage(`${product.name} deleted.`);
  };

  return (
    <>
      <header className="page-head"><div><p className="eyebrow">Catalogue</p><h1>Products</h1></div></header>
      <div className="card form-card">
        <h3>{editingProductId ? 'Edit Product' : 'Add Product'}</h3>
        <div className="grid-two">
          <label><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label><span>Category</span><input value={category} onChange={(e) => setCategory(e.target.value)} /></label>
          <label><span>Selling Price</span><input type="number" min="0" value={sellingPrice} onChange={(e) => setSellingPrice(Number(e.target.value || 0))} /></label>
          <label className="checkbox-label"><span>Active</span><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /></label>
        </div>
        <div className="stack-actions">
          <button type="button" className="primary" onClick={submit}>{editingProductId ? 'Save Changes' : 'Save Product'}</button>
          {editingProductId && <button type="button" className="secondary" onClick={resetForm}>Cancel Edit</button>}
        </div>
        {message && <p role="status">{message}</p>}
      </div>

      <div className="card table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Category</th><th>Selling Price</th><th>Current Recipe</th><th>Recipe Cost</th><th>Gross Profit</th><th>Margin</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {products.map((product) => {
              const { recipe, recipeCost, margin } = getProductMetrics(product.id);
              const currentRecipeCount = recipe?.ingredients.length ?? 0;
              return (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td>{product.category}</td>
                  <td>{formatMoney(product.sellingPrice)}</td>
                  <td>{currentRecipeCount ? `${currentRecipeCount} ingredient${currentRecipeCount === 1 ? '' : 's'}` : 'Not configured'}</td>
                  <td>{formatMoney(recipeCost)}</td>
                  <td>{formatMoney(margin.grossProfit)}</td>
                  <td>{margin.marginPercentage.toFixed(2)}%</td>
                  <td>{product.active ? 'Active' : 'Disabled'}</td>
                  <td><div className="stack-actions"><button type="button" className="secondary" onClick={() => editProduct(product)}>Edit</button><button type="button" className="danger" onClick={() => removeProduct(product)}>Delete</button></div></td>
                </tr>
              );
            })}
            {!products.length && <tr><td colSpan={9}>No products added yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
};

const RecipesPage = () => {
  const { products, rawMaterials, recipes, saveRecipeForProduct } = useApp();
  const [selectedProductId, setSelectedProductId] = useState(products[0]?.id || '');
  const [selectedMaterialId, setSelectedMaterialId] = useState(rawMaterials[0]?.id || '');
  const [quantity, setQuantity] = useState(0);
  const [unit, setUnit] = useState<Unit>('g');
  const [editingIngredientId, setEditingIngredientId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const selectedRecipe = [...recipes]
    .filter((recipe) => recipe.productId === selectedProductId)
    .sort((a, b) => Number(new Date(b.effectiveFrom)) - Number(new Date(a.effectiveFrom)) || b.versionNumber - a.versionNumber)[0];
  const selectedProduct = products.find((product) => product.id === selectedProductId);
  const selectedMaterial = rawMaterials.find((material) => material.id === selectedMaterialId);
  const recipeCost = calculateRecipeCost(selectedRecipe, rawMaterials);
  const margin = calculateProductMargin(selectedProduct?.sellingPrice ?? 0, recipeCost);
  const recipeConsumption = calculateRecipeConsumption(selectedRecipe, rawMaterials);

  const resetIngredientForm = () => {
    setEditingIngredientId(null);
    setSelectedMaterialId(rawMaterials[0]?.id || '');
    setQuantity(0);
    setUnit('g');
  };

  const saveRecipe = () => {
    if (!selectedProductId || !selectedMaterialId || !Number.isFinite(quantity) || quantity <= 0 || !selectedMaterial || !areUnitsCompatible(unit, selectedMaterial.unit)) {
      setMessage('Select a raw material and enter a quantity greater than zero.');
      return;
    }

    const existingIngredients = selectedRecipe?.ingredients || [];
    const nextIngredients = editingIngredientId
      ? existingIngredients.map((ingredient) => ingredient.id === editingIngredientId
        ? { rawMaterialId: selectedMaterialId, quantity, unit }
        : ingredient)
      : [...existingIngredients, { rawMaterialId: selectedMaterialId, quantity, unit }];

    saveRecipeForProduct(selectedProductId, nextIngredients);
    setMessage(editingIngredientId ? 'Recipe ingredient updated.' : 'Ingredient added to recipe.');
    resetIngredientForm();
  };

  const editIngredient = (ingredientId: string) => {
    const ingredient = selectedRecipe?.ingredients.find((item) => item.id === ingredientId);
    if (!ingredient) return;
    setEditingIngredientId(ingredient.id);
    setSelectedMaterialId(ingredient.rawMaterialId);
    setQuantity(ingredient.quantity);
    setUnit(ingredient.unit);
    setMessage('');
  };

  const deleteIngredient = (ingredientId: string) => {
    const ingredient = selectedRecipe?.ingredients.find((item) => item.id === ingredientId);
    if (!ingredient || !selectedRecipe) return;
    const materialName = rawMaterials.find((item) => item.id === ingredient.rawMaterialId)?.name || 'this ingredient';
    if (!window.confirm(`Delete ${materialName} from this product recipe?`)) return;

    saveRecipeForProduct(
      selectedProductId,
      selectedRecipe.ingredients
        .filter((item) => item.id !== ingredientId)
        .map(({ rawMaterialId, quantity: ingredientQuantity, unit: ingredientUnit }) => ({
          rawMaterialId,
          quantity: ingredientQuantity,
          unit: ingredientUnit,
        })),
    );
    if (editingIngredientId === ingredientId) resetIngredientForm();
    setMessage(`${materialName} removed from the recipe.`);
  };

  return (
    <>
      <header className="page-head"><div><p className="eyebrow">BOM</p><h1>Recipes</h1></div></header>

      <div className="card form-card">
        <h3>Set product recipe</h3>
        {!products.length && <p role="status">Add a product in Products before configuring its recipe.</p>}
        {products.length > 0 && !rawMaterials.length && <p role="status">Add raw materials in Inventory before configuring this recipe.</p>}
        <div className="grid-two">
          <label>
            <span>Product</span>
            <select value={selectedProductId} onChange={(e) => { setSelectedProductId(e.target.value); resetIngredientForm(); setMessage(''); }}>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </label>
          <label>
            <span>Raw material</span>
            <select value={selectedMaterialId} onChange={(e) => {
              const material = rawMaterials.find((item) => item.id === e.target.value);
              setSelectedMaterialId(e.target.value);
              if (material && !areUnitsCompatible(unit, material.unit)) setUnit(material.unit);
            }}>
              {rawMaterials.map((material) => <option key={material.id} value={material.id}>{material.name}</option>)}
            </select>
          </label>
          <label>
            <span>Quantity</span>
            <input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(Number(e.target.value || 0))} />
          </label>
          <label>
            <span>Unit</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
              {(['g', 'kg', 'ml', 'litre', 'piece', 'packet', 'box', 'bottle'] as const)
                .filter((option) => !selectedMaterial || areUnitsCompatible(option, selectedMaterial.unit))
                .map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        </div>
        <div className="stack-actions">
          <button type="button" className="primary" onClick={saveRecipe} disabled={!products.length || !rawMaterials.length}>{editingIngredientId ? 'Save Changes' : 'Save Ingredient'}</button>
          {editingIngredientId && <button type="button" className="secondary" onClick={() => { resetIngredientForm(); setMessage(''); }}>Cancel Edit</button>}
        </div>
        {message && <p role="status">{message}</p>}
      </div>

      <section className="metrics-grid">
        <div className="card stat-card primary"><small>Current Recipe</small><strong>{selectedRecipe ? `Version ${selectedRecipe.versionNumber}` : 'Not configured'}</strong></div>
        <div className="card stat-card warning"><small>Recipe Cost</small><strong>{formatMoney(recipeCost)}</strong></div>
        <div className="card stat-card"><small>Selling Price</small><strong>{formatMoney(selectedProduct?.sellingPrice ?? 0)}</strong></div>
        <div className="card stat-card success"><small>Gross Profit</small><strong>{formatMoney(margin.grossProfit)}</strong></div>
        <div className="card stat-card success"><small>Margin</small><strong>{margin.marginPercentage.toFixed(2)}%</strong></div>
      </section>

      <div className="card table-wrap">
        <h3>Current recipe ingredients</h3>
        <table>
          <thead><tr><th>Raw Material</th><th>Qty</th><th>Unit</th><th>Cost</th><th>Actions</th></tr></thead>
          <tbody>
            {recipeConsumption.map((item) => (
              <tr key={item.ingredientId}>
                <td>{item.rawMaterialName}</td>
                <td>{item.quantity.toFixed(3)}</td>
                <td>{item.unit}</td>
                <td>{formatMoney(item.cost)}</td>
                <td>
                  <div className="stack-actions">
                    <button type="button" className="secondary" onClick={() => editIngredient(item.ingredientId)}>Edit</button>
                    <button type="button" className="danger" onClick={() => deleteIngredient(item.ingredientId)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};

const InventoryPage = () => {
  const { rawMaterials, inventoryTransactions, addRawMaterial, updateRawMaterial, deleteRawMaterial } = useApp();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Ingredient');
  const [unit, setUnit] = useState<Unit>('kg');
  const [openingStock, setOpeningStock] = useState(0);
  const [minimumStock, setMinimumStock] = useState(0);
  const [reorderLevel, setReorderLevel] = useState(0);
  const [averageCost, setAverageCost] = useState(0);
  const [active, setActive] = useState(true);
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const resetForm = () => {
    setEditingMaterialId(null);
    setName('');
    setCategory('Ingredient');
    setUnit('kg');
    setOpeningStock(0);
    setMinimumStock(0);
    setReorderLevel(0);
    setAverageCost(0);
    setActive(true);
  };

  const handleAddMaterial = () => {
    const cleanName = name.trim();
    if (!cleanName) {
      setMessage('Enter a raw material name.');
      return;
    }
    if (rawMaterials.some((material) => material.id !== editingMaterialId && material.name.trim().toLowerCase() === cleanName.toLowerCase())) {
      setMessage('A raw material with this name already exists.');
      return;
    }
    if ([openingStock, minimumStock, reorderLevel, averageCost].some((value) => !Number.isFinite(value) || value < 0)) {
      setMessage('Stock levels and average cost must be zero or greater.');
      return;
    }

    const now = new Date().toISOString();
    const existing = rawMaterials.find((material) => material.id === editingMaterialId);
    if (existing) {
      updateRawMaterial({
        ...existing,
        name: cleanName,
        category: category.trim() || 'Ingredient',
        minimumStock,
        reorderLevel,
        active,
        updatedAt: now,
      });
    } else {
      addRawMaterial({
        id: generateId('raw_material'),
        name: cleanName,
        category: category.trim() || 'Ingredient',
        unit,
        currentStock: openingStock,
        minimumStock,
        reorderLevel,
        averageCost,
        active,
        createdAt: now,
        updatedAt: now,
      });
    }
    setMessage(existing ? `${cleanName} updated.` : `${cleanName} added to inventory.`);
    resetForm();
  };

  const editMaterial = (material: RawMaterial) => {
    setEditingMaterialId(material.id);
    setName(material.name);
    setCategory(material.category);
    setUnit(material.unit);
    setOpeningStock(material.currentStock);
    setMinimumStock(material.minimumStock);
    setReorderLevel(material.reorderLevel);
    setAverageCost(material.averageCost);
    setActive(material.active);
    setMessage('Stock quantity and unit stay unchanged when editing a material.');
  };

  const removeMaterial = (material: RawMaterial) => {
    if (!window.confirm(`Delete ${material.name}?`)) return;
    if (!deleteRawMaterial(material.id)) {
      setMessage('This material is referenced by inventory, a purchase, or a recipe and cannot be deleted.');
      return;
    }
    if (editingMaterialId === material.id) resetForm();
    setMessage(`${material.name} deleted.`);
  };

  return (
    <>
      <header className="page-head"><div><p className="eyebrow">Inventory</p><h1>Inventory</h1></div></header>
      <div className="card form-card">
        <h3>{editingMaterialId ? 'Edit Raw Material' : 'Add Raw Material'}</h3>
        <div className="grid-two">
          <label><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label><span>Category</span><input value={category} onChange={(event) => setCategory(event.target.value)} /></label>
          <label>
            <span>Unit</span>
            <select value={unit} disabled={Boolean(editingMaterialId)} onChange={(event) => setUnit(event.target.value as Unit)}>
              {(['g', 'kg', 'ml', 'litre', 'piece', 'packet', 'box', 'bottle'] as const).map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label><span>{editingMaterialId ? 'Current Stock (read-only)' : 'Opening Stock'}</span><input type="number" min="0" step="any" value={openingStock} disabled={Boolean(editingMaterialId)} onChange={(event) => setOpeningStock(Number(event.target.value))} /></label>
          <label><span>Minimum Stock</span><input type="number" min="0" step="any" value={minimumStock} onChange={(event) => setMinimumStock(Number(event.target.value))} /></label>
          <label><span>Reorder Level</span><input type="number" min="0" step="any" value={reorderLevel} onChange={(event) => setReorderLevel(Number(event.target.value))} /></label>
          {!editingMaterialId && <label><span>Average Cost per Unit</span><input type="number" min="0" step="any" value={averageCost} onChange={(event) => setAverageCost(Number(event.target.value))} /></label>}
          <label className="checkbox-label"><span>Active</span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /></label>
        </div>
        <div className="stack-actions">
          <button type="button" className="primary" onClick={handleAddMaterial}>{editingMaterialId ? 'Save Changes' : 'Add Raw Material'}</button>
          {editingMaterialId && <button type="button" className="secondary" onClick={resetForm}>Cancel Edit</button>}
        </div>
        {message && <p role="status">{message}</p>}
      </div>

      <div className="card table-wrap">
        <table>
          <thead><tr><th>Material</th><th>Current Stock</th><th>Reorder</th><th>Avg Cost</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {rawMaterials.map((material) => (
              <tr key={material.id}><td>{material.name}</td><td>{formatQuantity(material.currentStock, material.unit)}</td><td>{formatQuantity(material.reorderLevel, material.unit)}</td><td>{formatMoney(material.averageCost)}</td><td>{material.active ? 'Active' : 'Disabled'}</td><td><div className="stack-actions"><button type="button" className="secondary" onClick={() => editMaterial(material)}>Edit</button><button type="button" className="danger" onClick={() => removeMaterial(material)}>Delete</button></div></td></tr>
            ))}
            {!rawMaterials.length && <tr><td colSpan={6}>No raw materials added yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card table-wrap">
        <h3>Inventory Ledger</h3>
        <table>
          <thead><tr><th>Date</th><th>Material</th><th>Transaction</th><th>Quantity In</th><th>Quantity Out</th><th>Rate</th><th>Value</th><th>Balance</th></tr></thead>
          <tbody>
            {[...inventoryTransactions].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map((entry) => {
              const balanceBefore = [...inventoryTransactions]
                .filter((item) => item.rawMaterialId === entry.rawMaterialId)
                .filter((item) => item.date < entry.date || (item.date === entry.date && (item.createdAt < entry.createdAt || (item.createdAt === entry.createdAt && item.id < entry.id))))
                .reduce((sum, item) => {
                  const isIncoming = item.type === 'OPENING_STOCK' || item.type === 'PURCHASE' || item.type === 'ADJUSTMENT_IN' || item.type === 'TRANSFER_IN';
                  const isOutgoing = item.type === 'SALE_CONSUMPTION' || item.type === 'WASTAGE' || item.type === 'ADJUSTMENT_OUT' || item.type === 'TRANSFER_OUT';
                  return sum + (isIncoming ? item.quantity : isOutgoing ? -item.quantity : 0);
                }, 0);
              const quantityIn = entry.type === 'OPENING_STOCK' || entry.type === 'PURCHASE' || entry.type === 'ADJUSTMENT_IN' || entry.type === 'TRANSFER_IN' ? entry.quantity : 0;
              const quantityOut = entry.type === 'SALE_CONSUMPTION' || entry.type === 'WASTAGE' || entry.type === 'ADJUSTMENT_OUT' || entry.type === 'TRANSFER_OUT' ? entry.quantity : 0;
              const balance = balanceBefore + quantityIn - quantityOut;
              const materialName = rawMaterials.find((material) => material.id === entry.rawMaterialId)?.name ?? 'Unknown material';
              return (
                <tr key={entry.id}>
                  <td>{entry.date}</td>
                  <td>{materialName}</td>
                  <td>{entry.type}</td>
                  <td>{quantityIn} {entry.unit}</td>
                  <td>{quantityOut} {entry.unit}</td>
                  <td>{formatMoney(entry.rate)}</td>
                  <td>{formatMoney(entry.value)}</td>
                  <td>{balance.toFixed(3)} {entry.unit}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
};

const PurchasesPage = () => {
  const { rawMaterials, suppliers, purchases, accounts, addSupplier, updateSupplier, deleteSupplier, addPurchase, updatePurchase, deletePurchase, selectedDate, setSelectedDate } = useApp();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '');
  const [supplierName, setSupplierName] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [supplierAddress, setSupplierAddress] = useState('');
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [materialId, setMaterialId] = useState(rawMaterials[0]?.id || '');
  const [quantity, setQuantity] = useState(0);
  const [unit, setUnit] = useState<Unit>(rawMaterials[0]?.unit || 'kg');
  const [rate, setRate] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paidAmount, setPaidAmount] = useState(0);
  const [accountId, setAccountId] = useState(accounts.find((account) => account.active !== false && account.type === 'cash')?.id || '');
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null);

  const material = rawMaterials.find((item) => item.id === materialId);
  const selectedSupplier = suppliers.find((item) => item.id === supplierId);
  const total = quantity * rate;

  const resetPurchaseForm = () => {
    setEditingPurchaseId(null);
    setInvoiceNumber('');
    setQuantity(0);
    setRate(0);
    setPaidAmount(0);
    setNotes('');
  };

  const handleAddSupplier = () => {
    const cleanName = supplierName.trim();
    if (!cleanName) return;
    const existing = suppliers.find((supplier) => supplier.id === editingSupplierId);
    const supplier: SupplierRecord = {
      id: existing?.id ?? generateId('supplier'),
      name: cleanName,
      phone: supplierPhone.trim(),
      address: supplierAddress.trim(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (existing) updateSupplier(supplier);
    else addSupplier(supplier);
    setSupplierId(supplier.id);
    setEditingSupplierId(null);
    setSupplierName('');
    setSupplierPhone('');
    setSupplierAddress('');
  };

  const editSupplier = (supplier: SupplierRecord) => {
    setEditingSupplierId(supplier.id);
    setSupplierName(supplier.name);
    setSupplierPhone(supplier.phone);
    setSupplierAddress(supplier.address);
  };

  const removeSupplier = (supplier: SupplierRecord) => {
    if (!window.confirm(`Delete supplier ${supplier.name}?`)) return;
    if (!deleteSupplier(supplier.id)) {
      setMessage(`${supplier.name} is referenced by purchase records and cannot be deleted.`);
      return;
    }
    if (supplierId === supplier.id) setSupplierId(suppliers.find((item) => item.id !== supplier.id)?.id || '');
    if (editingSupplierId === supplier.id) setEditingSupplierId(null);
  };

  const handleSave = () => {
    if (!material || !selectedSupplier || quantity <= 0 || rate < 0 || paidAmount < 0 || paidAmount > total) {
      setMessage('Select a supplier and material, then enter valid purchase amounts.');
      return;
    }
    const existing = purchases.find((purchase) => purchase.id === editingPurchaseId);
    const purchase: PurchaseRecord = {
      id: existing?.id ?? generateId('purchase'),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      date: selectedDate,
      supplierId: selectedSupplier.id,
      supplierName: selectedSupplier.name,
      invoiceNumber: invoiceNumber.trim() || `INV-${Date.now()}`,
      items: [{
        id: generateId('purchase_item'),
        rawMaterialId: material.id,
        rawMaterialName: material.name,
        quantity,
        unit,
        rate,
        total,
      }],
      total,
      paymentMethod,
      paidAmount: Math.max(0, paidAmount),
      accountId,
      creditAmount: Math.max(0, total - paidAmount),
      notes: notes.trim() || undefined,
    };
    if (existing && !updatePurchase(purchase)) {
      setMessage('This change would make current stock negative, so the purchase was not changed.');
      return;
    }
    if (!existing) addPurchase(purchase);
    setMessage(existing ? `Purchase for ${material.name} updated.` : `Purchase saved for ${material.name}.`);
    resetPurchaseForm();
  };

  const editPurchase = (purchase: PurchaseRecord) => {
    if (purchase.items.length !== 1) {
      setMessage('This multi-item purchase cannot be edited in the single-item form.');
      return;
    }
    const item = purchase.items[0];
    setEditingPurchaseId(purchase.id);
    setSelectedDate(purchase.date);
    setSupplierId(purchase.supplierId || suppliers.find((supplier) => supplier.name === purchase.supplierName)?.id || '');
    setInvoiceNumber(purchase.invoiceNumber);
    setMaterialId(item.rawMaterialId);
    setUnit(item.unit);
    setQuantity(item.quantity);
    setRate(item.rate);
    setPaymentMethod(purchase.paymentMethod);
    setPaidAmount(purchase.paidAmount);
    setAccountId(accounts.find((account) => account.id === purchase.accountId && account.active !== false)?.id || accounts.find((account) => account.active !== false && account.type === (purchase.paymentMethod === 'cash' ? 'cash' : 'online'))?.id || '');
    setNotes(purchase.notes || '');
    setMessage('');
  };

  const removePurchase = (purchase: PurchaseRecord) => {
    if (!window.confirm(`Delete purchase ${purchase.invoiceNumber || purchase.id}? This also updates inventory and payment records.`)) return;
    if (!deletePurchase(purchase.id)) {
      setMessage('This purchase cannot be deleted because its stock has already been consumed.');
      return;
    }
    if (editingPurchaseId === purchase.id) resetPurchaseForm();
    setMessage('Purchase deleted and linked balances updated.');
  };

  return (
    <>
      <header className="page-head"><div><p className="eyebrow">Procurement</p><h1>Purchases</h1></div></header>
      <div className="card form-card">
        <h3>{editingPurchaseId ? 'Edit Purchase' : 'Create Purchase'}</h3>
        <div className="grid-two">
          <label><span>Date</span><input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} /></label>
          <label><span>Supplier</span><select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>{suppliers.length ? suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>) : <option value="">Add a supplier first</option>}</select></label>
          <label><span>{editingSupplierId ? 'Edit Supplier Name' : 'Supplier Name'}</span><input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Create supplier" /></label>
          <label><span>Supplier Phone</span><input value={supplierPhone} onChange={(e) => setSupplierPhone(e.target.value)} /></label>
          <label><span>Supplier Address</span><input value={supplierAddress} onChange={(e) => setSupplierAddress(e.target.value)} /></label>
          <div className="stack-actions">
            <button type="button" className="secondary" onClick={handleAddSupplier}>{editingSupplierId ? 'Save Supplier' : 'Add Supplier'}</button>
            {editingSupplierId && <button type="button" className="secondary" onClick={() => { setEditingSupplierId(null); setSupplierName(''); setSupplierPhone(''); setSupplierAddress(''); }}>Cancel</button>}
          </div>
          <label><span>Invoice Number</span><input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Invoice number" /></label>
          <label><span>Raw Material</span><select value={materialId} onChange={(e) => { setMaterialId(e.target.value); setUnit(rawMaterials.find((item) => item.id === e.target.value)?.unit || 'kg'); }}>{rawMaterials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Quantity</span><input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(Number(e.target.value || 0))} /></label>
          <label><span>Unit</span><select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>{(['g', 'kg', 'ml', 'litre', 'piece', 'packet', 'box', 'bottle'] as const).map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
          <label><span>Rate</span><input type="number" min="0" step="any" value={rate} onChange={(e) => setRate(Number(e.target.value || 0))} /></label>
          <label><span>Total</span><input type="number" value={total} readOnly /></label>
          <label><span>Payment Method</span><select value={paymentMethod} onChange={(e) => { const method = e.target.value as PaymentMethod; setPaymentMethod(method); setAccountId(accounts.find((account) => account.active !== false && account.type === (method === 'cash' ? 'cash' : 'online'))?.id || ''); }}>{(['cash', 'upi', 'card', 'other'] as const).map((method) => <option key={method} value={method}>{method.toUpperCase()}</option>)}</select></label>
          <label><span>Paid From Account</span><select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.filter((account) => account.active !== false && account.type === (paymentMethod === 'cash' ? 'cash' : 'online')).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          <label><span>Paid Amount</span><input type="number" min="0" value={paidAmount} onChange={(e) => setPaidAmount(Number(e.target.value || 0))} /></label>
          <label><span>Unpaid Balance</span><input type="number" value={Math.max(0, total - paidAmount)} readOnly /></label>
          <label><span>Notes</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        </div>
        <div className="stack-actions">
          <button type="button" className="primary" onClick={handleSave} disabled={!selectedSupplier || !material}>{editingPurchaseId ? 'Save Changes' : 'Save Purchase'}</button>
          {editingPurchaseId && <button type="button" className="secondary" onClick={resetPurchaseForm}>Cancel Edit</button>}
        </div>
        {message && <p role="status">{message}</p>}
      </div>
      <div className="card table-wrap">
        <h3>Purchases for {formatIndiaDate(selectedDate)}</h3>
        <table>
          <thead><tr><th>Invoice</th><th>Supplier</th><th>Items</th><th>Total</th><th>Paid</th><th>Due</th><th>Actions</th></tr></thead>
          <tbody>
            {purchases.filter((purchase) => purchase.date === selectedDate).map((purchase) => (
              <tr key={purchase.id}>
                <td>{purchase.invoiceNumber || '-'}</td>
                <td>{purchase.supplierName}</td>
                <td>{purchase.items.map((item) => `${item.rawMaterialName} × ${item.quantity} ${item.unit}`).join(', ')}</td>
                <td>{formatMoney(purchase.total)}</td>
                <td>{formatMoney(purchase.paidAmount)}</td>
                <td>{formatMoney(Math.max(0, purchase.total - purchase.paidAmount))}</td>
                <td><div className="stack-actions"><button type="button" className="secondary" onClick={() => editPurchase(purchase)} disabled={purchase.items.length !== 1} title={purchase.items.length !== 1 ? 'Edit is available for single-item purchases only' : 'Edit purchase'}>Edit</button><button type="button" className="danger" onClick={() => removePurchase(purchase)}>Delete</button></div></td>
              </tr>
            ))}
            {!purchases.some((purchase) => purchase.date === selectedDate) && <tr><td colSpan={7}>No purchases for this date.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card table-wrap">
        <h3>Suppliers</h3>
        <table>
          <thead><tr><th>Name</th><th>Phone</th><th>Address</th><th>Actions</th></tr></thead>
          <tbody>
            {suppliers.map((supplier) => (
              <tr key={supplier.id}><td>{supplier.name}</td><td>{supplier.phone}</td><td>{supplier.address}</td><td><div className="stack-actions"><button type="button" className="secondary" onClick={() => editSupplier(supplier)}>Edit</button><button type="button" className="danger" onClick={() => removeSupplier(supplier)}>Delete</button></div></td></tr>
            ))}
            {!suppliers.length && <tr><td colSpan={4}>No suppliers added yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
};

const ExpensesPage = () => {
  const { expenses, accounts, addExpense, updateExpense, deleteExpense, selectedDate, setSelectedDate } = useApp();
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState(0);
  const [paidAmount, setPaidAmount] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [accountId, setAccountId] = useState(accounts.find((account) => account.active !== false && account.type === 'cash')?.id || '');
  const [description, setDescription] = useState('');
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const resetForm = () => {
    setEditingExpenseId(null);
    setCategory('');
    setAmount(0);
    setPaidAmount(null);
    setPaymentMethod('cash');
    setAccountId(accounts.find((account) => account.active !== false && account.type === 'cash')?.id || '');
    setDescription('');
  };

  const handleSave = () => {
    const actualPaid = paidAmount ?? amount;
    if (!category || amount < 0 || !Number.isFinite(amount) || actualPaid < 0 || actualPaid > amount) {
      setMessage('Choose a category and enter a valid nonnegative amount.');
      return;
    }
    const existing = expenses.find((expense) => expense.id === editingExpenseId);
    const now = new Date().toISOString();
    const record = {
      id: existing?.id ?? generateId('expense'),
      createdAt: existing?.createdAt ?? now,
      updatedAt: new Date().toISOString(),
      date: selectedDate,
      category,
      amount,
      paidAmount: actualPaid,
      paymentMethod,
      accountId,
      description: description.trim(),
    };
    if (existing) updateExpense(record);
    else addExpense(record);
    setMessage(existing ? 'Expense updated.' : 'Expense saved.');
    resetForm();
  };

  const editExpense = (expense: ExpenseRecord) => {
    setEditingExpenseId(expense.id);
    setSelectedDate(expense.date);
    setCategory(expense.category);
    setAmount(expense.amount);
    setPaidAmount(expense.paidAmount ?? expense.amount);
    setPaymentMethod(expense.paymentMethod);
    setAccountId(accounts.find((account) => account.id === expense.accountId && account.active !== false)?.id || accounts.find((account) => account.active !== false && account.type === (expense.paymentMethod === 'cash' ? 'cash' : 'online'))?.id || '');
    setDescription(expense.description);
    setMessage('');
  };

  const removeExpense = (expense: ExpenseRecord) => {
    if (!window.confirm(`Delete this ${expense.category} expense?`)) return;
    deleteExpense(expense.id);
    if (editingExpenseId === expense.id) resetForm();
    setMessage('Expense deleted.');
  };

  return (
    <>
      <header className="page-head"><div><p className="eyebrow">Operations</p><h1>Expenses</h1></div></header>
      <div className="card form-card">
        <h3>{editingExpenseId ? 'Edit Expense' : 'Add Expense'}</h3>
        <div className="grid-two">
          <label><span>Date</span><input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} /></label>
          <label><span>Category</span><select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Select category</option>{['Rent', 'Salary', 'Electricity', 'Gas', 'Transport', 'Marketing', 'Maintenance', 'Packaging', 'Delivery', 'Miscellaneous'].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label><span>Amount</span><input type="number" min="0" value={amount} onChange={(e) => setAmount(Number(e.target.value || 0))} /></label>
          <label><span>Actually Paid</span><input type="number" min="0" max={amount} value={paidAmount ?? amount} onChange={(event) => setPaidAmount(Number(event.target.value || 0))} /></label>
          <label><span>Payment Method</span><select value={paymentMethod} onChange={(event) => { const method = event.target.value as PaymentMethod; setPaymentMethod(method); setAccountId(accounts.find((account) => account.active !== false && account.type === (method === 'cash' ? 'cash' : 'online'))?.id || ''); }}>{(['cash', 'upi', 'card', 'other'] as const).map((method) => <option key={method} value={method}>{method.toUpperCase()}</option>)}</select></label>
          <label><span>Paid From Account</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{accounts.filter((account) => account.active !== false && account.type === (paymentMethod === 'cash' ? 'cash' : 'online')).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          <label><span>Description</span><input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        </div>
        <div className="stack-actions">
          <button type="button" className="primary" onClick={handleSave}>{editingExpenseId ? 'Save Changes' : 'Save Expense'}</button>
          {editingExpenseId && <button type="button" className="secondary" onClick={resetForm}>Cancel Edit</button>}
        </div>
        {message && <p role="status">{message}</p>}
      </div>
      <div className="card table-wrap">
        <h3>Expenses for {formatIndiaDate(selectedDate)}</h3>
        <table>
          <thead><tr><th>Category</th><th>Amount</th><th>Description</th><th>Actions</th></tr></thead>
          <tbody>
            {expenses.filter((expense) => expense.date === selectedDate).map((expense) => (
              <tr key={expense.id}><td>{expense.category}</td><td>{formatMoney(expense.amount)}</td><td>{expense.description}</td><td><div className="stack-actions"><button type="button" className="secondary" onClick={() => editExpense(expense)}>Edit</button><button type="button" className="danger" onClick={() => removeExpense(expense)}>Delete</button></div></td></tr>
            ))}
            {!expenses.some((expense) => expense.date === selectedDate) && <tr><td colSpan={4}>No expenses for this date.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
};

const AccountsPage = () => {
  const {
    accounts, accountTransactions, cashReconciliations, sales, purchases, expenses, selectedDate, setSelectedDate,
    addAccount, deleteAccount, restoreAccount, transferAccounts, saveCashReconciliation,
  } = useApp();
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('cash');
  const [openingBalance, setOpeningBalance] = useState(0);
  const [openingDate, setOpeningDate] = useState(selectedDate);
  const [fromAccountId, setFromAccountId] = useState(accounts.find((account) => account.active !== false)?.id || '');
  const [toAccountId, setToAccountId] = useState(accounts.filter((account) => account.active !== false)[1]?.id || '');
  const [transferAmount, setTransferAmount] = useState(0);
  const [cashAccountId, setCashAccountId] = useState(accounts.find((account) => account.active !== false && account.type === 'cash')?.id || '');
  const [countedCash, setCountedCash] = useState(0);
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');
  const activeAccounts = accounts.filter((account) => account.active !== false);
  const archivedAccounts = accounts.filter((account) => account.active === false);
  const cashAccounts = activeAccounts.filter((account) => account.type === 'cash');
  const selectedCashAccount = cashAccounts.find((account) => account.id === cashAccountId) ?? cashAccounts[0];
  const expectedCash = selectedCashAccount ? getAccountBalance(selectedCashAccount, accountTransactions, selectedDate) : 0;
  const existingReconciliation = cashReconciliations.find((record) => record.date === selectedDate && record.accountId === selectedCashAccount?.id);
  const dailySales = sales.filter((sale) => sale.status === 'finalized' && sale.date === selectedDate);
  const dailySaleIds = new Set(dailySales.map((sale) => sale.id));
  const expectedCollections = dailySales.reduce((sum, sale) => sum + Object.values(sale.paymentSummary).reduce((paid, amount) => paid + amount, 0), 0);
  const postedCollections = accountTransactions
    .filter((entry) => dailySaleIds.has(entry.source))
    .reduce((sum, entry) => sum + (entry.direction === 'in' ? entry.amount : -entry.amount), 0);
  const recentTransactions = [...accountTransactions].sort((left, right) => right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt)).slice(0, 30);
  const getAccountDeleteReason = (account: typeof accounts[number]) => {
    const isReferenced = accountTransactions.some((entry) => entry.accountId === account.id)
      || cashReconciliations.some((entry) => entry.accountId === account.id)
      || sales.some((sale) => sale.cashAccountId === account.id || sale.onlineAccountId === account.id)
      || purchases.some((purchase) => purchase.accountId === account.id)
      || expenses.some((expense) => expense.accountId === account.id);
    return isReferenced ? 'Delete will archive this account to preserve financial history.' : 'Delete this unused account.';
  };

  const handleAddAccount = () => {
    try {
      addAccount({ id: generateId('account'), name: accountName, type: accountType, openingBalance, openingDate });
      setAccountName('');
      setOpeningBalance(0);
      setMessage('Account added. Its balance will be calculated from the opening balance and ledger.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to add this account.');
    }
  };

  const handleTransfer = () => {
    try {
      transferAccounts(fromAccountId, toAccountId, transferAmount, selectedDate);
      setTransferAmount(0);
      setMessage('Transfer posted as matching debit and credit entries.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to post this transfer.');
    }
  };

  const handleCashCount = () => {
    try {
      if (!selectedCashAccount) throw new Error('Create a cash account before reconciling cash.');
      saveCashReconciliation({ date: selectedDate, accountId: selectedCashAccount.id, countedBalance: countedCash, notes: notes.trim() || undefined });
      setMessage('Physical cash count saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save this cash count.');
    }
  };

  const handleDeleteAccount = (accountId: string) => {
    const account = accounts.find((item) => item.id === accountId);
    if (!account) return;
    const isReferenced = accountTransactions.some((entry) => entry.accountId === account.id)
      || cashReconciliations.some((entry) => entry.accountId === account.id)
      || sales.some((sale) => sale.cashAccountId === account.id || sale.onlineAccountId === account.id)
      || purchases.some((purchase) => purchase.accountId === account.id)
      || expenses.some((expense) => expense.accountId === account.id);
    const action = isReferenced ? 'archive to preserve financial history' : 'delete';
    if (!window.confirm(`Remove "${account.name}" from active accounts? This will ${action}.`)) return;
    const error = deleteAccount(accountId);
    if (error) {
      setMessage(error);
      return;
    }
    const remainingAccounts = activeAccounts.filter((item) => item.id !== accountId);
    if (fromAccountId === accountId) setFromAccountId(remainingAccounts[0]?.id || '');
    if (toAccountId === accountId) setToAccountId(remainingAccounts.find((item) => item.id !== remainingAccounts[0]?.id)?.id || remainingAccounts[0]?.id || '');
    if (cashAccountId === accountId) setCashAccountId(remainingAccounts.find((item) => item.type === 'cash')?.id || '');
    setMessage(isReferenced ? 'Account archived; its ledger and balance history are preserved.' : 'Account deleted.');
  };

  const handleRestoreAccount = (accountId: string) => {
    const error = restoreAccount(accountId);
    setMessage(error || 'Account restored to active accounts.');
  };

  return (
    <>
      <header className="page-head"><div><p className="eyebrow">Cash management</p><h1>Accounts</h1></div></header>
      <section className="stats-grid">
        {activeAccounts.map((account) => <StatCard key={account.id} label={`${account.name} · ${account.type}`} value={formatMoney(getAccountBalance(account, accountTransactions))} />)}
        <StatCard label="Total Available" value={formatMoney(accounts.reduce((sum, account) => sum + getAccountBalance(account, accountTransactions), 0))} tone="success" />
      </section>
      <section className="two-col">
        <div className="card form-card">
          <h3>Add Account</h3>
          <div className="grid-two">
            <label><span>Account Name</span><input value={accountName} onChange={(event) => setAccountName(event.target.value)} /></label>
            <label><span>Account Type</span><select value={accountType} onChange={(event) => setAccountType(event.target.value as AccountType)}><option value="cash">Cash</option><option value="online">Online</option></select></label>
            <label><span>Opening Balance</span><input type="number" min="0" value={openingBalance} onChange={(event) => setOpeningBalance(Number(event.target.value || 0))} /></label>
            <label><span>Effective Date</span><input type="date" value={openingDate} onChange={(event) => setOpeningDate(event.target.value)} /></label>
          </div>
          <div className="stack-actions"><button type="button" className="primary" onClick={handleAddAccount}>Add Account</button></div>
        </div>
        <div className="card form-card">
          <h3>Transfer Between Accounts</h3>
          <div className="grid-two">
            <label><span>From</span><select value={fromAccountId} onChange={(event) => setFromAccountId(event.target.value)}>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
            <label><span>To</span><select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
            <label><span>Amount</span><input type="number" min="0" value={transferAmount} onChange={(event) => setTransferAmount(Number(event.target.value || 0))} /></label>
            <label><span>Date</span><input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label>
          </div>
          <div className="stack-actions"><button type="button" className="primary" onClick={handleTransfer}>Post Transfer</button></div>
        </div>
      </section>
      <section className="two-col">
        <div className="card form-card">
          <h3>Daily Sales Collections · {formatIndiaDate(selectedDate)}</h3>
          <p>Collected on sales: <strong>{formatMoney(expectedCollections)}</strong></p>
          <p>Posted to accounts: <strong>{formatMoney(postedCollections)}</strong></p>
          <p>Difference: <strong>{formatMoney(expectedCollections - postedCollections)}</strong></p>
          <h3>Physical Cash Reconciliation</h3>
          <div className="grid-two">
            <label><span>Date</span><input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label>
            <label><span>Cash Account</span><select value={selectedCashAccount?.id || ''} onChange={(event) => setCashAccountId(event.target.value)}>{cashAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
            <label><span>Expected Cash</span><input value={formatMoney(expectedCash)} readOnly /></label>
            <label><span>Physically Counted</span><input type="number" min="0" value={existingReconciliation?.countedBalance ?? countedCash} onChange={(event) => setCountedCash(Number(event.target.value || 0))} /></label>
            <label><span>Variance</span><input value={formatMoney((existingReconciliation?.countedBalance ?? countedCash) - expectedCash)} readOnly /></label>
            <label><span>Notes</span><input value={notes || existingReconciliation?.notes || ''} onChange={(event) => setNotes(event.target.value)} /></label>
          </div>
          <div className="stack-actions"><button type="button" className="primary" onClick={handleCashCount}>Save Cash Count</button></div>
        </div>
        <div className="card table-wrap">
          <h3>Accounts</h3>
          <table>
            <thead><tr><th>Account</th><th>Type</th><th>Opening</th><th>Effective Date</th><th>Current Balance</th><th>Actions</th></tr></thead>
            <tbody>{activeAccounts.map((account) => {
              const deleteReason = getAccountDeleteReason(account);
              return (
                <tr key={account.id}>
                  <td>{account.name}</td>
                  <td>{account.type}</td>
                  <td>{formatMoney(account.openingBalance)}</td>
                  <td>{formatIndiaDate(account.openingDate)}</td>
                  <td>{formatMoney(getAccountBalance(account, accountTransactions))}</td>
                  <td><button type="button" className="danger" title={deleteReason} onClick={() => handleDeleteAccount(account.id)}>Delete</button></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </section>
      {!!archivedAccounts.length && <div className="card table-wrap">
        <h3>Archived Accounts</h3>
        <table>
          <thead><tr><th>Account</th><th>Type</th><th>Balance</th><th>Actions</th></tr></thead>
          <tbody>{archivedAccounts.map((account) => <tr key={account.id}><td>{account.name}</td><td>{account.type}</td><td>{formatMoney(getAccountBalance(account, accountTransactions))}</td><td><button type="button" className="secondary" onClick={() => handleRestoreAccount(account.id)}>Restore</button></td></tr>)}</tbody>
        </table>
      </div>}
      <div className="card table-wrap">
        <h3>Recent Account Transactions</h3>
        <table>
          <thead><tr><th>Date</th><th>Transaction ID</th><th>Account</th><th>Description</th><th>Direction</th><th>Amount</th></tr></thead>
          <tbody>
            {recentTransactions.map((entry) => <tr key={entry.id}><td>{formatIndiaDate(entry.date)}</td><td>{entry.transactionId || entry.id}</td><td>{accounts.find((account) => account.id === entry.accountId)?.name || 'Unknown account'}</td><td>{entry.label}</td><td>{entry.direction}</td><td>{formatMoney(entry.amount)}</td></tr>)}
            {!recentTransactions.length && <tr><td colSpan={6}>No account transactions posted yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {message && <p role="status">{message}</p>}
    </>
  );
};

const WastagePage = () => {
  const { rawMaterials, wastage, addWastage, selectedDate, setSelectedDate } = useApp();
  const [rawMaterialId, setRawMaterialId] = useState(rawMaterials[0]?.id || '');
  const [quantity, setQuantity] = useState(0);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const material = rawMaterials.find((item) => item.id === rawMaterialId);

  const save = () => {
    if (!material || quantity <= 0 || !reason.trim()) {
      setMessage('Select a material, enter a positive quantity, and provide a reason.');
      return;
    }
    const now = new Date().toISOString();
    try {
      addWastage({
        id: generateId('wastage'),
        createdAt: now,
        updatedAt: now,
        date: selectedDate,
        rawMaterialId: material.id,
        rawMaterialName: material.name,
        quantity,
        unit: material.unit,
        reason: reason.trim(),
        cost: quantity * material.averageCost,
      });
      setQuantity(0);
      setReason('');
      setMessage(`${material.name} wastage recorded; stock reduced.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to record wastage.');
    }
  };

  return (
    <>
      <header className="page-head"><div><p className="eyebrow">Inventory loss</p><h1>Wastage</h1></div></header>
      <div className="card form-card">
        <h3>Record Wastage</h3>
        <div className="grid-two">
          <label><span>Date</span><input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label>
          <label><span>Raw Material</span><select value={rawMaterialId} onChange={(event) => setRawMaterialId(event.target.value)}>{rawMaterials.map((item) => <option key={item.id} value={item.id}>{item.name} ({formatQuantity(item.currentStock, item.unit)})</option>)}</select></label>
          <label><span>Quantity</span><input type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(Number(event.target.value || 0))} /></label>
          <label><span>Reason</span><input value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        </div>
        <button type="button" className="primary" onClick={save} disabled={!rawMaterials.length}>Record Wastage</button>
        {message && <p role="status">{message}</p>}
      </div>
      <div className="card table-wrap">
        <h3>Wastage for {formatIndiaDate(selectedDate)}</h3>
        <table>
          <thead><tr><th>Material</th><th>Quantity</th><th>Reason</th><th>Cost</th></tr></thead>
          <tbody>
            {wastage.filter((entry) => entry.date === selectedDate).map((entry) => (
              <tr key={entry.id}><td>{entry.rawMaterialName}</td><td>{entry.quantity} {entry.unit}</td><td>{entry.reason}</td><td>{formatMoney(entry.cost)}</td></tr>
            ))}
            {!wastage.some((entry) => entry.date === selectedDate) && <tr><td colSpan={4}>No wastage recorded for this date.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
};

const ReportsPage = () => {
  const { sales, expenses, rawMaterials, inventoryTransactions, selectedDate } = useApp();
  const [toDate, setToDate] = useState(selectedDate);
  const [fromDate, setFromDate] = useState(() => {
    const date = new Date(`${selectedDate}T00:00:00`);
    date.setDate(date.getDate() - 9);
    return toBusinessDateKey(date);
  });
  const setRange = (days: number) => {
    const end = new Date(`${selectedDate}T00:00:00`);
    const start = new Date(end);
    start.setDate(start.getDate() - days + 1);
    setFromDate(toBusinessDateKey(start));
    setToDate(selectedDate);
  };
  const dateKeys: string[] = [];
  const rangeStart = new Date(`${fromDate}T00:00:00`);
  const rangeEnd = new Date(`${toDate}T00:00:00`);
  if (!Number.isNaN(rangeStart.getTime()) && !Number.isNaN(rangeEnd.getTime()) && rangeStart <= rangeEnd) {
    for (const date = new Date(rangeStart); date <= rangeEnd; date.setDate(date.getDate() + 1)) {
      dateKeys.push(toBusinessDateKey(date));
    }
  }
  const finalizedSales = sales.filter((sale) => sale.status === 'finalized' && sale.date >= fromDate && sale.date <= toDate);
  const periodExpenses = expenses.filter((expense) => expense.date >= fromDate && expense.date <= toDate);
  const periodRevenue = finalizedSales.reduce((sum, sale) => sum + sale.totalAmount, 0);
  const periodCOGS = finalizedSales.reduce((sum, sale) => sum + sale.totalCOGS, 0);
  const periodExpensesTotal = periodExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const itemRows = finalizedSales.flatMap((sale) => sale.items.map((item) => ({ ...item, saleDate: sale.date })));
  const trendRows = dateKeys.map((date) => {
    const daySales = finalizedSales.filter((sale) => sale.date === date);
    const revenue = daySales.reduce((sum, sale) => sum + sale.totalAmount, 0);
    const cogs = daySales.reduce((sum, sale) => sum + sale.totalCOGS, 0);
    const dayExpenses = periodExpenses.filter((expense) => expense.date === date).reduce((sum, expense) => sum + expense.amount, 0);
    return { date, revenue, cogs, expenses: dayExpenses, netProfit: revenue - cogs - dayExpenses };
  });
  const inventoryMovements = rawMaterials.map((material) => {
    const materialTransactions = inventoryTransactions.filter((entry) => entry.rawMaterialId === material.id);
    const signedQuantity = (entry: typeof inventoryTransactions[number]) => {
      if (['OPENING_STOCK', 'PURCHASE', 'ADJUSTMENT_IN', 'TRANSFER_IN'].includes(entry.type)) return entry.quantity;
      if (['SALE_CONSUMPTION', 'WASTAGE', 'ADJUSTMENT_OUT', 'TRANSFER_OUT'].includes(entry.type)) return -entry.quantity;
      return 0;
    };
    const rangeTransactions = materialTransactions.filter((entry) => entry.date >= fromDate && entry.date <= toDate);
    const sinceRangeStart = materialTransactions.filter((entry) => entry.date >= fromDate);
    const opening = material.currentStock - sinceRangeStart.reduce((sum, entry) => sum + signedQuantity(entry), 0);
    const openingAdded = rangeTransactions.filter((entry) => entry.type === 'OPENING_STOCK').reduce((sum, entry) => sum + entry.quantity, 0);
    const purchased = rangeTransactions.filter((entry) => entry.type === 'PURCHASE').reduce((sum, entry) => sum + entry.quantity, 0);
    const sold = rangeTransactions.filter((entry) => entry.type === 'SALE_CONSUMPTION').reduce((sum, entry) => sum + entry.quantity, 0);
    const wasted = rangeTransactions.filter((entry) => entry.type === 'WASTAGE').reduce((sum, entry) => sum + entry.quantity, 0);
    const otherMovement = rangeTransactions
      .filter((entry) => !['OPENING_STOCK', 'PURCHASE', 'SALE_CONSUMPTION', 'WASTAGE'].includes(entry.type))
      .reduce((sum, entry) => sum + signedQuantity(entry), 0);
    return {
      id: material.id,
      name: material.name,
      unit: material.unit,
      opening,
      openingAdded,
      purchased,
      sold,
      wasted,
      otherMovement,
      closing: opening + rangeTransactions.reduce((sum, entry) => sum + signedQuantity(entry), 0),
    };
  });
  const exportCsv = () => {
    const csvRows: (string | number)[][] = [
      ['Business report', rangeLabel],
      [],
      ['Daily Profit & Loss'],
      ['Date', 'Revenue', 'COGS', 'Gross Profit', 'Expenses', 'Net Profit'],
      ...trendRows.map((day) => [day.date, day.revenue, day.cogs, day.revenue - day.cogs, day.expenses, day.netProfit]),
      ['Total', periodRevenue, periodCOGS, periodRevenue - periodCOGS, periodExpensesTotal, periodRevenue - periodCOGS - periodExpensesTotal],
      [],
      ['Item-wise Sales'],
      ['Date', 'Product', 'Qty', 'Revenue', 'Cost', 'Profit'],
      ...itemRows.map((item) => [item.saleDate, item.productName, item.quantity, item.total, item.cost, item.grossProfit]),
      ['Total', '', itemRows.reduce((sum, item) => sum + item.quantity, 0), periodRevenue, periodCOGS, periodRevenue - periodCOGS],
      [],
      ['Inventory Movement'],
      ['Material', 'Unit', 'Starting Stock', 'Opening Added', 'Purchased', 'Sold', 'Wastage', 'Other Movement', 'Closing'],
      ...inventoryMovements.map((movement) => [movement.name, movement.unit, movement.opening, movement.openingAdded, movement.purchased, movement.sold, movement.wasted, movement.otherMovement, movement.closing]),
      [],
      ['Inventory Status (current)'],
      ['Material', 'Current', 'Reorder'],
      ...rawMaterials.map((material) => [material.name, `${material.currentStock} ${material.unit}`, `${material.reorderLevel} ${material.unit}`]),
    ];
    const csv = csvRows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `business-report-${fromDate}-to-${toDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const rangeLabel = `${formatIndiaDate(fromDate)} - ${formatIndiaDate(toDate)}`;

  return (
    <div className="reports-page">
      <header className="page-head"><div><p className="eyebrow">Analytics</p><h1>Reports</h1></div></header>
      <div className="card form-card">
        <div className="grid-two">
          <label><span>From</span><input type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} /></label>
          <label><span>To</span><input type="date" value={toDate} min={fromDate} max={selectedDate} onChange={(event) => setToDate(event.target.value)} /></label>
        </div>
        <div className="stack-actions">
          <button type="button" className="secondary" onClick={() => setRange(10)}>Last 10 days</button>
          <button type="button" className="secondary" onClick={() => setRange(20)}>Last 20 days</button>
          <button type="button" className="secondary" onClick={exportCsv}>Export Excel (CSV)</button>
          <button type="button" className="secondary" onClick={() => window.print()}>Export PDF</button>
        </div>
      </div>
      <section className="stats-grid">
        <StatCard label="Period Revenue" value={formatMoney(periodRevenue)} />
        <StatCard label="Period COGS" value={formatMoney(periodCOGS)} tone="warning" />
        <StatCard label="Gross Profit" value={formatMoney(periodRevenue - periodCOGS)} tone="success" />
        <StatCard label="Expenses" value={formatMoney(periodExpensesTotal)} tone="danger" />
        <StatCard label="Net Profit" value={formatMoney(periodRevenue - periodCOGS - periodExpensesTotal)} tone="success" />
      </section>
      <div className="card chart-card">
        <h3>Business Trend · {rangeLabel}</h3>
        <Suspense fallback={<div className="trend-chart" aria-label="Loading business trend" />}>
          <TrendChart data={trendRows} formatMoney={formatMoney} formatDate={formatIndiaDate} />
        </Suspense>
      </div>
      <div className="card table-wrap">
        <h3>Daily Profit &amp; Loss</h3>
        <table>
          <thead><tr><th>Date</th><th>Revenue</th><th>COGS</th><th>Gross Profit</th><th>Expenses</th><th>Net Profit</th></tr></thead>
          <tbody>
            {trendRows.map((day) => (
              <tr key={day.date}><td>{formatIndiaDate(day.date)}</td><td>{formatMoney(day.revenue)}</td><td>{formatMoney(day.cogs)}</td><td>{formatMoney(day.revenue - day.cogs)}</td><td>{formatMoney(day.expenses)}</td><td>{formatMoney(day.netProfit)}</td></tr>
            ))}
            {!trendRows.length && <tr><td colSpan={6}>Choose a valid date range.</td></tr>}
            {!!trendRows.length && <tr className="total-row"><th>Total for period</th><td>{formatMoney(periodRevenue)}</td><td>{formatMoney(periodCOGS)}</td><td>{formatMoney(periodRevenue - periodCOGS)}</td><td>{formatMoney(periodExpensesTotal)}</td><td>{formatMoney(periodRevenue - periodCOGS - periodExpensesTotal)}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card table-wrap">
        <h3>Item-wise Sales · {rangeLabel}</h3>
        <table>
          <thead><tr><th>Date</th><th>Product</th><th>Qty</th><th>Revenue</th><th>Cost</th><th>Profit</th></tr></thead>
          <tbody>
            {itemRows.map((item, index) => (
              <tr key={`${item.productId}-${index}-${item.saleDate}`}><td>{formatIndiaDate(item.saleDate)}</td><td>{item.productName}</td><td>{item.quantity}</td><td>{formatMoney(item.total)}</td><td>{formatMoney(item.cost)}</td><td>{formatMoney(item.grossProfit)}</td></tr>
            ))}
            {!itemRows.length && <tr><td colSpan={6}>No finalized sales in this date range.</td></tr>}
            {!!itemRows.length && <tr className="total-row"><th colSpan={2}>Total for period</th><td>{itemRows.reduce((sum, item) => sum + item.quantity, 0)}</td><td>{formatMoney(periodRevenue)}</td><td>{formatMoney(periodCOGS)}</td><td>{formatMoney(periodRevenue - periodCOGS)}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card table-wrap">
        <h3>Inventory Movement · {rangeLabel}</h3>
        <table>
          <thead><tr><th>Material</th><th>Starting Stock</th><th>Opening Added</th><th>Purchased</th><th>Sold</th><th>Wastage</th><th>Other Movement</th><th>Closing</th></tr></thead>
          <tbody>
            {inventoryMovements.map((movement) => (
              <tr key={movement.id}>
                <td>{movement.name}</td>
                <td>{formatQuantity(movement.opening, movement.unit)}</td>
                <td>{formatQuantity(movement.openingAdded, movement.unit)}</td>
                <td>{formatQuantity(movement.purchased, movement.unit)}</td>
                <td>{formatQuantity(movement.sold, movement.unit)}</td>
                <td>{formatQuantity(movement.wasted, movement.unit)}</td>
                <td>{formatQuantity(movement.otherMovement, movement.unit)}</td>
                <td>{formatQuantity(movement.closing, movement.unit)}</td>
              </tr>
            ))}
            {!inventoryMovements.length && <tr><td colSpan={8}>No inventory materials to report.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card table-wrap">
        <h3>Inventory Status</h3>
        <table>
          <thead><tr><th>Material</th><th>Current</th><th>Reorder</th></tr></thead>
          <tbody>
            {rawMaterials.map((material) => (
              <tr key={material.id}><td>{material.name}</td><td>{formatQuantity(material.currentStock, material.unit)}</td><td>{formatQuantity(material.reorderLevel, material.unit)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SettingsPage = () => {
  const { database, setDatabase } = useApp();
  const [importText, setImportText] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [validation, setValidation] = useState<DatabaseValidationResult | null>(null);
  const [toast, setToast] = useState('');

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3200);
  };

  const copyDatabase = async () => {
    try {
      await navigator.clipboard.writeText(exportDatabase(database));
      notify('Complete database JSON copied to clipboard.');
    } catch {
      notify('Could not copy database JSON. Check clipboard permissions.');
    }
  };

  const downloadDatabase = () => {
    const blob = new Blob([exportDatabase(database)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'bonafide-business-db.json';
    link.click();
    URL.revokeObjectURL(url);
    notify('Complete database JSON downloaded.');
  };

  const validateImport = () => {
    try {
      const parsed: unknown = JSON.parse(importText);
      const result = validateDatabase(parsed);
      setValidation(result);
      if (!result.valid) notify(`Import validation failed: ${result.errors[0]}`);
      else notify('Database JSON validated. Review the summary before replacing data.');
    } catch {
      const result: DatabaseValidationResult = { valid: false, errors: ['The pasted content is not valid JSON.'] };
      setValidation(result);
      notify(result.errors[0]);
    }
  };

  const confirmImport = () => {
    const imported = importDatabase(importText);
    if (!imported) {
      notify('Import failed. The current database was not changed.');
      return;
    }
    setDatabase(imported);
    setImportText('');
    setValidation(null);
    setModalOpen(false);
    notify('Business database replaced successfully.');
  };

  const clearBusinessDatabase = () => {
    if (!window.confirm('This will clear all saved business data. Continue?')) return;
    if (!clearDatabase()) {
      notify('Could not clear the local database.');
      return;
    }
    const emptyDatabase: AppDatabase = createDefaultDatabase();
    setDatabase(emptyDatabase);
    notify('Business data cleared.');
  };

  return (
    <>
      <header className="page-head"><div><p className="eyebrow">Control panel</p><h1>Settings</h1></div></header>
      <div className="card form-card">
        <div className="stack-actions">
          <button type="button" className="primary" onClick={copyDatabase}>COPY DATABASE JSON</button>
          <button type="button" className="secondary" onClick={downloadDatabase}>DOWNLOAD DATABASE JSON</button>
          <button type="button" className="secondary" onClick={() => { setImportText(''); setValidation(null); setModalOpen(true); }}>IMPORT DATABASE JSON</button>
          <button type="button" className="danger" onClick={clearBusinessDatabase}>Clear Database</button>
        </div>
      </div>

      {modalOpen && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Import Database JSON</h3>
            <textarea value={importText} rows={12} onChange={(e) => { setImportText(e.target.value); setValidation(null); }} />
            {validation?.valid && validation.database && (
              <div className="import-summary">
                <h4>Validated database summary</h4>
                <p>Products: {validation.database.products.length} · Raw materials: {validation.database.rawMaterials.length} · Recipes: {validation.database.recipes.length} · Recipe versions: {validation.database.recipeVersions.length}</p>
                <p>Sale days: {validation.database.saleDays.length} · Purchases: {validation.database.purchases.length} · Suppliers: {validation.database.suppliers.length} · Expenses: {validation.database.expenses.length}</p>
                <p>Inventory transactions: {validation.database.inventoryTransactions.length} · Wastage: {validation.database.wastage.length} · Adjustments: {validation.database.stockAdjustments.length} · Account transactions: {validation.database.accountTransactions.length} · Audit logs: {validation.database.auditLogs.length}</p>
                <strong>Warning: This will replace the current business database.</strong>
              </div>
            )}
            {validation && !validation.valid && (
              <ul className="import-errors">{validation.errors.map((error) => <li key={error}>{error}</li>)}</ul>
            )}
            <div className="stack-actions">
              <button type="button" className="secondary" onClick={() => { setModalOpen(false); setValidation(null); }}>Cancel</button>
              <button type="button" className="secondary" onClick={validateImport}>Validate JSON</button>
              {validation?.valid && <button type="button" className="danger" onClick={confirmImport}>Confirm Replace</button>}
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
};

const AuditLogPage = () => {
  const { auditLogs } = useApp();
  return (
    <>
      <header className="page-head"><div><p className="eyebrow">Activity</p><h1>Audit Log</h1></div></header>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Time</th><th>Action</th><th>Entity</th></tr></thead>
          <tbody>
            {auditLogs.map((entry) => (
              <tr key={entry.id}><td>{formatIndiaDate(new Date(entry.timestamp).toISOString().slice(0, 10))}</td><td>{entry.action}</td><td>{entry.entity}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};

const AppLayout = () => {
  const { selectedDate, setSelectedDate } = useApp();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <strong>BONAFIDE</strong>
          <span>Business Tracker</span>
        </div>
        <nav className="nav">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="content">
        <div className="global-date-bar">
          <label>
            <span>Selected business date</span>
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
          </label>
        </div>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/daily-sale" element={<POSPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/recipes" element={<RecipesPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/wastage" element={<WastagePage />} />
          <Route path="/purchases" element={<PurchasesPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/audit-log" element={<AuditLogPage />} />
        </Routes>
      </main>
    </div>
  );
};

const App = () => <AppLayout />;

export default App;
