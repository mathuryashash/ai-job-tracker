import { Router, Response } from 'express';
import { z, ZodError } from 'zod';
import prisma from '../prisma/index';
import { addCoverLetterJob } from '../queues/index';
import { generateCoverLetter } from '../services/ai.service';
import { createError } from '../middleware/errorHandler';
import { getAuthUserId, AuthRequest } from '../middleware/auth';

const router = Router();

const generateSchema = z.object({
  resumeId: z.string(),
  applicationId: z.string(),
  jobDescription: z.string(),
});

router.post('/generate', async (req: AuthRequest, res: Response) => {
  try {
    const data = generateSchema.parse(req.body);
    const userId = getAuthUserId(req);
    
    if (!userId) {
      throw createError('Unauthorized', 401);
    }

    const resume = await prisma.resume.findUnique({ where: { id: data.resumeId } });
    if (!resume || !resume.extractedText) {
      throw createError('Resume not found or has no extracted text', 404);
    }
    if (resume.userId !== userId) {
      throw createError('Forbidden', 403);
    }

    const application = await prisma.jobApplication.findUnique({ 
      where: { id: data.applicationId } 
    });
    if (!application) {
      throw createError('Application not found', 404);
    }
    if (application.userId !== userId) {
      throw createError('Forbidden', 403);
    }

    await addCoverLetterJob({
      userId,
      resumeId: data.resumeId,
      applicationId: data.applicationId,
      jobDescription: data.jobDescription,
    });

    res.status(202).json({
      success: true,
      message: 'Cover letter generation job queued',
    });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Generate cover letter error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate cover letter' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = getAuthUserId(req);
    
    if (!userId) {
      throw createError('Unauthorized', 401);
    }
    
    const coverLetter = await prisma.coverLetter.findUnique({ where: { id } });

    if (!coverLetter) {
      throw createError('Cover letter not found', 404);
    }
    if (coverLetter.userId !== userId) {
      throw createError('Forbidden', 403);
    }

    res.json({ success: true, data: coverLetter });
  } catch (error) {
    console.error('Get cover letter error:', error);
    res.status(500).json({ success: false, error: 'Failed to get cover letter' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const userId = getAuthUserId(req);
    
    if (!userId) {
      throw createError('Unauthorized', 401);
    }

    const existing = await prisma.coverLetter.findUnique({ where: { id }, select: { userId: true } });
    if (!existing) {
      throw createError('Cover letter not found', 404);
    }
    if (existing.userId !== userId) {
      throw createError('Forbidden', 403);
    }

    const coverLetter = await prisma.coverLetter.update({
      where: { id },
      data: { content },
    });

    res.json({ success: true, data: coverLetter });
  } catch (error) {
    console.error('Update cover letter error:', error);
    res.status(500).json({ success: false, error: 'Failed to update cover letter' });
  }
});

export default router;
