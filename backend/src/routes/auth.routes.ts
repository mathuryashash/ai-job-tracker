import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../prisma/index';
import { createError } from '../middleware/errorHandler';
import { requireAuth, getAuthUserId, generateToken, AuthRequest } from '../middleware/auth';

const router = Router();

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  picture: z.string().url().optional(),
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const data = createUserSchema.parse(req.body);

    let user = await prisma.user.findUnique({ where: { email: data.email } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: data.email,
          name: data.name,
          picture: data.picture || null,
        },
      });
    }

    const token = generateToken(user.id, user.email);

    res.json({ success: true, data: { user, token } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: error.errors });
      return;
    }
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Failed to login' });
  }
});

router.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    
    if (!userId) {
      throw createError('Unauthorized', 401);
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw createError('User not found', 404);
    }

    res.json({ success: true, data: user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, error: 'Failed to get user' });
  }
});

router.put('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    
    if (!userId) {
      throw createError('Unauthorized', 401);
    }

    const { name, picture, preferences } = req.body;

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(name && { name }),
        ...(picture && { picture }),
        ...(preferences && { preferences }),
      },
    });

    res.json({ success: true, data: user });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ success: false, error: 'Failed to update user' });
  }
});

router.delete('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = getAuthUserId(req);

    if (!userId) {
      throw createError('Unauthorized', 401);
    }

    // Verify user exists before deletion
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw createError('User not found', 404);
    }

    // TODO: Implement soft delete or archive user instead of permanent deletion
    // For now, perform cascading delete with proper error handling
    await prisma.resume.deleteMany({ where: { userId } });
    await prisma.jobApplication.deleteMany({ where: { userId } });
    await prisma.coverLetter.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });

    res.json({ success: true, message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete account' });
  }
});

export default router;