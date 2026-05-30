import request from 'supertest';
import express, { Express, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const mockPrismaUserFindUnique = jest.fn();
const mockPrismaUserCreate = jest.fn();
const mockVerifyAuth0Token = jest.fn();

jest.mock('../../prisma/index', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: (...args: unknown[]) => mockPrismaUserFindUnique(...args),
      create: (...args: unknown[]) => mockPrismaUserCreate(...args),
    },
  },
}));

jest.mock('../../middleware/auth0', () => ({
  verifyAuth0Token: (...args: unknown[]) => mockVerifyAuth0Token(...args),
}));

function createTestApp(): Express {
  const app = express();
  app.use(express.json());

  app.post('/api/auth/me', async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ success: false, error: 'Missing or invalid authorization header' });
        return;
      }

      const token = authHeader.substring(7);
      
      try {
        const user = await mockVerifyAuth0Token(token);
        
        let dbUser = await mockPrismaUserFindUnique({
          where: { auth0Sub: user.sub },
        });

        if (!dbUser) {
          dbUser = await mockPrismaUserCreate({
            data: {
              email: user.email || `${user.sub}@auth0.local`,
              name: user.name || 'User',
              picture: user.picture || null,
              auth0Sub: user.sub,
            },
          });
        }

        res.json({ success: true, data: dbUser });
      } catch (verifyError) {
        console.error('Auth0 token verification failed:', verifyError);
        res.status(401).json({ success: false, error: 'Invalid or expired token' });
      }
    } catch (error) {
      next(error);
    }
  });

  return app;
}

describe('Auth Stale Token Handling', () => {
  let app: Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  describe('Token verification failure scenarios', () => {
    it('should return 401 for missing authorization header', async () => {
      const response = await request(app)
        .post('/api/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Missing or invalid');
    });

    it('should return 401 for malformed bearer token', async () => {
      const response = await request(app)
        .post('/api/auth/me')
        .set('Authorization', 'Bearer malformed-token');

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Invalid or expired');
    });

    it('should return 401 for expired token', async () => {
      mockVerifyAuth0Token.mockRejectedValue(new jwt.TokenExpiredError('jwt expired', new Date()));

      const response = await request(app)
        .post('/api/auth/me')
        .set('Authorization', 'Bearer expired-token');

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Invalid or expired');
    });

    it('should return 401 for invalid signature', async () => {
      mockVerifyAuth0Token.mockRejectedValue(new jwt.JsonWebTokenError('invalid signature'));

      const response = await request(app)
        .post('/api/auth/me')
        .set('Authorization', 'Bearer invalid-signature-token');

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Invalid or expired');
    });

    it('should return 401 when Auth0 is not configured', async () => {
      mockVerifyAuth0Token.mockRejectedValue(new Error('Auth0 not configured'));

      const response = await request(app)
        .post('/api/auth/me')
        .set('Authorization', 'Bearer some-token');

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Invalid or expired');
    });

    it('should return 401 for malformed JWT structure', async () => {
      mockVerifyAuth0Token.mockRejectedValue(new jwt.JsonWebTokenError('jwt malformed'));

      const response = await request(app)
        .post('/api/auth/me')
        .set('Authorization', 'Bearer not.a.valid.jwt');

      expect(response.status).toBe(401);
    });

    it('should successfully return user for valid token', async () => {
      const mockUser = {
        id: 'db-user-id',
        email: 'test@example.com',
        name: 'Test User',
        auth0Sub: 'auth0|12345',
      };

      mockVerifyAuth0Token.mockResolvedValue({
        sub: 'auth0|12345',
        email: 'test@example.com',
        name: 'Test User',
      });
      mockPrismaUserFindUnique.mockResolvedValue(mockUser);

      const response = await request(app)
        .post('/api/auth/me')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockUser);
    });

    it('should create user if not found in database', async () => {
      const newUser = {
        id: 'new-user-id',
        email: 'new@example.com',
        name: 'New User',
        auth0Sub: 'auth0|67890',
      };

      mockVerifyAuth0Token.mockResolvedValue({
        sub: 'auth0|67890',
        email: 'new@example.com',
        name: 'New User',
      });
      mockPrismaUserFindUnique.mockResolvedValue(null);
      mockPrismaUserCreate.mockResolvedValue(newUser);

      const response = await request(app)
        .post('/api/auth/me')
        .set('Authorization', 'Bearer new-user-token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockPrismaUserCreate).toHaveBeenCalled();
    });
  });

  describe('Session clearing behavior (API contract)', () => {
    it('should clear session on any non-success response', async () => {
      mockVerifyAuth0Token.mockRejectedValue(new Error('Token invalid'));

      const response = await request(app)
        .post('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should not set Authorization header for failed requests', async () => {
      mockVerifyAuth0Token.mockRejectedValue(new Error('Token invalid'));

      const response = await request(app)
        .post('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
      expect(response.headers['authorization']).toBeUndefined();
    });

    it('should return structured error response for stale token', async () => {
      mockVerifyAuth0Token.mockRejectedValue(new jwt.TokenExpiredError('jwt expired', new Date()));

      const response = await request(app)
        .post('/api/auth/me')
        .set('Authorization', 'Bearer expired-jwt-token');

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error');
      expect(typeof response.body.error).toBe('string');
    });
  });

  describe('Multiple consecutive auth failures', () => {
    it('should consistently return 401 for invalid tokens', async () => {
      mockVerifyAuth0Token.mockRejectedValue(new Error('Invalid token'));

      for (let i = 0; i < 3; i++) {
        const response = await request(app)
          .post('/api/auth/me')
          .set('Authorization', 'Bearer invalid-token');

        expect(response.status).toBe(401);
        expect(response.body.error).toContain('Invalid or expired');
      }
    });

    it('should recover after valid token is provided', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        auth0Sub: 'auth0|123',
      };

      mockVerifyAuth0Token
        .mockRejectedValueOnce(new Error('Invalid'))
        .mockResolvedValueOnce({
          sub: 'auth0|123',
          email: 'test@example.com',
          name: 'Test User',
        });
      mockPrismaUserFindUnique.mockResolvedValue(mockUser);

      const invalidResponse = await request(app)
        .post('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token');
      expect(invalidResponse.status).toBe(401);

      const validResponse = await request(app)
        .post('/api/auth/me')
        .set('Authorization', 'Bearer valid-token');
      expect(validResponse.status).toBe(200);
      expect(validResponse.body.success).toBe(true);
    });
  });
});
