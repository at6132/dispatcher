import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  PUBLIC_API_URL: z.string().url().optional(),
  TZ: z.string().default('America/New_York'),
  /** override pino level: debug | info | warn | error */
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  /** Log redacted request body summaries (off by default in production) */
  LOG_REQUEST_BODIES: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  /**
   * Bot token from @BotFather.
   * TELEGRAM_BOT_ID is accepted as an alias (some envs used that name).
   */
  TELEGRAM_BOT_TOKEN: z.string().min(10).optional(),
  TELEGRAM_BOT_ID: z.string().min(10).optional(),
  /** Comma/space-separated Telegram chat IDs to notify */
  TELEGRAM_CHAT_IDS: z.string().optional(),
  /** Min HTTP status that triggers a text (default 500; set 400 to include client errors) */
  TELEGRAM_ALERT_MIN_STATUS: z.coerce.number().int().default(500),
  /** Ops admin console password (Telegram /allow still required) */
  ADMIN_PASSWORD: z.string().min(4).optional(),
  /** Dedicated JWT secret for admin sessions (min 32). Falls back to JWT_ACCESS_SECRET in dev only. */
  ADMIN_JWT_SECRET: z.string().min(32).optional(),
  ADMIN_SESSION_TTL_SEC: z.coerce.number().int().positive().default(3600),
  ADMIN_CHALLENGE_TTL_SEC: z.coerce.number().int().positive().default(300),
  /** Optional PostHog project key — mirrors analytics events when set */
  POSTHOG_API_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema> & {
  s3Enabled: boolean;
  telegramEnabled: boolean;
  adminEnabled: boolean;
  adminJwtSecret: string;
};

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${msg}`);
  }
  const data = parsed.data;
  const s3Enabled = Boolean(
    data.S3_ENDPOINT &&
      data.S3_BUCKET &&
      data.S3_ACCESS_KEY_ID &&
      data.S3_SECRET_ACCESS_KEY,
  );
  const token = data.TELEGRAM_BOT_TOKEN || data.TELEGRAM_BOT_ID;
  const chats = (data.TELEGRAM_CHAT_IDS ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const telegramEnabled = Boolean(token && chats.length > 0);
  const adminEnabled = Boolean(data.ADMIN_PASSWORD);
  const adminJwtSecret =
    data.ADMIN_JWT_SECRET ??
    (data.NODE_ENV === 'production'
      ? ''
      : data.JWT_ACCESS_SECRET);
  if (adminEnabled && data.NODE_ENV === 'production' && !data.ADMIN_JWT_SECRET) {
    throw new Error(
      'Invalid environment: ADMIN_JWT_SECRET is required in production when ADMIN_PASSWORD is set',
    );
  }
  return {
    ...data,
    s3Enabled,
    telegramEnabled,
    adminEnabled,
    adminJwtSecret:
      adminJwtSecret || data.JWT_ACCESS_SECRET,
  };
}

export const env = loadEnv();
