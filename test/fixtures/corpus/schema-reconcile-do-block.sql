-- Migration: schema-reconcile
-- Generated: 2026-03-17T08:11:19.070Z

--> statement-breakpoint
DROP TABLE IF EXISTS "credit_transactions";

--> statement-breakpoint
DELETE FROM "models" a
USING "models" b
WHERE a.model_id = b.model_id
  AND a.ctid < b.ctid;

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "models_model_id_unique" ON "models" ("model_id");

--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'models'::regclass
      AND conname = 'models_model_id_unique'
      AND contype = 'u'
  ) THEN
    ALTER TABLE "models"
      ADD CONSTRAINT "models_model_id_unique" UNIQUE USING INDEX "models_model_id_unique";
  END IF;
END $$;
