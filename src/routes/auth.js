import { config } from '../config.js';
import { AppError } from '../utils/errors.js';
import { parse, loginSchema, refreshSchema } from '../utils/validate.js';
import { verifyPassword } from '../security/passwords.js';
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeByRaw,
} from '../security/tokens.js';

function accountView(account) {
  return {
    id: account.id,
    owner: account.owner,
    currency: account.currency,
    balanceCents: account.balance_cents,
    balance: (account.balance_cents / 100).toFixed(2),
  };
}

function audit(db, accountId, action, detail, ip) {
  db.prepare(
    'INSERT INTO audit_log (account_id, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(accountId, action, detail, ip, Date.now());
}

export async function authRoutes(app) {
  const { db } = app;

  app.post(
    '/api/v1/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const body = parse(loginSchema, request.body);
      const row = db
        .prepare(
          `SELECT a.*, p.password_hash
           FROM accounts a
           JOIN password_credentials p ON p.account_id = a.id
           WHERE a.id = ?`,
        )
        .get(body.accountId);

      const generic = new AppError(401, 'invalid_credentials', 'Credenciales inválidas');
      if (!row) throw generic;
      if (row.status !== 'ACTIVE') {
        throw new AppError(423, 'account_locked', 'Cuenta bloqueada');
      }
      if (row.locked_until && row.locked_until > Date.now()) {
        throw new AppError(423, 'account_locked', 'Cuenta bloqueada temporalmente');
      }

      const ok = await verifyPassword(body.password, row.password_hash);
      if (!ok) {
        const attempts = row.failed_attempts + 1;
        const lockedUntil = attempts >= 5 ? Date.now() + 15 * 60 * 1000 : null;
        db.prepare(
          'UPDATE accounts SET failed_attempts = ?, locked_until = ? WHERE id = ?',
        ).run(attempts, lockedUntil, row.id);
        audit(db, row.id, 'LOGIN_FAILED', `attempts=${attempts}`, request.ip);
        throw generic;
      }

      db.prepare(
        'UPDATE accounts SET failed_attempts = 0, locked_until = NULL WHERE id = ?',
      ).run(row.id);

      const accessToken = signAccessToken(app, row.id);
      const refresh = issueRefreshToken(db, row.id);
      audit(db, row.id, 'LOGIN_OK', null, request.ip);

      return reply.send({
        accessToken,
        refreshToken: refresh.raw,
        tokenType: 'Bearer',
        expiresInSeconds: config.accessTtlSeconds,
        account: accountView(row),
      });
    },
  );

  app.post(
    '/api/v1/auth/refresh',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = parse(refreshSchema, request.body);
      const rotated = rotateRefreshToken(db, body.refreshToken);
      const account = db
        .prepare('SELECT * FROM accounts WHERE id = ?')
        .get(rotated.accountId);

      if (!account || account.status !== 'ACTIVE') {
        throw new AppError(401, 'account_unavailable', 'Cuenta no disponible');
      }

      const accessToken = signAccessToken(app, account.id);
      audit(db, account.id, 'TOKEN_REFRESHED', null, request.ip);

      return reply.send({
        accessToken,
        refreshToken: rotated.raw,
        tokenType: 'Bearer',
        expiresInSeconds: config.accessTtlSeconds,
        account: accountView(account),
      });
    },
  );

  app.post(
    '/api/v1/auth/logout',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = parse(refreshSchema, request.body);
      revokeByRaw(db, body.refreshToken);
      return reply.code(204).send();
    },
  );

  app.get('/api/v1/auth/me', { preHandler: app.authGuard }, async (request, reply) => {
    return reply.send(accountView(request.account));
  });
}
