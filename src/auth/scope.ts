import { and, eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import { categories, transactions, type users } from '../db/schema.js';

export type AppUser = typeof users.$inferSelect;

export interface VisibleScope {
  role: 'admin' | 'member';
  categoryPredicate: SQL;
  transactionPredicate: SQL;
}

export function visibleScope(user: AppUser): VisibleScope {
  if (user.role === 'admin') return { role: 'admin', categoryPredicate: sql`1 = 1`, transactionPredicate: sql`1 = 1` };
  const allowed = user.visibleCategoryIds ?? [];
  const categoryPredicate = allowed.length
    ? or(eq(categories.groupId, user.visibleGroupId!), inArray(categories.id, allowed))!
    : eq(categories.groupId, user.visibleGroupId!);
  const transactionPredicate = allowed.length
    ? or(eq(transactions.accountId, user.accountId!), inArray(transactions.categoryId, allowed), sql`${transactions.categoryId} in (select id from categories where group_id = ${user.visibleGroupId})`)!
    : or(eq(transactions.accountId, user.accountId!), sql`${transactions.categoryId} in (select id from categories where group_id = ${user.visibleGroupId})`)!;
  return { role: 'member', categoryPredicate, transactionPredicate };
}
