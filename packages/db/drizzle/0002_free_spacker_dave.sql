CREATE TYPE "public"."tenant_status" AS ENUM('active', 'pending', 'disabled');--> statement-breakpoint
CREATE TABLE "engine_tenants" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" "tenant_status" DEFAULT 'active' NOT NULL,
	"currency" text NOT NULL,
	"locale" text NOT NULL,
	"branding" jsonb NOT NULL,
	"allowed_workflows" text[] DEFAULT '{}' NOT NULL,
	"members" text[] DEFAULT '{}' NOT NULL,
	"secret_prefix" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tenants_members_idx" ON "engine_tenants" USING btree ("members");