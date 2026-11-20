CREATE TYPE "public"."approval_status" AS ENUM('draft', 'approved', 'archived');--> statement-breakpoint
CREATE TABLE "knowledge_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"examples" text[] DEFAULT '{}' NOT NULL,
	"response" text NOT NULL,
	"restrictions" text DEFAULT '' NOT NULL,
	"contacts" text[] DEFAULT '{}' NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"approval_status" "approval_status" DEFAULT 'draft' NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_rule_id_auto_reply_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."auto_reply_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_items_user_id_idx" ON "knowledge_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "knowledge_items_rule_id_idx" ON "knowledge_items" USING btree ("rule_id");