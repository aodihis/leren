CREATE TYPE "public"."mcp_client_role" AS ENUM('assistant', 'reply');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "knowledge_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"item_id" uuid,
	"idempotency_key" text NOT NULL,
	"proposal" jsonb NOT NULL,
	"status" "proposal_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_proposals_session_key_unique" UNIQUE("session_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "mcp_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"outcome" text NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "mcp_client_role" NOT NULL,
	"scopes" text[] NOT NULL,
	"message_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_proposals" ADD CONSTRAINT "knowledge_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_proposals" ADD CONSTRAINT "knowledge_proposals_rule_id_auto_reply_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."auto_reply_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_proposals" ADD CONSTRAINT "knowledge_proposals_item_id_knowledge_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_audit_log" ADD CONSTRAINT "mcp_audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_sessions" ADD CONSTRAINT "mcp_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_proposals_user_id_idx" ON "knowledge_proposals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_audit_log_user_id_idx" ON "mcp_audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_sessions_user_id_idx" ON "mcp_sessions" USING btree ("user_id");