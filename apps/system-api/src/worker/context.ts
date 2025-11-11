import type { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';

import type { AppConfig } from '../config';
import type { AppLogger } from '../lib/logger';
import type { RedisClient } from '../lib/redis';
import type { EmailService } from './email/service';

export type WorkerContext = {
  config: AppConfig;
  logger: AppLogger;
  prisma: PrismaClient;
  redis: RedisClient;
  emailService: EmailService;
  stripe: Stripe | null;
  queuePrefix: string;
};
