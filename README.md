# NexoPay — Backend distribuido UC1

Backend de NexoPay construido con Node.js 22, Fastify 5, SQLite y WebSocket. Expone autenticación con JWT y refresh rotativo, operaciones de billetera, historial y notificaciones de saldo en tiempo real.

Repositorio Android: `https://github.com/30621-srvillegas/nexopay-android`

## Demo

- Backend: `https://nexopay-backend-xnr5.onrender.com`
- APK release: `https://github.com/30621-srvillegas/nexopay-android/releases`
- Video: pendiente

## Cuentas de prueba

| Cuenta | Dueño | Clave |
|---|---|---|
| 10020001 | Ana Torres | Nexo#2026 |
| 10020002 | Luis Rojas | Nexo#2026 |

El seed se ejecuta al arrancar si la base no contiene cuentas. En Render free el disco es efímero y las operaciones se pierden al reiniciar el servicio; las cuentas se recrean automáticamente.

## Arquitectura

```text
Android -> HTTPS/REST -> Fastify -> SQLite
Android <- WSS (ticket de un solo uso) <- Fastify
```

## Funcionalidades

- Login con access token corto y refresh token rotativo.
- Depósito, retiro, transferencia P2P y pago de servicios.
- Idempotencia en operaciones financieras.
- Rate limit y bloqueo temporal por intentos fallidos.
- Tickets WebSocket de un solo uso.
- Contraseñas con Argon2id.
- Historial local cifrado en Android con SQLCipher.

## Requisitos

- Node.js 22 o superior.
- npm.
- No requiere un servidor de base de datos externo: usa SQLite.

## Ejecución local

```powershell
npm ci
Copy-Item .env.example .env
npm run seed
npm start
```

El backend queda disponible en `http://localhost:3000`. Verifica el estado con:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

## Variables de entorno

| Variable | Descripción | Valor por defecto |
|---|---|---|
| `PORT` | Puerto HTTP | `3000` |
| `HOST` | Interfaz de escucha | `0.0.0.0` |
| `NODE_ENV` | Entorno de ejecución | `development` |
| `JWT_ACCESS_SECRET` | Secreto de firma JWT; obligatorio en producción y mínimo 32 caracteres | Solo valor de desarrollo |
| `ACCESS_TTL_SECONDS` | Vigencia del access token | `900` |
| `REFRESH_TTL_DAYS` | Vigencia del refresh token | `7` |
| `DB_PATH` | Ruta de la base SQLite | `./data/nexopay.db` |
| `CORS_ORIGINS` | Orígenes permitidos separados por coma | `http://localhost:3000` |

Nunca se debe versionar `.env`. En producción las variables se configuran en Render.

## Pruebas

```powershell
npm test
```

La suite usa una base SQLite temporal y no requiere que el servidor esté levantado.

## Despliegue en Render

El repositorio incluye `render.yaml` con:

- Build: `npm ci`
- Start: `npm start`
- Health check: `/health`
- `JWT_ACCESS_SECRET` generado por Render
- `DB_PATH=./data/nexopay.db`

Render free duerme el servicio tras un periodo sin tráfico. Antes de una demostración, abrir `/health` y esperar a que despierte. Para persistencia real se necesita un disco persistente o una base administrada.

## Seguridad

- No se versionan `.env`, bases SQLite, logs ni secretos.
- El secreto JWT se genera en Render y no se comparte con el APK.
- Las contraseñas se almacenan con Argon2id.
- Los tickets WebSocket son de un solo uso.
- Las operaciones aceptan claves de idempotencia para evitar duplicados.

## Autor

Nombre — Curso Sistemas Distribuidos UC1 — 2026
