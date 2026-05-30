import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';

export interface Auth0User {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

export interface Auth0Request extends Request {
  user?: Auth0User;
}

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE;

const jwksClient = AUTH0_DOMAIN
  ? jwksRsa({
      jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 600000,
    })
  : null;

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  if (!jwksClient) {
    callback(new Error('Auth0 not configured'));
    return;
  }

  jwksClient.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
      return;
    }
    const signingKey = key?.getPublicKey();
    callback(null, signingKey);
  });
}

export function verifyAuth0Token(token: string): Promise<Auth0User> {
  return new Promise((resolve, reject) => {
    if (!AUTH0_DOMAIN || !AUTH0_AUDIENCE) {
      reject(new Error('Auth0 not configured'));
      return;
    }

    jwt.verify(
      token,
      getKey,
      {
        audience: AUTH0_AUDIENCE,
        issuer: `https://${AUTH0_DOMAIN}/`,
        algorithms: ['RS256'],
      },
      (err, decoded) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(decoded as Auth0User);
      }
    );
  });
}

export function auth0Middleware(req: Auth0Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.substring(7);

  verifyAuth0Token(token)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch((error) => {
      console.error('Auth0 token verification failed:', error.message);
      res.status(401).json({ success: false, error: 'Invalid or expired token' });
    });
}

export function optionalAuth0Middleware(req: Auth0Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.substring(7);

  verifyAuth0Token(token)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(() => {
      next();
    });
}
