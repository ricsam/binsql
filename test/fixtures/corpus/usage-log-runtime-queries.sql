-- Representative SQL copied from ai-platform/backend/router.ts usage-log
-- db.execute(sql`...`) calls. Drizzle interpolations are positional parameters.

WITH events AS (
  SELECT *,
    SUM(credits_added - credits_consumed) OVER (
      PARTITION BY user_id ORDER BY time
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS balance_after
  FROM credit_events
  WHERE user_id = $1
)
SELECT credits_added, credits_consumed, balance_after,
       type, description, model,
       input_tokens, output_tokens, cache_read_tokens,
       cache_write_5m_tokens, cache_write_1h_tokens,
       input_cost, output_cost, cache_read_cost,
       cache_write_5m_cost, cache_write_1h_cost, time
FROM events
ORDER BY time DESC
LIMIT $2 OFFSET $3;

SELECT COUNT(*)::int AS total_count FROM credit_events WHERE user_id = $1;
