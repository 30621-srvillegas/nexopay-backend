import { config } from './config.js';
import { openDatabase } from './db.js';
import { ensureSeed } from './seed.js';
import { buildApp } from './app.js';

const db = openDatabase(config.dbPath);
await ensureSeed(db);

const app = await buildApp({ db });

async function shutdown(signal) {
  app.log.info(`Cerrando por ${signal}`);
  try {
    await app.close();
  } finally {
    db.close();
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`NexoPay backend en http://localhost:${config.port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
