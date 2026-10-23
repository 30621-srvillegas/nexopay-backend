import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, login } from './helpers.js';

test('login correcto devuelve tokens y cuenta', async (t) => {
  const ctx = await createTestContext();
  t.after(() => ctx.close());

  const response = await login(ctx.app);
  assert.equal(response.statusCode, 200);

  const body = response.json();
  assert.ok(body.accessToken);
  assert.ok(body.refreshToken);
  assert.equal(body.account.id, '10020001');
  assert.equal(body.account.balanceCents, 150000);
});

test('login con clave incorrecta devuelve 401 genérico', async (t) => {
  const ctx = await createTestContext();
  t.after(() => ctx.close());

  const response = await login(ctx.app, '10020001', 'ClaveMala#1');
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'invalid_credentials');
});

test('bloqueo tras 5 intentos fallidos', async (t) => {
  const ctx = await createTestContext();
  t.after(() => ctx.close());

  for (let i = 0; i < 5; i += 1) {
    const response = await login(
      ctx.app,
      '10020001',
      'ClaveMala#1',
      `10.0.1.${i + 1}`,
    );
    assert.equal(response.statusCode, 401);
  }

  const locked = await login(ctx.app, '10020001', 'Nexo#2026', '10.0.1.99');
  assert.equal(locked.statusCode, 423);
  assert.equal(locked.json().error.code, 'account_locked');
});

test('refresh rota y detecta reuso', async (t) => {
  const ctx = await createTestContext();
  t.after(() => ctx.close());

  const first = (await login(ctx.app)).json();

  const refresh1 = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    payload: { refreshToken: first.refreshToken },
  });
  assert.equal(refresh1.statusCode, 200);
  const second = refresh1.json();

  const reuse = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    payload: { refreshToken: first.refreshToken },
  });
  assert.equal(reuse.statusCode, 401);

  const afterReuse = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    payload: { refreshToken: second.refreshToken },
  });
  assert.equal(afterReuse.statusCode, 401);
});
