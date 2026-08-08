import type { AppEnv } from '../config/env.js';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import { writeLog } from '../db/schema.js';
import type { YnabClient } from '../types/ynab.js';

export class WriteGateway {
  constructor(private readonly database: AppDatabase, private readonly ynab: YnabClient, private readonly env: AppEnv) {}

  async mutate(actor: string, endpoint: string, request: unknown, reversalHint: unknown, method: 'PATCH' | 'POST' = 'PATCH') {
    const inserted = this.database.db.insert(writeLog).values({
      at: new Date().toISOString(), actor, endpoint, request, reversalHint, dryRun: this.env.DRY_RUN,
    }).returning({ id: writeLog.id }).get();
    if (this.env.DRY_RUN) {
      const response = { dryRun: true, skipped: true };
      this.database.db.update(writeLog).set({ responseStatus: 200, response }).where(eq(writeLog.id, inserted.id)).run();
      return { status: 200, data: response };
    }
    const result = await this.ynab.mutate(endpoint, request, method);
    this.database.db.update(writeLog).set({ responseStatus: result.status, response: result.data }).where(eq(writeLog.id, inserted.id)).run();
    return result;
  }
}
