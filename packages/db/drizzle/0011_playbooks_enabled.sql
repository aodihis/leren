ALTER TABLE "playbooks" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
UPDATE "playbooks" SET "enabled" = ("approval_status" = 'approved');--> statement-breakpoint
ALTER TABLE "playbooks" DROP COLUMN "approval_status";--> statement-breakpoint
ALTER TABLE "playbooks" DROP COLUMN "approved_at";--> statement-breakpoint
DROP TYPE "public"."approval_status";
