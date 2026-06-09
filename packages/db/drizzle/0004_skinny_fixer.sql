CREATE TYPE "public"."integration_connection_status" AS ENUM('enabled', 'pending', 'disabled');--> statement-breakpoint
CREATE TABLE "engine_tenant_integrations" (
	"tenant_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"status" "integration_connection_status" DEFAULT 'pending' NOT NULL,
	"connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engine_tenant_integrations_tenant_id_integration_id_pk" PRIMARY KEY("tenant_id","integration_id")
);
--> statement-breakpoint
ALTER TABLE "engine_tenant_integrations" ADD CONSTRAINT "engine_tenant_integrations_tenant_id_engine_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."engine_tenants"("tenant_id") ON DELETE cascade ON UPDATE no action;