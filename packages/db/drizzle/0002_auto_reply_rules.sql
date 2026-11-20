CREATE TYPE "public"."mention_detection" AS ENUM('alias', 'alias_then_llm');--> statement-breakpoint
CREATE TYPE "public"."sender_mode" AS ENUM('any', 'allowlist');--> statement-breakpoint
CREATE TYPE "public"."thread_mode" AS ENUM('new', 'reply', 'both');--> statement-breakpoint
CREATE TABLE "auto_reply_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"timezone" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_reply_conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"sender_mode" "sender_mode" DEFAULT 'any' NOT NULL,
	"sender_allowlist" text[] DEFAULT '{}' NOT NULL,
	"reply_when_to" boolean DEFAULT true NOT NULL,
	"reply_when_cc" boolean DEFAULT false NOT NULL,
	"reply_when_bcc" boolean DEFAULT false NOT NULL,
	"require_sole_recipient" boolean DEFAULT false NOT NULL,
	"mention_overrides" boolean DEFAULT false NOT NULL,
	"mention_detection" "mention_detection" DEFAULT 'alias' NOT NULL,
	"mention_aliases" text[] DEFAULT '{}' NOT NULL,
	"thread_mode" "thread_mode" DEFAULT 'both' NOT NULL,
	"skip_bulk_mail" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_reply_conditions_rule_id_unique" UNIQUE("rule_id")
);
--> statement-breakpoint
ALTER TABLE "auto_reply_rules" ADD CONSTRAINT "auto_reply_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_reply_conditions" ADD CONSTRAINT "email_reply_conditions_rule_id_auto_reply_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."auto_reply_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auto_reply_rules_user_id_idx" ON "auto_reply_rules" USING btree ("user_id");