import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';

import type { RedisClient } from '../lib/redis';

export type IssuedRefreshToken = {
  token: string;
  tokenId: string;
  expiresAt: number;
};

const TOKEN_BYTE_LENGTH = 48;

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

function generateToken(): { token: string; tokenId: string; hash: Buffer } {
  const tokenId = randomUUID();
  const secret = randomBytes(TOKEN_BYTE_LENGTH).toString('base64url');
  const token = `${tokenId}.${secret}`;
  const hash = hashToken(token);
  return { token, tokenId, hash };
}

function buildRedisKey(userId: string, tokenId: string): string {
  return `auth:refresh:${userId}:${tokenId}`;
}

export class RefreshTokenStore {
  constructor(
    private readonly redis: RedisClient,
    private readonly ttlSeconds: number,
  ) {}

  async issue(userId: string): Promise<IssuedRefreshToken> {
    const generated = generateToken();
    const redisKey = buildRedisKey(userId, generated.tokenId);
    await this.redis.set(redisKey, generated.hash.toString('hex'), 'EX', this.ttlSeconds);

    return {
      token: generated.token,
      tokenId: generated.tokenId,
      expiresAt: Math.floor(Date.now() / 1000) + this.ttlSeconds,
    };
  }

  async verify(userId: string, token: string): Promise<{ tokenId: string } | null> {
    const parsed = this.parseToken(token);
    if (!parsed) {
      return null;
    }

    const redisKey = buildRedisKey(userId, parsed.tokenId);
    const stored = await this.redis.get(redisKey);
    if (!stored) {
      return null;
    }

    const hashed = hashToken(token);
    const storedBuffer = Buffer.from(stored, 'hex');
    if (storedBuffer.length !== hashed.length) {
      return null;
    }

    if (!timingSafeEqual(storedBuffer, hashed)) {
      return null;
    }

    return { tokenId: parsed.tokenId };
  }

  async revoke(userId: string, tokenId: string): Promise<void> {
    const redisKey = buildRedisKey(userId, tokenId);
    await this.redis.del(redisKey);
  }

  async rotate(userId: string, token: string): Promise<IssuedRefreshToken | null> {
    const verification = await this.verify(userId, token);
    if (!verification) {
      return null;
    }

    await this.revoke(userId, verification.tokenId);
    return this.issue(userId);
  }

  private parseToken(token: string): { tokenId: string } | null {
    const parts = token.split('.');
    if (parts.length < 2) {
      return null;
    }

    const [tokenId] = parts;
    if (!tokenId) {
      return null;
    }

    return { tokenId };
  }
}
