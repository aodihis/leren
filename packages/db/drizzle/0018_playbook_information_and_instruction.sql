ALTER TABLE "playbooks" ADD COLUMN "information" text;--> statement-breakpoint
ALTER TABLE "playbooks" ADD COLUMN "instruction" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reply_instruction" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "playbooks" SET "information" = "response", "instruction" = CASE WHEN btrim("restrictions") = '' THEN '' ELSE 'Never say the following. ' || btrim("restrictions") END, "updated_at" = now();--> statement-breakpoint
ALTER TABLE "playbooks" ALTER COLUMN "information" SET NOT NULL;
