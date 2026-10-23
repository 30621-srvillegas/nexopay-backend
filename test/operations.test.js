import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createTestContext, loginJson } from './helpers.js';

function auth(token, key = crypto.randomUUID()) {
  return {
    authorization: `Bearer ${token}`,
    'idempotency-key': key,
  };
}

test('depósito suma saldo y la idempotencia evita duplicados', async (t) => {
  const ctx = await createTestContext();
  t.after(() => ctx.close());

  const session = await loginJson(ctx.app);
  const key = crypto.randomUUID();

  const first = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/operations/deposit',
    headers: auth(session.accessToken, key),
    payload: { amountCents: 10000 },
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().balanceCents, 160000);

  const second = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/operations/deposit',
    headers: auth(session.accessToken, key),
    payload: { amountCents: 10000 },
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().idempotentReplay, true);
  assert.equal(second.json().balanceCents, 160000);

  const count = ctx.db
    .prepare('SELECT COUNT(*) AS c FROM transactions WHERE account_id = ?')
    .get('10020001').c;
  assert.equal(count, 1);
});

test('retiro con saldo insuficiente devuelve 400 sin insertar', async (t) => {
  const ctx = await createTestContext();
  t.after(() => ctx.close());

  const session = await loginJson(ctx.app);
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/operations/withdraw',
    headers: auth(session.accessToken),
    payload: { amountCents: 200000 },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'insufficient_funds');

  const count = ctx.db
    .prepare('SELECT COUNT(*) AS c FROM transactions WHERE account_id = ?')
    .get('10020001').c;
  assert.equal(count, 0);
});

test('transferencia mueve saldo e inserta dos filas', async (t) => {
  const ctx = await createTestContext();
  t.after(() => ctx.close());

  const ana = await loginJson(ctx.app, '10020001');
  const before = ctx.db
    .prepare('SELECT balance_cents FROM accounts WHERE id = ?')
    .get('10020002').balance_cents;

  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/operations/transfer',
    headers: auth(ana.accessToken),
    payload: { toAccountId: '10020002', amountCents: 5000 },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().balanceCents, 145000);

  const after = ctx.db
    .prepare('SELECT balance_cents FROM accounts WHERE id = ?')
    .get('10020002').balance_cents;
  assert.equal(after, before + 5000);

  const rows = ctx.db
    .prepare('SELECT COUNT(*) AS c FROM transactions WHERE reference_id = ?')
    .get(response.json().referenceId).c;
  assert.equal(rows, 2);
});

test('pago de servicio se categoriza como Luz', async (t) => {
  const ctx = await createTestContext();
  t.after(() => ctx.close());

  const session = await loginJson(ctx.app);
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/operations/pay-service',
    headers: auth(session.accessToken),
    payload: { contractCode: 'LUZ-001', amountCents: 3000 },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().transaction.serviceName, 'Luz');
  assert.equal(response.json().transaction.contractCode, 'LUZ-001');
});
