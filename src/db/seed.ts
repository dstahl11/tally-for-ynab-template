import fs from 'node:fs';
import type { AppEnv } from '../config/env.js';
import type { AppDatabase } from './client.js';
import { settings, users } from './schema.js';
import { DEFAULT_APPROVAL_SETTINGS } from '../rules/pipeline.js';

export function seedDatabase(database: AppDatabase, env: AppEnv) {
  const now = new Date().toISOString();
  database.db.insert(users).values([
    { id: 'admin', name: env.ADMIN_NAME, phone: env.ADMIN_PHONE, role: 'admin', accountId: null, visibleGroupId: null, visibleCategoryIds: [], createdAt: now, updatedAt: now },
    { id: 'member', name: env.MEMBER_NAME, phone: env.MEMBER_PHONE, role: 'member', accountId: env.MEMBER_ACCOUNT_ID, visibleGroupId: env.MEMBER_CATEGORY_GROUP_ID, visibleCategoryIds: env.MEMBER_VISIBLE_CATEGORY_IDS.split(',').map((id) => id.trim()).filter(Boolean), createdAt: now, updatedAt: now },
  ]).onConflictDoNothing().run();

  const essentials = JSON.parse(fs.readFileSync('./config/essentials.json', 'utf8')).categoryNames as string[];
  const thresholds = JSON.parse(fs.readFileSync('./config/thresholds.json', 'utf8')) as unknown;
  database.db.insert(settings).values([
    { key: 'essentials_category_names', value: essentials, updatedAt: now, updatedBy: 'seed' },
    { key: 'approval_assistant', value: DEFAULT_APPROVAL_SETTINGS, updatedAt: now, updatedBy: 'seed' },
    { key: 'thresholds', value: thresholds, updatedAt: now, updatedBy: 'seed' },
    { key: 'unknown_category_name', value: '❓ Unknown', updatedAt: now, updatedBy: 'seed' },
  ]).onConflictDoNothing().run();
}
