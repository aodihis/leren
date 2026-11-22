DROP TABLE "contacts" CASCADE;--> statement-breakpoint
DROP TABLE "knowledge_item_contacts" CASCADE;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "contacts" text[] DEFAULT '{}' NOT NULL;