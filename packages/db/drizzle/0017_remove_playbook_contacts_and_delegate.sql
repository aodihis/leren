ALTER TABLE "reply_decisions" ALTER COLUMN "outcome" SET DATA TYPE text;--> statement-breakpoint
UPDATE "reply_decisions" SET "outcome" = 'answer' WHERE "outcome" = 'delegate';--> statement-breakpoint
UPDATE "playbooks" SET "response" = "response" || chr(10) || chr(10) || 'Contact: ' || array_to_string("contacts", ', ') WHERE cardinality("contacts") > 0 AND length("response") + length(array_to_string("contacts", ', ')) + 11 <= 5000;--> statement-breakpoint
DROP TYPE "public"."reply_outcome";--> statement-breakpoint
CREATE TYPE "public"."reply_outcome" AS ENUM('answer', 'escalate', 'ignore');--> statement-breakpoint
ALTER TABLE "reply_decisions" ALTER COLUMN "outcome" SET DATA TYPE "public"."reply_outcome" USING "outcome"::"public"."reply_outcome";--> statement-breakpoint
ALTER TABLE "playbooks" DROP COLUMN "contacts";