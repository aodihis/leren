CREATE TYPE "public"."channel_account_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "channel_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"label" text NOT NULL,
	"credentials" text,
	"status" "channel_account_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channel_accounts_provider_account_unique" UNIQUE("channel","provider","provider_account_id")
);
--> statement-breakpoint
ALTER TABLE "reply_conditions" ADD COLUMN "channel_account_id" uuid;--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_accounts_user_id_idx" ON "channel_accounts" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "reply_conditions" ADD CONSTRAINT "reply_conditions_channel_account_id_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."channel_accounts"("id") ON DELETE set null ON UPDATE no action;