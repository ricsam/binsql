-- Migration: reseed-data
-- Seed default settings and AI models
--> statement-breakpoint
DELETE FROM "models" a
USING "models" b
WHERE a.model_id = b.model_id
  AND a.ctid < b.ctid;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS models_model_id_unique ON "models" ("model_id");
--> statement-breakpoint
INSERT INTO "settings" ("key", "value") VALUES ('embeddingModelId', '"amazon.titan-embed-text-v2:0"') ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value";
--> statement-breakpoint
INSERT INTO "settings" ("key", "value") VALUES ('embeddingDimensions', '1024') ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value";
--> statement-breakpoint
INSERT INTO "settings" ("key", "value") VALUES ('embeddingPricePerMTok', '0.02') ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value";
--> statement-breakpoint
INSERT INTO "settings" ("key", "value") VALUES ('defaultMonthlyCredits', '20') ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value";
--> statement-breakpoint
INSERT INTO "models" ("id", "model_id", "name", "description", "type", "input_price_per_m_tok", "output_price_per_m_tok", "cache_write_5m_price_per_m_tok", "cache_write_1h_price_per_m_tok", "cache_read_price_per_m_tok", "context_window", "thinking", "managed_cache", "enabled", "created_at")
VALUES (gen_random_uuid(), 'eu.anthropic.claude-opus-4-6-v1', 'Claude Opus 4.6 (EU)', 'Most capable Claude model for complex tasks', 'both', 5, 25, 6.25, 10, 0.5, 200000, true, true, true, NOW())
ON CONFLICT ("model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "type" = EXCLUDED."type",
  "input_price_per_m_tok" = EXCLUDED."input_price_per_m_tok",
  "output_price_per_m_tok" = EXCLUDED."output_price_per_m_tok",
  "cache_write_5m_price_per_m_tok" = EXCLUDED."cache_write_5m_price_per_m_tok",
  "cache_write_1h_price_per_m_tok" = EXCLUDED."cache_write_1h_price_per_m_tok",
  "cache_read_price_per_m_tok" = EXCLUDED."cache_read_price_per_m_tok",
  "context_window" = EXCLUDED."context_window",
  "thinking" = EXCLUDED."thinking",
  "managed_cache" = EXCLUDED."managed_cache",
  "enabled" = EXCLUDED."enabled";
--> statement-breakpoint
INSERT INTO "models" ("id", "model_id", "name", "description", "type", "input_price_per_m_tok", "output_price_per_m_tok", "cache_write_5m_price_per_m_tok", "cache_write_1h_price_per_m_tok", "cache_read_price_per_m_tok", "context_window", "thinking", "managed_cache", "enabled", "created_at")
VALUES (gen_random_uuid(), 'eu.anthropic.claude-opus-4-5-20251101-v1:0', 'Claude Opus 4.5 (EU)', 'Most capable Claude model for complex reasoning, analysis, and creative tasks. EU region.', 'both', 5, 25, 6.25, 10, 0.5, 200000, true, true, true, NOW())
ON CONFLICT ("model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "type" = EXCLUDED."type",
  "input_price_per_m_tok" = EXCLUDED."input_price_per_m_tok",
  "output_price_per_m_tok" = EXCLUDED."output_price_per_m_tok",
  "cache_write_5m_price_per_m_tok" = EXCLUDED."cache_write_5m_price_per_m_tok",
  "cache_write_1h_price_per_m_tok" = EXCLUDED."cache_write_1h_price_per_m_tok",
  "cache_read_price_per_m_tok" = EXCLUDED."cache_read_price_per_m_tok",
  "context_window" = EXCLUDED."context_window",
  "thinking" = EXCLUDED."thinking",
  "managed_cache" = EXCLUDED."managed_cache",
  "enabled" = EXCLUDED."enabled";
--> statement-breakpoint
INSERT INTO "models" ("id", "model_id", "name", "description", "type", "input_price_per_m_tok", "output_price_per_m_tok", "cache_write_5m_price_per_m_tok", "cache_write_1h_price_per_m_tok", "cache_read_price_per_m_tok", "context_window", "thinking", "managed_cache", "enabled", "created_at")
VALUES (gen_random_uuid(), 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0', 'Claude Sonnet 4.5 (EU)', 'Balanced performance and cost Claude model', 'both', 3, 15, 3.75, 6, 0.3, 200000, true, true, true, NOW())
ON CONFLICT ("model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "type" = EXCLUDED."type",
  "input_price_per_m_tok" = EXCLUDED."input_price_per_m_tok",
  "output_price_per_m_tok" = EXCLUDED."output_price_per_m_tok",
  "cache_write_5m_price_per_m_tok" = EXCLUDED."cache_write_5m_price_per_m_tok",
  "cache_write_1h_price_per_m_tok" = EXCLUDED."cache_write_1h_price_per_m_tok",
  "cache_read_price_per_m_tok" = EXCLUDED."cache_read_price_per_m_tok",
  "context_window" = EXCLUDED."context_window",
  "thinking" = EXCLUDED."thinking",
  "managed_cache" = EXCLUDED."managed_cache",
  "enabled" = EXCLUDED."enabled";
--> statement-breakpoint
INSERT INTO "models" ("id", "model_id", "name", "description", "type", "input_price_per_m_tok", "output_price_per_m_tok", "cache_write_5m_price_per_m_tok", "cache_write_1h_price_per_m_tok", "cache_read_price_per_m_tok", "context_window", "thinking", "managed_cache", "enabled", "created_at")
VALUES (gen_random_uuid(), 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', 'Claude Haiku 4.5 (EU)', 'Fast and cost-effective Claude model', 'both', 1, 5, 1.25, 2, 0.1, 200000, true, true, true, NOW())
ON CONFLICT ("model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "type" = EXCLUDED."type",
  "input_price_per_m_tok" = EXCLUDED."input_price_per_m_tok",
  "output_price_per_m_tok" = EXCLUDED."output_price_per_m_tok",
  "cache_write_5m_price_per_m_tok" = EXCLUDED."cache_write_5m_price_per_m_tok",
  "cache_write_1h_price_per_m_tok" = EXCLUDED."cache_write_1h_price_per_m_tok",
  "cache_read_price_per_m_tok" = EXCLUDED."cache_read_price_per_m_tok",
  "context_window" = EXCLUDED."context_window",
  "thinking" = EXCLUDED."thinking",
  "managed_cache" = EXCLUDED."managed_cache",
  "enabled" = EXCLUDED."enabled";
--> statement-breakpoint
INSERT INTO "models" ("id", "model_id", "name", "description", "type", "input_price_per_m_tok", "output_price_per_m_tok", "context_window", "thinking", "enabled", "created_at")
VALUES (gen_random_uuid(), 'eu.anthropic.claude-3-5-sonnet-20240620-v1:0', 'Claude 3.5 Sonnet (EU)', 'Previous generation Sonnet model', 'both', 3, 15, 200000, false, true, NOW())
ON CONFLICT ("model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "type" = EXCLUDED."type",
  "input_price_per_m_tok" = EXCLUDED."input_price_per_m_tok",
  "output_price_per_m_tok" = EXCLUDED."output_price_per_m_tok",
  "context_window" = EXCLUDED."context_window",
  "thinking" = EXCLUDED."thinking",
  "enabled" = EXCLUDED."enabled";
--> statement-breakpoint
INSERT INTO "models" ("id", "model_id", "name", "description", "type", "input_price_per_m_tok", "output_price_per_m_tok", "context_window", "thinking", "enabled", "created_at")
VALUES (gen_random_uuid(), 'eu.meta.llama3-2-1b-instruct-v1:0', 'Llama 3.2 1B (EU)', 'Lightweight open-source Llama model', 'both', 0.13, 0.13, 128000, false, true, NOW())
ON CONFLICT ("model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "type" = EXCLUDED."type",
  "input_price_per_m_tok" = EXCLUDED."input_price_per_m_tok",
  "output_price_per_m_tok" = EXCLUDED."output_price_per_m_tok",
  "context_window" = EXCLUDED."context_window",
  "thinking" = EXCLUDED."thinking",
  "enabled" = EXCLUDED."enabled";
--> statement-breakpoint
INSERT INTO "models" ("id", "model_id", "name", "description", "type", "input_price_per_m_tok", "output_price_per_m_tok", "context_window", "thinking", "enabled", "created_at", "region")
VALUES (gen_random_uuid(), 'moonshotai.kimi-k2.5', 'Kimi K2.5', 'Moonshot AI Kimi K2.5 model', 'both', 0.72, 3.60, 262144, false, true, NOW(), 'eu-north-1')
ON CONFLICT ("model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "type" = EXCLUDED."type",
  "input_price_per_m_tok" = EXCLUDED."input_price_per_m_tok",
  "output_price_per_m_tok" = EXCLUDED."output_price_per_m_tok",
  "context_window" = EXCLUDED."context_window",
  "thinking" = EXCLUDED."thinking",
  "enabled" = EXCLUDED."enabled",
  "region" = EXCLUDED."region";
