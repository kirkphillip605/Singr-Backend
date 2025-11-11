import { envsafe, bool, num, port, str, url } from 'envsafe';

export type AppConfig = {
  env: 'development' | 'test' | 'production';
  server: {
    port: number;
    host: string;
  };
  logging: {
    level: string;
  };
  database: {
    url: string;
  };
  redis: {
    url: string;
  };
  auth: {
    secret: string;
    jwtPrivateKey: string;
    jwtPublicKey: string;
    refreshTokenTtlSeconds: number;
  };
  storage: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    useSsl: boolean;
  };
  stripe: {
    apiKey: string | null;
    webhookSecret: string | null;
  };
  email: {
    provider: 'console' | 'smtp';
    fromAddress: string;
    fromName: string;
    logEmails: boolean;
    smtp: {
      host: string;
      port: number;
      secure: boolean;
      username: string | null;
      password: string | null;
    } | null;
  };
  sentry: {
    dsn: string | null;
    tracesSampleRate: number;
    profilesSampleRate: number;
    enabled: boolean;
  };
  cors: {
    origins: string[];
  };
  rateLimit: {
    defaultWindowMs: number;
    defaultMax: number;
    trustProxy: boolean;
  };
  metrics: {
    enabled: boolean;
  };
  cache: {
    venueListTtlSeconds: number;
    systemListTtlSeconds: number;
    apiKeyListTtlSeconds: number;
    subscriptionListTtlSeconds: number;
    brandingProfileTtlSeconds: number;
    organizationUserListTtlSeconds: number;
    songdbIngestTtlSeconds: number;
    singerProfileTtlSeconds: number;
    singerFavoritesTtlSeconds: number;
    singerHistoryTtlSeconds: number;
    publicVenueSearchTtlSeconds: number;
    publicSongSearchTtlSeconds: number;
  };
  branding: {
    uploadUrlTtlSeconds: number;
  };
  organization: {
    invitationTtlSeconds: number;
    invitationBaseUrl: string;
  };
  singer: {
    requestLimitPerSinger: number;
    requestWindowMsPerSinger: number;
    requestLimitPerVenue: number;
    requestWindowMsPerVenue: number;
  };
};

let cachedConfig: AppConfig | null = null;

const configSpec = {
  NODE_ENV: str({
    choices: ['development', 'test', 'production'] as const,
    devDefault: 'development',
  }),
  HOST: str({ default: '0.0.0.0' }),
  PORT: port({ devDefault: 3000 }),
  LOG_LEVEL: str({ devDefault: 'debug', default: 'info' }),
  DATABASE_URL: url({ devDefault: 'postgresql://singr:singr@localhost:5432/singr' }),
  REDIS_URL: str({ devDefault: 'redis://127.0.0.1:6379/0' }),
  AUTH_SECRET: str(),
  JWT_PRIVATE_KEY: str(),
  JWT_PUBLIC_KEY: str(),
  REFRESH_TOKEN_TTL_SECONDS: num({ devDefault: 60 * 60 * 24 * 7, default: 60 * 60 * 24 * 7 }),
  S3_ENDPOINT: str({ devDefault: 'http://127.0.0.1:9000' }),
  S3_ACCESS_KEY_ID: str({ devDefault: 'singr' }),
  S3_SECRET_ACCESS_KEY: str({ devDefault: 'singr-secret' }),
  S3_BUCKET: str({ devDefault: 'singr-assets' }),
  S3_USE_SSL: bool({ devDefault: false, default: true }),
  STRIPE_API_KEY: str({ allowEmpty: true, default: '' }),
  STRIPE_WEBHOOK_SECRET: str({ allowEmpty: true, default: '' }),
  EMAIL_PROVIDER: str({
    default: 'console',
    devDefault: 'console',
    choices: ['console', 'smtp'] as const,
  }),
  EMAIL_FROM_ADDRESS: str({ devDefault: 'no-reply@singr.test', default: 'no-reply@singr.test' }),
  EMAIL_FROM_NAME: str({ devDefault: 'Singr Team', default: 'Singr Team' }),
  EMAIL_LOG_MESSAGES: bool({ devDefault: true, default: false }),
  SMTP_HOST: str({ allowEmpty: true, default: '' }),
  SMTP_PORT: num({ devDefault: 587, default: 587 }),
  SMTP_SECURE: bool({ devDefault: false, default: true }),
  SMTP_USERNAME: str({ allowEmpty: true, default: '' }),
  SMTP_PASSWORD: str({ allowEmpty: true, default: '' }),
  SENTRY_DSN: str({ allowEmpty: true, default: '' }),
  SENTRY_TRACES_SAMPLE_RATE: num({ default: 0.1, devDefault: 0.1 }),
  SENTRY_PROFILES_SAMPLE_RATE: num({ default: 0.0, devDefault: 0.0 }),
  CORS_ALLOWED_ORIGINS: str({ allowEmpty: true, default: '' }),
  RATE_LIMIT_DEFAULT_WINDOW_MS: num({ devDefault: 60_000, default: 60_000 }),
  RATE_LIMIT_DEFAULT_MAX: num({ devDefault: 120, default: 100 }),
  RATE_LIMIT_TRUST_PROXY: bool({ devDefault: true, default: false }),
  METRICS_ENABLED: bool({ devDefault: true, default: true }),
  VENUES_CACHE_TTL_SECONDS: num({ devDefault: 300, default: 300 }),
  SYSTEMS_CACHE_TTL_SECONDS: num({ devDefault: 300, default: 300 }),
  API_KEYS_CACHE_TTL_SECONDS: num({ devDefault: 120, default: 120 }),
  SUBSCRIPTIONS_CACHE_TTL_SECONDS: num({ devDefault: 120, default: 120 }),
  BRANDING_CACHE_TTL_SECONDS: num({ devDefault: 600, default: 600 }),
  ORG_USERS_CACHE_TTL_SECONDS: num({ devDefault: 300, default: 300 }),
  SONGDB_CACHE_TTL_SECONDS: num({ devDefault: 60, default: 60 }),
  SINGER_PROFILE_CACHE_TTL_SECONDS: num({ devDefault: 120, default: 120 }),
  SINGER_FAVORITES_CACHE_TTL_SECONDS: num({ devDefault: 120, default: 120 }),
  SINGER_HISTORY_CACHE_TTL_SECONDS: num({ devDefault: 60, default: 60 }),
  PUBLIC_VENUES_CACHE_TTL_SECONDS: num({ devDefault: 300, default: 300 }),
  PUBLIC_SONGS_CACHE_TTL_SECONDS: num({ devDefault: 300, default: 300 }),
  BRANDING_UPLOAD_URL_TTL_SECONDS: num({ devDefault: 900, default: 900 }),
  ORG_INVITATION_TTL_SECONDS: num({ devDefault: 86_400, default: 86_400 }),
  ORG_INVITATION_BASE_URL: str({ devDefault: 'https://app.singr.test/invite', default: 'https://app.singr.test/invite' }),
  SINGER_REQUEST_LIMIT_PER_SINGER: num({ devDefault: 10, default: 10 }),
  SINGER_REQUEST_WINDOW_MS_PER_SINGER: num({ devDefault: 300_000, default: 300_000 }),
  SINGER_REQUEST_LIMIT_PER_VENUE: num({ devDefault: 30, default: 30 }),
  SINGER_REQUEST_WINDOW_MS_PER_VENUE: num({ devDefault: 300_000, default: 300_000 }),
};

function parseCorsOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const raw = envsafe(configSpec, { env });

  return {
    env: raw.NODE_ENV as AppConfig['env'],
    server: {
      port: Number(raw.PORT),
      host: raw.HOST,
    },
    logging: {
      level: raw.LOG_LEVEL,
    },
    database: {
      url: raw.DATABASE_URL,
    },
    redis: {
      url: raw.REDIS_URL,
    },
    auth: {
      secret: raw.AUTH_SECRET,
      jwtPrivateKey: raw.JWT_PRIVATE_KEY,
      jwtPublicKey: raw.JWT_PUBLIC_KEY,
      refreshTokenTtlSeconds: Number(raw.REFRESH_TOKEN_TTL_SECONDS),
    },
    storage: {
      endpoint: raw.S3_ENDPOINT,
      accessKeyId: raw.S3_ACCESS_KEY_ID,
      secretAccessKey: raw.S3_SECRET_ACCESS_KEY,
      bucket: raw.S3_BUCKET,
      useSsl: raw.S3_USE_SSL,
    },
    stripe: {
      apiKey: raw.STRIPE_API_KEY.length > 0 ? raw.STRIPE_API_KEY : null,
      webhookSecret: raw.STRIPE_WEBHOOK_SECRET.length > 0 ? raw.STRIPE_WEBHOOK_SECRET : null,
    },
    email: {
      provider: raw.EMAIL_PROVIDER as AppConfig['email']['provider'],
      fromAddress: raw.EMAIL_FROM_ADDRESS,
      fromName: raw.EMAIL_FROM_NAME,
      logEmails: raw.EMAIL_LOG_MESSAGES,
      smtp:
        raw.EMAIL_PROVIDER === 'smtp'
          ? {
              host: raw.SMTP_HOST,
              port: Number(raw.SMTP_PORT),
              secure: raw.SMTP_SECURE,
              username: raw.SMTP_USERNAME.length > 0 ? raw.SMTP_USERNAME : null,
              password: raw.SMTP_PASSWORD.length > 0 ? raw.SMTP_PASSWORD : null,
            }
          : null,
    },
    sentry: {
      dsn: raw.SENTRY_DSN.length > 0 ? raw.SENTRY_DSN : null,
      tracesSampleRate: Number(raw.SENTRY_TRACES_SAMPLE_RATE),
      profilesSampleRate: Number(raw.SENTRY_PROFILES_SAMPLE_RATE),
      enabled: raw.SENTRY_DSN.length > 0,
    },
    cors: {
      origins: parseCorsOrigins(raw.CORS_ALLOWED_ORIGINS),
    },
    rateLimit: {
      defaultWindowMs: Number(raw.RATE_LIMIT_DEFAULT_WINDOW_MS),
      defaultMax: Number(raw.RATE_LIMIT_DEFAULT_MAX),
      trustProxy: raw.RATE_LIMIT_TRUST_PROXY,
    },
    metrics: {
      enabled: raw.METRICS_ENABLED,
    },
    cache: {
      venueListTtlSeconds: Number(raw.VENUES_CACHE_TTL_SECONDS),
      systemListTtlSeconds: Number(raw.SYSTEMS_CACHE_TTL_SECONDS),
      apiKeyListTtlSeconds: Number(raw.API_KEYS_CACHE_TTL_SECONDS),
      subscriptionListTtlSeconds: Number(raw.SUBSCRIPTIONS_CACHE_TTL_SECONDS),
      brandingProfileTtlSeconds: Number(raw.BRANDING_CACHE_TTL_SECONDS),
      organizationUserListTtlSeconds: Number(raw.ORG_USERS_CACHE_TTL_SECONDS),
      songdbIngestTtlSeconds: Number(raw.SONGDB_CACHE_TTL_SECONDS),
      singerProfileTtlSeconds: Number(raw.SINGER_PROFILE_CACHE_TTL_SECONDS),
      singerFavoritesTtlSeconds: Number(raw.SINGER_FAVORITES_CACHE_TTL_SECONDS),
      singerHistoryTtlSeconds: Number(raw.SINGER_HISTORY_CACHE_TTL_SECONDS),
      publicVenueSearchTtlSeconds: Number(raw.PUBLIC_VENUES_CACHE_TTL_SECONDS),
      publicSongSearchTtlSeconds: Number(raw.PUBLIC_SONGS_CACHE_TTL_SECONDS),
    },
    branding: {
      uploadUrlTtlSeconds: Number(raw.BRANDING_UPLOAD_URL_TTL_SECONDS),
    },
    organization: {
      invitationTtlSeconds: Number(raw.ORG_INVITATION_TTL_SECONDS),
      invitationBaseUrl: raw.ORG_INVITATION_BASE_URL,
    },
    singer: {
      requestLimitPerSinger: Number(raw.SINGER_REQUEST_LIMIT_PER_SINGER),
      requestWindowMsPerSinger: Number(raw.SINGER_REQUEST_WINDOW_MS_PER_SINGER),
      requestLimitPerVenue: Number(raw.SINGER_REQUEST_LIMIT_PER_VENUE),
      requestWindowMsPerVenue: Number(raw.SINGER_REQUEST_WINDOW_MS_PER_VENUE),
    },
  };
}

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }

  return cachedConfig;
}

export function resetConfigCache() {
  cachedConfig = null;
}
