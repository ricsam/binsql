-- Migration: migration
-- Generated: 2026-03-17T11:29:59.092Z

--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "provider" text NOT NULL DEFAULT 'bedrock';

--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "provider_model_id" text;