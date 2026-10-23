import crypto from 'node:crypto';
import { config } from '../config.js';
import { AppError } from '../utils/errors.js';

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function signAccessToken(app, accountId) {
  return app.jwt.sign(
    { sub: accountId, typ: 'access' },
    { expiresIn: config.accessTtlSeconds },
  );
}

export function issueRefreshToken(db, accountId, familyId = crypto.randomUUID()) {
  const raw = randomToken(48);
  const id = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + config.refreshTtlDays * 24 * 60 * 60 * 1000;

  db.prepare(
    `INSERT INTO refresh_tokens
     (id, account_id, token_hash, family_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, accountId, sha256(raw), familyId, expiresAt, now);

  return { raw, id, familyId, expiresAt };
}

export function revokeFamily(db, familyId) {
  db.prepare(
    'UPDATE refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL',
  ).run(Date.now(), familyId);
}

export function revokeByRaw(db, raw) {
  const row = db
    .prepare('SELECT family_id FROM refresh_tokens WHERE token_hash = ?')
    .get(sha256(raw));
  if (row) revokeFamily(db, row.family_id);
}

export function rotateRefreshToken(db, raw) {
  const hash = sha256(raw);
  const now = Date.now();
  let reuseFamilyId = null;

  try {
    return db.transaction(() => {
      const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(hash);
      if (!row) throw new AppError(401, 'invalid_refresh', 'Refresh token inválido');

      if (row.revoked_at) {
        reuseFamilyId = row.family_id;
        throw new AppError(401, 'refresh_reused', 'Refresh token reutilizado; sesión revocada');
      }

      if (row.expires_at <= now) {
        throw new AppError(401, 'refresh_expired', 'Refresh token expirado');
      }

      const next = issueRefreshToken(db, row.account_id, row.family_id);
      db.prepare('UPDATE refresh_tokens SET revoked_at = ?, replaced_by = ? WHERE id = ?').run(
        now,
        next.id,
        row.id,
      );

      return { accountId: row.account_id, ...next };
    })();
  } catch (error) {
    if (reuseFamilyId) revokeFamily(db, reuseFamilyId);
    throw error;
  }
}

export function issueWsTicket(db, accountId) {
  const raw = randomToken(32);
  const hash = sha256(raw);
  const now = Date.now();

  db.prepare(
    `INSERT INTO ws_tickets (ticket_hash, account_id, expires_at, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(hash, accountId, now + 30_000, now);

  return { ticket: raw, expiresInSeconds: 30 };
}

export function consumeWsTicket(db, raw) {
  const hash = sha256(raw);
  const now = Date.now();
  const row = db.prepare('SELECT * FROM ws_tickets WHERE ticket_hash = ?').get(hash);

  if (!row || row.used_at || row.expires_at <= now) return null;

  const result = db
    .prepare('UPDATE ws_tickets SET used_at = ? WHERE ticket_hash = ? AND used_at IS NULL')
    .run(now, hash);

  return result.changes === 1 ? row.account_id : null;
}
