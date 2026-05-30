import fs from 'fs';
import path from 'path';
import pdf from 'pdf-parse';

export async function extractTextFromPDF(filePath: string): Promise<string> {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    return data.text || '';
  } catch (error) {
    console.error('PDF extraction error:', error);
    return '';
  }
}

export function validatePDF(file: Express.Multer.File): { valid: boolean; error?: string } {
  const maxSize = 5 * 1024 * 1024;
  
  if (file.mimetype !== 'application/pdf') {
    return { valid: false, error: 'Only PDF files are allowed' };
  }
  
  if (file.size > maxSize) {
    return { valid: false, error: 'File size must be less than 5MB' };
  }
  
  return { valid: true };
}

export function generateSecureFilename(originalName: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const ext = path.extname(originalName);
  return `${timestamp}-${random}${ext}`;
}