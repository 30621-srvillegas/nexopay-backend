import { issueWsTicket, consumeWsTicket } from '../security/tokens.js';
import { balanceView } from '../utils/money.js';

export async function realtimeRoutes(app) {
  const { db, hub } = app;

  app.post(
    '/api/v1/realtime/ticket',
    {
      preHandler: app.authGuard,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      return reply.send(issueWsTicket(db, request.account.id));
    },
  );

  app.get('/ws', { websocket: true }, (socket, request) => {
    const url = new URL(request.url, 'http://localhost');
    const ticket = url.searchParams.get('ticket');
    const accountId = ticket ? consumeWsTicket(db, ticket) : null;

    if (!accountId) {
      socket.close(4401, 'invalid_ticket');
      return;
    }

    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
    if (!account) {
      socket.close(4401, 'account_not_found');
      return;
    }

    hub.add(accountId, socket);
    hub.sendToSocket(socket, 'connection.ready', {
      accountId,
      ...balanceView(account.balance_cents),
    });

    socket.isAlive = true;
    socket.on('pong', () => {
      socket.isAlive = true;
    });
    socket.on('close', () => hub.remove(accountId, socket));
    socket.on('error', () => hub.remove(accountId, socket));
    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message?.type === 'ping') {
          hub.sendToSocket(socket, 'pong', { ts: Date.now() });
        }
      } catch {
        // El protocolo del cliente es opcional; los eventos van del servidor al cliente.
      }
    });
  });

  const pingInterval = setInterval(() => {
    for (const socket of hub.allSockets()) {
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      try {
        socket.ping();
      } catch {
        // El socket ya se cerró.
      }
    }
  }, 30_000);

  pingInterval.unref();

  app.addHook('onClose', async () => {
    clearInterval(pingInterval);
  });
}
