import crypto from 'node:crypto';
import { AppError } from '../utils/errors.js';
import {
  parse,
  amountSchema,
  transferSchema,
  payServiceSchema,
  parseIdempotencyKey,
} from '../utils/validate.js';
import { runIdempotent } from '../security/idempotency.js';
import { balanceView } from '../utils/money.js';

const SERVICE_MAP = {
  LUZ: 'Luz',
  AGUA: 'Agua',
  NET: 'Internet',
  GAS: 'Gas',
};

function txView(row) {
  return {
    id: row.id,
    type: row.type,
    amountCents: row.amount_cents,
    amount: (row.amount_cents / 100).toFixed(2),
    balanceCents: row.balance_after_cents,
    balance: (row.balance_after_cents / 100).toFixed(2),
    counterpartyAccountId: row.counterparty_account_id ?? null,
    contractCode: row.contract_code ?? null,
    serviceName: row.service_name ?? null,
    description: row.description ?? null,
    referenceId: row.reference_id ?? null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function insertTransaction(db, accountId, tx) {
  db.prepare(
    `INSERT INTO transactions
     (id, account_id, type, amount_cents, balance_after_cents, counterparty_account_id,
      contract_code, service_name, description, reference_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    tx.id,
    accountId,
    tx.type,
    tx.amount_cents,
    tx.balance_after_cents,
    tx.counterparty_account_id,
    tx.contract_code,
    tx.service_name,
    tx.description,
    tx.reference_id,
    tx.created_at,
  );
}

function audit(db, accountId, action, detail, ip, now = Date.now()) {
  db.prepare(
    'INSERT INTO audit_log (account_id, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(accountId, action, detail, ip, now);
}

export async function operationRoutes(app) {
  const { db, hub } = app;

  app.post(
    '/api/v1/operations/deposit',
    { preHandler: app.authGuard },
    async (request, reply) => {
      const body = parse(amountSchema, request.body);
      const key = parseIdempotencyKey(request.headers['idempotency-key']);
      const accountId = request.account.id;

      const result = runIdempotent(db, { accountId, key, operation: 'deposit', body }, () => {
        const now = Date.now();
        const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
        const newBalance = account.balance_cents + body.amountCents;

        db.prepare('UPDATE accounts SET balance_cents = ? WHERE id = ?').run(
          newBalance,
          accountId,
        );

        const tx = {
          id: crypto.randomUUID(),
          type: 'DEPOSIT',
          amount_cents: body.amountCents,
          balance_after_cents: newBalance,
          counterparty_account_id: null,
          contract_code: null,
          service_name: null,
          description: 'Depósito',
          reference_id: null,
          created_at: now,
        };
        insertTransaction(db, accountId, tx);
        audit(db, accountId, 'DEPOSIT', `amountCents=${body.amountCents}`, request.ip, now);

        return {
          statusCode: 200,
          body: { transaction: txView(tx), ...balanceView(newBalance) },
        };
      });

      if (!result.replayed) {
        hub.send(accountId, 'balance.updated', {
          ...balanceView(result.body.balanceCents),
          reason: 'deposit',
          transaction: result.body.transaction,
        });
      }

      return reply
        .code(result.statusCode)
        .send({ ...result.body, idempotentReplay: result.replayed });
    },
  );

  app.post(
    '/api/v1/operations/withdraw',
    { preHandler: app.authGuard },
    async (request, reply) => {
      const body = parse(amountSchema, request.body);
      const key = parseIdempotencyKey(request.headers['idempotency-key']);
      const accountId = request.account.id;

      const result = runIdempotent(db, { accountId, key, operation: 'withdraw', body }, () => {
        const now = Date.now();
        const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);

        if (account.balance_cents < body.amountCents) {
          throw new AppError(400, 'insufficient_funds', 'Saldo insuficiente', {
            ...balanceView(account.balance_cents),
          });
        }

        const newBalance = account.balance_cents - body.amountCents;
        db.prepare('UPDATE accounts SET balance_cents = ? WHERE id = ?').run(
          newBalance,
          accountId,
        );

        const tx = {
          id: crypto.randomUUID(),
          type: 'WITHDRAWAL',
          amount_cents: body.amountCents,
          balance_after_cents: newBalance,
          counterparty_account_id: null,
          contract_code: null,
          service_name: null,
          description: 'Retiro',
          reference_id: null,
          created_at: now,
        };
        insertTransaction(db, accountId, tx);
        audit(db, accountId, 'WITHDRAWAL', `amountCents=${body.amountCents}`, request.ip, now);

        return {
          statusCode: 200,
          body: { transaction: txView(tx), ...balanceView(newBalance) },
        };
      });

      if (!result.replayed) {
        hub.send(accountId, 'balance.updated', {
          ...balanceView(result.body.balanceCents),
          reason: 'withdrawal',
          transaction: result.body.transaction,
        });
      }

      return reply
        .code(result.statusCode)
        .send({ ...result.body, idempotentReplay: result.replayed });
    },
  );

  app.post(
    '/api/v1/operations/transfer',
    { preHandler: app.authGuard },
    async (request, reply) => {
      const body = parse(transferSchema, request.body);
      const key = parseIdempotencyKey(request.headers['idempotency-key']);
      const from = request.account;

      if (from.id === body.toAccountId) {
        throw new AppError(422, 'same_account', 'No puedes transferirte a ti mismo');
      }
      const destination = db
        .prepare('SELECT * FROM accounts WHERE id = ?')
        .get(body.toAccountId);
      if (!destination) {
        throw new AppError(404, 'destination_not_found', 'Cuenta destino no existe');
      }
      const to = destination;

      const result = runIdempotent(db, { accountId: from.id, key, operation: 'transfer', body }, () => {
        const now = Date.now();
        const fromAccount = db.prepare('SELECT * FROM accounts WHERE id = ?').get(from.id);
        const toAccount = db
          .prepare('SELECT * FROM accounts WHERE id = ?')
          .get(body.toAccountId);

        if (fromAccount.balance_cents < body.amountCents) {
          throw new AppError(400, 'insufficient_funds', 'Saldo insuficiente', {
            ...balanceView(fromAccount.balance_cents),
          });
        }

        const fromBalance = fromAccount.balance_cents - body.amountCents;
        const toBalance = toAccount.balance_cents + body.amountCents;

        db.prepare('UPDATE accounts SET balance_cents = ? WHERE id = ?').run(
          fromBalance,
          from.id,
        );
        db.prepare('UPDATE accounts SET balance_cents = ? WHERE id = ?').run(
          toBalance,
          to.id,
        );

        const referenceId = crypto.randomUUID();
        const sent = {
          id: crypto.randomUUID(),
          type: 'TRANSFER_SENT',
          amount_cents: body.amountCents,
          balance_after_cents: fromBalance,
          counterparty_account_id: to.id,
          contract_code: null,
          service_name: null,
          description: `A ${to.id}`,
          reference_id: referenceId,
          created_at: now,
        };
        const received = {
          id: crypto.randomUUID(),
          type: 'TRANSFER_RECEIVED',
          amount_cents: body.amountCents,
          balance_after_cents: toBalance,
          counterparty_account_id: from.id,
          contract_code: null,
          service_name: null,
          description: `De ${from.id}`,
          reference_id: referenceId,
          created_at: now,
        };

        insertTransaction(db, from.id, sent);
        insertTransaction(db, to.id, received);
        audit(db, from.id, 'TRANSFER_SENT', `to=${to.id};amountCents=${body.amountCents}`, request.ip, now);
        audit(db, to.id, 'TRANSFER_RECEIVED', `from=${from.id};amountCents=${body.amountCents}`, request.ip, now);

        return {
          statusCode: 200,
          body: {
            transaction: txView(sent),
            ...balanceView(fromBalance),
            toAccountId: to.id,
            referenceId,
          },
        };
      });

      if (!result.replayed) {
        const receivedRow = db
          .prepare(
            'SELECT * FROM transactions WHERE reference_id = ? AND account_id = ?',
          )
          .get(result.body.referenceId, to.id);

        if (receivedRow) {
          hub.send(to.id, 'transfer.received', {
            transaction: txView(receivedRow),
            fromAccountId: from.id,
            ...balanceView(receivedRow.balance_after_cents),
          });
        }

        hub.send(from.id, 'balance.updated', {
          ...balanceView(result.body.balanceCents),
          reason: 'transfer_sent',
          transaction: result.body.transaction,
        });
      }

      return reply
        .code(result.statusCode)
        .send({ ...result.body, idempotentReplay: result.replayed });
    },
  );

  app.post(
    '/api/v1/operations/pay-service',
    { preHandler: app.authGuard },
    async (request, reply) => {
      const body = parse(payServiceSchema, request.body);
      const key = parseIdempotencyKey(request.headers['idempotency-key']);
      const accountId = request.account.id;
      const prefix = body.contractCode.split('-')[0];
      const serviceName = SERVICE_MAP[prefix] ?? 'Servicio Básico';

      const result = runIdempotent(db, { accountId, key, operation: 'pay-service', body }, () => {
        const now = Date.now();
        const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);

        if (account.balance_cents < body.amountCents) {
          throw new AppError(400, 'insufficient_funds', 'Saldo insuficiente', {
            ...balanceView(account.balance_cents),
          });
        }

        const newBalance = account.balance_cents - body.amountCents;
        db.prepare('UPDATE accounts SET balance_cents = ? WHERE id = ?').run(
          newBalance,
          accountId,
        );

        const tx = {
          id: crypto.randomUUID(),
          type: 'SERVICE_PAYMENT',
          amount_cents: body.amountCents,
          balance_after_cents: newBalance,
          counterparty_account_id: null,
          contract_code: body.contractCode,
          service_name: serviceName,
          description: `Pago ${serviceName} · ${body.contractCode}`,
          reference_id: null,
          created_at: now,
        };
        insertTransaction(db, accountId, tx);
        audit(
          db,
          accountId,
          'SERVICE_PAYMENT',
          `contract=${body.contractCode};amountCents=${body.amountCents}`,
          request.ip,
          now,
        );

        return {
          statusCode: 200,
          body: { transaction: txView(tx), ...balanceView(newBalance) },
        };
      });

      if (!result.replayed) {
        hub.send(accountId, 'balance.updated', {
          ...balanceView(result.body.balanceCents),
          reason: 'service_payment',
          transaction: result.body.transaction,
        });
      }

      return reply
        .code(result.statusCode)
        .send({ ...result.body, idempotentReplay: result.replayed });
    },
  );

  app.get(
    '/api/v1/operations/balance',
    { preHandler: app.authGuard },
    async (request, reply) => {
      const account = db
        .prepare('SELECT * FROM accounts WHERE id = ?')
        .get(request.account.id);
      return reply.send({
        accountId: account.id,
        ...balanceView(account.balance_cents),
        currency: account.currency,
      });
    },
  );

  app.get(
    '/api/v1/operations/transactions',
    { preHandler: app.authGuard },
    async (request, reply) => {
      const rawLimit = Number(request.query?.limit ?? 50);
      const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100)
        : 50;

      const rows = db
        .prepare(
          `SELECT * FROM transactions
           WHERE account_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
        )
        .all(request.account.id, limit);

      return reply.send({ transactions: rows.map(txView) });
    },
  );
}
