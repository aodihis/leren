CREATE TABLE "reply_conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reply_conditions_rule_channel_unique" UNIQUE("rule_id","channel")
);
--> statement-breakpoint
ALTER TABLE "reply_conditions" ADD CONSTRAINT "reply_conditions_rule_id_auto_reply_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."auto_reply_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "reply_conditions" ("rule_id", "channel", "settings", "created_at", "updated_at")
SELECT
	"rule_id",
	'email',
	jsonb_build_object(
		'senderMode', "sender_mode",
		'senderAllowlist', to_jsonb("sender_allowlist"),
		'replyWhenTo', "reply_when_to",
		'replyWhenCc', "reply_when_cc",
		'replyWhenBcc', "reply_when_bcc",
		'requireSoleRecipient', "require_sole_recipient",
		'mentionOverrides', "mention_overrides",
		'mentionDetection', "mention_detection",
		'mentionAliases', to_jsonb("mention_aliases"),
		'threadMode', "thread_mode",
		'skipBulkMail', "skip_bulk_mail"
	),
	"created_at",
	"updated_at"
FROM "email_reply_conditions";
