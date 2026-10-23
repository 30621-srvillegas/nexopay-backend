import 'dotenv/config';

const env = process.env.NODE_ENV ?? 'development';
const isProd = env === 'production';

function readSecret() {
  const value = process.env.JWT_ACCESS_SECRET;
  if (value && value.trim().length >= 32) return value.trim();
  if (isProd) throw new Error('JWT_ACCESS_SECRET es obligatorio en producción (mínimo 32 caracteres)');
  return 'dev_only_secret_no_usar_en_produccion_2026_nexopay';
}

export const config = {
  env,
  isProd,
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? './data/nexopay.db',
  accessSecret: readSecret(),
  accessTtlSeconds: Number(process.env.ACCESS_TTL_SECONDS ?? 900),
  refreshTtlDays: Number(process.env.REFRESH_TTL_DAYS ?? 7),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
};
