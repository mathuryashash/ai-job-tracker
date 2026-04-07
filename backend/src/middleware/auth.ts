import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  userId?: string;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.substring(7);
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    console.error('JWT_SECRET not configured');
    res.status(500).json({ success: false, error: 'Server configuration error' });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret) as { userId: string; email: string };
    req.userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

export function getAuthUserId(req: AuthRequest): string | undefined {
  return req.userId;
}

export function generateToken(userId: string, email: string): string {
  const secret = process.env.JWT_SECRET;
  const expiration = process.env.JWT_EXPIRATION || '24h';

  if (!secret) {
    throw new Error('JWT_SECRET not configured');
  }

  return jwt.sign(
    { userId, email },
    secret,
    { expiresIn: expiration }
  );
}
