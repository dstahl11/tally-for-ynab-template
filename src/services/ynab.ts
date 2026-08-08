import type { AppEnv } from '../config/env.js';
import { mockYnabData } from './ynabMock.js';
import type { YnabCategory, YnabClient, YnabDelta, YnabTransaction } from '../types/ynab.js';

export class HourlyLimiter {
  private calls: number[] = [];
  constructor(private readonly limit: number, private readonly now: () => number = Date.now, private readonly sleep: (delay: number) => Promise<void> = (delay) => new Promise((resolve) => setTimeout(resolve, delay))) {}
  async wait(): Promise<void> {
    const hourAgo = this.now() - 3_600_000;
    this.calls = this.calls.filter((time) => time > hourAgo);
    if (this.calls.length >= this.limit) {
      const delay = this.calls[0] + 3_600_000 - this.now();
      await this.sleep(delay);
      this.calls = this.calls.filter((time) => time > this.now() - 3_600_000);
    }
    this.calls.push(this.now());
  }
}

export class HttpYnabClient implements YnabClient {
  private readonly limiter = new HourlyLimiter(150);
  constructor(private readonly token: string, private readonly planId: string) {}

  private async get<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    await this.limiter.wait();
    const url = new URL(`https://api.ynab.com/v1/plans/${this.planId}${path}`);
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
    const response = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!response.ok) throw new Error(`YNAB ${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
  }

  async accounts(knowledge: number) {
    const response = await this.get<{ data: { accounts: any[]; server_knowledge: number } }>('/accounts', { last_knowledge_of_server: knowledge || undefined });
    return { items: response.data.accounts, serverKnowledge: response.data.server_knowledge };
  }
  async payees(knowledge: number) {
    const response = await this.get<{ data: { payees: any[]; server_knowledge: number } }>('/payees', { last_knowledge_of_server: knowledge || undefined });
    return { items: response.data.payees, serverKnowledge: response.data.server_knowledge };
  }
  async categories(knowledge: number) {
    const response = await this.get<{ data: { category_groups: Array<any>; server_knowledge: number } }>('/categories', { last_knowledge_of_server: knowledge || undefined });
    const items = response.data.category_groups.flatMap((group) => group.categories.map((category: any) => ({ ...category, category_group_name: group.name })));
    return { items, serverKnowledge: response.data.server_knowledge };
  }
  async month(month: string, knowledge: number) {
    const response = await this.get<{ data: { month: { categories: YnabCategory[] }; server_knowledge?: number } }>(`/months/${month}`, { last_knowledge_of_server: knowledge || undefined });
    return { items: response.data.month.categories, serverKnowledge: response.data.server_knowledge ?? knowledge, readyToAssignMilli: (response.data.month as any).to_be_budgeted ?? 0 };
  }
  async transactions(knowledge: number, sinceDate: string) {
    const response = await this.get<{ data: { transactions: YnabTransaction[]; server_knowledge: number } }>('/transactions', {
      since_date: knowledge ? undefined : sinceDate,
      last_knowledge_of_server: knowledge || undefined,
    });
    return { items: response.data.transactions, serverKnowledge: response.data.server_knowledge };
  }
  async countUnapproved(sinceDate: string) {
    const response = await this.get<{ data: { transactions: YnabTransaction[] } }>('/transactions', { type: 'unapproved', since_date: sinceDate });
    return response.data.transactions.filter((transaction) => !transaction.deleted).length;
  }
  async mutate(endpoint: string, body: unknown, method: 'PATCH' | 'POST' = 'PATCH') {
    await this.limiter.wait();
    const response = await fetch(`https://api.ynab.com/v1/plans/${this.planId}${endpoint}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  }
}

export class MockYnabClient implements YnabClient {
  private knowledge = 42;
  private delta<T>(items: T[], knowledge: number): YnabDelta<T> {
    return { items: knowledge >= this.knowledge ? [] : structuredClone(items), serverKnowledge: this.knowledge };
  }
  async accounts(knowledge: number) { return this.delta(mockYnabData.accounts, knowledge); }
  async payees(knowledge: number) { return this.delta(mockYnabData.payees, knowledge); }
  async categories(knowledge: number) { return this.delta(mockYnabData.categories, knowledge); }
  async month(month: string, knowledge: number) {
    const rows = mockYnabData.months[month] ?? mockYnabData.categories;
    return { ...this.delta(rows, knowledge), readyToAssignMilli: 1_000_000 };
  }
  async transactions(knowledge: number, sinceDate: string) {
    return this.delta(mockYnabData.transactions.filter((transaction) => transaction.date >= sinceDate), knowledge);
  }
  async countUnapproved(sinceDate: string) {
    return mockYnabData.transactions.filter((transaction) => transaction.date >= sinceDate && !transaction.approved && !transaction.deleted).length;
  }
  async mutate(endpoint: string, body: unknown, method: 'PATCH' | 'POST' = 'PATCH') { return { status: 200, data: { mock: true, endpoint, body, method } }; }
}

export function createYnabClient(env: AppEnv): YnabClient {
  return env.MOCK_EXTERNALS ? new MockYnabClient() : new HttpYnabClient(env.YNAB_API_KEY!, env.YNAB_PLAN_ID!);
}
