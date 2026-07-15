import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const userStatusEnum = pgEnum('user_status', ['active', 'locked']);
export const vehicleClassEnum = pgEnum('vehicle_class', [
  'sedan',
  'suv',
  'large_suv',
  'minivan',
  'sprinter',
]);
export const driveStatusEnum = pgEnum('drive_status', [
  'open',
  'assigned',
  'picked_up',
  'completed',
  'cancelled',
]);
export const tripTypeEnum = pgEnum('trip_type', ['one_way', 'round_trip']);
export const applicationStatusEnum = pgEnum('application_status', [
  'pending',
  'accepted',
  'rejected',
  'cleared',
]);
export const balanceStatusEnum = pgEnum('balance_status', ['open', 'settled']);
export const photoKindEnum = pgEnum('photo_kind', [
  'self',
  'interior',
  'exterior',
  'payment_proof',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    phone: text('phone').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    status: userStatusEnum('status').notNull().default('active'),
    onboardingComplete: boolean('onboarding_complete').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('users_phone_uidx').on(t.phone)],
);

export const driverProfiles = pgTable('driver_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  vehicleClass: vehicleClassEnum('vehicle_class').notNull(),
  vehicleType: text('vehicle_type').notNull(),
  seats: integer('seats').notNull(),
  yearsDrivingUpstate: integer('years_driving_upstate').notNull(),
  zelle: text('zelle'),
  extraInfo: text('extra_info'),
  selfPhotoKey: text('self_photo_key'),
  vehicleInteriorKey: text('vehicle_interior_key'),
  vehicleExteriorKey: text('vehicle_exterior_key'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    familyId: uuid('family_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_hash_uidx').on(t.tokenHash),
    index('refresh_tokens_user_idx').on(t.userId),
    index('refresh_tokens_family_idx').on(t.familyId),
  ],
);

export const drives = pgTable(
  'drives',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    posterId: uuid('poster_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    routeText: text('route_text').notNull(),
    fromPlace: text('from_place'),
    toPlace: text('to_place'),
    passengerPhone: text('passenger_phone').notNull(),
    address: text('address'),
    vehicleClass: vehicleClassEnum('vehicle_class').notNull().default('sedan'),
    seats: integer('seats').notNull().default(4),
    tripType: tripTypeEnum('trip_type').notNull().default('one_way'),
    extraInfo: text('extra_info'),
    status: driveStatusEnum('status').notNull().default('open'),
    assigneeId: uuid('assignee_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    costCents: integer('cost_cents'),
    miles: numeric('miles', { precision: 8, scale: 2 }),
    waitMinutes: integer('wait_minutes'),
    completeNote: text('complete_note'),
    hiddenByPoster: boolean('hidden_by_poster').notNull().default(false),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Set when assignee requests cancel; poster must approve/deny. */
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('drives_status_created_idx').on(t.status, t.createdAt),
    index('drives_poster_idx').on(t.posterId),
    index('drives_assignee_idx').on(t.assigneeId),
    uniqueIndex('drives_one_active_assignee_uidx')
      .on(t.assigneeId)
      .where(
        sql`${t.assigneeId} IS NOT NULL AND ${t.status} IN ('assigned', 'picked_up')`,
      ),
  ],
);

export const applications = pgTable(
  'applications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    driveId: uuid('drive_id')
      .notNull()
      .references(() => drives.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lat: numeric('lat', { precision: 10, scale: 7 }),
    lng: numeric('lng', { precision: 10, scale: 7 }),
    status: applicationStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('applications_drive_driver_uidx').on(t.driveId, t.driverId),
    uniqueIndex('applications_one_accepted_uidx')
      .on(t.driveId)
      .where(sql`${t.status} = 'accepted'`),
    index('applications_drive_idx').on(t.driveId),
  ],
);

/** Owner favorited another user (dispatcher↔driver; either direction). */
export const favorites = pgTable(
  'favorites',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    favoriteUserId: uuid('favorite_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('favorites_owner_favorite_uidx').on(t.ownerId, t.favoriteUserId),
    index('favorites_owner_idx').on(t.ownerId),
    index('favorites_favorite_user_idx').on(t.favoriteUserId),
  ],
);

/**
 * Per-notification delivery mode.
 * `favorites` = only when the related user is in the recipient's favorites
 * (favorited applicant for new applications; favorited poster for new drives / accepts).
 */
export const notificationPrefModeEnum = pgEnum('notification_pref_mode', [
  'off',
  'all',
  'favorites',
]);

export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Poster: someone applied to your drive. */
  newApplication: notificationPrefModeEnum('new_application')
    .notNull()
    .default('all'),
  /** Poster: your drive status changed (picked up / completed / cancelled). */
  driveStatus: notificationPrefModeEnum('drive_status')
    .notNull()
    .default('all'),
  /** Driver: you were accepted for a drive (“you got the job”). */
  applicationAccepted: notificationPrefModeEnum('application_accepted')
    .notNull()
    .default('all'),
  /** Driver: any new drive posted to the board. */
  newDrivePosted: notificationPrefModeEnum('new_drive_posted')
    .notNull()
    .default('all'),
  /** Poster: assigned driver requested to cancel the ride. */
  cancelRequest: notificationPrefModeEnum('cancel_request')
    .notNull()
    .default('all'),
  /** Driver: poster cleared submissions on a drive you applied to. */
  applicationCleared: notificationPrefModeEnum('application_cleared')
    .notNull()
    .default('all'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const pushTokens = pgTable(
  'push_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    platform: text('platform'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('push_tokens_token_uidx').on(t.token),
    index('push_tokens_user_idx').on(t.userId),
  ],
);

export const balances = pgTable(
  'balances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    driveId: uuid('drive_id')
      .notNull()
      .references(() => drives.id, { onDelete: 'restrict' }),
    posterId: uuid('poster_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    amountCents: integer('amount_cents').notNull(),
    status: balanceStatusEnum('status').notNull().default('open'),
    dueSunday: timestamp('due_sunday', { withTimezone: true }).notNull(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    /** Optional Zelle / bank confirmation screenshot object key. */
    settlementProofKey: text('settlement_proof_key'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('balances_drive_uidx').on(t.driveId),
    index('balances_driver_status_idx').on(t.driverId, t.status),
    index('balances_poster_status_idx').on(t.posterId, t.status),
  ],
);

export const photoUploads = pgTable(
  'photo_uploads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: photoKindEnum('kind').notNull(),
    objectKey: text('object_key').notNull(),
    contentType: text('content_type').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('photo_uploads_user_idx').on(t.userId)],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    responseStatus: integer('response_status').notNull(),
    responseBody: text('response_body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('idempotency_user_key_uidx').on(t.userId, t.key),
    index('idempotency_expires_idx').on(t.expiresAt),
  ],
);

export const adminChallengeStatusEnum = pgEnum('admin_challenge_status', [
  'pending',
  'approved',
  'denied',
  'expired',
]);

export const actorTypeEnum = pgEnum('actor_type', [
  'admin',
  'system',
  'user',
]);

export const securitySeverityEnum = pgEnum('security_severity', [
  'info',
  'warn',
  'critical',
]);

export const adminLoginChallenges = pgTable(
  'admin_login_challenges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    shortCode: text('short_code').notNull(),
    status: adminChallengeStatusEnum('status').notNull().default('pending'),
    ip: text('ip').notNull(),
    userAgent: text('user_agent'),
    approvedByChatId: text('approved_by_chat_id'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    sessionTokenHash: text('session_token_hash'),
    sessionIssuedAt: timestamp('session_issued_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('admin_challenges_short_code_uidx').on(t.shortCode),
    index('admin_challenges_status_created_idx').on(t.status, t.createdAt),
  ],
);

export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tokenHash: text('token_hash').notNull(),
    challengeId: uuid('challenge_id').references(() => adminLoginChallenges.id, {
      onDelete: 'set null',
    }),
    ip: text('ip').notNull(),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('admin_sessions_token_hash_uidx').on(t.tokenHash),
    index('admin_sessions_expires_idx').on(t.expiresAt),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorType: actorTypeEnum('actor_type').notNull(),
    actorId: text('actor_id'),
    sessionId: uuid('session_id'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    requestId: text('request_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    metaJson: text('meta_json'),
  },
  (t) => [
    index('audit_events_at_idx').on(t.at),
    index('audit_events_action_idx').on(t.action),
    index('audit_events_entity_idx').on(t.entityType, t.entityId),
    index('audit_events_request_idx').on(t.requestId),
    index('audit_events_ip_idx').on(t.ip),
  ],
);

export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    name: text('name').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    anonymousId: text('anonymous_id'),
    requestId: text('request_id'),
    ip: text('ip'),
    propsJson: text('props_json'),
  },
  (t) => [
    index('analytics_events_name_at_idx').on(t.name, t.at),
    index('analytics_events_user_idx').on(t.userId),
    index('analytics_events_at_idx').on(t.at),
  ],
);

export const securityEvents = pgTable(
  'security_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    kind: text('kind').notNull(),
    severity: securitySeverityEnum('severity').notNull().default('info'),
    ip: text('ip'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    adminChallengeId: uuid('admin_challenge_id'),
    requestId: text('request_id'),
    detailJson: text('detail_json'),
  },
  (t) => [
    index('security_events_at_idx').on(t.at),
    index('security_events_kind_idx').on(t.kind),
    index('security_events_ip_idx').on(t.ip),
    index('security_events_request_idx').on(t.requestId),
  ],
);
