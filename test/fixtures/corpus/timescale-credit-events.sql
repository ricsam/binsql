-- Migration: credit-events-hypertable
-- Generated: 2026-02-19T19:18:38.862Z
-- Type: custom
-- build-it-now:migration-class=timescale

--> statement-breakpoint
SELECT create_hypertable('credit_events', by_range('time'), if_not_exists => TRUE);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_credit_events_user_time ON credit_events (user_id, time DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_credit_events_model_time ON credit_events (model, time DESC) WHERE model IS NOT NULL;
--> statement-breakpoint
CREATE MATERIALIZED VIEW credit_events_5m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket(INTERVAL '5 minutes', "time") AS bucket,
  user_id,
  model,
  SUM(credits_added) AS credits_added,
  SUM(credits_consumed) AS credits_consumed,
  SUM(input_tokens) AS input_tokens,
  SUM(output_tokens) AS output_tokens,
  SUM(cache_read_tokens) AS cache_read_tokens,
  SUM(cache_write_5m_tokens) AS cache_write_5m_tokens,
  SUM(cache_write_1h_tokens) AS cache_write_1h_tokens,
  SUM(input_cost) AS input_cost,
  SUM(output_cost) AS output_cost,
  SUM(cache_read_cost) AS cache_read_cost,
  SUM(cache_write_5m_cost) AS cache_write_5m_cost,
  SUM(cache_write_1h_cost) AS cache_write_1h_cost
FROM credit_events
GROUP BY bucket, user_id, model
WITH NO DATA;
--> statement-breakpoint
CREATE MATERIALIZED VIEW credit_events_1h
WITH (timescaledb.continuous) AS
SELECT
  time_bucket(INTERVAL '1 hour', "time") AS bucket,
  user_id,
  model,
  SUM(credits_added) AS credits_added,
  SUM(credits_consumed) AS credits_consumed,
  SUM(input_tokens) AS input_tokens,
  SUM(output_tokens) AS output_tokens,
  SUM(cache_read_tokens) AS cache_read_tokens,
  SUM(cache_write_5m_tokens) AS cache_write_5m_tokens,
  SUM(cache_write_1h_tokens) AS cache_write_1h_tokens,
  SUM(input_cost) AS input_cost,
  SUM(output_cost) AS output_cost,
  SUM(cache_read_cost) AS cache_read_cost,
  SUM(cache_write_5m_cost) AS cache_write_5m_cost,
  SUM(cache_write_1h_cost) AS cache_write_1h_cost
FROM credit_events
GROUP BY bucket, user_id, model
WITH NO DATA;
--> statement-breakpoint
CREATE MATERIALIZED VIEW credit_events_1d
WITH (timescaledb.continuous) AS
SELECT
  time_bucket(INTERVAL '1 day', "time") AS bucket,
  user_id,
  model,
  SUM(credits_added) AS credits_added,
  SUM(credits_consumed) AS credits_consumed,
  SUM(input_tokens) AS input_tokens,
  SUM(output_tokens) AS output_tokens,
  SUM(cache_read_tokens) AS cache_read_tokens,
  SUM(cache_write_5m_tokens) AS cache_write_5m_tokens,
  SUM(cache_write_1h_tokens) AS cache_write_1h_tokens,
  SUM(input_cost) AS input_cost,
  SUM(output_cost) AS output_cost,
  SUM(cache_read_cost) AS cache_read_cost,
  SUM(cache_write_5m_cost) AS cache_write_5m_cost,
  SUM(cache_write_1h_cost) AS cache_write_1h_cost
FROM credit_events
GROUP BY bucket, user_id, model
WITH NO DATA;
--> statement-breakpoint
SELECT add_continuous_aggregate_policy('credit_events_5m',
  start_offset => INTERVAL '30 minutes',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '5 minutes',
  if_not_exists => TRUE);
--> statement-breakpoint
SELECT add_continuous_aggregate_policy('credit_events_1h',
  start_offset => INTERVAL '3 hours',
  end_offset => INTERVAL '10 minutes',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE);
--> statement-breakpoint
SELECT add_continuous_aggregate_policy('credit_events_1d',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 day',
  if_not_exists => TRUE);
--> statement-breakpoint
ALTER TABLE credit_events SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'user_id',
  timescaledb.compress_orderby = 'time DESC'
);
--> statement-breakpoint
SELECT add_compression_policy('credit_events', compress_after => INTERVAL '7 days', if_not_exists => TRUE);
