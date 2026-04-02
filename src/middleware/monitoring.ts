import type { Request, Response } from 'express';
import { config } from '../config/env';

export const healthCheck = (req: Request, res: Response) => {
  const uptime = process.uptime();
  
  const healthData = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(uptime),
    environment: config.server.nodeEnv,
    version: '1.0.0',
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
  };

  res.status(200).json(healthData);
};