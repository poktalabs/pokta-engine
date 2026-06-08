CREATE TYPE "public"."workflow_state_status" AS ENUM('pending', 'attempting', 'applied', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "engine_workflow_state" (
	"consumer_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"sku" text NOT NULL,
	"desired_price" numeric,
	"desired_hash" text,
	"prior_shopify" numeric,
	"attempted_price" numeric,
	"status" "workflow_state_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"source_run_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engine_workflow_state_consumer_id_workflow_id_sku_pk" PRIMARY KEY("consumer_id","workflow_id","sku")
);
--> statement-breakpoint
CREATE INDEX "workflow_state_status_idx" ON "engine_workflow_state" USING btree ("status");