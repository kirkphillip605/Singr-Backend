import { importSPKI, jwtVerify, type KeyLike } from 'jose';

import type { AppConfig } from '../config';
import { accessTokenClaimsSchema, type AccessTokenClaims } from './types';

const JWT_ALGORITHM = 'ES256';
const JWT_AUDIENCE = 'system.singrkaraoke.com';

export class TokenVerifier {
  private readonly publicKeyPromise: Promise<KeyLike>;

  constructor(private readonly config: AppConfig) {
    this.publicKeyPromise = importSPKI(
      this.config.auth.jwtPublicKey,
      JWT_ALGORITHM,
    ) as Promise<KeyLike>;
  }

  async verify(accessToken: string): Promise<AccessTokenClaims> {
    const key = await this.publicKeyPromise;
    const { payload } = await jwtVerify(accessToken, key, {
      audience: JWT_AUDIENCE,
    });

    return accessTokenClaimsSchema.parse(payload);
  }
}
