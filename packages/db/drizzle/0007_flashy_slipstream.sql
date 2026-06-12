CREATE TYPE "public"."member_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TABLE "engine_superadmins" (
	"did" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- admin-roles Wave A / D4: seed the ONE bootstrap superadmin (dev@poktalabs.com),
-- insert-only. Hand-added to the generated migration (no env var). ON CONFLICT DO
-- NOTHING keeps re-runs idempotent and never clobbers an existing row.
INSERT INTO "engine_superadmins" ("did") VALUES ('did:privy:cmq6zcn7y001y0cjm37szqy4b') ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "engine_tenant_invites" ADD COLUMN "role" "member_role" DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "engine_tenant_invites" ADD COLUMN "invited_by_did" text;--> statement-breakpoint
ALTER TABLE "engine_tenant_members" ADD COLUMN "role" "member_role" DEFAULT 'member' NOT NULL;