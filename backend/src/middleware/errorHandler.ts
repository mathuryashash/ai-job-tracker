import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import logger from './requestLogger';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
  details?: any;
}

export const errorHandler = (
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  let statusCode = 500;
  let message = 'Internal Server Error';
  let details = undefined;

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    statusCode = 400;
    message = 'Validation error';
    details = err.errors.map(e => ({
      path: e.path.join('.'),
      message: e.message,
    }));
  }
  // Handle Prisma unique constraint errors
  else if (err.code === 'P2002') {
    statusCode = 409;
    message = `Duplicate value for field: ${err.meta?.target?.[0] || 'unknown'}`;
  }
  // Handle Prisma not found errors
  else if (err.code === 'P2025') {
    statusCode = 404;
    message = 'Resource not found';
  }
  // Handle custom app errors
  else if (err instanceof Error && (err as AppError).statusCode) {
    const appErr = err as AppError;
    statusCode = appErr.statusCode || 500;
    message = appErr.message || message;
    details = appErr.details;
  }
  // Handle generic errors
  else if (err instanceof Error) {
    message = err.message;
  }

  logger.error({
    message,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    statusCode,
    details,
  });

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(details && { details }),
    ...(process.env.NODE_ENV === 'development' && process.env.EXPOSE_ERROR_STACKS === 'true' && { stack: err instanceof Error ? err.stack : undefined }),
  });
};

export const createError = (message: string, statusCode: number, details?: any): AppError => {
  const error: AppError = new Error(message);
  error.statusCode = statusCode;
  error.isOperational = true;
  error.details = details;
  return error;
};
