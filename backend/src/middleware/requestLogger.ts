import { Request, Response, NextFunction } from 'express';
import winston from 'winston';
import { randomUUID } from 'crypto';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
  ],
});

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
   const requestId = (req.headers['x-request-id'] as string) || randomUUID();
   req.headers['x-request-id'] = requestId;

   const redactedHeaders: Record<string, unknown> = { ...req.headers };
   for (const key of Object.keys(redactedHeaders)) {
     const lowered = key.toLowerCase();
     if (
       lowered.includes('authorization') ||
       lowered.includes('api-key') ||
       lowered.includes('apikey') ||
       lowered.includes('token') ||
       lowered.includes('cookie')
     ) {
       redactedHeaders[key] = '[REDACTED]';
     }
   }

   const redactedQuery: Record<string, unknown> = { ...req.query };
   for (const key of Object.keys(redactedQuery)) {
     const lowered = key.toLowerCase();
     if (
       lowered.includes('password') ||
       lowered.includes('key') ||
       lowered.includes('token') ||
       lowered.includes('secret')
     ) {
       redactedQuery[key] = '[REDACTED]';
     }
   }

   logger.info({
     requestId,
     method: req.method,
     path: req.path,
     query: redactedQuery,
     headers: redactedHeaders,
   });
   
   // Add request ID to response headers for tracing
   res.setHeader('X-Request-ID', requestId);
   next();
 };

export default logger;
