-- 001_trading_core.up.sql
-- Source de vérité persistante BoriazBot (PostgreSQL).
-- NUMERIC pour finances ; TIMESTAMPTZ UTC ; pas de secrets/clés privées.
-- Migration non destructive (CREATE IF NOT EXISTS).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strategy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  parameters_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  code_reference TEXT,
  git_commit TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_strategy_versions_version
  ON strategy_versions (version);
CREATE INDEX IF NOT EXISTS idx_strategy_versions_active
  ON strategy_versions (is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS market_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  symbol TEXT NOT NULL,
  timeframe_context TEXT,
  last_price NUMERIC(36, 18),
  spread_bps NUMERIC(18, 8),
  estimated_slippage_bps NUMERIC(18, 8),
  funding_rate NUMERIC(36, 18),
  open_interest NUMERIC(36, 18),
  snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_age_seconds NUMERIC(18, 6),
  correlation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_market_snapshots_symbol_created
  ON market_snapshots (symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_snapshots_corr
  ON market_snapshots (correlation_id);

CREATE TABLE IF NOT EXISTS feature_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  symbol TEXT NOT NULL,
  strategy_version_id UUID REFERENCES strategy_versions(id),
  market_snapshot_id UUID REFERENCES market_snapshots(id),
  score NUMERIC(10, 4),
  features_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_feature_snapshots_symbol_created
  ON feature_snapshots (symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feature_snapshots_corr
  ON feature_snapshots (correlation_id);

CREATE TABLE IF NOT EXISTS signal_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('long', 'short')),
  setup_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'detected'
    CHECK (status IN (
      'detected','ai_pending','ai_approved','ai_rejected',
      'risk_approved','risk_rejected','executed','expired','cancelled','failed'
    )),
  strategy_version_id UUID REFERENCES strategy_versions(id),
  market_snapshot_id UUID REFERENCES market_snapshots(id),
  feature_snapshot_id UUID REFERENCES feature_snapshots(id),
  score NUMERIC(10, 4),
  entry_type TEXT,
  proposed_entry_price NUMERIC(36, 18),
  entry_zone_low NUMERIC(36, 18),
  entry_zone_high NUMERIC(36, 18),
  stop_loss NUMERIC(36, 18),
  take_profit_levels_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_reward_ratio NUMERIC(18, 8),
  reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  rejected_conditions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  dedupe_key TEXT NOT NULL,
  correlation_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_candidates_dedupe
  ON signal_candidates (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_signal_candidates_symbol_created
  ON signal_candidates (symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_candidates_status_created
  ON signal_candidates (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_candidates_corr
  ON signal_candidates (correlation_id);

CREATE TABLE IF NOT EXISTS ai_validations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signal_candidate_id UUID REFERENCES signal_candidates(id),
  provider TEXT,
  model TEXT,
  prompt_version TEXT,
  request_hash TEXT,
  cached BOOLEAN NOT NULL DEFAULT FALSE,
  decision TEXT NOT NULL
    CHECK (decision IN ('approve','reject','uncertain','error')),
  confidence NUMERIC(8, 6),
  reason_code TEXT,
  reason TEXT,
  risk_flags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  latency_ms INTEGER,
  estimated_input_tokens INTEGER,
  estimated_output_tokens INTEGER,
  estimated_cost_usd NUMERIC(18, 8),
  raw_response_redacted_json JSONB,
  error_code TEXT,
  correlation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_validations_signal_created
  ON ai_validations (signal_candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_validations_request_hash
  ON ai_validations (request_hash);

CREATE TABLE IF NOT EXISTS risk_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signal_candidate_id UUID REFERENCES signal_candidates(id),
  approved BOOLEAN NOT NULL,
  reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  calculated_position_size NUMERIC(36, 18),
  calculated_notional NUMERIC(36, 18),
  risk_amount NUMERIC(36, 18),
  effective_leverage NUMERIC(18, 8),
  stop_distance_pct NUMERIC(18, 8),
  risk_reward_ratio NUMERIC(18, 8),
  account_equity NUMERIC(36, 18),
  exposure_before NUMERIC(36, 18),
  exposure_after NUMERIC(36, 18),
  correlation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_risk_decisions_signal_created
  ON risk_decisions (signal_candidate_id, created_at DESC);

CREATE TABLE IF NOT EXISTS trade_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signal_candidate_id UUID REFERENCES signal_candidates(id),
  risk_decision_id UUID REFERENCES risk_decisions(id),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('long', 'short')),
  order_type TEXT,
  requested_price NUMERIC(36, 18),
  requested_size NUMERIC(36, 18),
  requested_notional NUMERIC(36, 18),
  leverage NUMERIC(18, 8),
  stop_loss NUMERIC(36, 18),
  take_profit_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  mode TEXT NOT NULL CHECK (mode IN ('shadow','paper','live')),
  correlation_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_intents_idempotency
  ON trade_intents (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_trade_intents_status_created
  ON trade_intents (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_intents_corr
  ON trade_intents (correlation_id);

CREATE TABLE IF NOT EXISTS exchange_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trade_intent_id UUID REFERENCES trade_intents(id),
  exchange TEXT NOT NULL DEFAULT 'hyperliquid',
  exchange_order_id TEXT,
  client_order_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  type TEXT,
  requested_price NUMERIC(36, 18),
  requested_size NUMERIC(36, 18),
  filled_size NUMERIC(36, 18),
  average_fill_price NUMERIC(36, 18),
  status TEXT NOT NULL DEFAULT 'submitted',
  fees NUMERIC(36, 18),
  raw_response_redacted_json JSONB,
  correlation_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_exchange_orders_exchange_oid
  ON exchange_orders (exchange_order_id)
  WHERE exchange_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exchange_orders_client_oid
  ON exchange_orders (client_order_id)
  WHERE client_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exchange_orders_intent
  ON exchange_orders (trade_intent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS fills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exchange_order_id UUID REFERENCES exchange_orders(id),
  exchange_fill_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  price NUMERIC(36, 18) NOT NULL,
  size NUMERIC(36, 18) NOT NULL,
  fee NUMERIC(36, 18),
  liquidity_type TEXT,
  correlation_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fills_exchange_fill
  ON fills (exchange_fill_id)
  WHERE exchange_fill_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fills_order
  ON fills (exchange_order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS positions_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('long', 'short')),
  trade_intent_id UUID REFERENCES trade_intents(id),
  entry_price NUMERIC(36, 18),
  exit_price NUMERIC(36, 18),
  size NUMERIC(36, 18),
  leverage NUMERIC(18, 8),
  stop_loss NUMERIC(36, 18),
  take_profit_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  realized_pnl NUMERIC(36, 18),
  unrealized_pnl_at_close NUMERIC(36, 18),
  fees NUMERIC(36, 18),
  funding_paid_or_received NUMERIC(36, 18),
  exit_reason TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  correlation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_positions_history_symbol_opened
  ON positions_history (symbol, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_history_status
  ON positions_history (status, opened_at DESC);

CREATE TABLE IF NOT EXISTS bot_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  service TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info'
    CHECK (severity IN ('debug','info','warn','error','critical')),
  symbol TEXT,
  candidate_id UUID,
  trade_intent_id UUID,
  correlation_id TEXT,
  message TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_bot_events_created
  ON bot_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_events_service_created
  ON bot_events (service, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_events_severity_created
  ON bot_events (severity, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_usage_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  calls_count INTEGER NOT NULL DEFAULT 0,
  cached_count INTEGER NOT NULL DEFAULT 0,
  approval_count INTEGER NOT NULL DEFAULT 0,
  rejection_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  timeout_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_estimate_usd NUMERIC(18, 8) NOT NULL DEFAULT 0,
  average_latency_ms NUMERIC(18, 6)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_usage_period_provider_model
  ON ai_usage_metrics (period_start, period_end, provider, model);

CREATE TABLE IF NOT EXISTS configuration_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_identifier TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_value_json JSONB,
  new_value_json JSONB,
  reason TEXT,
  correlation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_config_audit_created
  ON configuration_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_config_audit_action
  ON configuration_audit_log (action, created_at DESC);

-- Config runtime persistée (kill switch / mode) — pas de secrets
CREATE TABLE IF NOT EXISTS bot_runtime_config (
  id TEXT PRIMARY KEY DEFAULT 'global',
  trading_mode TEXT NOT NULL DEFAULT 'shadow'
    CHECK (trading_mode IN ('shadow','paper','live')),
  live_trading_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  global_kill_switch BOOLEAN NOT NULL DEFAULT TRUE,
  reconciliation_required BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

INSERT INTO bot_runtime_config (id, trading_mode, live_trading_enabled, global_kill_switch, reconciliation_required)
VALUES ('global', 'shadow', FALSE, TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Escape hatch documents JSON (compat Upstash keys) pendant migration
CREATE TABLE IF NOT EXISTS kv_documents (
  key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kv_documents_updated
  ON kv_documents (updated_at DESC);

INSERT INTO schema_migrations (id) VALUES ('001_trading_core')
ON CONFLICT (id) DO NOTHING;
