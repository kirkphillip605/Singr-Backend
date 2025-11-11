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
