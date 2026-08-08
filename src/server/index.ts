import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { loadEnv } from '../config/env.js';
import { runMigrations } from '../db/migrate.js';
import { seedDatabase } from '../db/seed.js';
import { createMessenger } from '../services/messages.js';
import { createYnabClient } from '../services/ynab.js';
import { AuthService } from '../auth/service.js';
import { WriteGateway } from '../proposals/writeGateway.js';
import { ProposalService } from '../proposals/service.js';
import { FundingService } from '../detectors/funding.js';
import { SyncService } from '../sync/service.js';
import { TransactionPipeline } from '../rules/pipeline.js';
import { ChatService } from '../chat/service.js';
import { createApp } from './app.js';
import { startScheduler } from '../jobs/scheduler.js';
import { MemberAutomation } from '../jobs/memberAutomation.js';
import { DetectorService } from '../detectors/service.js';
import { NovelCategorizer } from '../rules/novelCategorizer.js';

const env = loadEnv();
const database = runMigrations(env.DATABASE_PATH);
seedDatabase(database, env);
const ynab = createYnabClient(env);
const messenger = createMessenger(env);
const auth = new AuthService(database, messenger, env);
const writes = new WriteGateway(database, ynab, env);
const proposals = new ProposalService(database, writes, messenger, env);
const funding = new FundingService(database, writes, proposals, env);
const sync = new SyncService(database, ynab, messenger, env);
const pipeline = new TransactionPipeline(database, writes);
const chat = new ChatService(database, env);
const member = new MemberAutomation(database, messenger, env);
const detectors = new DetectorService(database, proposals);
const categorizer = new NovelCategorizer(database, env);
const app = createApp({ env, database, auth, messenger, writes, proposals, funding, sync, pipeline, chat, member, detectors, categorizer });

if (env.NODE_ENV === 'production') {
  app.use('/*', serveStatic({ root: './web/dist' }));
  app.get('*', serveStatic({ path: './web/dist/index.html' }));
}

startScheduler(env, sync, pipeline, funding, member, detectors, categorizer);
serve({ fetch: app.fetch, port: env.PORT }, (info) => console.log(`${env.APP_NAME} listening on http://localhost:${info.port}`));
