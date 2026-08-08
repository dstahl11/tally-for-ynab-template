export interface YnabAccount {
  id: string;
  name: string;
  on_budget: boolean;
  closed: boolean;
  deleted: boolean;
  [key: string]: unknown;
}

export interface YnabPayee {
  id: string;
  name: string;
  deleted: boolean;
  [key: string]: unknown;
}

export interface YnabCategory {
  id: string;
  category_group_id: string;
  category_group_name: string;
  name: string;
  hidden: boolean;
  deleted: boolean;
  note?: string | null;
  goal_type?: string | null;
  goal_target?: number | null;
  goal_target_date?: string | null;
  budgeted?: number;
  activity?: number;
  balance?: number;
  goal_under_funded?: number | null;
  [key: string]: unknown;
}

export interface YnabTransaction {
  id: string;
  date: string;
  amount: number;
  payee_id?: string | null;
  payee_name?: string | null;
  import_payee_name?: string | null;
  import_payee_name_original?: string | null;
  category_id?: string | null;
  category_name?: string | null;
  account_id: string;
  account_name: string;
  memo?: string | null;
  approved: boolean;
  cleared: string;
  transfer_account_id?: string | null;
  transfer_transaction_id?: string | null;
  matched_transaction_id?: string | null;
  subtransactions?: unknown[];
  deleted: boolean;
  [key: string]: unknown;
}

export interface YnabDelta<T> {
  items: T[];
  serverKnowledge: number;
  readyToAssignMilli?: number;
}

export interface YnabClient {
  accounts(knowledge: number): Promise<YnabDelta<YnabAccount>>;
  payees(knowledge: number): Promise<YnabDelta<YnabPayee>>;
  categories(knowledge: number): Promise<YnabDelta<YnabCategory>>;
  month(month: string, knowledge: number): Promise<YnabDelta<YnabCategory>>;
  transactions(knowledge: number, sinceDate: string): Promise<YnabDelta<YnabTransaction>>;
  countUnapproved(sinceDate: string): Promise<number>;
  mutate(endpoint: string, body: unknown, method?: 'PATCH' | 'POST'): Promise<{ status: number; data: unknown }>;
}
