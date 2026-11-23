CREATE TYPE "public"."delivery_mode" AS ENUM('draft', 'send');--> statement-breakpoint
CREATE TYPE "public"."delivery_state" AS ENUM('pending', 'started', 'completed', 'failed');--> statement-breakpoint
ALTER TABLE "reply_decisions" ADD COLUMN "delivery_mode" "delivery_mode";--> statement-breakpoint
ALTER TABLE "reply_decisions" ADD COLUMN "delivery_state" "delivery_state";--> statement-breakpoint
ALTER TABLE "reply_decisions" ADD COLUMN "delivery_request" jsonb;--> statement-breakpoint
ALTER TABLE "reply_decisions" ADD COLUMN "delivery_response" jsonb;--> statement-breakpoint
ALTER TABLE "reply_decisions" ADD COLUMN "delivery_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reply_decisions" ADD COLUMN "delivery_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reply_decisions" ADD COLUMN "delivery_finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reply_decisions" ADD COLUMN "mailbox_draft_id" text;--> statement-breakpoint
ALTER TABLE "reply_decisions" ADD COLUMN "sent_message_id" text;--> statement-breakpoint
ALTER TABLE "reply_decisions" ADD COLUMN "delivery_error" text;--> statement-breakpoint
ALTER TABLE "reply_decisions" ADD CONSTRAINT "reply_decisions_delivery_state_has_mode" CHECK ("reply_decisions"."delivery_state" IS NULL OR "reply_decisions"."delivery_mode" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "reply_decisions" ADD CONSTRAINT "reply_decisions_delivery_started_has_request" CHECK ("reply_decisions"."delivery_state" IS NULL OR "reply_decisions"."delivery_state" NOT IN ('started', 'completed') OR ("reply_decisions"."delivery_request" IS NOT NULL AND "reply_decisions"."delivery_started_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "reply_decisions" ADD CONSTRAINT "reply_decisions_delivery_completed_has_id" CHECK ("reply_decisions"."delivery_state" IS DISTINCT FROM 'completed' OR "reply_decisions"."mailbox_draft_id" IS NOT NULL OR "reply_decisions"."sent_message_id" IS NOT NULL);