-- 001_trading_core.down.sql
-- Rollback réversible (ordre inverse des FKs).

DROP TABLE IF EXISTS kv_documents CASCADE;
DROP TABLE IF EXISTS bot_runtime_config CASCADE;
DROP TABLE IF EXISTS configuration_audit_log CASCADE;
DROP TABLE IF EXISTS ai_usage_metrics CASCADE;
DROP TABLE IF EXISTS bot_events CASCADE;
DROP TABLE IF EXISTS positions_history CASCADE;
DROP TABLE IF EXISTS fills CASCADE;
DROP TABLE IF EXISTS exchange_orders CASCADE;
DROP TABLE IF EXISTS trade_intents CASCADE;
DROP TABLE IF EXISTS risk_decisions CASCADE;
DROP TABLE IF EXISTS ai_validations CASCADE;
DROP TABLE IF EXISTS signal_candidates CASCADE;
DROP TABLE IF EXISTS feature_snapshots CASCADE;
DROP TABLE IF EXISTS market_snapshots CASCADE;
DROP TABLE IF EXISTS strategy_versions CASCADE;

DELETE FROM schema_migrations WHERE id = '001_trading_core';
