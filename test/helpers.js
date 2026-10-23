import { openDatabase } from '../src/db.js';
import { ensureSeed } from '../src/seed.js';
import { buildApp } from '../src/app.js';

export async function createTestContext() {
  const db = openDatabase(':memory:');
  await ensureSeed(db);
  const app = await buildApp({ db, logger: false });
  await app.ready();

  return {
    db,
    app,
    async close() {
      await app.close();
      db.close();
    },
  };
}

export async function login(
  app,
  accountId = '10020001',
  password = 'Nexo#2026',
  remoteAddress = '10.0.0.1',
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { accountId, password },
    remoteAddress,
  });
}

export async function loginJson(app, accountId = '10020001') {
  return (await login(app, accountId)).json();
}
