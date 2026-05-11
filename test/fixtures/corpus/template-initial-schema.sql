-- Migration: initial
-- Generated: 2026-01-29T19:48:18.498Z

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
CREATE TABLE "comments" (
	"id" text PRIMARY KEY,
	"post_id" text NOT NULL,
	"author_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);

--> statement-breakpoint
CREATE TABLE "direct_messages" (
	"id" text PRIMARY KEY,
	"sender_id" text NOT NULL,
	"receiver_id" text NOT NULL,
	"content" text NOT NULL,
	"read" boolean NOT NULL DEFAULT false,
	"created_at" bigint NOT NULL
);

--> statement-breakpoint
CREATE TABLE "friendships" (
	"id" text PRIMARY KEY,
	"requester_id" text NOT NULL,
	"addressee_id" text NOT NULL,
	"status" text NOT NULL DEFAULT 'pending',
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);

--> statement-breakpoint
CREATE TABLE "likes" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"post_id" text NOT NULL,
	"created_at" bigint NOT NULL
);

--> statement-breakpoint
CREATE TABLE "post_attachments" (
	"id" text PRIMARY KEY,
	"post_id" text NOT NULL,
	"file_path" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" bigint NOT NULL
);

--> statement-breakpoint
CREATE TABLE "posts" (
	"id" text PRIMARY KEY,
	"author_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
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
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL DEFAULT false,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"bio" text,
	"cover_photo" text,
	"avatar_path" text,
	CONSTRAINT "user_email_unique" UNIQUE ("email")
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
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "posts" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "user" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_sender_id_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "user" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_receiver_id_user_id_fk" FOREIGN KEY ("receiver_id") REFERENCES "user" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requester_id_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "user" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_addressee_id_user_id_fk" FOREIGN KEY ("addressee_id") REFERENCES "user" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "posts" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "post_attachments" ADD CONSTRAINT "post_attachments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "posts" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "user" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;

--> statement-breakpoint
CREATE INDEX "comments_post_idx" ON "comments" ("post_id" NULLS LAST);

--> statement-breakpoint
CREATE INDEX "comments_author_idx" ON "comments" ("author_id" NULLS LAST);

--> statement-breakpoint
CREATE INDEX "dm_sender_idx" ON "direct_messages" ("sender_id" NULLS LAST);

--> statement-breakpoint
CREATE INDEX "dm_receiver_idx" ON "direct_messages" ("receiver_id" NULLS LAST);

--> statement-breakpoint
CREATE INDEX "dm_conversation_idx" ON "direct_messages" ("sender_id" NULLS LAST, "receiver_id" NULLS LAST);

--> statement-breakpoint
CREATE INDEX "friendships_requester_idx" ON "friendships" ("requester_id" NULLS LAST);

--> statement-breakpoint
CREATE INDEX "friendships_addressee_idx" ON "friendships" ("addressee_id" NULLS LAST);

--> statement-breakpoint
CREATE UNIQUE INDEX "friendships_unique_idx" ON "friendships" ("requester_id" NULLS LAST, "addressee_id" NULLS LAST);

--> statement-breakpoint
CREATE INDEX "likes_post_idx" ON "likes" ("post_id" NULLS LAST);

--> statement-breakpoint
CREATE INDEX "likes_user_idx" ON "likes" ("user_id" NULLS LAST);

--> statement-breakpoint
CREATE UNIQUE INDEX "likes_unique_idx" ON "likes" ("user_id" NULLS LAST, "post_id" NULLS LAST);

--> statement-breakpoint
CREATE INDEX "attachments_post_idx" ON "post_attachments" ("post_id" NULLS LAST);

--> statement-breakpoint
CREATE INDEX "posts_author_idx" ON "posts" ("author_id" NULLS LAST);

--> statement-breakpoint
CREATE INDEX "posts_created_idx" ON "posts" ("created_at" NULLS LAST);