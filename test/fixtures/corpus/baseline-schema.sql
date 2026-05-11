-- Migration: baseline_schema
-- Generated: 2026-02-19T15:58:28.938Z

--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE "core_members" (
	"id" text PRIMARY KEY,
	"core_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL DEFAULT 'operator',
	"joined_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE "cores" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"description" text,
	"external_id" text,
	"created_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE "credit_events" (
	"time" timestamp with time zone NOT NULL,
	"user_id" text NOT NULL,
	"model" text,
	"type" text NOT NULL,
	"description" text,
	"credits_added" real NOT NULL DEFAULT 0,
	"credits_consumed" real NOT NULL DEFAULT 0,
	"input_tokens" integer NOT NULL DEFAULT 0,
	"output_tokens" integer NOT NULL DEFAULT 0,
	"cache_read_tokens" integer NOT NULL DEFAULT 0,
	"cache_write_5m_tokens" integer NOT NULL DEFAULT 0,
	"cache_write_1h_tokens" integer NOT NULL DEFAULT 0,
	"input_cost" real NOT NULL DEFAULT 0,
	"output_cost" real NOT NULL DEFAULT 0,
	"cache_read_cost" real NOT NULL DEFAULT 0,
	"cache_write_5m_cost" real NOT NULL DEFAULT 0,
	"cache_write_1h_cost" real NOT NULL DEFAULT 0
);

--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"markdown_content" text,
	"status" text NOT NULL DEFAULT 'pending',
	"error" text,
	"chunks_count" integer,
	"scope" text NOT NULL DEFAULT 'personal',
	"scope_id" text,
	"created_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" text PRIMARY KEY,
	"document_id" text NOT NULL,
	"content" text NOT NULL,
	"block_type" text,
	"page_number" integer,
	"embedding" vector(1024) NOT NULL
);

--> statement-breakpoint
CREATE TABLE "models" (
	"id" text PRIMARY KEY,
	"model_id" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "models_model_id_unique" UNIQUE ("model_id"),
	"description" text,
	"type" text NOT NULL DEFAULT 'chat',
	"input_price_per_m_tok" real NOT NULL DEFAULT 0,
	"output_price_per_m_tok" real NOT NULL DEFAULT 0,
	"cache_write_5m_price_per_m_tok" real,
	"cache_write_1h_price_per_m_tok" real,
	"cache_read_price_per_m_tok" real,
	"context_window" integer,
	"thinking" boolean NOT NULL DEFAULT false,
	"managed_cache" boolean NOT NULL DEFAULT false,
	"region" text,
	"enabled" boolean NOT NULL DEFAULT true,
	"created_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE ("token")
);

--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY,
	"value" jsonb
);

--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL DEFAULT false,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"username" text NOT NULL,
	"role" text NOT NULL DEFAULT 'user',
	"credit_balance" real NOT NULL DEFAULT 0,
	"default_monthly_credits" real NOT NULL DEFAULT 0,
	"external_id" text,
	"anocca_jwt" text,
	"enabled" boolean NOT NULL DEFAULT true,
	"api_enabled" boolean NOT NULL DEFAULT true,
	CONSTRAINT "user_email_unique" UNIQUE ("email"),
	CONSTRAINT "user_username_unique" UNIQUE ("username")
);

--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);

--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "core_members" ADD CONSTRAINT "core_members_core_id_cores_id_fk" FOREIGN KEY ("core_id") REFERENCES "cores" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "core_members" ADD CONSTRAINT "core_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;