import { Router, Response } from 'express';
import { z, ZodError } from 'zod';
import prisma from '../prisma/index';
import { createError } from '../middleware/errorHandler';
import { getAuthUserId, AuthRequest } from '../middleware/auth';

const router = Router();

const createApplicationSchema = z.object({
  companyName: z.string().min(1),
  positionTitle: z.string().min(1),
  jobDescription: z.string().optional(),
  jobUrl: z.string().url().optional().or(z.literal('')),
  resumeId: z.string().optional(),
});

const updateApplicationSchema = z.object({
  companyName: z.string().min(1).optional(),
  positionTitle: z.string().min(1).optional(),
  jobDescription: z.string().optional(),
  jobUrl: z.string().url().optional().or(z.literal('')),
  status: z.enum(['todo', 'applied', 'interviewing', 'offer', 'rejected']).optional(),
  resumeId: z.string().optional().nullable(),
  coverLetterId: z.string().optional().nullable(),
  applicationDate: z.string().datetime().optional().nullable(),
});

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      throw createError('Unauthorized', 401);
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    const [applications, total] = await Promise.all([
      prisma.jobApplication.findMany({
        where: { userId },
        include: {
          activities: {
            orderBy: { createdAt: 'desc' },
            take: 10,
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.jobApplication.count({ where: { userId } }),
    ]);

    res.json({ success: true, data: applications, pagination: { total, limit, offset } });
  } catch (error) {
    console.error('Get applications error:', error);
    res.status(500).json({ success: false, error: 'Failed to get applications' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const data = createApplicationSchema.parse(req.body);
    const userId = getAuthUserId(req);
    if (!userId) {
      throw createError('Unauthorized', 401);
    }

    const application = await prisma.jobApplication.create({
      data: {
        userId,
        companyName: data.companyName,
        positionTitle: data.positionTitle,
        jobDescription: data.jobDescription || null,
        jobUrl: data.jobUrl || null,
        resumeId: data.resumeId || null,
        status: 'todo',
      },
    });

    await prisma.activity.create({
      data: {
        applicationId: application.id,
        type: 'note',
        description: 'Application created',
      },
    });

    res.status(201).json({ success: true, data: application });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Create application error:', error);
    res.status(500).json({ success: false, error: 'Failed to create application' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = getAuthUserId(req);
    if (!userId) {
      throw createError('Unauthorized', 401);
    }
    
    const application = await prisma.jobApplication.findUnique({
      where: { id },
      include: {
        activities: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!application) {
      throw createError('Application not found', 404);
    }
    if (application.userId !== userId) {
      throw createError('Forbidden', 403);
    }

    res.json({ success: true, data: application });
  } catch (error) {
    console.error('Get application error:', error);
    res.status(500).json({ success: false, error: 'Failed to get application' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = getAuthUserId(req);
    if (!userId) {
      throw createError('Unauthorized', 401);
    }

    const data = updateApplicationSchema.parse(req.body);

    const existing = await prisma.jobApplication.findUnique({ where: { id } });
    if (!existing) {
      throw createError('Application not found', 404);
    }
    if (existing.userId !== userId) {
      throw createError('Forbidden', 403);
    }

    const statusChanged = data.status && data.status !== existing.status;

    const application = await prisma.jobApplication.update({
      where: { id },
      data: {
        ...data,
        applicationDate: data.applicationDate ? new Date(data.applicationDate) : undefined,
      },
    });

    if (statusChanged) {
      await prisma.activity.create({
        data: {
          applicationId: id,
          type: 'status-change',
          description: `Status changed to ${data.status}`,
        },
      });
    }

    res.json({ success: true, data: application });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Update application error:', error);
    res.status(500).json({ success: false, error: 'Failed to update application' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = getAuthUserId(req);
    if (!userId) {
      throw createError('Unauthorized', 401);
    }

    const existing = await prisma.jobApplication.findUnique({ where: { id }, select: { userId: true } });
    if (!existing) {
      throw createError('Application not found', 404);
    }
    if (existing.userId !== userId) {
      throw createError('Forbidden', 403);
    }

    await prisma.jobApplication.delete({ where: { id } });

    res.json({ success: true, message: 'Application deleted' });
  } catch (error) {
    console.error('Delete application error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete application' });
  }
});

router.post('/:id/move', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = getAuthUserId(req);
    if (!userId) {
      throw createError('Unauthorized', 401);
    }

    if (!['todo', 'applied', 'interviewing', 'offer', 'rejected'].includes(status)) {
      throw createError('Invalid status', 400);
    }

    const existing = await prisma.jobApplication.findUnique({ where: { id }, select: { userId: true } });
    if (!existing) {
      throw createError('Application not found', 404);
    }
    if (existing.userId !== userId) {
      throw createError('Forbidden', 403);
    }

    const application = await prisma.jobApplication.update({
      where: { id },
      data: { 
        status,
        applicationDate: status === 'applied' ? new Date() : undefined,
      },
    });

    await prisma.activity.create({
      data: {
        applicationId: id,
        type: 'status-change',
        description: `Moved to ${status}`,
      },
    });

    res.json({ success: true, data: application });
  } catch (error) {
    console.error('Move application error:', error);
    res.status(500).json({ success: false, error: 'Failed to move application' });
  }
});

export default router;
