# Singr Centralized API Backend Plan

## 1. Architecture Overview
- **Core principles**: Twelve-factor, stateless, horizontally scalable REST API deployed behind load balancers. Single codebase delivering API-only service (no UI assets). Strict separation between request handling, domain services, persistence, and infrastructure adapters.
- **Technology stack**: Node.js (LTS), TypeScript, Fastify (primary HTTP server for performance and ecosystem), Zod for validation, Prisma ORM, PostgreSQL + PostGIS, Redis (cache, rate limiting, BullMQ queues), Auth.js/NextAuth (JWT), S3-compatible storage (GCS), Sentry for observability.
- **Layering**:
  - **Interface Layer**: Fastify routes grouped by module (`auth`, `customer`, `singer`, `admin`, `public`, `openkj`). Shared request lifecycle middleware for correlation IDs, auth extraction, rate limiting, CORS, secure headers.
  - **Application Services**: Encapsulate use cases per bounded context (e.g., `CustomerVenueService`, `SingerRequestService`). Handle DTO ↔ domain translation, orchestrate transactions, call infra services.
  - **Domain Models**: Type-safe entities/value objects, policy checks, permission guards. House RBAC evaluation utilities, rate limit rule definitions, audit event producers.
  - **Infrastructure**: Prisma repositories, Redis clients, BullMQ queues, S3 storage adapter, Stripe SDK integration, email provider, PostGIS helpers, Sentry instrumentation, audit logging triggers.
  - **Shared packages**: Config loader, logger (pino JSON), HTTP error catalogue (Problem+JSON), utilities (Argon2 password hashing, JWT sign/verify, caching wrappers).
- **Service decomposition**:
  - **API service**: Handles all HTTP traffic. Exposes health endpoints. Interacts with Redis, PostgreSQL, S3.
  - **Worker service**: Separate BullMQ worker container for async tasks (emails, webhooks, indexing). Shares Prisma client and config.
  - **Migrations & Prisma**: Managed via dedicated `prisma migrate` invocation. DDL below is authoritative baseline.
- **Extensibility**: Reserve module boundaries to add GraphQL/tRPC gateway later (dedicated adapter). Domain services remain transport-agnostic.

## 2. PostgreSQL DDL (authoritative baseline)
```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_audit()
RETURNS trigger AS $$
DECLARE
  v_old JSONB;
  v_new JSONB;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    v_old = TO_JSONB(OLD);
    v_new = NULL;
  ELSIF (TG_OP = 'UPDATE') THEN
    v_old = TO_JSONB(OLD);
    v_new = TO_JSONB(NEW);
  ELSE
    v_old = NULL;
    v_new = TO_JSONB(NEW);
  END IF;

  INSERT INTO audit_logs (
    audit_logs_id,
    table_name,
    record_id,
    user_id,
    operation,
    old_data,
    new_data
  ) VALUES (
    GEN_RANDOM_UUID(),
    TG_TABLE_NAME,
    COALESCE(NEW.id::TEXT, NEW.*::JSONB ->> 'id', OLD.id::TEXT, OLD.*::JSONB ->> 'id'),
    COALESCE(current_setting('app.current_user_id', true), NULL),
    TG_OP,
    v_old,
    v_new
  );

  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TYPE branding_owner_type AS ENUM ('platform', 'customer');
CREATE TYPE branding_status AS ENUM ('active', 'suspended', 'revoked');
CREATE TYPE organization_user_status AS ENUM ('invited', 'active', 'suspended', 'revoked');
CREATE TYPE api_key_status AS ENUM ('active', 'revoked', 'expired', 'suspended');

CREATE TABLE users (
  users_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  password_algo TEXT,
  name TEXT,
  display_name TEXT,
  phone_number TEXT,
  image_url TEXT,
  is_email_verified BOOLEAN DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE roles (
  roles_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE permissions (
  permissions_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE role_permissions (
  role_permissions_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roles_id UUID NOT NULL REFERENCES roles(roles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  permissions_id UUID NOT NULL REFERENCES permissions(permissions_id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX ux_role_permissions_role_permission ON role_permissions (roles_id, permissions_id);

CREATE TABLE user_roles (
  user_roles_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  users_id UUID NOT NULL REFERENCES users(users_id) ON DELETE CASCADE ON UPDATE CASCADE,
  roles_id UUID NOT NULL REFERENCES roles(roles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX ux_user_roles_user_role ON user_roles (users_id, roles_id);

CREATE TABLE customer_profiles (
  customer_profiles_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  users_id UUID NOT NULL UNIQUE REFERENCES users(users_id) ON DELETE CASCADE ON UPDATE CASCADE,
  legal_business_name TEXT,
  dba_name TEXT,
  stripe_customer_id TEXT UNIQUE,
  contact_email TEXT,
  contact_phone TEXT,
  timezone TEXT DEFAULT 'UTC',
  billing_address JSONB,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE singer_profiles (
  singer_profiles_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  users_id UUID NOT NULL UNIQUE REFERENCES users(users_id) ON DELETE CASCADE ON UPDATE CASCADE,
  nickname TEXT,
  avatar_url TEXT,
  preferences JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE organization_users (
  organization_users_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profiles_id UUID NOT NULL REFERENCES customer_profiles(customer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  users_id UUID NOT NULL REFERENCES users(users_id) ON DELETE CASCADE ON UPDATE CASCADE,
  invited_by_user_id UUID REFERENCES users(users_id) ON DELETE SET NULL ON UPDATE CASCADE,
  role_id UUID REFERENCES roles(roles_id) ON DELETE SET NULL ON UPDATE CASCADE,
  status organization_user_status NOT NULL DEFAULT 'invited',
  invitation_token TEXT,
  invitation_expires_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_profiles_id, users_id)
);

CREATE TABLE organization_user_permissions (
  organization_user_permissions_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_users_id UUID NOT NULL REFERENCES organization_users(organization_users_id) ON DELETE CASCADE ON UPDATE CASCADE,
  permissions_id UUID NOT NULL REFERENCES permissions(permissions_id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX ux_org_user_permissions ON organization_user_permissions (organization_users_id, permissions_id);

CREATE TABLE accounts (
  accounts_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  users_id UUID NOT NULL REFERENCES users(users_id) ON DELETE CASCADE ON UPDATE CASCADE,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  type TEXT NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at BIGINT,
  token_type TEXT,
  scope TEXT,
  id_token TEXT,
  session_state TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_account_id)
);

CREATE TABLE sessions (
  sessions_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  users_id UUID NOT NULL REFERENCES users(users_id) ON DELETE CASCADE ON UPDATE CASCADE,
  session_token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE verification_tokens (
  identifier TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (identifier, token)
);

CREATE INDEX idx_verification_tokens_expires ON verification_tokens (expires_at);

CREATE TABLE customers (
  customers_id UUID PRIMARY KEY,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  customer_profiles_id UUID NOT NULL REFERENCES customer_profiles(customer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  email TEXT,
  name TEXT,
  phone TEXT,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  invoice_settings JSONB NOT NULL DEFAULT '{}'::JSONB,
  shipping JSONB NOT NULL DEFAULT '{}'::JSONB,
  tax_exempt TEXT,
  tax_ids JSONB NOT NULL DEFAULT '[]'::JSONB,
  livemode BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE api_keys (
  api_keys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profiles_id UUID NOT NULL REFERENCES customer_profiles(customer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  customers_id UUID REFERENCES customers(customers_id) ON DELETE SET NULL ON UPDATE CASCADE,
  created_by_users_id UUID REFERENCES users(users_id) ON DELETE SET NULL ON UPDATE CASCADE,
  description TEXT,
  api_key_hash TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  status api_key_status NOT NULL DEFAULT 'active',
  revoked_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_customer_profile ON api_keys (customer_profiles_id);
CREATE INDEX idx_api_keys_customer ON api_keys (customers_id);

CREATE TABLE stripe_checkout_sessions (
  stripe_checkout_sessions_id TEXT PRIMARY KEY,
  customers_id UUID NOT NULL REFERENCES customers(customers_id) ON DELETE CASCADE ON UPDATE CASCADE,
  payment_status TEXT NOT NULL,
  mode TEXT NOT NULL,
  amount_total BIGINT,
  currency TEXT NOT NULL,
  url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE products (
  products_id TEXT PRIMARY KEY,
  name TEXT,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  images TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  livemode BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE prices (
  prices_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(products_id) ON DELETE CASCADE ON UPDATE CASCADE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  currency CHAR(3) NOT NULL,
  type TEXT NOT NULL,
  recurring JSONB,
  unit_amount BIGINT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  livemode BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prices_product ON prices (product_id);
CREATE INDEX idx_prices_active ON prices (active);

CREATE TABLE subscriptions (
  subscriptions_id TEXT PRIMARY KEY,
  customer_profiles_id UUID NOT NULL REFERENCES customer_profiles(customer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  status TEXT NOT NULL,
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  cancel_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  livemode BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_customer_profile ON subscriptions (customer_profiles_id);
CREATE INDEX idx_subscriptions_status ON subscriptions (status);

CREATE TABLE stripe_webhook_events (
  stripe_webhook_events_id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  livemode BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT,
  request_id TEXT,
  endpoint_secret TEXT
);

CREATE TABLE state (
  customer_profiles_id UUID PRIMARY KEY REFERENCES customer_profiles(customer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  serial BIGINT NOT NULL DEFAULT 1
);

CREATE TABLE venues (
  venues_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profiles_id UUID NOT NULL REFERENCES customer_profiles(customer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  openkj_venue_id INTEGER NOT NULL,
  url_name TEXT NOT NULL UNIQUE,
  accepting_requests BOOLEAN NOT NULL DEFAULT TRUE,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  country TEXT,
  phone_number TEXT,
  website TEXT,
  location geography(Point, 4326),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_profiles_id, openkj_venue_id)
);

CREATE INDEX idx_venues_customer_profile ON venues (customer_profiles_id);
CREATE INDEX idx_venues_location ON venues USING GIST (location);

CREATE TABLE systems (
  systems_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profiles_id UUID NOT NULL REFERENCES customer_profiles(customer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  openkj_system_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  configuration JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_profiles_id, openkj_system_id)
);

CREATE INDEX idx_systems_customer_profile ON systems (customer_profiles_id);

CREATE TABLE songdb (
  songdb_id BIGSERIAL PRIMARY KEY,
  customer_profiles_id UUID NOT NULL REFERENCES customer_profiles(customer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  openkj_system_id INTEGER NOT NULL,
  artist TEXT NOT NULL,
  title TEXT NOT NULL,
  combined TEXT NOT NULL,
  normalized_combined TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_profiles_id, openkj_system_id, combined),
  UNIQUE (customer_profiles_id, openkj_system_id, normalized_combined)
);

CREATE INDEX idx_songdb_customer_system_artist ON songdb (customer_profiles_id, openkj_system_id, artist);

CREATE TABLE requests (
  requests_id BIGSERIAL PRIMARY KEY,
  venues_id UUID NOT NULL REFERENCES venues(venues_id) ON DELETE CASCADE ON UPDATE CASCADE,
  singer_profiles_id UUID REFERENCES singer_profiles(singer_profiles_id) ON DELETE SET NULL ON UPDATE CASCADE,
  submitted_by_users_id UUID REFERENCES users(users_id) ON DELETE SET NULL ON UPDATE CASCADE,
  artist TEXT NOT NULL,
  title TEXT NOT NULL,
  key_change INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_requests_venue_processed ON requests (venues_id, processed);

CREATE TABLE singer_favorite_songs (
  singer_favorite_songs_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  singer_profiles_id UUID NOT NULL REFERENCES singer_profiles(singer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  artist TEXT,
  title TEXT,
  key_change INTEGER NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (singer_profiles_id, artist, title, key_change)
);

CREATE TABLE singer_request_history (
  singer_request_history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  singer_profiles_id UUID NOT NULL REFERENCES singer_profiles(singer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  venues_id UUID NOT NULL REFERENCES venues(venues_id) ON DELETE CASCADE ON UPDATE CASCADE,
  artist TEXT NOT NULL,
  title TEXT NOT NULL,
  key_change INTEGER NOT NULL DEFAULT 0,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  song_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_singer_request_history_profile ON singer_request_history (singer_profiles_id, requested_at DESC);

CREATE TABLE singer_favorite_venues (
  singer_profiles_id UUID NOT NULL REFERENCES singer_profiles(singer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  venues_id UUID NOT NULL REFERENCES venues(venues_id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (singer_profiles_id, venues_id)
);

CREATE TABLE branding_profiles (
  branding_profiles_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type branding_owner_type NOT NULL,
  owner_id UUID,
  name TEXT NOT NULL,
  logo_url TEXT,
  color_palette JSONB NOT NULL DEFAULT '{}'::JSONB,
  powered_by_singr BOOLEAN NOT NULL DEFAULT TRUE,
  domain TEXT,
  app_bundle_id TEXT,
  app_package_name TEXT,
  status branding_status NOT NULL DEFAULT 'active',
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_type, owner_id, name)
);

CREATE TABLE branded_apps (
  branded_apps_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profiles_id UUID NOT NULL REFERENCES customer_profiles(customer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  branding_profiles_id UUID NOT NULL REFERENCES branding_profiles(branding_profiles_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  bundle_identifier TEXT,
  status branding_status NOT NULL DEFAULT 'active',
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  rate_limit_override JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE branded_app_api_keys (
  branded_app_api_keys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branded_apps_id UUID NOT NULL REFERENCES branded_apps(branded_apps_id) ON DELETE CASCADE ON UPDATE CASCADE,
  api_key_hash TEXT NOT NULL,
  description TEXT,
  last_used_at TIMESTAMPTZ,
  status branding_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (branded_apps_id, api_key_hash)
);

CREATE TABLE audit_logs (
  audit_logs_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_id TEXT,
  user_id UUID,
  operation TEXT NOT NULL,
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_table_record ON audit_logs (table_name, record_id);
CREATE INDEX idx_audit_logs_user_created_at ON audit_logs (user_id, created_at DESC);

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN (
    'users','roles','permissions','role_permissions','user_roles','customer_profiles','singer_profiles',
    'organization_users','organization_user_permissions','accounts','sessions','verification_tokens','customers',
    'api_keys','stripe_checkout_sessions','products','prices','subscriptions','stripe_webhook_events','state','venues',
    'systems','songdb','requests','singer_favorite_songs','singer_request_history','singer_favorite_venues',
    'branding_profiles','branded_apps','branded_app_api_keys'
  ) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_set_updated_at ON %I;', r.tablename || '_set_updated_at', r.tablename);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at();', r.tablename || '_set_updated_at', r.tablename);

    IF r.tablename <> 'audit_logs' THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I_audit ON %I;', r.tablename || '_audit', r.tablename);
      EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION record_audit();', r.tablename || '_audit', r.tablename);
    END IF;
  END LOOP;
END;
$$;
```

## 3. Prisma Schema (mirrors DDL)
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum BrandingOwnerType {
  platform
  customer

  @@map("branding_owner_type")
}

enum BrandingStatus {
  active
  suspended
  revoked

  @@map("branding_status")
}

enum OrganizationUserStatus {
  invited
  active
  suspended
  revoked

  @@map("organization_user_status")
}

enum ApiKeyStatus {
  active
  revoked
  expired
  suspended

  @@map("api_key_status")
}

model User {
  id              String      @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("users_id")
  email           String      @unique
  passwordHash    String?     @map("password_hash")
  passwordAlgo    String?     @map("password_algo")
  name            String?
  displayName     String?     @map("display_name")
  phoneNumber     String?     @map("phone_number")
  imageUrl        String?     @map("image_url")
  isEmailVerified Boolean     @default(false) @map("is_email_verified")
  lastLoginAt     DateTime?   @map("last_login_at") @db.Timestamptz(6)
  createdAt       DateTime    @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime    @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  customerProfile      CustomerProfile?
  singerProfile        SingerProfile?
  accounts             Account[]
  sessions             Session[]
  userRoles            UserRole[]
  organizationUsers    OrganizationUser[] @relation("OrganizationUserUser")
  organizationInvites  OrganizationUser[] @relation("OrganizationUserInvitedBy")
  apiKeys              ApiKey[]           @relation("ApiKeyCreatedBy")
  requests             Request[]          @relation("RequestSubmittedBy")

  @@map("users")
}

model Role {
  id              String           @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("roles_id")
  slug            String           @unique
  description     String?
  isSystem        Boolean          @default(false) @map("is_system")
  createdAt       DateTime         @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime         @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  rolePermissions RolePermission[]
  userRoles       UserRole[]
  organizationUsers OrganizationUser[]

  @@map("roles")
}

model Permission {
  id          String            @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("permissions_id")
  slug        String            @unique
  description String?
  createdAt   DateTime          @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime          @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  rolePermissions            RolePermission[]
  organizationUserPermissions OrganizationUserPermission[]

  @@map("permissions")
}

model RolePermission {
  id           String     @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("role_permissions_id")
  roleId       String     @map("roles_id") @db.Uuid
  permissionId String     @map("permissions_id") @db.Uuid
  createdAt    DateTime   @default(now()) @map("created_at") @db.Timestamptz(6)

  role       Role       @relation(fields: [roleId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  permission Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@unique([roleId, permissionId], map: "ux_role_permissions_role_permission")
  @@map("role_permissions")
}

model UserRole {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("user_roles_id")
  userId    String   @map("users_id") @db.Uuid
  roleId    String   @map("roles_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  role Role @relation(fields: [roleId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@unique([userId, roleId], map: "ux_user_roles_user_role")
  @@map("user_roles")
}

model CustomerProfile {
  id                String      @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("customer_profiles_id")
  userId            String      @unique @map("users_id") @db.Uuid
  legalBusinessName String?     @map("legal_business_name")
  dbaName           String?     @map("dba_name")
  stripeCustomerId  String?     @map("stripe_customer_id")
  contactEmail      String?     @map("contact_email")
  contactPhone      String?     @map("contact_phone")
  timezone          String?     @default("UTC")
  billingAddress    Json?       @map("billing_address")
  metadata          Json?       @default("{}")
  createdAt         DateTime    @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime    @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  user               User                    @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  customers          Customer[]
  apiKeys            ApiKey[]
  state              State?
  venues             Venue[]
  systems            System[]
  songdb             SongDb[]
  subscriptions      Subscription[]
  organizationUsers  OrganizationUser[]
  brandedApps        BrandedApp[]

  @@map("customer_profiles")
}

model SingerProfile {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("singer_profiles_id")
  userId      String   @unique @map("users_id") @db.Uuid
  nickname    String?
  avatarUrl   String?  @map("avatar_url")
  preferences Json?    @default("{}")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  user            User                 @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  favoriteSongs   SingerFavoriteSong[]
  favoriteVenues  SingerFavoriteVenue[]
  requestHistory  SingerRequestHistory[]
  requests        Request[]

  @@map("singer_profiles")
}

model OrganizationUser {
  id                 String                 @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("organization_users_id")
  customerProfileId  String                 @map("customer_profiles_id") @db.Uuid
  userId             String                 @map("users_id") @db.Uuid
  invitedByUserId    String?                @map("invited_by_user_id") @db.Uuid
  roleId             String?                @map("role_id") @db.Uuid
  status             OrganizationUserStatus @default(invited)
  invitationToken    String?                @map("invitation_token")
  invitationExpiresAt DateTime?             @map("invitation_expires_at") @db.Timestamptz(6)
  lastAccessedAt     DateTime?              @map("last_accessed_at") @db.Timestamptz(6)
  createdAt          DateTime               @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt          DateTime               @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  customerProfile CustomerProfile @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  user            User            @relation("OrganizationUserUser", fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  invitedBy       User?           @relation("OrganizationUserInvitedBy", fields: [invitedByUserId], references: [id], onDelete: SetNull, onUpdate: Cascade)
  role            Role?           @relation(fields: [roleId], references: [id], onDelete: SetNull, onUpdate: Cascade)
  permissions     OrganizationUserPermission[]

  @@unique([customerProfileId, userId], map: "organization_users_customer_profiles_id_users_id_key")
  @@map("organization_users")
}

model OrganizationUserPermission {
  id                  String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("organization_user_permissions_id")
  organizationUserId  String   @map("organization_users_id") @db.Uuid
  permissionId        String   @map("permissions_id") @db.Uuid
  createdAt           DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  organizationUser OrganizationUser @relation(fields: [organizationUserId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  permission       Permission       @relation(fields: [permissionId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@unique([organizationUserId, permissionId], map: "ux_org_user_permissions")
  @@map("organization_user_permissions")
}

model Account {
  id                String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("accounts_id")
  userId            String   @map("users_id") @db.Uuid
  provider          String
  providerAccountId String   @map("provider_account_id")
  type              String
  refreshToken      String?  @map("refresh_token")
  accessToken       String?  @map("access_token")
  expiresAt         BigInt?  @map("expires_at")
  tokenType         String?  @map("token_type")
  scope             String?
  idToken           String?  @map("id_token")
  sessionState      String?  @map("session_state")
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@unique([provider, providerAccountId])
  @@map("accounts")
}

model Session {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("sessions_id")
  userId       String   @map("users_id") @db.Uuid
  sessionToken String   @unique @map("session_token")
  expiresAt    DateTime @map("expires_at") @db.Timestamptz(6)
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@map("sessions")
}

model VerificationToken {
  identifier String
  token      String
  expiresAt  DateTime @map("expires_at") @db.Timestamptz(6)
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt  DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@id([identifier, token])
  @@index([expiresAt], map: "idx_verification_tokens_expires")
  @@map("verification_tokens")
}

model Customer {
  id                String    @id @db.Uuid @map("customers_id")
  stripeCustomerId  String    @map("stripe_customer_id")
  customerProfileId String    @map("customer_profiles_id") @db.Uuid
  email             String?
  name              String?
  phone             String?
  description       String?
  metadata          Json      @default("{}")
  invoiceSettings   Json      @map("invoice_settings") @default("{}")
  shipping          Json      @default("{}")
  taxExempt         String?   @map("tax_exempt")
  taxIds            Json      @map("tax_ids") @default("[]")
  livemode          Boolean   @default(false)
  createdAt         DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  customerProfile CustomerProfile @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  apiKeys         ApiKey[]
  checkoutSessions StripeCheckoutSession[]

  @@map("customers")
}

model ApiKey {
  id                String       @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("api_keys_id")
  customerProfileId String       @map("customer_profiles_id") @db.Uuid
  customerId        String?      @map("customers_id") @db.Uuid
  createdByUserId   String?      @map("created_by_users_id") @db.Uuid
  description       String?
  apiKeyHash        String       @map("api_key_hash")
  lastUsedAt        DateTime?    @map("last_used_at") @db.Timestamptz(6)
  status            ApiKeyStatus @default(active)
  revokedAt         DateTime?    @map("revoked_at") @db.Timestamptz(6)
  metadata          Json?        @default("{}")
  createdAt         DateTime     @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime     @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  customerProfile CustomerProfile @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  customer        Customer?        @relation(fields: [customerId], references: [id], onDelete: SetNull, onUpdate: Cascade)
  createdBy       User?            @relation("ApiKeyCreatedBy", fields: [createdByUserId], references: [id], onDelete: SetNull, onUpdate: Cascade)

  @@index([customerProfileId], map: "idx_api_keys_customer_profile")
  @@index([customerId], map: "idx_api_keys_customer")
  @@map("api_keys")
}

model StripeCheckoutSession {
  id            String   @id @map("stripe_checkout_sessions_id")
  customerId    String   @map("customers_id") @db.Uuid
  paymentStatus String   @map("payment_status")
  mode          String
  amountTotal   BigInt?  @map("amount_total")
  currency      String
  url           String?
  metadata      Json      @default("{}")
  completedAt   DateTime? @map("completed_at") @db.Timestamptz(6)
  expiresAt     DateTime? @map("expires_at") @db.Timestamptz(6)
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@map("stripe_checkout_sessions")
}

model StripeProduct {
  id          String   @id @map("products_id")
  name        String?
  description String?
  active      Boolean  @default(true)
  metadata    Json     @default("{}")
  images      String[] @default([])
  livemode    Boolean  @default(false)
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  prices StripePrice[]

  @@map("products")
}

model StripePrice {
  id         String       @id @map("prices_id")
  productId  String       @map("product_id")
  active     Boolean      @default(true)
  currency   String       @db.Char(3)
  type       String
  recurring  Json?
  unitAmount BigInt?      @map("unit_amount")
  metadata   Json         @default("{}")
  livemode   Boolean      @default(false)
  createdAt  DateTime     @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt  DateTime     @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  product StripeProduct @relation(fields: [productId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@index([productId], map: "idx_prices_product")
  @@index([active], map: "idx_prices_active")
  @@map("prices")
}

model Subscription {
  id                 String   @id @map("subscriptions_id")
  customerProfileId  String   @map("customer_profiles_id") @db.Uuid
  status             String
  currentPeriodStart DateTime @map("current_period_start") @db.Timestamptz(6)
  currentPeriodEnd   DateTime @map("current_period_end") @db.Timestamptz(6)
  cancelAtPeriodEnd  Boolean  @default(false) @map("cancel_at_period_end")
  cancelAt           DateTime? @map("cancel_at") @db.Timestamptz(6)
  canceledAt         DateTime? @map("canceled_at") @db.Timestamptz(6)
  metadata           Json     @default("{}")
  livemode           Boolean  @default(false)
  createdAt          DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt          DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  customerProfile CustomerProfile @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@index([customerProfileId], map: "idx_subscriptions_customer_profile")
  @@index([status], map: "idx_subscriptions_status")
  @@map("subscriptions")
}

model StripeWebhookEvent {
  id             Int      @id @default(autoincrement()) @map("stripe_webhook_events_id")
  eventId        String   @unique @map("event_id")
  eventType      String   @map("event_type")
  payload        Json
  processed      Boolean  @default(false)
  processedAt    DateTime? @map("processed_at") @db.Timestamptz(6)
  receivedAt     DateTime @default(now()) @map("received_at") @db.Timestamptz(6)
  livemode       Boolean  @default(false)
  errorMessage   String?  @map("error_message")
  requestId      String?  @map("request_id")
  endpointSecret String?  @map("endpoint_secret")

  @@map("stripe_webhook_events")
}

model State {
  customerProfileId String @id @map("customer_profiles_id") @db.Uuid
  serial            BigInt @default(1)

  customerProfile CustomerProfile @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@map("state")
}

model Venue {
  id                String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("venues_id")
  customerProfileId String   @map("customer_profiles_id") @db.Uuid
  openkjVenueId     Int      @map("openkj_venue_id")
  urlName           String   @unique @map("url_name")
  acceptingRequests Boolean  @default(true) @map("accepting_requests")
  name              String
  address           String
  city              String
  state             String
  postalCode        String   @map("postal_code")
  country           String?
  phoneNumber       String?  @map("phone_number")
  website           String?
  location          Unsupported("geography(Point,4326)")
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  customerProfile CustomerProfile @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  requests        Request[]
  favoriteVenues  SingerFavoriteVenue[]
  requestHistory  SingerRequestHistory[]

  @@unique([customerProfileId, openkjVenueId], map: "venues_customer_profiles_id_openkj_venue_id_key")
  @@index([customerProfileId], map: "idx_venues_customer_profile")
  @@map("venues")
}

model System {
  id                String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("systems_id")
  customerProfileId String   @map("customer_profiles_id") @db.Uuid
  openkjSystemId    Int      @map("openkj_system_id")
  name              String
  configuration     Json?    @default("{}")
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  customerProfile CustomerProfile @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@unique([customerProfileId, openkjSystemId], map: "systems_customer_profiles_id_openkj_system_id_key")
  @@index([customerProfileId], map: "idx_systems_customer_profile")
  @@map("systems")
}

model SongDb {
  id                 BigInt  @id @default(autoincrement()) @map("songdb_id")
  customerProfileId  String  @map("customer_profiles_id") @db.Uuid
  openkjSystemId     Int     @map("openkj_system_id")
  artist             String
  title              String
  combined           String
  normalizedCombined String  @map("normalized_combined")
  createdAt          DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt          DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  customerProfile CustomerProfile @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@unique([customerProfileId, openkjSystemId, combined], map: "songdb_customer_profiles_id_openkj_system_id_combined_key")
  @@unique([customerProfileId, openkjSystemId, normalizedCombined], map: "songdb_customer_profiles_id_openkj_system_id_normalized_combined_key")
  @@index([customerProfileId, openkjSystemId, artist], map: "idx_songdb_customer_system_artist")
  @@map("songdb")
}

model Request {
  id                BigInt     @id @default(autoincrement()) @map("requests_id")
  venueId           String     @map("venues_id") @db.Uuid
  singerProfileId   String?    @map("singer_profiles_id") @db.Uuid
  submittedByUserId String?    @map("submitted_by_users_id") @db.Uuid
  artist            String
  title             String
  keyChange         Int        @default(0) @map("key_change")
  notes             String?
  processed         Boolean    @default(false)
  requestedAt       DateTime   @default(now()) @map("requested_at") @db.Timestamptz(6)
  processedAt       DateTime?  @map("processed_at") @db.Timestamptz(6)
  createdAt         DateTime   @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime   @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  venue         Venue         @relation(fields: [venueId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  singerProfile SingerProfile? @relation(fields: [singerProfileId], references: [id], onDelete: SetNull, onUpdate: Cascade)
  submittedBy   User?          @relation("RequestSubmittedBy", fields: [submittedByUserId], references: [id], onDelete: SetNull, onUpdate: Cascade)

  @@index([venueId, processed], map: "idx_requests_venue_processed")
  @@map("requests")
}

model SingerFavoriteSong {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("singer_favorite_songs_id")
  singerProfileId String   @map("singer_profiles_id") @db.Uuid
  artist          String?
  title           String?
  keyChange       Int      @default(0) @map("key_change")
  metadata        Json?    @default("{}")
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  singerProfile SingerProfile @relation(fields: [singerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@unique([singerProfileId, artist, title, keyChange])
  @@map("singer_favorite_songs")
}

model SingerRequestHistory {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("singer_request_history_id")
  singerProfileId String   @map("singer_profiles_id") @db.Uuid
  venueId         String   @map("venues_id") @db.Uuid
  artist          String
  title           String
  keyChange       Int      @default(0) @map("key_change")
  requestedAt     DateTime @default(now()) @map("requested_at") @db.Timestamptz(6)
  songFingerprint String   @map("song_fingerprint")
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  singerProfile SingerProfile @relation(fields: [singerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  venue         Venue         @relation(fields: [venueId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@index([singerProfileId, requestedAt], map: "idx_singer_request_history_profile")
  @@map("singer_request_history")
}

model SingerFavoriteVenue {
  singerProfileId String   @map("singer_profiles_id") @db.Uuid
  venueId         String   @map("venues_id") @db.Uuid
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  singerProfile SingerProfile @relation(fields: [singerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  venue         Venue         @relation(fields: [venueId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@id([singerProfileId, venueId])
  @@map("singer_favorite_venues")
}

model BrandingProfile {
  id             String          @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("branding_profiles_id")
  ownerType      BrandingOwnerType @map("owner_type")
  ownerId        String?         @map("owner_id") @db.Uuid
  name           String
  logoUrl        String?         @map("logo_url")
  colorPalette   Json            @map("color_palette") @default("{}")
  poweredBySingr Boolean         @default(true) @map("powered_by_singr")
  domain         String?
  appBundleId    String?         @map("app_bundle_id")
  appPackageName String?         @map("app_package_name")
  status         BrandingStatus  @default(active)
  metadata       Json?           @default("{}")
  createdAt      DateTime        @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime        @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  brandedApps BrandedApp[]

  @@unique([ownerType, ownerId, name], map: "branding_profiles_owner_type_owner_id_name_key")
  @@map("branding_profiles")
}

model BrandedApp {
  id               String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("branded_apps_id")
  customerProfileId String        @map("customer_profiles_id") @db.Uuid
  brandingProfileId String        @map("branding_profiles_id") @db.Uuid
  name             String
  platform         String
  bundleIdentifier String?        @map("bundle_identifier")
  status           BrandingStatus @default(active)
  config           Json           @default("{}")
  rateLimitOverride Json?         @map("rate_limit_override")
  createdAt        DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime       @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  customerProfile CustomerProfile @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  brandingProfile BrandingProfile @relation(fields: [brandingProfileId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  apiKeys         BrandedAppApiKey[]

  @@map("branded_apps")
}

model BrandedAppApiKey {
  id           String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("branded_app_api_keys_id")
  brandedAppId String         @map("branded_apps_id") @db.Uuid
  apiKeyHash   String         @map("api_key_hash")
  description  String?
  lastUsedAt   DateTime?      @map("last_used_at") @db.Timestamptz(6)
  status       BrandingStatus @default(active)
  createdAt    DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime       @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  brandedApp BrandedApp @relation(fields: [brandedAppId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@unique([brandedAppId, apiKeyHash])
  @@map("branded_app_api_keys")
}

model AuditLog {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("audit_logs_id")
  tableName String   @map("table_name")
  recordId  String?  @map("record_id")
  userId    String?  @map("user_id") @db.Uuid
  operation String
  oldData   Json?
  newData   Json?
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([tableName, recordId], map: "idx_audit_logs_table_record")
  @@index([userId, createdAt], map: "idx_audit_logs_user_created_at")
  @@map("audit_logs")
}
```

## 4. ERD Summary (Entities & Relationships)
- **users** have optional one-to-one links to **customer_profiles** (customer owners) and **singer_profiles**. They also connect to **user_roles**, **accounts**, **sessions**, **organization_users** (as members or inviters), **api_keys** (creator), and **requests** (submitted_by).
- **roles** map to **user_roles** (global role assignment) and **role_permissions**. They can also be attached per-organization through **organization_users**.
- **permissions** participate in global role composition via **role_permissions** and per-organization overrides via **organization_user_permissions**.
- **customer_profiles** anchor tenant data. They belong to a single **user** (owner) and relate to **customers** (Stripe mirror), **api_keys**, **venues**, **systems**, **songdb** records, **subscriptions**, **state** counters, **organization_users**, and **branded_apps**.
- **organization_users** associate additional **users** with a **customer_profile**, referencing optional **roles** and override **permissions**. They keep invite state and last-access timestamps.
- **singer_profiles** extend users with singer-specific data and own **singer_favorite_songs**, **singer_favorite_venues**, **singer_request_history**, and **requests** links.
- **venues** belong to **customer_profiles** and host **requests**, **singer_request_history**, and **singer_favorite_venues**. They store PostGIS `geography(Point,4326)` for spatial queries.
- **systems** map OpenKJ systems to customer profiles; **songdb** rows depend on both customer profile and system.
- **requests** reference **venues**, optionally **singer_profiles**, and optionally the submitting **user** for audit/abuse investigations.
- **singer_favorite_songs**, **singer_favorite_venues**, and **singer_request_history** all hinge on **singer_profiles**.
- **api_keys** belong to customer profiles and optionally tie back to Stripe **customers** and creator **users**. **branded_app_api_keys** are scoped to **branded_apps**.
- **Stripe tables** (customers, stripe_checkout_sessions, products, prices, subscriptions, stripe_webhook_events) keep Stripe-native identifiers while linking to customer profiles when relevant.
- **branding_profiles** capture theming, referenced by many **branded_apps**. Owner_type distinguishes platform default vs. customer-owned.
- **audit_logs** store change history for all write-heavy tables, optionally referencing the acting **user**.
- **state** holds per-customer serial counters (legacy compatibility) tied to customer profiles.

## 5. REST Endpoint Inventory (v1)
### Shared Behaviors
- All endpoints emit Problem+JSON errors with consistent structure, include correlation ID header (`x-request-id`), enforce CORS per domain, and run rate limiting via Redis using sliding window.
- Authenticated routes require valid JWT (Bearer for APIs; HttpOnly cookie for web) with audience `system.singrkaraoke.com`. Authorization evaluated via RBAC/permission service using context (global vs. organization).

### /v1/auth
| Method & Path | Description | Auth | Rate Limit |
| --- | --- | --- | --- |
| POST /signin | Credential login (email/password Argon2 verify) or OAuth code exchange. Issues JWT & refresh token. | None | Strict (5/min/IP + incremental backoff) |
| POST /register | Creates user + optional customer profile (if `account_type=customer`) or singer profile. Sends verification email. | None | 3/hour/IP |
| POST /register/singer | Lightweight singer signup for public venues. | None | 5/hour/IP |
| POST /password/forgot | Generates verification token, enqueues email job. | None | 5/hour/IP |
| POST /password/reset | Consumes token, updates password hash. | None | 5/hour/IP |
| GET /profile | Returns user info, global roles, organizations, singer profile, branding context. | JWT | 30/min/user |
| POST /context | Switches active organization or singer context, returning refreshed JWT. | JWT | 10/min/user |
| POST /signout | Revokes refresh token (adds to Redis denylist) and instructs clients to drop session. | JWT | 30/min/user |
| GET /well-known/jwks.json | Public JWKS for JWT verification. | Public | 600/min/IP |

### /v1/customer (requires active customer context + permission checks)
| Endpoint | Description |
| --- | --- |
| GET /venues | Paginated list with filters (status, city). Supports caching (Redis) and PostGIS bounding boxes. |
| POST /venues | Creates venue; validates unique url_name per customer; sets location from lat/lng. |
| GET /venues/{id} | Retrieve venue details; includes stats (requests today) via aggregated query. |
| PATCH /venues/{id} | Partial update; invalidates caches; triggers audit log. |
| DELETE /venues/{id} | Soft delete optional (flag) or hard delete; ensures cascade to caches. |
| GET /systems | Lists OpenKJ systems. |
| POST /systems | Adds new system; ensures unique openkj_system_id per customer. |
| PATCH /systems/{id} | Update system metadata/config JSON. |
| DELETE /systems/{id} | Remove system; optionally queue songdb cleanup. |
| GET /api-keys | Lists hashed keys with metadata (never return plaintext). |
| POST /api-keys | Issues new key (plaintext returned once), stores Argon2 hash. Enqueues audit + webhook. |
| POST /api-keys/{id}/rotate | Rotates key (revokes old, issues new). |
| POST /api-keys/{id}/revoke | Sets status revoked; invalidates caches. |
| GET /subscriptions | Surfaces Stripe subscription state (from DB + Stripe refresh). |
| POST /subscriptions/checkout | Creates Stripe Checkout session; returns redirect URL. |
| GET /branding | Lists branding profiles owned by customer. |
| POST /branding | Creates or clones branding profile; uses signed upload URLs for assets. |
| PATCH /branding/{id} | Update colors/logo; ensures S3 metadata update. |
| GET /organization/users | Lists invited sub-users with roles/permissions. |
| POST /organization/users | Invites user (existing or new) via email; stores invitation token. |
| PATCH /organization/users/{id} | Update status, roles, permissions. |
| DELETE /organization/users/{id} | Revokes membership (soft delete by status). |
| GET /songdb | Filterable song library. |
| POST /songdb/import | Accepts upload manifest, enqueues BullMQ job for ingestion. |
| DELETE /songdb/{id} | Removes entry. |

### /v1/singer (singer context)
- `POST /requests` – Validate venue accepts requests; check rate limit (per singer + per venue). Creates request, updates history, enqueues notifications.
- `GET /requests/:id` – Returns request details if singer owns it.
- `GET /favorites/songs` / `POST /favorites/songs` / `DELETE /favorites/songs/:favoriteId` – Manage singer favorite songs.
- `GET /favorites/venues` / `POST /favorites/venues` / `DELETE /favorites/venues/:venueId` – Manage venue favorites.
- `GET /history` – Paginated history with ability to filter by venue/time.
- `POST /profile` / `PATCH /profile` – Manage singer profile nickname/preferences.

### /v1/admin (admin/support roles)
- `GET /users` / `PATCH /users/:id` – Search users, assign global roles, reset MFA, disable accounts.
- `GET /roles` / `POST /roles` / `PATCH /roles/:id` – Manage role catalog and attach permissions.
- `GET /permissions` – Enumerate permission slugs.
- `GET /organizations` / `GET /organizations/:id` – Inspect customer profile metadata, Stripe state, venues.
- `POST /organizations/:id/suspend` / `POST /organizations/:id/activate` – Manage tenant lifecycle.
- `GET /audit` – Query audit logs by table, record_id, user_id, date range.
- `GET /branding/profiles` / `POST /branding/profiles` / `PATCH /branding/profiles/:id` – Manage platform defaults and assign to customers.
- `GET /branded-apps` / `POST /branded-apps` / `PATCH /branded-apps/:id` / `POST /branded-apps/:id/revoke` – Manage white-label builds and API credentials.
- `GET /stripe/events` – View webhook events and reprocess.
- `GET /metrics` – Provide operational metrics (requests, queue health) with auth.

### /v1/public (public, with rate limiting)
- `GET /venues` – Filter by city/state/url_name; cached in Redis (5 min). Supports highlight of branded metadata.
- `GET /venues/nearby` – Query by lat/lon/radius using PostGIS `ST_DWithin`; sorts by `ST_Distance`. Rate limit 60/min/IP.
- `GET /songs/search` – Keyword search with optional venue/system context; caching with invalidation on songdb update.
- `GET /branding/platform` – Returns default branding profile for Singer app.

### /v1/openkj/api (legacy behavior)
- `POST /command` – Accepts JSON { api_key, command, payload }. Validate API key, dispatch to command handlers (reuse existing logic). Responses mirror legacy format. Rate limit per key. Ensure command list maintained.

## 6. Auth, JWT, and Context Flow
- **Registration**: Users created with Argon2id hashed password (using `argon2id` variant, memory-hard config). Email verification tokens stored in `verification_tokens` table. Completed registration may optionally create `customer_profile` or `singer_profile` depending on chosen persona. Default roles assigned (customer_owner, singer, etc.).
- **Sign-in**: Validate credentials, load roles & permissions (global + organization). Build JWT (ES256 recommended) with claims: `sub`, `email`, `roles` (global slugs), `organizations` (array of {id, roles, permissions hash}), `activeContext` (type/id), `exp`, `iat`, `jti`. Issue refresh token (rotating, stored hashed in Redis with TTL). For OAuth providers, rely on Auth.js accounts linking.
- **Context Switching**: `/v1/auth/context` accepts `contextType` (customer|singer) + identifier. Service validates membership (owner or org user) and returns new JWT with updated `activeContext`. Refresh token remains same but minted new access token.
- **Authorization**: Middleware inspects JWT, resolves context. Authorization guard checks global roles (admin/support) first, then organization-specific roles/permissions. For org-specific operations, evaluate organization role slug plus aggregated permissions (role_permissions + overrides). Cache permission sets in Redis keyed by `userId:customerProfileId:version` with invalidation triggered by membership changes.
- **Session Management**: JWT stateless; refresh tokens stored hashed (Argon2id) in Redis. On signout or rotation, mark jti as revoked. Optionally store `current_setting('app.current_user_id')` during DB operations for audit triggers.
- **Security Enhancements**: Enforce MFA-ready structure (future). Rate limit login/password endpoints. Use `helmet`-style secure headers. CORS restrict to known domains per route group. For cookie sessions, set `SameSite=None`, `Secure`, `HttpOnly`.

## 7. Audit Logging & Rollback Readiness
- **Database triggers**: `record_audit` trigger logs insert/update/delete with full old/new JSONB payloads for tracked tables. Application sets `app.current_user_id` per transaction to capture actor. Sensitive columns (password_hash, api_key_hash) excluded via column-level security? For hashed secrets, configure DB column to be excluded from `old_data`/`new_data` using view or sanitized representation in Prisma middleware (replace with `<redacted>`).
- **Application layer**: On actions that do not hit DB (e.g., external API calls), produce synthetic audit entries via `INSERT INTO audit_logs`. Include correlation IDs.
- **Rollback support**: Provide internal admin tooling to read audit trail and reconstruct previous record states. Since audit logs store JSONB old_data, operations can reconstruct previous version by applying `old_data`. Future tooling may reapply to main tables in a safe transaction.
- **Exposure**: `/v1/admin/audit` provides filtered access with pagination, support for `operation`, `user_id`, `table_name`, timeframe filters.

## 8. Branding & White-label Strategy
- **Branding profiles**: `branding_profiles` table stores theming, logos, metadata. At least one platform default row (owner_type=platform, owner_id NULL) seeded via migration. Customers can create additional profiles (owner_type=customer). Assets stored in S3/GCS with folder structure (`branding/platform/{id}` etc.).
- **Branded apps**: Link customers to branding profiles, track platform (iOS, Android, Web). Each app can have API keys stored hashed in `branded_app_api_keys` for app-specific authentication/rate limiting. Provide admin controls to suspend/revoke.
- **API usage**: Frontends fetch active branding profile during boot. Singer app default uses `/v1/public/branding/platform`. Customer-managed apps call `/v1/customer/branding` to manage, while Singer web/app reads context-specific branding in `/v1/auth/profile` and `/v1/public/venues` responses.
- **Asset pipeline**: Upload flow uses signed URLs minted server-side. Validate MIME type, enforce file size (<=2MB). Optionally integrate ClamAV scanning via worker queue prior to finalizing asset references. Store S3 metadata (content-type, etag) in profile metadata JSON.
- **Multi-domain**: `domain` column supports custom hostnames for whitelabel deployments. Config service returns CNAME instructions, to be used by frontends for domain-based theming.

## 9. Caching, Rate Limiting, and Async Jobs
- **Redis usage**:
  - Caching: Short-lived caches for `/v1/public/venues`, `/v1/public/venues/nearby`, `/v1/public/songs/search`. Keys include query params hashed. TTL ~5 minutes. Invalidation triggered on venue/songdb updates.
  - Rate limiting: Use sliding window algorithm via Redis scripts. Separate buckets per route group (auth, public, singer, admin). Additional per-IP + per-user limits. Expose headers `X-RateLimit-Remaining`.
  - Session revocation: Store revoked JWT jti and refresh token hashes with TTL.
  - Permission cache: `permissions:{userId}:{customerProfileId}` storing aggregated permission set with version bump on updates.
- **BullMQ queues**:
  - `email` queue for transactional emails (welcome, invitations, password resets) using provider (e.g., SendGrid). Retries with exponential backoff.
  - `webhooks` queue to send events to customer endpoints or internal systems.
  - `song_index_refresh` queue for bulk songdb ingestion and search indexing (future search service).
  - `cleanup` queue for periodic tasks (stale requests, expired invitations, audit log compaction).
  - Optional `branding_asset_scan` queue for malware scanning results.
- **Workers**: Separate Node.js worker process loads same Prisma and config. Use BullMQ FlowProducers for chained jobs when needed.
- **OpenKJ**: Maintain queue or direct call for command bridging if asynchronous operations required.

## 10. Observability, Logging, Error Taxonomy
- **Sentry**: Integrate Sentry SDK across API and worker. Attach release version, environment, server name. Use tracing integration with Fastify to capture performance spans (DB, Redis). Include user context (id, email) when available (respect PII policies).
- **Logging**: Use pino for structured JSON logs. Each request log includes `request_id`, `user_id`, `organization_id`, route, latency, status. Redact secrets (Authorization headers, passwords). Worker logs include job id, attempts, duration.
- **Metrics**: Expose Prometheus-compatible `/metrics` (behind auth) capturing request counts, latency histograms, queue depth, cache hit ratio.
- **Error taxonomy**: Standardize on Problem+JSON with types (e.g., `https://singrkaraoke.com/problems/validation-error`). Distinguish `validation_error`, `authentication_failed`, `authorization_denied`, `rate_limited`, `resource_not_found`, `conflict`, `internal_error`. Map to HTTP codes. Include `trace_id` linking to Sentry event.
- **Health checks**: `/healthz` (shallow) verifying process alive; `/readyz` verifying DB, Redis connectivity, queue health. Add background self-tests for PostGIS function availability.

## 11. Deployment & DevOps Notes
- **Configuration**: Use `envsafe` (or similar) to validate environment variables. Required envs include `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `AUTH_SECRET`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `SENTRY_DSN`, `STRIPE_SECRET_KEY`, etc. Keep secrets out of repo.
- **Docker**: Multi-stage Dockerfile (builder -> runtime). Base on `node:lts-alpine`. Install `postgresql-client` for migrations. Run as non-root user. Provide `docker-compose.yml` for local dev (API, Postgres + PostGIS image, Redis, MinIO, Mailpit).
- **Migrations**: Use Prisma migrate to apply schema. Seed script to insert default roles (admin, support_admin, customer_owner, customer_manager, singer), baseline permissions, platform branding profile, default Stripe products if needed.
- **CI/CD**: Pipeline steps – lint (eslint), typecheck (tsc --noEmit), unit tests (jest/vitest), integration tests (against dockerized Postgres/Redis). Run `prisma migrate deploy` before release. Upload source maps to Sentry.
- **Security**: Use Dependabot/Snyk for dependency scanning. Implement container scanning. Ensure Argon2 native deps compiled (use `@node-rs/argon2`).
- **Runtime**: Deploy to container orchestrator (ECS/EKS/GKE). Configure auto-scaling based on CPU/RPS. Use managed Postgres with PostGIS (e.g., Cloud SQL + PostGIS). Add PgBouncer for connection pooling. Redis (managed) with high availability.
- **Load balancing**: Terminate TLS at load balancer. Enforce HTTPS redirect. Provide domain-specific routing (system.singrkaraoke.com). Use CDN caching for static JWKS if needed.
- **Backups & DR**: Automated Postgres backups (point-in-time). Redis persistence optional (AOF) for session revocation. S3 versioning enabled for branding assets. Regular audit log archiving to cold storage via worker job.
- **Future hooks**: Domain services designed with interfaces to support GraphQL/tRPC adapters. Keep DTO validators reusable.
