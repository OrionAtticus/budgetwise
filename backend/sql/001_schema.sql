-- ════════════════════════════════════════════════════════════════════════
-- BudgetWise Family Plan — Initial Database Schema
-- Postgres 16 · matches BudgetWise_DataStorage_Specification.md §3–§4
-- ════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;

-- ── §3.1  family_accounts ──────────────────────────────────────────────
CREATE TABLE family_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL,
    plan_tier       VARCHAR(20)  NOT NULL DEFAULT 'free'
                    CHECK (plan_tier IN ('free','starter','family_pro','enterprise')),
    billing_email   VARCHAR(255) NOT NULL UNIQUE,
    max_members     INTEGER      NOT NULL DEFAULT 1 CHECK (max_members > 0),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── §3.2  user_profiles ────────────────────────────────────────────────
CREATE TABLE user_profiles (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id            UUID NOT NULL REFERENCES family_accounts(id) ON DELETE CASCADE,
    name                 VARCHAR(100) NOT NULL,
    email                VARCHAR(255) UNIQUE,
    role                 VARCHAR(10)  NOT NULL
                         CHECK (role IN ('admin','member','teen','junior')),
    income_type          VARCHAR(20)
                         CHECK (income_type IN ('salaried','freelancer','student','other')),
    monthly_income       DECIMAL(12,2) DEFAULT 0.00 CHECK (monthly_income >= 0),
    monthly_limit        DECIMAL(12,2) DEFAULT 0.00 CHECK (monthly_limit  >= 0),
    primary_goal         VARCHAR(200),
    accent_colour        VARCHAR(7)   DEFAULT '#3d6b52',
    onboarding_complete  BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_profiles_family_id ON user_profiles(family_id);
CREATE INDEX idx_profiles_email     ON user_profiles(email);

-- ── §3.3  transactions ─────────────────────────────────────────────────
CREATE TABLE transactions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id        UUID         NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    description      VARCHAR(255) NOT NULL,
    amount           DECIMAL(12,2) NOT NULL CHECK (amount > 0),
    type             VARCHAR(7)   NOT NULL CHECK (type IN ('expense','income')),
    category         VARCHAR(50)  NOT NULL,
    date             DATE         NOT NULL,
    idempotency_key  VARCHAR(255) UNIQUE,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tx_member_date     ON transactions(member_id, date DESC);
CREATE INDEX idx_tx_member_category ON transactions(member_id, category);
CREATE INDEX idx_tx_idempotency     ON transactions(idempotency_key);

-- ── §3.4  budget_categories ────────────────────────────────────────────
CREATE TABLE budget_categories (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id      UUID         NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    name           VARCHAR(100) NOT NULL,
    type           VARCHAR(7)   NOT NULL DEFAULT 'expense' CHECK (type IN ('expense','income')),
    icon           VARCHAR(30)  DEFAULT '📊',
    monthly_limit  DECIMAL(12,2) NOT NULL CHECK (monthly_limit >= 0),
    amount_spent   DECIMAL(12,2) NOT NULL DEFAULT 0.00 CHECK (amount_spent >= 0),
    parent_group   VARCHAR(50),
    period_start   DATE         NOT NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_budget_member        ON budget_categories(member_id);
CREATE INDEX idx_budget_member_period ON budget_categories(member_id, period_start);

-- ── §3.5  savings_goals ────────────────────────────────────────────────
CREATE TABLE savings_goals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID         NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    family_id       UUID         NOT NULL REFERENCES family_accounts(id) ON DELETE CASCADE,
    name            VARCHAR(200) NOT NULL,
    icon            VARCHAR(30)  DEFAULT '🎯',
    target_amount   DECIMAL(12,2) NOT NULL CHECK (target_amount > 0),
    current_amount  DECIMAL(12,2) NOT NULL DEFAULT 0.00 CHECK (current_amount >= 0),
    deadline        DATE,
    is_shared       BOOLEAN      NOT NULL DEFAULT FALSE,
    is_archived     BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_goals_member        ON savings_goals(member_id);
CREATE INDEX idx_goals_family_shared ON savings_goals(family_id) WHERE is_shared = TRUE;

-- ── §3.6  shared_goal_contributors ─────────────────────────────────────
-- Tracks how much each family member has contributed to a shared goal,
-- so the "Family" tab can show a per-member breakdown ("Mom: $1,200 ·
-- Dad: $800 · Jordan: $50"). Updated via UPSERT inside addSavings()
-- when is_shared = TRUE on the parent goal.
CREATE TABLE shared_goal_contributors (
    goal_id           UUID NOT NULL REFERENCES savings_goals(id)   ON DELETE CASCADE,
    member_id         UUID NOT NULL REFERENCES user_profiles(id)   ON DELETE CASCADE,
    total_contributed DECIMAL(12,2) NOT NULL DEFAULT 0.00 CHECK (total_contributed >= 0),
    last_contribution TIMESTAMPTZ,
    PRIMARY KEY (goal_id, member_id)
);
CREATE INDEX idx_sgc_member ON shared_goal_contributors(member_id);

-- ── §3.7  notifications ────────────────────────────────────────────────
CREATE TABLE notifications (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id  UUID         NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    sender_id     UUID         REFERENCES user_profiles(id) ON DELETE SET NULL,
    type          VARCHAR(30)  NOT NULL
                  CHECK (type IN ('nudge','budget_warning','weekly_report','invite','system')),
    title         VARCHAR(200) NOT NULL,
    body          TEXT,
    is_read       BOOLEAN      NOT NULL DEFAULT FALSE,
    delivered_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notif_recipient ON notifications(recipient_id, created_at DESC);

-- ── §3.8  insights_cache ───────────────────────────────────────────────
CREATE TABLE insights_cache (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID         NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    billing_period  VARCHAR(7)   NOT NULL,  
    insights_json   JSONB        NOT NULL,
    generated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (member_id, billing_period)
);

-- ── §4.1  auth.credentials ─────────────────────────────────────────────
CREATE TABLE auth.credentials (
    member_id        UUID PRIMARY KEY REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    pin_hash         VARCHAR(72)  NOT NULL, 
    failed_attempts  INTEGER      NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    locked_until     TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── §4.2  auth.sessions ────────────────────────────────────────────────
CREATE TABLE auth.sessions (
    token       VARCHAR(128) PRIMARY KEY,
    member_id   UUID         NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ  NOT NULL
);
CREATE INDEX idx_sessions_member ON auth.sessions(member_id);
CREATE INDEX idx_sessions_expiry ON auth.sessions(expires_at);

-- ── updated_at trigger function ────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER family_accounts_set_updated_at
    BEFORE UPDATE ON family_accounts
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TRIGGER user_profiles_set_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TRIGGER auth_credentials_set_updated_at
    BEFORE UPDATE ON auth.credentials
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();