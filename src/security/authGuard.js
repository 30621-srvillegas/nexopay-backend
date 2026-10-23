import { AppError } from '../utils/errors.js';

export async function authGuard(request) {
  try {
    await request.jwtVerify();
  } catch {
    throw new AppError(401, 'invalid_access_token', 'Access token inválido o expirado');
  }

  if (request.user?.typ !== 'access' || !request.user?.sub) {
    throw new AppError(401, 'invalid_access_token', 'El token no es un access token');
  }

  const account = request.server.db
    .prepare('SELECT * FROM accounts WHERE id = ?')
    .get(request.user.sub);

  if (!account || account.status !== 'ACTIVE') {
    throw new AppError(401, 'account_unavailable', 'Cuenta no disponible');
  }

  request.account = account;
}
