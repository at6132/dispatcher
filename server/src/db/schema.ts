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
  'completed',
  'cancelled',
]);
export const tripTypeEnum = pgEnum('trip_type', ['one_way', 'round_trip']);
export const applicationStatusEnum = pgEnum('application_status', [
  'pending',
  'accepted',
  'rejected',
]);
export const balanceStatusEnum = pgEnum('balance_status', ['open', 'settled']);
export const photoKindEnum = pgEnum('photo_kind', [
  'self',
  'interior',
  'exterior',
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
    index('applications_drive_idx').on(t.driveId),
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
