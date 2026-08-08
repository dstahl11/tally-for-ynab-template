import cron from 'node-cron';
import type { AppEnv } from '../config/env.js';
import type { FundingService } from '../detectors/funding.js';
import type { SyncService } from '../sync/service.js';
import type { TransactionPipeline } from '../rules/pipeline.js';
import type { MemberAutomation } from './memberAutomation.js';
import type { DetectorService } from '../detectors/service.js';
import type { NovelCategorizer } from '../rules/novelCategorizer.js';

export function startScheduler(env: AppEnv, sync: SyncService, pipeline: TransactionPipeline, funding: FundingService, member: MemberAutomation, detectors: DetectorService, categorizer: NovelCategorizer) {
  const jobs = [
    cron.schedule(`*/${env.SYNC_INTERVAL_MIN} * * * *`, async () => { const result = await sync.run(); if (result.ok) await pipeline.process(result.changedTransactionIds); }, { timezone: env.TIMEZONE }),
    cron.schedule('0 8 1 * *', async () => { await funding.run(); }, { timezone: env.TIMEZONE }),
    cron.schedule('15 8 * * *', async () => { member.advanceMysteryRetries(); await member.evaluateAlerts(); }, { timezone: env.TIMEZONE }),
    cron.schedule('30 8 */3 * *', async () => { await member.sendDigest(); }, { timezone: env.TIMEZONE }),
    cron.schedule('0 9 * * 0', async () => { await detectors.runWeekly(); }, { timezone: env.TIMEZONE }),
    cron.schedule('5 * * * *', async () => { await categorizer.run(); }, { timezone: env.TIMEZONE }),
  ];
  return () => jobs.forEach((job) => job.stop());
}
