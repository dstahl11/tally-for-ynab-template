import type { YnabAccount, YnabCategory, YnabPayee, YnabTransaction } from '../types/ynab.js';

const month = new Date().toISOString().slice(0, 7) + '-01';
const category = (id: string, name: string, group = 'Member Categories', underfunded = 0): YnabCategory => ({
  id, category_group_id: group === 'Member Categories' ? 'mock-member-group' : 'group-household', category_group_name: group,
  name, hidden: false, deleted: false, goal_type: 'NEED', goal_target: underfunded || 300000,
  budgeted: underfunded ? 0 : 300000, activity: -120000, balance: underfunded ? 0 : 180000, goal_under_funded: underfunded,
});

const accounts: YnabAccount[] = [
  { id: 'mock-member-account', name: 'Member', on_budget: true, closed: false, deleted: false },
  { id: 'acct-checking', name: 'Household Checking', on_budget: true, closed: false, deleted: false },
  { id: 'acct-tracking', name: 'Brokerage', on_budget: false, closed: false, deleted: false },
];
const categories: YnabCategory[] = [
  category('cat-grocery', 'Groceries', 'Household', 240000),
  category('mock-member-food', 'Member Food'),
  category('cat-train', '🚆 Train Tickets'),
  { ...category('cat-clothes', 'Clothing'), activity: -240000, balance: 60000 },
  category('cat-electric', 'Electric', 'Household', 110000),
  { ...category('cat-netflix', 'Streaming', 'Household'), goal_target: 26650 },
  category('cat-unknown', '❓ Unknown', 'Unexpected'),
];
const payees: YnabPayee[] = [
  { id: 'payee-market', name: 'Market Square', deleted: false },
  { id: 'payee-cafe', name: 'Example Cafe', deleted: false },
  { id: 'payee-netflix', name: 'Netflix', deleted: false },
];
const transactions: YnabTransaction[] = [
  { id: 'txn-1', date: new Date().toISOString().slice(0, 10), amount: -34180, account_id: 'mock-member-account', account_name: 'Member', payee_id: 'payee-market', payee_name: 'Market Square', import_payee_name_original: 'SQ *MKTPL*47291', category_id: null, category_name: null, memo: null, approved: false, cleared: 'cleared', deleted: false, subtransactions: [] },
  { id: 'txn-market-2', date: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), amount: -32990, account_id: 'mock-member-account', account_name: 'Member', payee_id: 'payee-market', payee_name: 'Market Square', import_payee_name_original: 'SQ *MKTPL*47291', category_id: null, category_name: null, memo: null, approved: true, cleared: 'cleared', deleted: false, subtransactions: [] },
  { id: 'txn-2', date: new Date(Date.now() - 86400000).toISOString().slice(0, 10), amount: -28780, account_id: 'acct-checking', account_name: 'Household Checking', payee_id: 'payee-netflix', payee_name: 'Netflix', import_payee_name_original: 'NETFLIX.COM', category_id: 'cat-netflix', category_name: 'Streaming', memo: null, approved: true, cleared: 'cleared', deleted: false, subtransactions: [] },
  { id: 'txn-netflix-2', date: new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10), amount: -28780, account_id: 'acct-checking', account_name: 'Household Checking', payee_id: 'payee-netflix', payee_name: 'Netflix', import_payee_name_original: 'NETFLIX.COM', category_id: 'cat-netflix', category_name: 'Streaming', memo: null, approved: true, cleared: 'cleared', deleted: false, subtransactions: [] },
  { id: 'txn-netflix-3', date: new Date(Date.now() - 62 * 86400000).toISOString().slice(0, 10), amount: -28780, account_id: 'acct-checking', account_name: 'Household Checking', payee_id: 'payee-netflix', payee_name: 'Netflix', import_payee_name_original: 'NETFLIX.COM', category_id: 'cat-netflix', category_name: 'Streaming', memo: null, approved: true, cleared: 'cleared', deleted: false, subtransactions: [] },
  { id: 'txn-3', date: new Date(Date.now() - 172800000).toISOString().slice(0, 10), amount: -12000, account_id: 'mock-member-account', account_name: 'Member', payee_id: 'payee-cafe', payee_name: 'Example Cafe', import_payee_name_original: 'EXAMPLE CAFE 0123', category_id: null, category_name: null, memo: null, approved: false, cleared: 'cleared', deleted: false, subtransactions: [] },
  { id: 'txn-transfer', date: new Date(Date.now() - 259200000).toISOString().slice(0, 10), amount: -500000, account_id: 'acct-checking', account_name: 'Household Checking', payee_name: 'Transfer', category_id: null, category_name: null, approved: false, cleared: 'cleared', transfer_account_id: 'mock-member-account', deleted: false, subtransactions: [] },
];

export const mockYnabData: { accounts: YnabAccount[]; payees: YnabPayee[]; categories: YnabCategory[]; months: Record<string, YnabCategory[]>; transactions: YnabTransaction[] } = {
  accounts, payees, categories, months: { [month]: categories }, transactions,
};
