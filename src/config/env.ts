import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('true')
  .transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().default('./data/ynab-companion.sqlite'),
  APP_HOST: z.string().default('http://localhost:3000'),
  APP_NAME: z.string().default('Tally'),
  SESSION_SECRET: z.string().min(16).default('mock-session-secret-change-before-live'),
  TIMEZONE: z.string().default('America/New_York'),
  DRY_RUN: booleanString,
  MOCK_EXTERNALS: booleanString,
  SYNC_INTERVAL_MIN: z.coerce.number().int().min(5).max(60).default(20),
  HISTORY_MONTHS: z.coerce.number().int().min(1).max(120).default(24),
  CHAT_DAILY_LIMIT: z.coerce.number().int().min(0).max(10_000).default(250),
  YNAB_API_KEY: z.string().optional(),
  YNAB_PLAN_ID: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  ADMIN_NAME: z.string().default('Admin'),
  ADMIN_PHONE: z.string().default('+15550101001'),
  ADMIN_PIN: z.string().regex(/^\d{6}$/).optional(),
  MEMBER_NAME: z.string().default('Member'),
  MEMBER_PHONE: z.string().default('+15550101002'),
  MEMBER_ACCOUNT_ID: z.string().default('mock-member-account'),
  MEMBER_CATEGORY_GROUP_ID: z.string().default('mock-member-group'),
  MEMBER_VISIBLE_CATEGORY_IDS: z.string().default('mock-member-food'),
  MEMBER_PIN: z.string().regex(/^\d{6}$/).optional(),
  HC_UUID: z.string().optional(),
});

export type AppEnv = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const env = schema.parse(source);
  if (!env.MOCK_EXTERNALS) {
    const missing = [
      ['YNAB_API_KEY', env.YNAB_API_KEY],
      ['YNAB_PLAN_ID', env.YNAB_PLAN_ID],
      ['TWILIO_ACCOUNT_SID', env.TWILIO_ACCOUNT_SID],
      ['TWILIO_AUTH_TOKEN', env.TWILIO_AUTH_TOKEN],
      ['TWILIO_FROM', env.TWILIO_FROM],
      ['ADMIN_PIN', env.ADMIN_PIN],
      ['MEMBER_PIN', env.MEMBER_PIN],
    ].filter(([, value]) => !value);
    if (missing.length) throw new Error(`Missing live configuration: ${missing.map(([key]) => key).join(', ')}`);
  }
  if (!env.DRY_RUN && env.MOCK_EXTERNALS) {
    throw new Error('MOCK_EXTERNALS=true cannot be combined with DRY_RUN=false');
  }
  return env;
}
