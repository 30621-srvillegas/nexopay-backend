import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { openDatabase } from './db.js';
import { hashPassword } from './security/passwords.js';

export async function ensureSeed(db) {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c;
  if (existing > 0) return;

  const passwordHash = await hashPassword('Nexo#2026');
  const now = Date.now();

  const insertAccount = db.prepare(
    `INSERT INTO accounts
     (id, owner, currency, balance_cents, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertCredential = db.prepare(
    `INSERT INTO password_credentials (account_id, password_hash, updated_at)
     VALUES (?, ?, ?)`,
  );

  const transaction = db.transaction(() => {
    insertAccount.run('10020001', 'Ana Torres', 'PEN', 150000, 'ACTIVE', now);
    insertCredential.run('10020001', passwordHash, now);

    insertAccount.run('10020002', 'Luis Rojas', 'PEN', 80000, 'ACTIVE', now);
    insertCredential.run('10020002', passwordHash, now);
  });

  transaction();
  console.log('Seed listo: 10020001 (Ana) y 10020002 (Luis), clave Nexo#2026');
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const db = openDatabase(config.dbPath);
  await ensureSeed(db);
  db.close();
}
