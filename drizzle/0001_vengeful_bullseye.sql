ALTER TABLE "agent_tasks" ADD COLUMN "is_public" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "share_token" text;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_share_token_unique" UNIQUE("share_token");