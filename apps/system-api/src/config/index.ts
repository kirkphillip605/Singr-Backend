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
  SENTRY_DSN: str({ allowEmpty: true, default: '' }),
  SENTRY_TRACES_SAMPLE_RATE: num({ default: 0.1, devDefault: 0.1 }),
  SENTRY_PROFILES_SAMPLE_RATE: num({ default: 0.0, devDefault: 0.0 }),
  CORS_ALLOWED_ORIGINS: str({ allowEmpty: true, default: '' }),
  RATE_LIMIT_DEFAULT_WINDOW_MS: num({ devDefault: 60_000, default: 60_000 }),
  RATE_LIMIT_DEFAULT_MAX: num({ devDefault: 120, default: 100 }),
  RATE_LIMIT_TRUST_PROXY: bool({ devDefault: true, default: false }),
  METRICS_ENABLED: bool({ devDefault: true, default: true }),
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
