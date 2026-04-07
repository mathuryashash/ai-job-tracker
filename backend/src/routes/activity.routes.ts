import { Router, Response } from 'express';
import { z, ZodError } from 'zod';
import prisma from '../prisma/index';
import { createError } from '../middleware/errorHandler';
import { getAuthUserId, AuthRequest } from '../middleware/auth';

const router = Router();

const createActivitySchema = z.object({
  type: z.enum(['note', 'email', 'call', 'interview']),
  description: z.string().min(1),
  metadata: z.record(z.any()).optional(),
});

router.get('/application/:applicationId', async (req: AuthRequest, res: Response) => {
  try {
    const { applicationId } = req.params;
    const userId = getAuthUserId(req);
    
    if (!userId) {
      throw createError('Unauthorized', 401);
    }
    
    const application = await prisma.jobApplication.findUnique({ where: { id: applicationId }, select: { userId: true } });
    if (!application) {
      throw createError('Application not found', 404);
    }
    if (application.userId !== userId) {
      throw createError('Forbidden', 403);
    }
    
    const activities = await prisma.activity.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: activities });
  } catch (error) {
    console.error('Get activities error:', error);
    res.status(500).json({ success: false, error: 'Failed to get activities' });
  }
});

router.post('/application/:applicationId', async (req: AuthRequest, res: Response) => {
  try {
    const { applicationId } = req.params;
    const userId = getAuthUserId(req);
    const data = createActivitySchema.parse(req.body);

    if (!userId) {
      throw createError('Unauthorized', 401);
    }

    const application = await prisma.jobApplication.findUnique({ where: { id: applicationId } });
    if (!application) {
      throw createError('Application not found', 404);
    }
    if (application.userId !== userId) {
      throw createError('Forbidden', 403);
    }

    const activity = await prisma.activity.create({
      data: {
        applicationId,
        type: data.type,
        description: data.description,
        metadata: data.metadata || {},
      },
    });

    res.status(201).json({ success: true, data: activity });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Create activity error:', error);
    res.status(500).json({ success: false, error: 'Failed to create activity' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { description } = req.body;
    const userId = getAuthUserId(req);

    if (!userId) {
      throw createError('Unauthorized', 401);
    }

    const existing = await prisma.activity.findUnique({
      where: { id },
      include: { application: { select: { userId: true } } },
    });
    if (!existing) {
      throw createError('Activity not found', 404);
    }
    if (existing.application.userId !== userId) {
      throw createError('Forbidden', 403);
    }

    const activity = await prisma.activity.update({
      where: { id },
      data: { description },
    });

    res.json({ success: true, data: activity });
  } catch (error) {
    console.error('Update activity error:', error);
    res.status(500).json({ success: false, error: 'Failed to update activity' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = getAuthUserId(req);
    
    if (!userId) {
      throw createError('Unauthorized', 401);
    }
    
    const existing = await prisma.activity.findUnique({
      where: { id },
      include: { application: { select: { userId: true } } },
    });
    if (!existing) {
      throw createError('Activity not found', 404);
    }
    if (existing.application.userId !== userId) {
      throw createError('Forbidden', 403);
    }

    await prisma.activity.delete({ where: { id } });

    res.json({ success: true, message: 'Activity deleted' });
  } catch (error) {
    console.error('Delete activity error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete activity' });
  }
});

export default router;
