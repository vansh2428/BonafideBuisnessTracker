import assert from 'node:assert/strict';
import type { Account } from '../types';
import { migrateDatabase } from '../storage/database';
import {
  appendIdempotentEntries,
  buildPaymentEntries,
  buildReversalEntry,
  buildTransferEntries,
  calculateDailySaleSettlement,
  getAccountBalance,
  getTotalAccountBalance,
  hasPostedKey,
} from './accounts';

const accounts: Account[] = [
  { id: 'cash', name: 'Cash', type: 'cash', openingBalance: 100, openingDate: '2026-01-01', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  { id: 'online', name: 'Online', type: 'online', openingBalance: 50, openingDate: '2026-01-01', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
];
const saleEntries = buildPaymentEntries([
  { accountId: 'cash', amount: 60, method: 'cash' },
  { accountId: 'online', amount: 40, method: 'upi' },
], {
  date: '2026-01-03', label: 'Sale payment', source: 'sale-1', sourceType: 'sale', direction: 'in', idempotencyPrefix: 'sale:submission-1',
}, '2026-01-03T10:00:00.000Z');

assert.equal(saleEntries.reduce((sum, entry) => sum + entry.amount, 0), 100);
assert.equal(saleEntries.length, 2);
assert.equal(buildPaymentEntries([{ accountId: 'cash', amount: 0, method: 'cash' }], {
  date: '2026-01-03', label: 'Purchase payment', source: 'purchase-unpaid', sourceType: 'purchase', direction: 'out', idempotencyPrefix: 'purchase:unpaid',
}).length, 0);

const refund = buildReversalEntry(saleEntries[0], '2026-01-04', 'Refund', '2026-01-04T10:00:00.000Z');
assert.equal(refund.direction, 'out');
assert.equal(refund.amount, saleEntries[0].amount);
assert.equal(refund.reversesTransactionId, saleEntries[0].transactionId);

const transfers = buildTransferEntries('cash', 'online', 25, '2026-01-05', 'transfer-1', { cash: 'cash', online: 'upi' }, '2026-01-05T10:00:00.000Z');
assert.equal(transfers.length, 2);
assert.equal(transfers.reduce((sum, entry) => sum + (entry.direction === 'in' ? entry.amount : -entry.amount), 0), 0);

const ledger = [...saleEntries, refund, ...transfers];
assert.equal(getAccountBalance(accounts[0], ledger, '2026-01-02'), 100);
assert.equal(getAccountBalance(accounts[0], ledger, '2026-01-03'), 160);
assert.equal(getAccountBalance(accounts[0], ledger, '2026-01-04'), 100);
assert.equal(getTotalAccountBalance(accounts, ledger, '2026-01-05'), 190);
assert.equal(getAccountBalance({ ...accounts[0], openingDate: '2026-01-06' }, ledger, '2026-01-05'), 0);
assert.equal(hasPostedKey(ledger, saleEntries[0].idempotencyKey ?? ''), true);
assert.equal(hasPostedKey(ledger, 'sale:duplicate'), false);
assert.equal(appendIdempotentEntries(saleEntries, saleEntries).length, saleEntries.length);

const settlement = calculateDailySaleSettlement([{
  id: 'sale-with-adjustment',
  totalAmount: 1500,
  paymentSummary: { cash: 400, upi: 1000, card: 0, other: 0 },
}], [{ amount: 100, direction: 'decrease' }]);
assert.equal(settlement.outstanding, 0);
assert.equal(settlement.saleOutstandings.get('sale-with-adjustment'), 0);

const increaseDoesNotChangeDue = calculateDailySaleSettlement([{
  id: 'sale-with-increase-note',
  totalAmount: 1500,
  paymentSummary: { cash: 400, upi: 1000, card: 0, other: 0 },
}], [{ amount: 100, direction: 'increase' }]);
assert.equal(increaseDoesNotChangeDue.outstanding, 100);
assert.equal(increaseDoesNotChangeDue.saleOutstandings.get('sale-with-increase-note'), 100);

const overpaidSaleWithAdjustment = calculateDailySaleSettlement([{
  id: 'overpaid-sale-with-adjustment',
  totalAmount: 1500,
  paymentSummary: { cash: 400, upi: 1200, card: 0, other: 0 },
}], [{ amount: 100, direction: 'increase' }]);
assert.equal(overpaidSaleWithAdjustment.outstanding, 0);

const oldConsumptionEntry = buildPaymentEntries([{ accountId: 'cash', amount: 100, method: 'cash' }], {
  date: '2026-01-06',
  label: 'Daily sale adjustment',
  source: 'DailySaleAdjustment-old-consumption',
  sourceType: 'manual',
  direction: 'out',
  idempotencyPrefix: 'daily-sale-adjustment:old-consumption',
}, '2026-01-06T10:00:00.000Z')[0];
const oldConsumptionReversal = buildReversalEntry(oldConsumptionEntry, '2026-01-07', 'Adjustment removed', '2026-01-07T10:00:00.000Z');
assert.equal(getAccountBalance(accounts[0], [oldConsumptionEntry]), 100);
assert.equal(getAccountBalance(accounts[0], [oldConsumptionEntry, oldConsumptionReversal]), 100);

const extraReceiptEntry = buildPaymentEntries([{ accountId: 'cash', amount: 25, method: 'cash' }], {
  date: '2026-01-08',
  label: 'Daily sale adjustment',
  source: 'DailySaleAdjustment-extra-receipt',
  sourceType: 'manual',
  direction: 'in',
  idempotencyPrefix: 'daily-sale-adjustment:extra-receipt',
}, '2026-01-08T10:00:00.000Z')[0];
const extraReceiptReversal = buildReversalEntry(extraReceiptEntry, '2026-01-09', 'Adjustment removed', '2026-01-09T10:00:00.000Z');
assert.equal(getAccountBalance(accounts[0], [extraReceiptEntry]), 100);
assert.equal(getAccountBalance(accounts[0], [extraReceiptEntry, extraReceiptReversal]), 100);

const migrated = migrateDatabase({
  accounts: [{
    id: 'legacy-cash-entry',
    date: '2026-01-03',
    type: 'cash',
    label: 'Legacy sale',
    amount: 12,
    direction: 'in',
    source: 'legacy-sale',
    createdAt: '2026-01-03T10:00:00.000Z',
  }],
});
assert.equal(migrated.accounts.length, 2);
assert.equal(migrated.accountTransactions.length, 1);
assert.equal(getAccountBalance(migrated.accounts[0], migrated.accountTransactions), 12);

console.log('Account ledger tests passed.');