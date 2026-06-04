CREATE TYPE "public"."approval_state" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "engine_approvals" (
	"approval_id" text PRIMARY KEY NOT NULL,
	"source_run_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"artifact" jsonb NOT NULL,
	"state" "approval_state" DEFAULT 'pending' NOT NULL,
	"approver" text NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"dispatched_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engine_quota_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"consumer_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"day" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engine_runs" (
	"run_id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"consumer_id" text NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"error" jsonb,
	"trace_id" text NOT NULL,
	"idempotency_key" text,
	"parent_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "approvals_state_idx" ON "engine_approvals" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "quota_consumer_workflow_day" ON "engine_quota_ledger" USING btree ("consumer_id","workflow_id","day");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "engine_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "runs_consumer_idx" ON "engine_runs" USING btree ("consumer_id");