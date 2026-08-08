import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { AppEnv } from '../config/env.js';
import type { AppDatabase } from '../db/client.js';
import { categories, categoryMonths, messagesLog, overrides, proposals, queueItems, rules, settings, syncState, transactions, users, writeLog } from '../db/schema.js';
import { visibleScope, type AppUser } from '../auth/scope.js';
import { AuthService } from '../auth/service.js';
import { FundingService } from '../detectors/funding.js';
import { ChatService } from '../chat/service.js';
import type { Messenger } from '../services/messages.js';
import { ProposalService } from '../proposals/service.js';
import { WriteGateway } from '../proposals/writeGateway.js';
import { SyncService } from '../sync/service.js';
import { TransactionPipeline } from '../rules/pipeline.js';
import { MemberAutomation } from '../jobs/memberAutomation.js';
import { DetectorService } from '../detectors/service.js';
import { NovelCategorizer } from '../rules/novelCategorizer.js';
import { daysLeftInMonth, monthKeyInTimeZone } from '../time.js';

type Variables = { user: AppUser };
export interface AppServices {
  env: AppEnv; database: AppDatabase; auth: AuthService; messenger: Messenger; writes: WriteGateway;
  proposals: ProposalService; funding: FundingService; sync: SyncService; pipeline: TransactionPipeline; chat: ChatService;
  member: MemberAutomation;
  detectors: DetectorService;
  categorizer: NovelCategorizer;
}

export function createApp(services: AppServices) {
  const app = new Hono<{ Variables: Variables }>();
  const pinAttemptKey = (userId: 'admin' | 'member') => `pin_attempts:${userId}`;
  const pinAttemptWindowMs = 15 * 60_000;
  const readPinAttempts = (userId: 'admin' | 'member', now: number) => {
    const stored = services.database.db.select().from(settings).where(eq(settings.key, pinAttemptKey(userId))).get()?.value;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return { count: 0, resetAt: now + pinAttemptWindowMs };
    const count = Number((stored as Record<string, unknown>).count);
    const resetAt = Number((stored as Record<string, unknown>).resetAt);
    if (!Number.isInteger(count) || !Number.isFinite(resetAt) || resetAt <= now) return { count: 0, resetAt: now + pinAttemptWindowMs };
    return { count, resetAt };
  };
  const savePinAttempts = (userId: 'admin' | 'member', value: { count: number; resetAt: number }) => {
    const now = new Date().toISOString();
    services.database.db.insert(settings).values({ key: pinAttemptKey(userId), value, updatedAt: now, updatedBy: 'auth' })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now, updatedBy: 'auth' } }).run();
  };
  const clearPinAttempts = (userId: 'admin' | 'member') => {
    services.database.db.delete(settings).where(eq(settings.key, pinAttemptKey(userId))).run();
  };

  app.use('/api/*', async (context, next) => {
    const mockId = context.req.header('x-mock-user') ?? getCookie(context, 'mock_user');
    const user = services.auth.sessionUser(getCookie(context, 'ynab_session')) ?? (mockId ? services.auth.mockUser(mockId) : null) ?? (services.env.MOCK_EXTERNALS ? services.auth.mockUser('admin') : null);
    if (!user) return context.json({ error: 'authentication_required' }, 401);
    context.set('user', user);
    await next();
  });

  app.get('/health', (context) => {
    const state = services.database.db.select().from(syncState).where(eq(syncState.resource, 'transactions')).get();
    return context.json({ ok: state?.status !== 'failed', dryRun: services.env.DRY_RUN, mockExternals: services.env.MOCK_EXTERNALS, sync: state ?? null }, state?.status === 'failed' ? 503 : 200);
  });

  app.get('/public-config', (context) => context.json({
    appName: services.env.APP_NAME,
    adminName: services.env.ADMIN_NAME,
    memberName: services.env.MEMBER_NAME,
  }));

  app.post('/auth/pin', async (context) => {
    const parsed = z.object({ userId: z.enum(['admin', 'member']), pin: z.string().regex(/^\d{6}$/) }).safeParse(await context.req.json().catch(() => ({})));
    if (!parsed.success) return context.json({ error: 'invalid_credentials' }, 401);
    const now = Date.now();
    const attempt = readPinAttempts(parsed.data.userId, now);
    if (attempt.count >= 5) {
      context.header('Retry-After', String(Math.ceil((attempt.resetAt - now) / 1000)));
      return context.json({ error: 'too_many_attempts' }, 429);
    }
    const result = services.auth.signInWithPin(parsed.data.userId, parsed.data.pin);
    if (!result) {
      const failed = { ...attempt, count: attempt.count + 1 };
      savePinAttempts(parsed.data.userId, failed);
      if (failed.count >= 5) {
        context.header('Retry-After', String(Math.ceil((failed.resetAt - now) / 1000)));
        return context.json({ error: 'too_many_attempts' }, 429);
      }
      return context.json({ error: 'invalid_credentials' }, 401);
    }
    clearPinAttempts(parsed.data.userId);
    setCookie(context, 'ynab_session', result.sessionToken, { httpOnly: true, secure: services.env.APP_HOST.startsWith('https://'), sameSite: 'Lax', maxAge: 30 * 86400, path: '/' });
    return context.json({ ok: true, userId: result.userId });
  });

  app.post('/auth/request-link', async (context) => {
    const parsed = z.object({ phone: z.string().min(7).max(30) }).safeParse(await context.req.json().catch(() => ({})));
    if (parsed.success) await services.auth.requestLink(parsed.data.phone).catch(() => 'missing');
    return context.json({ ok: true, message: 'If that number is registered, a sign-in link is on its way.' });
  });
  app.post('/auth/sms', async (context) => {
    const parsed = z.object({ userId: z.enum(['admin', 'member']) }).safeParse(await context.req.json().catch(() => ({})));
    if (!parsed.success) return context.json({ error: 'invalid_request' }, 400);
    try {
      const result = await services.auth.requestLinkForUser(parsed.data.userId);
      if (result === 'limited') {
        context.header('Retry-After', '3600');
        return context.json({ error: 'too_many_links' }, 429);
      }
      if (result !== 'sent') return context.json({ error: 'delivery_unavailable' }, 503);
      return context.json({ ok: true, expiresInMinutes: 15 });
    } catch {
      return context.json({ error: 'delivery_unavailable' }, 502);
    }
  });
  app.get('/auth/verify', (context) => {
    const result = services.auth.verifyMagicLink(context.req.query('token') ?? '');
    if (!result) return context.text('This sign-in link is invalid or expired.', 401);
    setCookie(context, 'ynab_session', result.sessionToken, { httpOnly: true, secure: services.env.APP_HOST.startsWith('https://'), sameSite: 'Lax', maxAge: 30 * 86400, path: '/' });
    return context.redirect('/');
  });
  app.get('/auth/mock/:user', (context) => {
    if (!services.env.MOCK_EXTERNALS || !services.auth.mockUser(context.req.param('user'))) return context.notFound();
    setCookie(context, 'mock_user', context.req.param('user'), { httpOnly: true, sameSite: 'Lax', path: '/' });
    return context.redirect('/');
  });
  app.post('/auth/signout', (context) => {
    services.auth.revokeSession(getCookie(context, 'ynab_session'));
    deleteCookie(context, 'ynab_session', { path: '/' });
    deleteCookie(context, 'mock_user', { path: '/' });
    return context.json({ ok: true });
  });

  app.get('/api/me', (context) => {
    const user = context.get('user');
    return context.json({ id: user.id, name: user.name, role: user.role, dryRun: services.env.DRY_RUN, mockExternals: services.env.MOCK_EXTERNALS });
  });
  app.get('/api/dashboard', (context) => {
    const user = context.get('user');
    const scope = visibleScope(user);
    const month = context.req.query('month') ?? monthKeyInTimeZone(services.env.TIMEZONE);
    const rows = services.database.db.select({ id: categories.id, name: categories.name, groupName: categories.groupName, budgetedMilli: categoryMonths.budgetedMilli, activityMilli: categoryMonths.activityMilli, balanceMilli: categoryMonths.balanceMilli })
      .from(categoryMonths).innerJoin(categories, eq(categories.id, categoryMonths.categoryId))
      .where(and(eq(categoryMonths.month, month), scope.categoryPredicate, eq(categories.hidden, false), eq(categories.deleted, false))).orderBy(categories.groupName, categories.name).all();
    const preferenceKey = `overview_hidden_category_ids:${user.id}`;
    const stored = services.database.db.select().from(settings).where(eq(settings.key, preferenceKey)).get()?.value;
    const allowedIds = new Set(rows.map((row) => row.id));
    const hiddenCategoryIds = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string' && allowedIds.has(id)) : [];
    const hiddenIds = new Set(hiddenCategoryIds);
    const availableCategories = rows.map((row) => ({ ...row, spentMilli: Math.abs(row.activityMilli), pace: row.budgetedMilli > 0 ? Math.abs(row.activityMilli) / row.budgetedMilli : null }));
    const daysLeft = daysLeftInMonth(services.env.TIMEZONE);
    const adminSummary = user.role === 'admin' ? (() => {
      const storedReadyToAssign = services.database.db.select().from(settings).where(eq(settings.key, `ready_to_assign:${month}`)).get()?.value;
      const readyToAssignMilli = Number(storedReadyToAssign);
      return { readyToAssignMilli: Number.isFinite(readyToAssignMilli) ? readyToAssignMilli : 0 };
    })() : {};
    return context.json({ month, daysLeft, ...adminSummary, hiddenCategoryIds, availableCategories, categories: availableCategories.filter((row) => !hiddenIds.has(row.id)) });
  });
  app.put('/api/dashboard/categories', async (context) => {
    const user = context.get('user');
    const scope = visibleScope(user);
    const parsed = z.object({ hiddenCategoryIds: z.array(z.string()).max(500) }).strict().safeParse(await context.req.json().catch(() => ({})));
    if (!parsed.success) return context.json({ error: 'invalid_request' }, 400);
    const allowedIds = new Set(services.database.db.select({ id: categories.id }).from(categories).where(and(scope.categoryPredicate, eq(categories.hidden, false), eq(categories.deleted, false))).all().map((row) => row.id));
    const hiddenCategoryIds = [...new Set(parsed.data.hiddenCategoryIds)].filter((id) => allowedIds.has(id));
    const key = `overview_hidden_category_ids:${user.id}`;
    services.database.db.insert(settings).values({ key, value: hiddenCategoryIds, updatedAt: new Date().toISOString(), updatedBy: user.id })
      .onConflictDoUpdate({ target: settings.key, set: { value: hiddenCategoryIds, updatedAt: new Date().toISOString(), updatedBy: user.id } }).run();
    return context.json({ hiddenCategoryIds });
  });
  app.get('/api/categories', (context) => {
    const scope = visibleScope(context.get('user'));
    return context.json(services.database.db.select({ id: categories.id, name: categories.name, groupName: categories.groupName }).from(categories).where(and(scope.categoryPredicate, eq(categories.hidden, false), eq(categories.deleted, false))).orderBy(categories.groupName, categories.name).all());
  });
  app.get('/api/categories/:id/transactions', (context) => {
    const scope = visibleScope(context.get('user'));
    const category = services.database.db.select({ id: categories.id, name: categories.name, groupName: categories.groupName })
      .from(categories)
      .where(and(eq(categories.id, context.req.param('id')), scope.categoryPredicate, eq(categories.hidden, false), eq(categories.deleted, false))).get();
    if (!category) return context.notFound();
    const month = context.req.query('month') ?? monthKeyInTimeZone(services.env.TIMEZONE);
    const summary = services.database.db.select({ budgetedMilli: categoryMonths.budgetedMilli, activityMilli: categoryMonths.activityMilli, balanceMilli: categoryMonths.balanceMilli })
      .from(categoryMonths).where(and(eq(categoryMonths.categoryId, category.id), eq(categoryMonths.month, month))).get() ?? { budgetedMilli: 0, activityMilli: 0, balanceMilli: 0 };
    const rows = services.database.db.select({ id: transactions.id, date: transactions.date, payeeName: transactions.payeeName, importPayeeNameOriginal: transactions.importPayeeNameOriginal, accountName: transactions.accountName, memo: transactions.memo, amountMilli: transactions.amountMilli, cleared: transactions.cleared })
      .from(transactions)
      .where(and(eq(transactions.categoryId, category.id), scope.transactionPredicate, eq(transactions.deleted, false)))
      .orderBy(desc(transactions.date)).limit(100).all();
    return context.json({ category, month, summary, transactions: rows });
  });
  app.get('/api/queue', (context) => {
    const scope = visibleScope(context.get('user'));
    const rows = services.database.db.select({ item: queueItems, transaction: transactions }).from(queueItems).innerJoin(transactions, eq(queueItems.transactionId, transactions.id))
      .where(and(scope.transactionPredicate, eq(transactions.approved, false), eq(transactions.deleted, false), sql`${transactions.categoryId} is null`, sql`${queueItems.state} in ('pending','retry')`))
      .orderBy(sql`coalesce(${queueItems.askedAt}, '')`, desc(transactions.date)).all();
    return context.json(rows.map(({ item, transaction }) => ({ ...item, transaction: { id: transaction.id, date: transaction.date, amountMilli: transaction.amountMilli, payeeName: transaction.payeeName, importPayeeNameOriginal: transaction.importPayeeNameOriginal, accountName: transaction.accountName } })));
  });
  app.post('/api/queue/enrich', async (context) => {
    return context.json({ processed: await services.categorizer.run({ refreshMissing: true }) });
  });
  app.post('/api/queue/:id/skip', (context) => {
    const scope = visibleScope(context.get('user'));
    const joined = services.database.db.select({ item: queueItems, transaction: transactions }).from(queueItems).innerJoin(transactions, eq(queueItems.transactionId, transactions.id))
      .where(and(eq(queueItems.transactionId, context.req.param('id')), scope.transactionPredicate, sql`${queueItems.state} in ('pending','retry')`)).get();
    if (!joined) return context.notFound();
    services.database.db.update(queueItems).set({ askedAt: new Date().toISOString() }).where(eq(queueItems.transactionId, joined.item.transactionId)).run();
    return context.json({ ok: true });
  });
  app.patch('/api/queue/:id', async (context) => {
    const user = context.get('user');
    const scope = visibleScope(user);
    const parsed = z.object({ categoryId: z.string().nullable() }).safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: 'invalid_request' }, 400);
    const joined = services.database.db.select({ item: queueItems, transaction: transactions }).from(queueItems).innerJoin(transactions, eq(queueItems.transactionId, transactions.id))
      .where(and(eq(queueItems.transactionId, context.req.param('id')), scope.transactionPredicate)).get();
    if (!joined) return context.notFound();
    let destination = parsed.data.categoryId ? services.database.db.select().from(categories).where(eq(categories.id, parsed.data.categoryId)).get() : services.database.db.select().from(categories).where(eq(categories.name, '❓ Unknown')).get();
    if (!destination) return context.json({ error: 'unknown_category_missing' }, 409);
    await services.writes.mutate('queue', '/transactions', { transactions: [{ id: joined.transaction.id, category_id: destination.id, approved: true }] }, { category_id: joined.transaction.categoryId, approved: joined.transaction.approved });
    const firstSuggestion = joined.item.suggestions.find((suggestion) => suggestion.categoryId);
    services.database.sqlite.transaction(() => {
      services.database.db.update(transactions).set({ categoryId: destination!.id, categoryName: destination!.name, approved: true }).where(eq(transactions.id, joined.transaction.id)).run();
      const unknownState = joined.item.state === 'retry' || joined.item.retryCount >= 1 ? 'rested' : 'unknown';
      services.database.db.update(queueItems).set({ state: parsed.data.categoryId ? 'answered' : unknownState, answerCategoryId: destination!.id, answeredAt: new Date().toISOString(), retryAt: parsed.data.categoryId || unknownState === 'rested' ? null : new Date(Date.now() + 3 * 86400000).toISOString() }).where(eq(queueItems.transactionId, joined.transaction.id)).run();
      if (firstSuggestion?.categoryId && firstSuggestion.categoryId !== destination!.id) services.database.db.insert(overrides).values({ transactionId: joined.transaction.id, fromCategoryId: firstSuggestion.categoryId, toCategoryId: destination!.id, source: 'queue', at: new Date().toISOString() }).run();
    })();
    return context.json({ ok: true });
  });
  app.get('/api/settings', (context) => {
    if (context.get('user').role !== 'admin') return context.json({ error: 'forbidden' }, 403);
    return context.json(Object.fromEntries(services.database.db.select().from(settings).all().map((row) => [row.key, row.value])));
  });
  app.put('/api/settings/essentials', async (context) => {
    const user = context.get('user');
    if (user.role !== 'admin') return context.json({ error: 'forbidden' }, 403);
    const parsed = z.object({ categoryNames: z.array(z.string()).max(100) }).safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: 'invalid_request' }, 400);
    return context.json({ categoryNames: services.funding.setEssentials(parsed.data.categoryNames, user.id) });
  });
  app.put('/api/settings/approval', async (context) => {
    const user = context.get('user');
    if (user.role !== 'admin') return context.json({ error: 'forbidden' }, 403);
    const parsed = z.object({
      enabled: z.boolean(),
      mode: z.enum(['review', 'automatic']),
      minHistory: z.number().int().min(3).max(50),
      consistencyPercent: z.number().int().min(50).max(100),
      standardDeviations: z.number().min(0.5).max(5),
      maxPerRun: z.number().int().min(1).max(500),
    }).strict().safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: 'invalid_request' }, 400);
    return context.json(services.pipeline.setApprovalSettings(parsed.data, user.id));
  });
  app.get('/api/admin', (context) => {
    if (context.get('user').role !== 'admin') return context.json({ error: 'forbidden' }, 403);
    return context.json({
      sync: services.database.db.select().from(syncState).orderBy(syncState.resource).all(),
      proposals: services.database.db.select().from(proposals).orderBy(desc(proposals.createdAt)).limit(20).all(),
      writes: services.database.db.select().from(writeLog).orderBy(desc(writeLog.id)).limit(30).all(),
      rules: services.database.db.select().from(rules).orderBy(rules.priority).all(),
      approval: { ...services.pipeline.approvalStatus(), dryRun: services.env.DRY_RUN },
      funding: services.funding.status(),
    });
  });
  app.post('/api/rules', async (context) => {
    const user = context.get('user'); if (user.role !== 'admin') return context.json({ error: 'forbidden' }, 403);
    const parsed = z.object({ kind: z.enum(['payee_route', 'payee_category', 'item_category']), matchField: z.enum(['import_payee_name_original', 'payee_norm', 'item_name']), matchType: z.enum(['contains', 'prefix', 'regex']), pattern: z.string().min(1).max(300), secondaryPattern: z.string().max(300).nullable().optional(), action: z.object({ categoryId: z.string().optional(), categoryName: z.string().optional(), route: z.string().optional() }), priority: z.number().int().min(0).max(10000).default(100) }).safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: 'invalid_request' }, 400);
    if (parsed.data.matchType === 'regex') try { new RegExp(parsed.data.pattern); } catch { return context.json({ error: 'invalid_regex' }, 400); }
    const row = services.database.db.insert(rules).values({ ...parsed.data, secondaryPattern: parsed.data.secondaryPattern ?? null, enabled: true, createdBy: 'admin', hitCount: 0, createdAt: new Date().toISOString() }).returning().get();
    return context.json(row, 201);
  });
  app.patch('/api/rules/:id', async (context) => {
    const user = context.get('user'); if (user.role !== 'admin') return context.json({ error: 'forbidden' }, 403);
    const parsed = z.object({ enabled: z.boolean().optional(), priority: z.number().int().min(0).max(10000).optional(), pattern: z.string().min(1).max(300).optional() }).strict().safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: 'invalid_request' }, 400);
    services.database.db.update(rules).set(parsed.data).where(eq(rules.id, Number(context.req.param('id')))).run(); return context.json({ ok: true });
  });
  app.delete('/api/rules/:id', (context) => {
    const user = context.get('user'); if (user.role !== 'admin') return context.json({ error: 'forbidden' }, 403);
    services.database.db.update(rules).set({ enabled: false }).where(eq(rules.id, Number(context.req.param('id')))).run(); return context.json({ ok: true, disabled: true });
  });
  app.post('/api/admin/sync', async (context) => {
    if (context.get('user').role !== 'admin') return context.json({ error: 'forbidden' }, 403);
    const sync = await services.sync.run();
    const pipeline = sync.ok ? await services.pipeline.process(sync.changedTransactionIds) : null;
    return context.json({ sync, pipeline });
  });
  app.post('/api/admin/funding-preview', async (context) => {
    if (context.get('user').role !== 'admin') return context.json({ error: 'forbidden' }, 403);
    const body = await context.req.json().catch(() => ({})) as { readyToAssignMilli?: number };
    return context.json(await services.funding.run(body.readyToAssignMilli));
  });
  app.post('/api/admin/detectors', async (context) => {
    if (context.get('user').role !== 'admin') return context.json({ error: 'forbidden' }, 403);
    return context.json({ proposalIds: await services.detectors.runWeekly() });
  });
  app.post('/api/admin/categorizer', async (context) => {
    if (context.get('user').role !== 'admin') return context.json({ error: 'forbidden' }, 403);
    return context.json({ processed: await services.categorizer.run() });
  });
  app.post('/api/chat', async (context) => {
    const parsed = z.object({ message: z.string().min(1).max(1000) }).safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: 'invalid_request' }, 400);
    return context.json(await services.chat.ask(context.get('user'), parsed.data.message));
  });
  app.post('/api/chat/stream', async (context) => {
    const parsed = z.object({ message: z.string().min(1).max(1000) }).safeParse(await context.req.json().catch(() => ({})));
    if (!parsed.success) return context.json({ error: 'invalid_request' }, 400);
    const user = context.get('user');
    return streamSSE(context, async (stream) => {
      await stream.writeSSE({ event: 'status', data: 'thinking' });
      const answer = await services.chat.ask(user, parsed.data.message);
      const chunks = answer.answer_md.match(/.{1,20}(?:\s|$)/g) ?? [answer.answer_md];
      for (const chunk of chunks) {
        await stream.writeSSE({ event: 'delta', data: chunk });
        await stream.sleep(18);
      }
      await stream.writeSSE({ event: 'complete', data: JSON.stringify(answer) });
    });
  });

  app.post('/webhooks/twilio/sms', async (context) => {
    const form = Object.fromEntries(await context.req.formData().then((data) => Array.from(data.entries()).map(([key, value]) => [key, String(value)])));
    const signature = context.req.header('X-Twilio-Signature') ?? '';
    if (!services.messenger.validate(signature, `${services.env.APP_HOST}/webhooks/twilio/sms`, form)) return context.text('Invalid signature', 403);
    const from = form.From ?? ''; const body = (form.Body ?? '').trim().toUpperCase();
    services.database.db.insert(messagesLog).values({ direction: 'inbound', toPhone: services.env.TWILIO_FROM ?? 'mock', fromPhone: from, body: form.Body ?? '', twilioSid: form.MessageSid, at: new Date().toISOString() }).run();
    const user = services.database.db.select().from(users).where(eq(users.phone, from)).get();
    if (!user) return context.body(null, 204);
    const match = /^(Y|N|RELEASE)\s+([A-Z2-9]{4})$/.exec(body);
    if (match) await services.proposals.resolve(match[2], match[1] === 'N' ? 'reject' : match[1] === 'RELEASE' ? 'release' : 'approve');
    else await services.member.handlePrecommit(from, form.Body ?? '');
    return context.body(null, 204);
  });

  return app;
}
