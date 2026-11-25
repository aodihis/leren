CREATE TYPE "public"."connector_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"connector" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"label" text NOT NULL,
	"credentials" text,
	"status" "connector_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "connectors_user_connector_unique" UNIQUE("user_id","connector")
);
--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;