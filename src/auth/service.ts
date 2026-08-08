import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { AppEnv } from '../config/env.js';
import type { AppDatabase } from '../db/client.js';
import { magicLinks, messagesLog, sessions, users } from '../db/schema.js';
import type { Messenger } from '../services/messages.js';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const secureMatch = (provided: string, expected: string) => timingSafeEqual(
  createHash('sha256').update(provided).digest(),
  createHash('sha256').update(expected).digest(),
);

export class AuthService {
  constructor(private readonly database: AppDatabase, private readonly messenger: Messenger, private readonly env: AppEnv) {}

  private createSession(userId: string): string {
    const sessionToken = randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    this.database.db.insert(sessions).values({ id: randomUUID(), userId, tokenHash: hash(sessionToken), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), createdAt: now, lastSeenAt: now }).run();
    return sessionToken;
  }

  signInWithPin(userId: 'admin' | 'member', pin: string): { sessionToken: string; userId: string } | null {
    const expected = userId === 'admin' ? this.env.ADMIN_PIN : this.env.MEMBER_PIN;
    if (!expected || !secureMatch(pin, expected)) return null;
    const user = this.database.db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) return null;
    return { sessionToken: this.createSession(user.id), userId: user.id };
  }

  private async issueLink(userId: string, phone: string): Promise<'sent' | 'limited'> {
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const count = this.database.db.select({ count: sql<number>`count(*)` }).from(magicLinks)
      .where(and(eq(magicLinks.userId, userId), gt(magicLinks.createdAt, hourAgo))).get()!.count;
    if (count >= 3) return 'limited';
    const token = randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    this.database.db.insert(magicLinks).values({ id: randomUUID(), userId, tokenHash: hash(token), expiresAt, usedAt: null, createdAt: now }).run();
    const body = `${this.env.APP_NAME} sign-in: ${this.env.APP_HOST}/auth/verify?token=${encodeURIComponent(token)} (expires in 15 minutes). Reply STOP to opt out; HELP for help.`;
    const message = await this.messenger.send(phone, body);
    this.database.db.insert(messagesLog).values({ direction: 'outbound', toPhone: phone, fromPhone: this.env.TWILIO_FROM ?? 'mock', body: `${this.env.APP_NAME} sign-in link sent (expires in 15 minutes)`, twilioSid: message.sid, at: now }).run();
    return 'sent';
  }

  async requestLink(phone: string): Promise<'sent' | 'limited' | 'missing'> {
    const user = this.database.db.select().from(users).where(eq(users.phone, phone)).get();
    return user ? this.issueLink(user.id, user.phone) : 'missing';
  }

  async requestLinkForUser(userId: 'admin' | 'member'): Promise<'sent' | 'limited' | 'missing'> {
    const user = this.database.db.select().from(users).where(eq(users.id, userId)).get();
    return user ? this.issueLink(user.id, user.phone) : 'missing';
  }

  verifyMagicLink(token: string): { sessionToken: string; userId: string } | null {
    const now = new Date().toISOString();
    const link = this.database.db.select().from(magicLinks).where(and(eq(magicLinks.tokenHash, hash(token)), isNull(magicLinks.usedAt), gt(magicLinks.expiresAt, now))).get();
    if (!link) return null;
    this.database.sqlite.transaction(() => {
      this.database.db.update(magicLinks).set({ usedAt: now }).where(eq(magicLinks.id, link.id)).run();
    })();
    return { sessionToken: this.createSession(link.userId), userId: link.userId };
  }

  sessionUser(token: string | undefined) {
    if (!token) return null;
    const now = new Date().toISOString();
    const session = this.database.db.select().from(sessions).where(and(eq(sessions.tokenHash, hash(token)), gt(sessions.expiresAt, now))).get();
    if (!session) return null;
    this.database.db.update(sessions).set({ lastSeenAt: now, expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() }).where(eq(sessions.id, session.id)).run();
    return this.database.db.select().from(users).where(eq(users.id, session.userId)).get() ?? null;
  }

  revokeSession(token: string | undefined) {
    if (!token) return;
    this.database.db.delete(sessions).where(eq(sessions.tokenHash, hash(token))).run();
  }

  mockUser(id: string) {
    if (!this.env.MOCK_EXTERNALS) return null;
    return this.database.db.select().from(users).where(eq(users.id, id)).get() ?? null;
  }
}
