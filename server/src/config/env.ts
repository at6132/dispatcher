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
});

export type Env = z.infer<typeof envSchema> & {
  s3Enabled: boolean;
  telegramEnabled: boolean;
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
  return { ...data, s3Enabled, telegramEnabled };
}

export const env = loadEnv();
