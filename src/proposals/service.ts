import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import { messagesLog, proposals, rules } from '../db/schema.js';
import { WriteGateway } from './writeGateway.js';
import type { Messenger } from '../services/messages.js';
import type { AppEnv } from '../config/env.js';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function code() { return Array.from(randomBytes(4), (byte) => alphabet[byte % alphabet.length]).join(''); }

export class ProposalService {
  constructor(private readonly database: AppDatabase, private readonly writes: WriteGateway, private readonly messenger: Messenger, private readonly env: AppEnv) {}
  async create(kind: typeof proposals.$inferInsert.kind, payload: unknown, summarySms: string, recipientUserId = 'admin') {
    let id = code();
    while (this.database.db.select().from(proposals).where(and(eq(proposals.id, id), eq(proposals.status, 'open'))).get()) id = code();
    this.database.db.insert(proposals).values({ id, kind, payload, summarySms, status: 'open', recipientUserId, createdAt: new Date().toISOString() }).run();
    const to = recipientUserId === 'member' ? this.env.MEMBER_PHONE : this.env.ADMIN_PHONE;
    const body = `${summarySms}\nReply Y ${id} to apply or N ${id} to skip.`;
    const sent = await this.messenger.send(to, body);
    this.database.db.insert(messagesLog).values({ direction: 'outbound', toPhone: to, fromPhone: this.env.TWILIO_FROM ?? 'mock', body, twilioSid: sent.sid, relatedProposalId: id, at: new Date().toISOString() }).run();
    return id;
  }
  async resolve(id: string, action: 'approve' | 'reject' | 'release') {
    const proposal = this.database.db.select().from(proposals).where(and(eq(proposals.id, id), eq(proposals.status, 'open'))).get();
    if (!proposal) return { ok: false, message: 'Proposal not found or already resolved.' };
    const now = new Date().toISOString();
    if (action === 'reject') {
      this.database.db.update(proposals).set({ status: 'rejected', resolvedAt: now }).where(eq(proposals.id, id)).run();
      return { ok: true, message: `Skipped ${id}.` };
    }
    const payload = proposal.payload as { writes?: Array<{ endpoint: string; request: unknown; reversalHint: unknown; method?: 'PATCH' | 'POST' }>; releaseWrites?: Array<{ endpoint: string; request: unknown; reversalHint: unknown; method?: 'PATCH' | 'POST' }>; newRecurring?: { categoryGroupId: string; name: string; targetMilli: number; note: string; transactionIds: string[]; payeeNorm: string } };
    this.database.db.update(proposals).set({ status: 'approved', resolvedAt: now }).where(eq(proposals.id, id)).run();
    const results = [];
    if (payload.newRecurring) {
      const created = await this.writes.mutate(`proposal:${id}`, '/categories', { category: { category_group_id: payload.newRecurring.categoryGroupId, name: payload.newRecurring.name, goal_target: payload.newRecurring.targetMilli, note: payload.newRecurring.note } }, { created_category: true }, 'POST');
      results.push(created);
      const categoryId = this.env.DRY_RUN ? `dryrun-${id}` : (created.data as any)?.data?.category?.id;
      if (created.status < 300 && categoryId) {
        results.push(await this.writes.mutate(`proposal:${id}`, '/transactions', { transactions: payload.newRecurring.transactionIds.map((transactionId) => ({ id: transactionId, category_id: categoryId })) }, { transaction_ids: payload.newRecurring.transactionIds, category_id: null }));
        if (!this.env.DRY_RUN) this.database.db.insert(rules).values({ kind: 'payee_category', matchField: 'payee_norm', matchType: 'contains', pattern: payload.newRecurring.payeeNorm, action: { categoryId }, priority: 70, enabled: true, createdBy: 'admin', hitCount: 0, createdAt: new Date().toISOString() }).run();
      }
    }
    const selectedWrites = action === 'release' ? payload.releaseWrites ?? payload.writes : payload.writes;
    for (const write of selectedWrites ?? []) results.push(await this.writes.mutate(`proposal:${id}`, write.endpoint, write.request, write.reversalHint, write.method));
    const failed = results.some((result) => result.status >= 300);
    this.database.db.update(proposals).set({ status: failed ? 'failed' : 'executed', executedAt: new Date().toISOString(), executionResult: results }).where(eq(proposals.id, id)).run();
    return { ok: !failed, message: failed ? `Proposal ${id} partially failed.` : `Applied ${id}${action === 'release' ? ' through holdback' : ''}.` };
  }
}
