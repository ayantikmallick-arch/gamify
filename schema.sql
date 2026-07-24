-- ============================================================
-- GamifyDeals – PostgreSQL Schema (Manual UPI + Multi-Slot Credentials)
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── ADMINS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,           -- bcrypt(12)
  role          VARCHAR(20)  NOT NULL DEFAULT 'admin'
                  CHECK (role IN ('owner', 'admin')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── GAMES ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS games (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(255) NOT NULL,
  genre          VARCHAR(100),
  sub_genre      VARCHAR(100),
  steam_app_id   INTEGER,
  price          DECIMAL(10,2) NOT NULL,
  original_price DECIMAL(10,2),
  badge          VARCHAR(50),
  emoji          VARCHAR(10)  DEFAULT '🎮',
  description    TEXT,
  active         BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_games_active ON games (active);
CREATE INDEX IF NOT EXISTS idx_games_genre  ON games (genre);

-- ── GAME ACCOUNTS (Multi-Slot Steam Credentials) ─────────────
-- Allows storing up to 10+ Steam accounts/slots per game
CREATE TABLE IF NOT EXISTS game_accounts (
  id                 SERIAL       PRIMARY KEY,
  game_id            INTEGER      NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  slot_name          VARCHAR(50)  NOT NULL DEFAULT 'Slot 1', -- Slot 1, Slot 2, etc.
  steam_username     VARCHAR(255) NOT NULL,
  steam_password_enc TEXT         NOT NULL,   -- AES-256-GCM ciphertext (hex)
  steam_iv           VARCHAR(64)  NOT NULL,   -- GCM IV (hex)
  steam_auth_tag     VARCHAR(64)  NOT NULL,   -- GCM auth tag (hex)
  notes              TEXT,                    -- Internal admin notes / backup codes
  active             BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_game_accounts_game ON game_accounts (game_id);

-- ── ORDERS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_email          VARCHAR(255) NOT NULL,
  buyer_name           VARCHAR(255),
  buyer_whatsapp       VARCHAR(20),
  game_id              INTEGER      REFERENCES games(id) ON DELETE SET NULL,
  assigned_account_id  INTEGER      REFERENCES game_accounts(id) ON DELETE SET NULL,
  amount               DECIMAL(10,2) NOT NULL,
  currency             VARCHAR(3)   NOT NULL DEFAULT 'INR',
  utr_number           VARCHAR(100),            -- Customer submitted 12-digit UTR
  payment_method       VARCHAR(50)  NOT NULL DEFAULT 'upi_qr',
  status               VARCHAR(20)  NOT NULL DEFAULT 'pending_approval'
                         CHECK (status IN ('pending_approval', 'delivered', 'rejected')),
  assigned_username     VARCHAR(255),
  assigned_password_enc TEXT,
  assigned_iv           VARCHAR(64),
  assigned_auth_tag     VARCHAR(64),
  cart_items           JSONB,                  -- stored if cart checkout
  view_token           TEXT,                   -- no-expiry JWT for My Order page
  admin_notes          TEXT,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  approved_at          TIMESTAMPTZ,
  approved_by          VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_email      ON orders (buyer_email);
CREATE INDEX IF NOT EXISTS idx_orders_utr        ON orders (utr_number);
CREATE INDEX IF NOT EXISTS idx_orders_view_token ON orders (view_token);

-- ── AUDIT LOG ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_logs (
  id           SERIAL       PRIMARY KEY,
  game_id      INTEGER      REFERENCES games(id) ON DELETE SET NULL,
  order_id     UUID,
  action       VARCHAR(50)  NOT NULL,
    -- 'order_created' | 'approved_delivered' | 'rejected' | 'revealed_customer' | 'revealed_admin' | 'account_added'
  actor        VARCHAR(100) NOT NULL DEFAULT 'system',
  meta         JSONB,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_action    ON inventory_logs (action);
CREATE INDEX IF NOT EXISTS idx_logs_created   ON inventory_logs (created_at DESC);
