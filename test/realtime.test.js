import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createTestContext, loginJson } from './helpers.js';

test('ticket WS es de un solo uso y llega transfer.received', async (t) => {
  const ctx = await createTestContext();
  t.after(() => ctx.close());

  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  const port = ctx.app.server.address().port;

  const ana = await loginJson(ctx.app, '10020001');
  const luis = await loginJson(ctx.app, '10020002');

  const ticketResponse = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/realtime/ticket',
    headers: { authorization: `Bearer ${ana.accessToken}` },
  });
  assert.equal(ticketResponse.statusCode, 200);
  const ticket = ticketResponse.json().ticket;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${ticket}`);
  const readyPromise = once(ws, 'message');
  await once(ws, 'open');

  const [readyRaw] = await readyPromise;
  const ready = JSON.parse(readyRaw.toString());
  assert.equal(ready.event, 'connection.ready');

  const reuse = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${ticket}`);
  reuse.on('error', () => {});
  const [closeCode] = await once(reuse, 'close');
  assert.equal(closeCode, 4401);

  const receivedPromise = once(ws, 'message');

  const transfer = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/operations/transfer',
    headers: {
      authorization: `Bearer ${luis.accessToken}`,
      'idempotency-key': crypto.randomUUID(),
    },
    payload: { toAccountId: '10020001', amountCents: 2500 },
  });
  assert.equal(transfer.statusCode, 200);

  const [receivedRaw] = await receivedPromise;
  const envelope = JSON.parse(receivedRaw.toString());
  assert.equal(envelope.event, 'transfer.received');
  assert.equal(envelope.data.transaction.amountCents, 2500);
  assert.equal(envelope.data.fromAccountId, '10020002');

  ws.close();
});
