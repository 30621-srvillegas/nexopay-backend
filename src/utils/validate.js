import { z } from 'zod';
import { AppError } from './errors.js';

export const accountIdSchema = z
  .string()
  .regex(/^\d{8}$/, 'La cuenta debe tener exactamente 8 dígitos');

export const loginSchema = z.object({
  accountId: accountIdSchema,
  password: z.string().min(8).max(72),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(300),
});

export const amountSchema = z.object({
  amountCents: z.number().int().positive().max(10_000_000),
});

export const transferSchema = z.object({
  toAccountId: accountIdSchema,
  amountCents: z.number().int().positive().max(10_000_000),
});

export const payServiceSchema = z.object({
  contractCode: z
    .string()
    .regex(/^(LUZ|AGUA|NET|GAS)-[A-Z0-9]{3,12}$/, 'Código de contrato inválido'),
  amountCents: z.number().int().positive().max(10_000_000),
});

export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Idempotency-Key inválida');

export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(422, 'validation_error', 'Datos inválidos', result.error.flatten());
  }
  return result.data;
}

export function parseIdempotencyKey(value) {
  const result = idempotencyKeySchema.safeParse(value);
  if (!result.success) {
    throw new AppError(422, 'idempotency_key_invalid', 'Falta o es inválida la cabecera Idempotency-Key');
  }
  return result.data;
}
