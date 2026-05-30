import { Request, Response, NextFunction } from 'express';
import { verifyAuth0Token, Auth0User, Auth0Request } from './auth0';
import jwt from 'jsonwebtoken';
import prisma from '../prisma/index';
import { getJwtSecret } from '../config/env';

export { Auth0User, Auth0Request } from './auth0';

export interface AuthRequest extends Request {
  userId?: string;
  auth0User?: Auth0User;
}

// Only treat as dev mode when NODE_ENV is explicitly set to 'development'.
// Missing NODE_ENV defaults to development for local work but never enables
// security bypasses in deployed environments.
const isDevMode = process.env.NODE_ENV === 'development';

// Resolved once at module load via the centralized env validator.
// validateEnv() will have already been called by index.ts before this runs.
const JWT_SECRET = ((): string => {
  try {
    return getJwtSecret();
  } catch {
    // validateEnv() not yet called (e.g., unit test bootstrap). Return a
    // safe placeholder; actual resolution happens via validateEnv() in index.ts.
    return process.env.JWT_SECRET ?? '';
  }
})();

export async function devAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  console.log('[devAuth] Starting, isDevMode:', isDevMode);
  
  if (!isDevMode) {
    console.log('[devAuth] Not dev mode, passing through');
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  console.log('[devAuth] Token present:', !!token, 'token value:', token);

  if (token && JWT_SECRET) {
    console.log('[devAuth] Checking JWT_SECRET, value:', JWT_SECRET ? 'SET' : 'NOT SET');
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      (req as any).userId = decoded.userId;
      console.log('[devAuth] Set userId from JWT:', decoded.userId);
      next();
      return;
    } catch {
      console.log('[devAuth] JWT verification failed');
    }
  }

  console.log('[devAuth] No match, passing through');
  next();
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  console.log('[requireAuth] userId already set:', !!req.userId);
  
  if (req.userId) {
    console.log('[requireAuth] Allowing, userId:', req.userId);
    next();
    return;
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.substring(7);
  console.log('[requireAuth] Verifying Auth0 token');

  verifyAuth0Token(token)
    .then(async (user) => {
      req.auth0User = user;

      // Map Auth0 subject to internal user.id so downstream services
      // always receive a DB-backed user identifier.
      // Using upsert instead of findUnique+create to avoid a race condition
      // where two concurrent requests for the same Auth0 user both see
      // findUnique → null and then both attempt create(), causing a P2002
      // unique constraint violation. upsert is a single atomic operation.
      const internalUser = await prisma.user.upsert({
        where: { auth0Sub: user.sub },
        update: {},
        create: {
          email: user.email || `${user.sub}@auth0.local`,
          name: user.name || 'User',
          picture: user.picture || null,
          auth0Sub: user.sub,
        },
      });

      req.userId = internalUser.id;
      console.log('[requireAuth] Set internal userId from Auth0:', internalUser.id);
      next();
    })
    .catch((error) => {
      console.error('[requireAuth] Auth0 token verification failed:', error.message);
      res.status(401).json({ success: false, error: 'Invalid or expired token' });
    });
}

export function getAuthUserId(req: AuthRequest): string | undefined {
  return req.userId;
}

export function getAuth0User(req: AuthRequest): Auth0User | undefined {
  return req.auth0User;
}
