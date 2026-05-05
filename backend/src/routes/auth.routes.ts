import { Router, Response } from 'express';
import { z, ZodError } from 'zod';
import prisma from '../prisma/index';
import { createError } from '../middleware/errorHandler';
import { requireAuth, getAuth0User, AuthRequest } from '../middleware/auth';
import jwt from 'jsonwebtoken';
import { TOKEN_EXPIRY } from '../config/constants';

const router = Router();

// Zod schema for user preferences - prevents mass assignment
const userPreferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  language: z.string().optional(),
  timezone: z.string().optional(),
  notifications: z.object({
    email: z.boolean().optional(),
    push: z.boolean().optional(),
    jobReminders: z.boolean().optional(),
  }).optional(),
  privacy: z.object({
    showProfile: z.boolean().optional(),
    showStats: z.boolean().optional(),
  }).optional(),
  resumeSettings: z.object({
    defaultFormat: z.string().optional(),
    autoSave: z.boolean().optional(),
  }).optional(),
}).strict(); // Reject unknown fields to prevent mass assignment

const updateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  picture: z.string().url().optional().or(z.literal('')).optional(),
  preferences: userPreferencesSchema.optional(),
});

const isDevMode = process.env.NODE_ENV === 'development' || process.env.DEV_MODE === 'true';
const JWT_SECRET = process.env.JWT_SECRET || (isDevMode ? 'dev-secret-change-in-production' : undefined);

router.post('/dev-login', async (req: AuthRequest, res: Response) => {
  if (!isDevMode) {
    res.status(403).json({ success: false, error: 'Dev login disabled in production' });
    return;
  }

  if (!JWT_SECRET) {
    res.status(500).json({ success: false, error: 'JWT_SECRET not configured' });
    return;
  }

  try {
    const { email, name } = req.body;

    if (!email || !name) {
      res.status(400).json({ success: false, error: 'Email and name are required' });
      return;
    }

    let user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      user = await prisma.user.create({
        data: { email, name },
      });
    }

    const signOptions: jwt.SignOptions = { expiresIn: TOKEN_EXPIRY };
    const token = jwt.sign(
      { userId: user.id, sub: `dev|${user.id}`, email: user.email, name: user.name },
      JWT_SECRET,
      signOptions
    );

    res.json({ success: true, data: { user, token } });
  } catch (error) {
    console.error('Dev login error:', error);
    res.status(500).json({ success: false, error: 'Dev login failed' });
  }
});

router.get('/me', async (req: AuthRequest, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (token && JWT_SECRET) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
        if (user) {
          res.json({ success: true, data: user });
          return;
        }
      } catch {
        // token invalid, fall through to Auth0
      }
    }

    const auth0User = getAuth0User(req);
    if (!auth0User) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    let user = await prisma.user.findUnique({
      where: { auth0Sub: auth0User.sub },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: auth0User.email || `${auth0User.sub}@auth0.local`,
          name: auth0User.name || 'User',
          picture: auth0User.picture || null,
          auth0Sub: auth0User.sub,
        },
      });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, error: 'Failed to get user' });
  }
});

router.put('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const auth0User = getAuth0User(req);

    if (!auth0User) {
      throw createError('Unauthorized', 401);
    }

    const user = await prisma.user.findUnique({
      where: { auth0Sub: auth0User.sub },
    });

    if (!user) {
      throw createError('User not found', 404);
    }

    // Validate input to prevent mass assignment
    const validatedData = updateUserSchema.parse(req.body);

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(validatedData.name && { name: validatedData.name }),
        ...(validatedData.picture && { picture: validatedData.picture }),
        ...(validatedData.preferences && { preferences: validatedData.preferences }),
      },
    });

    res.json({ success: true, data: updatedUser });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ 
        success: false, 
        error: 'Validation failed', 
        details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
      });
      return;
    }
    console.error('Update user error:', error);
    res.status(500).json({ success: false, error: 'Failed to update user' });
  }
});

router.delete('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const auth0User = getAuth0User(req);

    if (!auth0User) {
      throw createError('Unauthorized', 401);
    }

    const user = await prisma.user.findUnique({
      where: { auth0Sub: auth0User.sub },
    });

    if (!user) {
      throw createError('User not found', 404);
    }

    // Cascade deletes are configured on each relation, so deleting the user
    // is sufficient — but explicit deletions are retained for clarity.
    await prisma.$transaction([
      prisma.resume.deleteMany({ where: { userId: user.id } }),
      prisma.jobApplication.deleteMany({ where: { userId: user.id } }),
      prisma.coverLetter.deleteMany({ where: { userId: user.id } }),
      prisma.user.delete({ where: { id: user.id } }),
    ]);

    res.json({ success: true, message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete account' });
  }
});

router.get('/callback', (_req: AuthRequest, res: Response) => {
  res.json({ success: true, message: 'OAuth callback endpoint - handled by Auth0 redirect URI' });
});

export default router;
