CREATE TYPE "public"."message_status" AS ENUM('received', 'not_applicable', 'queued', 'processing', 'drafted', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_account_id" uuid,
	"channel" text NOT NULL,
	"provider" text NOT NULL,
	"provider_message_id" text NOT NULL,
	"provider_thread_id" text,
	"from_address" text NOT NULL,
	"to_addresses" text[] DEFAULT '{}' NOT NULL,
	"cc_addresses" text[] DEFAULT '{}' NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"body_truncated" boolean DEFAULT false NOT NULL,
	"is_reply" boolean DEFAULT false NOT NULL,
	"is_bulk" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"status" "message_status" DEFAULT 'received' NOT NULL,
	"status_reason" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "messages_provider_message_unique" UNIQUE("user_id","channel","provider","provider_message_id")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_account_id_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."channel_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_user_received_idx" ON "messages" USING btree ("user_id","received_at");
--> statement-breakpoint
UPDATE "reply_conditions" SET "settings" = "settings" || '{"replyMode":"draft"}'::jsonb WHERE "channel" = 'email' AND NOT ("settings" ? 'replyMode');