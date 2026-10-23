import crypto from 'node:crypto';
import { AppError } from '../utils/errors.js';

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

export function requestHash(operation, body) {
  return crypto
    .createHash('sha256')
    .update(stableStringify({ operation, body }))
    .digest('hex');
}

/**
 * Ejecuta una operación de dinero una sola vez por (cuenta, operación, Idempotency-Key).
 * Si llega un reintento con el mismo cuerpo, devuelve la respuesta original.
 * Si llega la misma clave con otra operación o cuerpo, responde 409.
 */
export function runIdempotent(db, { accountId, key, operation, body }, execute) {
  if (!key) {
    throw new AppError(422, 'idempotency_key_required', 'Falta la cabecera Idempotency-Key');
  }

  const hash = requestHash(operation, body);
  const existing = db
    .prepare(
      'SELECT request_hash, status_code, response_json FROM idempotency_keys WHERE account_id = ? AND idempotency_key = ?',
    )
    .get(accountId, key);

  if (existing) {
    if (existing.request_hash !== hash) {
      throw new AppError(409, 'idempotency_conflict', 'La clave ya se usó con otra operación o cuerpo');
    }
    return {
      statusCode: existing.status_code,
      body: JSON.parse(existing.response_json),
      replayed: true,
    };
  }

  const transaction = db.transaction(() => {
    const result = execute();
    db.prepare(
      `INSERT INTO idempotency_keys
       (account_id, idempotency_key, request_hash, status_code, response_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(accountId, key, hash, result.statusCode, JSON.stringify(result.body), Date.now());
    return { ...result, replayed: false };
  });

  try {
    return transaction();
  } catch (error) {
    if (
      error?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
      error?.code === 'SQLITE_CONSTRAINT_UNIQUE'
    ) {
      const row = db
        .prepare(
          'SELECT request_hash, status_code, response_json FROM idempotency_keys WHERE account_id = ? AND idempotency_key = ?',
        )
        .get(accountId, key);
      if (row && row.request_hash === hash) {
        return { statusCode: row.status_code, body: JSON.parse(row.response_json), replayed: true };
      }
      throw new AppError(409, 'idempotency_conflict', 'Operación duplicada en conflicto');
    }
    throw error;
  }
}
