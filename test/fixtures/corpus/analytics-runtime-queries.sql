-- Representative SQL copied from ai-platform/backend/analytics-service.ts.
-- Drizzle interpolation sites are represented with positional parameters and
-- concrete allowlisted table/column names from the source helpers.

SELECT
  time_bucket_gapfill(
    INTERVAL '5 minutes',
    "time",
    $1::timestamptz,
    $2::timestamptz
  ) AS bucket,
  COALESCE(SUM(credits_consumed), 0) AS consumed
FROM credit_events
WHERE "time" >= $1::timestamptz
  AND "time" < $2::timestamptz
  AND user_id = $3
GROUP BY 1
ORDER BY 1;

SELECT COALESCE(SUM(credits_added - credits_consumed), 0) AS balance_at_start
FROM credit_events_5m
WHERE "bucket" < $1::timestamptz
  AND user_id = $2;

SELECT
  time_bucket_gapfill(
    INTERVAL '1 hour',
    "bucket",
    $1::timestamptz,
    $2::timestamptz
  ) AS bucket,
  COALESCE(SUM(credits_added - credits_consumed), 0) AS delta
FROM credit_events_1h
WHERE "bucket" >= $1::timestamptz
  AND "bucket" < $2::timestamptz
GROUP BY 1
ORDER BY 1;

SELECT model, SUM(credits_consumed) AS total
FROM credit_events_1d
WHERE "bucket" >= $1::timestamptz
  AND "bucket" < $2::timestamptz
  AND model IS NOT NULL
GROUP BY model
ORDER BY total DESC
LIMIT $3;

SELECT
  time_bucket_gapfill(
    INTERVAL '1 day',
    "bucket",
    $1::timestamptz,
    $2::timestamptz
  ) AS bucket,
  model,
  COALESCE(SUM(credits_consumed), 0) AS consumed
FROM credit_events_1d
WHERE "bucket" >= $1::timestamptz
  AND "bucket" < $2::timestamptz
  AND model IN ($3, $4)
GROUP BY 1, 2
ORDER BY 1, 2;

SELECT
  time_bucket_gapfill(
    INTERVAL '1 day',
    "bucket",
    $1::timestamptz,
    $2::timestamptz
  ) AS bucket,
  COALESCE(SUM(credits_consumed), 0) AS consumed
FROM credit_events_1d
WHERE "bucket" >= $1::timestamptz
  AND "bucket" < $2::timestamptz
  AND model IS NOT NULL
  AND model NOT IN ($3, $4)
GROUP BY 1
ORDER BY 1;

SELECT
  model,
  SUM(credits_consumed) AS total_credits,
  SUM(input_tokens) AS input_tokens,
  SUM(output_tokens) AS output_tokens,
  SUM(cache_read_tokens) AS cache_read_tokens,
  SUM(cache_write_5m_tokens) AS cache_write_5m_tokens,
  SUM(cache_write_1h_tokens) AS cache_write_1h_tokens
FROM credit_events_1d
WHERE "bucket" >= $1::timestamptz
  AND "bucket" < $2::timestamptz
  AND model IS NOT NULL
GROUP BY model
ORDER BY total_credits DESC;

SELECT
  ce.user_id,
  u.username,
  SUM(ce.credits_consumed) AS credits_used,
  COUNT(DISTINCT DATE(ce."bucket")) AS active_days,
  MAX(ce."bucket") AS last_activity
FROM credit_events_1d ce
JOIN "user" u ON u.id = ce.user_id
WHERE ce."bucket" >= $1::timestamptz
  AND ce."bucket" < $2::timestamptz
  AND ce.user_id IN (SELECT user_id FROM core_members WHERE core_id = $3)
  AND ce.credits_consumed > 0
GROUP BY ce.user_id, u.username
ORDER BY credits_used DESC;

SELECT cm.user_id, u.username, u.credit_balance
FROM core_members cm
JOIN "user" u ON u.id = cm.user_id
WHERE cm.core_id = $1;

SELECT user_id,
  COALESCE(SUM(credits_added - credits_consumed), 0) AS balance_at_start
FROM credit_events_5m
WHERE "bucket" < $1::timestamptz
  AND user_id IN (SELECT user_id FROM core_members WHERE core_id = $2)
GROUP BY user_id;

SELECT
  time_bucket_gapfill(
    INTERVAL '5 minutes',
    "bucket",
    $1::timestamptz,
    $2::timestamptz
  ) AS bucket,
  user_id,
  COALESCE(SUM(credits_added - credits_consumed), 0) AS delta
FROM credit_events_5m
WHERE "bucket" >= $1::timestamptz
  AND "bucket" < $2::timestamptz
  AND user_id IN (SELECT user_id FROM core_members WHERE core_id = $3)
GROUP BY 1, 2
ORDER BY 1, 2;

SELECT
  cm.core_id,
  c.name AS core_name,
  SUM(ce.credits_consumed) AS credits_used,
  COUNT(DISTINCT ce.user_id) AS active_users
FROM core_members cm
JOIN cores c ON c.id = cm.core_id
JOIN credit_events_1d ce ON ce.user_id = cm.user_id
WHERE ce."bucket" >= $1::timestamptz
  AND ce."bucket" < $2::timestamptz
  AND ce.credits_consumed > 0
GROUP BY cm.core_id, c.name
ORDER BY credits_used DESC;
