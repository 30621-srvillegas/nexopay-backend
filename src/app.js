import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { authRoutes } from './routes/auth.js';
import { operationRoutes } from './routes/operations.js';
import { realtimeRoutes } from './routes/realtime.js';
import { authGuard } from './security/authGuard.js';
import { RealtimeHub } from './realtime/hub.js';
import { AppError } from './utils/errors.js';

function buildLogger(logger) {
  if (logger === false) return false;
  if (logger !== true) return logger;

  return {
    level: config.isProd ? 'info' : 'debug',
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["idempotency-key"]',
        'req.body.password',
        'req.body.refreshToken',
      ],
      censor: '[REDACTED]',
    },
    ...(config.isProd
      ? {}
      : {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'SYS:standard', ignore: 'pid,hostname' },
          },
        }),
  };
}

export async function buildApp({ db, logger = true }) {
  const app = Fastify({
    logger: buildLogger(logger),
    trustProxy: true,
    bodyLimit: 32 * 1024,
  });

  app.decorate('db', db);
  app.decorate('hub', new RealtimeHub());
  app.decorate('authGuard', authGuard);
  app.decorateRequest('account', null);

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: config.isProd
      ? { maxAge: 15_552_000, includeSubDomains: true }
      : false,
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || config.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  });

  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    hook: 'onRequest',
  });

  await app.register(jwt, {
    secret: config.accessSecret,
  });

  await app.register(websocket, {
    options: { maxPayload: 16 * 1024 },
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null,
          requestId: request.id,
        },
      });
    }

    if (error.statusCode === 429) {
      return reply.code(429).send({
        error: {
          code: 'rate_limited',
          message: 'Demasiadas solicitudes. Espera un momento.',
          requestId: request.id,
        },
      });
    }

    request.log.error({ err: error }, 'Error no controlado');
    return reply.code(500).send({
      error: {
        code: 'internal_error',
        message: 'Error interno del servidor',
        requestId: request.id,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({
      error: {
        code: 'not_found',
        message: 'Ruta no encontrada',
        requestId: request.id,
      },
    });
  });

  app.get('/health', async () => ({
    ok: true,
    service: 'nexopay-backend',
    env: config.env,
    ts: new Date().toISOString(),
  }));

  await app.register(authRoutes);
  await app.register(operationRoutes);
  await app.register(realtimeRoutes);

  return app;
}
