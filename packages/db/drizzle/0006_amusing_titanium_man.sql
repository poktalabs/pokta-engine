CREATE TYPE "public"."invite_status" AS ENUM('pending', 'claimed', 'revoked');--> statement-breakpoint
CREATE TABLE "engine_tenant_invites" (
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"status" "invite_status" DEFAULT 'pending' NOT NULL,
	"claimed_by_did" text,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engine_tenant_invites_tenant_id_email_pk" PRIMARY KEY("tenant_id","email"),
	CONSTRAINT "engine_tenant_invites_email_lower" CHECK ("engine_tenant_invites"."email" = lower("engine_tenant_invites"."email"))
);
--> statement-breakpoint
ALTER TABLE "engine_tenant_invites" ADD CONSTRAINT "engine_tenant_invites_tenant_id_engine_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."engine_tenants"("tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_invites_active_email" ON "engine_tenant_invites" USING btree ("email") WHERE "engine_tenant_invites"."status" != 'revoked';