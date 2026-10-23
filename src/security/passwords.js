import { argon2id, argon2Verify } from 'hash-wasm';
import { randomBytes } from 'node:crypto';

const ARGON2_PARAMS = {
  parallelism: 1,
  iterations: 3,
  memorySize: 64 * 1024, // 64 MB
  hashLength: 32,
};

export async function hashPassword(password) {
  const salt = randomBytes(16);
  return argon2id({
    password: password.normalize('NFKC'),
    salt,
    ...ARGON2_PARAMS,
    outputType: 'encoded',
  });
}

export async function verifyPassword(password, encodedHash) {
  if (!encodedHash) return false;
  return argon2Verify({
    password: password.normalize('NFKC'),
    hash: encodedHash,
  });
}
