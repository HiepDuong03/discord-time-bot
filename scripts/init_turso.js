import { createClient } from '@libsql/client';
import fs from 'node:fs';
import dotenv from 'dotenv';
dotenv.config();

async function initTurso() {
  console.log('Connecting to Turso Cloud at:', process.env.TURSO_DATABASE_URL);
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
  });

  const schema = fs.readFileSync('src/database/schema.sql', 'utf8');
  await client.executeMultiple(schema);
  console.log('✅ Schema executed successfully on Turso!');

  const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table'");
  console.log('✅ Tables on Turso Cloud:', tables.rows.map(r => r.name));

  // Di chuyển dữ liệu cũ từ SQLite local nếu có
  const localDbFile = 'data/timesheet.db';
  if (fs.existsSync(localDbFile)) {
    console.log('Syncing existing data from local SQLite to Turso...');
    const Database = (await import('better-sqlite3')).default;
    const localDb = new Database(localDbFile);
    
    // 1. Users
    const users = localDb.prepare('SELECT * FROM users').all();
    for (const u of users) {
      await client.execute({
        sql: 'INSERT OR IGNORE INTO users (discord_id, display_name, daily_target_hours, created_at) VALUES (?, ?, ?, ?)',
        args: [u.discord_id, u.display_name, u.daily_target_hours, u.created_at]
      });
    }
    console.log(`Synced ${users.length} users to Turso.`);

    // 2. Accounts
    const accounts = localDb.prepare('SELECT * FROM accounts').all();
    for (const a of accounts) {
      await client.execute({
        sql: 'INSERT OR IGNORE INTO accounts (account_code, daily_target_hours, created_at) VALUES (?, ?, ?)',
        args: [a.account_code, a.daily_target_hours, a.created_at]
      });
    }
    console.log(`Synced ${accounts.length} accounts to Turso.`);

    // 3. Shifts
    const shifts = localDb.prepare('SELECT * FROM shifts').all();
    for (const s of shifts) {
      await client.execute({
        sql: 'INSERT OR IGNORE INTO shifts (id, user_id, account_code, check_in, check_out, duration_minutes, work_date, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        args: [s.id, s.user_id, s.account_code, s.check_in, s.check_out, s.duration_minutes, s.work_date, s.status, s.note, s.created_at]
      });
    }
    console.log(`Synced ${shifts.length} shifts to Turso.`);
    localDb.close();
  }
}

initTurso().catch(console.error);
