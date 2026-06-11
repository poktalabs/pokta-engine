-- Wave 0 (D9): replace engine_tenants.members[] with an engine_tenant_members table.
-- Behavior-preserving: existing members are COPIED into the new table BEFORE the
-- old column is dropped, so no current member (incl. env-seeded prod DIDs) is lost.

-- (1) the new membership table + FK + the GLOBAL DID-uniqueness guard.
CREATE TABLE "engine_tenant_members" (
	"tenant_id" text NOT NULL,
	"did" text NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engine_tenant_members_tenant_id_did_pk" PRIMARY KEY("tenant_id","did")
);
--> statement-breakpoint
ALTER TABLE "engine_tenant_members" ADD CONSTRAINT "engine_tenant_members_tenant_id_engine_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."engine_tenants"("tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_members_did_unique" ON "engine_tenant_members" USING btree ("did");--> statement-breakpoint

-- (2) DATA-COPY: move every existing member DID into the new table BEFORE the
-- column is dropped. MUST precede the DROP COLUMN or prod members are lost and
-- every current user is locked out. ON CONFLICT DO NOTHING dedupes (PK + UNIQUE(did)).
INSERT INTO "engine_tenant_members" ("tenant_id", "did")
	SELECT "tenant_id", unnest("members") FROM "engine_tenants"
	ON CONFLICT DO NOTHING;--> statement-breakpoint

-- (3) drop the old array index, then (4) the old column.
DROP INDEX "tenants_members_idx";--> statement-breakpoint
ALTER TABLE "engine_tenants" DROP COLUMN "members";
