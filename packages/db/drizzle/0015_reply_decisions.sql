CREATE TYPE "public"."reply_outcome" AS ENUM('answer', 'delegate', 'escalate', 'ignore');--> statement-breakpoint
ALTER TYPE "public"."message_status" ADD VALUE 'escalated' BEFORE 'failed';--> statement-breakpoint
CREATE TABLE "reply_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"outcome" "reply_outcome" NOT NULL,
	"body" text,
	"category" text,
	"citations" text[] DEFAULT '{}' NOT NULL,
	"playbook_ids" text[] DEFAULT '{}' NOT NULL,
	"reasons" text[] DEFAULT '{}' NOT NULL,
	"revisions" integer DEFAULT 0 NOT NULL,
	"evaluations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reply_decisions_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "reply_decisions" ADD CONSTRAINT "reply_decisions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_decisions" ADD CONSTRAINT "reply_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;