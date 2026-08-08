import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { loadEnv } from '../config/env.js';
import { createDatabase } from './client.js';

export function runMigrations(databasePath: string) {
  const database = createDatabase(databasePath);
  migrate(database.db, { migrationsFolder: './src/db/migrations' });
  database.sqlite.pragma('optimize');
  return database;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = loadEnv();
  const database = runMigrations(env.DATABASE_PATH);
  database.close();
  console.log('Database migrations applied.');
}
