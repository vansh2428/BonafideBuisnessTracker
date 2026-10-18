import type { Account, AccountTransaction, PaymentMethod } from '../types';
import { generateId } from './ids';

export interface LedgerPosting {
  accountId: string;
  amount: number;
  method: PaymentMethod;
}

export const buildPaymentEntries = (
  postings: LedgerPosting[],
  details: {
    date: string;
    label: string;
    source: string;
    sourceType: AccountTransaction['sourceType'];
    direction: AccountTransaction['direction'];
    idempotencyPrefix: string;
    notes?: string;
  },
  now = new Date().toISOString(),
): AccountTransaction[] => postings
  .filter((posting) => posting.amount > 0)
  .map((posting) => ({
    id: generateId('account-transaction'),
    transactionId: generateId('txn'),
    idempotencyKey: `${details.idempotencyPrefix}:${posting.accountId}:${posting.method}`,
    accountId: posting.accountId,
    createdAt: now,
    updatedAt: now,
    date: details.date,
    type: posting.method,
    label: details.label,
    amount: posting.amount,
    direction: details.direction,
    source: details.source,
    sourceType: details.sourceType,
    notes: details.notes,
  }));

export const hasPostedKey = (entries: AccountTransaction[], key: string): boolean =>
  entries.some((entry) => entry.idempotencyKey === key);

export const appendIdempotentEntries = (
  existing: AccountTransaction[],
  proposed: AccountTransaction[],
): AccountTransaction[] => {
  const knownKeys = new Set(existing.map((entry) => entry.idempotencyKey).filter((key): key is string => Boolean(key)));
  const additions = proposed.filter((entry) => {
    if (!entry.idempotencyKey) return true;
    if (knownKeys.has(entry.idempotencyKey)) return false;
    knownKeys.add(entry.idempotencyKey);
    return true;
  });
  return [...existing, ...additions];
};

export const getAccountBalance = (
  account: Account,
  entries: AccountTransaction[],
  asOfDate = '9999-12-31',
): number => asOfDate < account.openingDate ? 0 : account.openingBalance + entries
  .filter((entry) => entry.accountId === account.id && entry.date >= account.openingDate && entry.date <= asOfDate)
  .reduce((balance, entry) => balance + (entry.direction === 'in' ? entry.amount : -entry.amount), 0);

export const getTotalAccountBalance = (
  accounts: Account[],
  entries: AccountTransaction[],
  asOfDate?: string,
): number => accounts.reduce((total, account) => total + getAccountBalance(account, entries, asOfDate), 0);

export const buildTransferEntries = (
  fromAccountId: string,
  toAccountId: string,
  amount: number,
  date: string,
  transferId: string,
  methods: Record<string, PaymentMethod>,
  now = new Date().toISOString(),
): AccountTransaction[] => {
  if (fromAccountId === toAccountId) throw new Error('Choose two different accounts for a transfer.');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Transfer amount must be greater than zero.');
  return [
    ...buildPaymentEntries([{ accountId: fromAccountId, amount, method: methods[fromAccountId] ?? 'cash' }], {
      date, label: 'Account transfer', source: transferId, sourceType: 'transfer', direction: 'out', idempotencyPrefix: `transfer:${transferId}:out`,
    }, now),
    ...buildPaymentEntries([{ accountId: toAccountId, amount, method: methods[toAccountId] ?? 'cash' }], {
      date, label: 'Account transfer', source: transferId, sourceType: 'transfer', direction: 'in', idempotencyPrefix: `transfer:${transferId}:in`,
    }, now),
  ].map((entry) => ({ ...entry, transferId }));
};

export const buildReversalEntry = (
  entry: AccountTransaction,
  date: string,
  reason: string,
  now = new Date().toISOString(),
): AccountTransaction => ({
  id: generateId('account-transaction'),
  transactionId: generateId('txn'),
  idempotencyKey: `reversal:${entry.transactionId ?? entry.id}`,
  accountId: entry.accountId,
  createdAt: now,
  updatedAt: now,
  date,
  type: entry.type,
  label: `Reversal: ${entry.label}`,
  amount: entry.amount,
  direction: entry.direction === 'in' ? 'out' : 'in',
  source: entry.source,
  sourceType: 'reversal',
  reversesTransactionId: entry.transactionId ?? entry.id,
  transferId: entry.transferId,
  notes: reason,
});

export const getUnreversedEntries = (entries: AccountTransaction[]): AccountTransaction[] => {
  const reversed = new Set(entries.map((entry) => entry.reversesTransactionId).filter((id): id is string => Boolean(id)));
  return entries.filter((entry) => !reversed.has(entry.transactionId ?? entry.id));
};