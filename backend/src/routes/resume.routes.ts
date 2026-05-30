import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { extractTextFromPDF, validatePDF, generateSecureFilename } from '../services/resume.service';
import { parseResumeWithAI } from '../services/resume-parser.service';
import prisma from '../prisma/index';
import { addResumeAnalysisJob } from '../queues/index';
import { analyzeResume } from '../services/ai.service';
import { createError } from '../middleware/errorHandler';
import { getAuthUserId, AuthRequest } from '../middleware/auth';
import { FILE_SIZE_LIMIT } from '../config/constants';
import { hasEnoughDiskSpace } from '../utils/diskSpace';

const router = Router();

const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    cb(null, generateSecureFilename(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: FILE_SIZE_LIMIT },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      cb(createError('Only PDF files are allowed', 400));
      return;
    }
    cb(null, true);
  },
});

const analyzeSchema = z.object({
  jobDescription: z.string().optional(),
});

router.post('/upload', upload.single('resume'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      throw createError('No file uploaded', 400);
    }

    const validation = validatePDF(req.file);
    if (!validation.valid) {
      throw createError(validation.error || 'Invalid file', 400);
    }

    // Check disk space before processing upload
    const hasSpace = await hasEnoughDiskSpace(req.file.size);
    if (!hasSpace) {
      throw createError('Insufficient disk space for upload', 507); // 507 Insufficient Storage
    }

    const extractedText = await extractTextFromPDF(req.file.path);
    if (!extractedText || extractedText.trim().length < 50) {
      throw createError('Uploaded PDF has no extractable text. Please upload a text-based PDF resume.', 400);
    }
    const userId = getAuthUserId(req);
    
    if (!userId) {
      throw createError('Unauthorized', 401);
    }
    
    const resume = await prisma.resume.create({
      data: {
        userId,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        path: req.file.path,
        extractedText,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        id: resume.id,
        originalName: resume.originalName,
        createdAt: resume.createdAt,
      },
    });
  } catch (error) {
    console.error('Upload error:', error);
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: error.errors });
      return;
    }
    if (error instanceof Error && (error as any).statusCode) {
      res.status((error as any).statusCode).json({ success: false, error: error.message });
      return;
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: 'Failed to upload resume: ' + errorMessage });
  }
});

router.post('/:id/analyze', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = getAuthUserId(req);
    const { jobDescription } = req.body;

    if (!userId) {
      throw createError('Unauthorized', 401);
    }

    const resume = await prisma.resume.findUnique({ where: { id } });
    if (!resume) {
      throw createError('Resume not found', 404);
    }
    if (resume.userId !== userId) {
      throw createError('Forbidden', 403);
    }

    await addResumeAnalysisJob({
      resumeId: id,
      userId: resume.userId,
      jobDescription,
    });

    await prisma.resumeAnalysis.create({
      data: {
        resumeId: id,
        jobDescription: jobDescription || null,
        matchPercentage: 0,
        skillsRadar: {},
        missingKeywords: [],
        suggestions: [],
        status: 'processing',
      },
    });

    res.status(202).json({
      success: true,
      message: 'Analysis job queued',
    });
  } catch (error) {
    console.error('Analysis error:', error);
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: error.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to queue analysis' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = getAuthUserId(req);
    
    if (!userId) {
      throw createError('Unauthorized', 401);
    }
    
    const resume = await prisma.resume.findUnique({ 
      where: { id },
      include: { analyses: true },
    });

    if (!resume) {
      throw createError('Resume not found', 404);
    }
    if (resume.userId !== userId) {
      throw createError('Forbidden', 403);
    }

    res.json({ success: true, data: resume });
  } catch (error) {
    console.error('Get resume error:', error);
    res.status(500).json({ success: false, error: 'Failed to get resume' });
  }
});

router.get('/:id/analysis', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = getAuthUserId(req);
    
    if (!userId) {
      throw createError('Unauthorized', 401);
    }
    
    const resume = await prisma.resume.findUnique({ where: { id }, select: { userId: true } });
    if (!resume) {
      throw createError('Resume not found', 404);
    }
    if (resume.userId !== userId) {
      throw createError('Forbidden', 403);
    }

    const analyses = await prisma.resumeAnalysis.findMany({
      where: { resumeId: id },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: analyses });
  } catch (error) {
    console.error('Get analysis error:', error);
    res.status(500).json({ success: false, error: 'Failed to get analysis' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = getAuthUserId(req);
    
    if (!userId) {
      throw createError('Unauthorized', 401);
    }
    
    const resume = await prisma.resume.findUnique({ where: { id } });
    if (!resume) {
      throw createError('Resume not found', 404);
    }
    if (resume.userId !== userId) {
      throw createError('Forbidden', 403);
    }

    if (resume.path && fs.existsSync(resume.path)) {
      fs.unlinkSync(resume.path);
    }

    await prisma.resume.delete({ where: { id } });
    res.json({ success: true, message: 'Resume deleted' });
  } catch (error) {
    console.error('Delete resume error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete resume' });
  }
});

// ── POST /api/resumes/:id/parse — AI Parse Resume ──

router.post('/:id/parse', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = getAuthUserId(req);

    if (!userId) {
      throw createError('Unauthorized', 401);
    }

    const resume = await prisma.resume.findUnique({ where: { id } });
    if (!resume) {
      throw createError('Resume not found', 404);
    }
    if (resume.userId !== userId) {
      throw createError('Forbidden', 403);
    }

    // Use extracted text or extract from PDF
    const extractedText = resume.extractedText || await extractTextFromPDF(resume.path);
    if (!extractedText || extractedText.trim().length < 50) {
      throw createError('Resume has no extractable text', 400);
    }

    // Parse with AI
    const parsed = await parseResumeWithAI(extractedText);

    // Save structured data to database
    const updatedResume = await prisma.resume.update({
      where: { id },
      data: {
        extractedText, // Ensure extracted text is stored
        structuredData: parsed as any,
      },
    });

    res.json({
      success: true,
      data: {
        id: updatedResume.id,
        structuredData: parsed,
      },
    });
  } catch (error) {
    console.error('Parse error:', error);
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: error.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to parse resume' });
  }
});

export default router;
