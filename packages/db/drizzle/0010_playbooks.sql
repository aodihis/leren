CREATE TABLE "playbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"examples" text[] DEFAULT '{}' NOT NULL,
	"response" text NOT NULL,
	"restrictions" text DEFAULT '' NOT NULL,
	"contacts" text[] DEFAULT '{}' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"timezone" text NOT NULL,
	"approval_status" "approval_status" DEFAULT 'draft' NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reply_conditions" ADD COLUMN "playbook_id" uuid;--> statement-breakpoint
ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "playbooks_user_id_idx" ON "playbooks" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "reply_conditions" ADD CONSTRAINT "reply_conditions_playbook_id_playbooks_id_fk" FOREIGN KEY ("playbook_id") REFERENCES "public"."playbooks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reply_conditions" DROP CONSTRAINT "reply_conditions_rule_channel_unique";--> statement-breakpoint
ALTER TABLE "reply_conditions" ALTER COLUMN "rule_id" DROP NOT NULL;--> statement-breakpoint
INSERT INTO "playbooks" ("id", "user_id", "topic", "examples", "response", "restrictions", "contacts", "starts_at", "ends_at", "timezone", "approval_status", "approved_at", "created_at", "updated_at")
SELECT
	k."id",
	k."user_id",
	k."topic",
	k."examples",
	k."response",
	k."restrictions",
	k."contacts",
	COALESCE(k."valid_from", r."starts_at"),
	COALESCE(k."valid_until", r."ends_at"),
	r."timezone",
	CASE WHEN r."enabled" THEN k."approval_status" ELSE 'archived'::"approval_status" END,
	CASE WHEN r."enabled" THEN k."approved_at" ELSE NULL END,
	k."created_at",
	k."updated_at"
FROM "knowledge_items" k
JOIN "auto_reply_rules" r ON r."id" = k."rule_id";--> statement-breakpoint
INSERT INTO "playbooks" ("id", "user_id", "topic", "response", "starts_at", "ends_at", "timezone", "approval_status", "created_at", "updated_at")
SELECT
	r."id",
	r."user_id",
	r."name",
	'',
	r."starts_at",
	r."ends_at",
	r."timezone",
	CASE WHEN r."enabled" THEN 'draft'::"approval_status" ELSE 'archived'::"approval_status" END,
	r."created_at",
	r."updated_at"
FROM "auto_reply_rules" r
WHERE NOT EXISTS (SELECT 1 FROM "knowledge_items" k WHERE k."rule_id" = r."id");--> statement-breakpoint
INSERT INTO "reply_conditions" ("playbook_id", "channel", "settings", "created_at", "updated_at")
SELECT k."id", c."channel", c."settings", c."created_at", c."updated_at"
FROM "reply_conditions" c
JOIN "knowledge_items" k ON k."rule_id" = c."rule_id";--> statement-breakpoint
UPDATE "reply_conditions" c
SET "playbook_id" = c."rule_id"
WHERE c."playbook_id" IS NULL
	AND NOT EXISTS (SELECT 1 FROM "knowledge_items" k WHERE k."rule_id" = c."rule_id");--> statement-breakpoint
DELETE FROM "reply_conditions" WHERE "playbook_id" IS NULL;--> statement-breakpoint
ALTER TABLE "auto_reply_rules" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge_items" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "auto_reply_rules" CASCADE;--> statement-breakpoint
DROP TABLE "knowledge_items" CASCADE;--> statement-breakpoint
ALTER TABLE "reply_conditions" DROP CONSTRAINT IF EXISTS "reply_conditions_rule_id_auto_reply_rules_id_fk";
--> statement-breakpoint
ALTER TABLE "reply_conditions" ALTER COLUMN "playbook_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reply_conditions" DROP COLUMN "rule_id";--> statement-breakpoint
ALTER TABLE "reply_conditions" ADD CONSTRAINT "reply_conditions_playbook_channel_unique" UNIQUE("playbook_id","channel");
