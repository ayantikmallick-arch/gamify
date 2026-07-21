-- ============================================================
-- GamifyDeals – PostgreSQL Schema
-- Run once: psql $DATABASE_URL -f schema.sql
-- Requires PostgreSQL 13+
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

-- ── INVENTORY ─────────────────────────────────────────────────
-- UUID primary key – not guessable
CREATE TABLE IF NOT EXISTS inventory (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id            INTEGER      NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  steam_username     VARCHAR(255) NOT NULL,
  steam_password_enc TEXT         NOT NULL,   -- AES-256-GCM ciphertext (hex)
  steam_iv           VARCHAR(64)  NOT NULL,   -- GCM IV (hex, 16 bytes → 32 hex chars)
  steam_auth_tag     VARCHAR(64)  NOT NULL,   -- GCM auth tag (hex, 16 bytes → 32 hex chars)
  status             VARCHAR(20)  NOT NULL DEFAULT 'available'
                       CHECK (status IN ('available', 'reserved', 'sold', 'replaced')),
  order_id           UUID,                    -- set when assigned
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  sold_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inventory_game_status ON inventory (game_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_status      ON inventory (status);

-- ── ORDERS ────────────────────────────────────────────────────
-- UUID primary key
CREATE TABLE IF NOT EXISTS orders (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_email          VARCHAR(255) NOT NULL,
  buyer_name           VARCHAR(255),
  buyer_whatsapp       VARCHAR(20),
  game_id              INTEGER      REFERENCES games(id) ON DELETE SET NULL,
  inventory_id         UUID         REFERENCES inventory(id) ON DELETE SET NULL,
  amount               DECIMAL(10,2) NOT NULL,
  currency             VARCHAR(3)   NOT NULL DEFAULT 'INR',
  razorpay_order_id    VARCHAR(255) UNIQUE,
  razorpay_payment_id  VARCHAR(255),
  razorpay_signature   VARCHAR(512),
  status               VARCHAR(20)  NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  cart_items           JSONB,                  -- stored if cart checkout
  view_token           TEXT,                   -- no-expiry JWT for My Order page
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  paid_at              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_rzp_order  ON orders (razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_email      ON orders (buyer_email);
CREATE INDEX IF NOT EXISTS idx_orders_view_token ON orders (view_token);

-- ── INVENTORY AUDIT LOG ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_logs (
  id           SERIAL       PRIMARY KEY,
  inventory_id UUID         REFERENCES inventory(id) ON DELETE SET NULL,
  game_id      INTEGER      REFERENCES games(id)     ON DELETE SET NULL,
  order_id     UUID,
  action       VARCHAR(50)  NOT NULL,
    -- 'imported' | 'assigned' | 'sold' | 'replaced' | 'deleted'
    -- 'revealed_customer' | 'revealed_admin'
  actor        VARCHAR(100) NOT NULL DEFAULT 'system',   -- admin username or 'system'
  meta         JSONB,                                     -- extra context
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_inventory ON inventory_logs (inventory_id);
CREATE INDEX IF NOT EXISTS idx_logs_action    ON inventory_logs (action);
CREATE INDEX IF NOT EXISTS idx_logs_created   ON inventory_logs (created_at DESC);
