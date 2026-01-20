CREATE TYPE "public"."user_status" AS ENUM('onboarding', 'active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."day_of_week" AS ENUM('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday');--> statement-breakpoint
CREATE TYPE "public"."meeting_frequency" AS ENUM('daily', 'weekly', 'biweekly', 'monthly', 'as_needed');--> statement-breakpoint
CREATE TYPE "public"."task_context" AS ENUM('computer', 'phone', 'home', 'outside');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('today', 'this_week', 'soon');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'synced', 'completed', 'discussed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('action', 'project', 'waiting', 'someday', 'agenda');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('pending', 'sent', 'delivered', 'failed', 'received');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_number" text NOT NULL,
	"notion_access_token" text,
	"notion_workspace_id" text,
	"notion_workspace_name" text,
	"notion_tasks_database_id" text,
	"notion_people_database_id" text,
	"notion_bot_id" text,
	"todoist_access_token" text,
	"todoist_user_id" text,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"digest_time" text DEFAULT '08:00' NOT NULL,
	"meeting_reminder_hours" integer DEFAULT 2 NOT NULL,
	"weekly_review_day" text DEFAULT 'sunday' NOT NULL,
	"weekly_review_time" text DEFAULT '18:00' NOT NULL,
	"status" "user_status" DEFAULT 'onboarding' NOT NULL,
	"onboarding_step" text DEFAULT 'welcome',
	"total_tasks_captured" integer DEFAULT 0 NOT NULL,
	"total_tasks_completed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone,
	CONSTRAINT "users_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"notion_page_id" text,
	"todoist_label" text,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}',
	"frequency" "meeting_frequency",
	"day_of_week" "day_of_week",
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone,
	CONSTRAINT "people_notion_page_id_unique" UNIQUE("notion_page_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"notion_page_id" text,
	"todoist_task_id" text,
	"raw_text" text NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"type" "task_type" NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"context" "task_context",
	"priority" "task_priority",
	"person_id" uuid,
	"parent_project_id" uuid,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone,
	"last_sync_error" text,
	CONSTRAINT "tasks_notion_page_id_unique" UNIQUE("notion_page_id"),
	CONSTRAINT "tasks_todoist_task_id_unique" UNIQUE("todoist_task_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"direction" "message_direction" NOT NULL,
	"status" "message_status" DEFAULT 'pending' NOT NULL,
	"sendblue_message_id" text,
	"classification" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "messages_sendblue_message_id_unique" UNIQUE("sendblue_message_id")
);
--> statement-breakpoint
CREATE TABLE "conversation_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"state_type" text NOT NULL,
	"step" text,
	"data" jsonb DEFAULT '{}'::jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_project_id_tasks_id_fk" FOREIGN KEY ("parent_project_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_states" ADD CONSTRAINT "conversation_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_users_phone" ON "users" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX "idx_users_status" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_people_user_id" ON "people" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_people_user_name" ON "people" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "idx_people_notion_page" ON "people" USING btree ("notion_page_id");--> statement-breakpoint
CREATE INDEX "idx_people_active" ON "people" USING btree ("user_id","active");--> statement-breakpoint
CREATE INDEX "idx_tasks_user_id" ON "tasks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_user_type_status" ON "tasks" USING btree ("user_id","type","status");--> statement-breakpoint
CREATE INDEX "idx_tasks_user_context" ON "tasks" USING btree ("user_id","context");--> statement-breakpoint
CREATE INDEX "idx_tasks_user_person" ON "tasks" USING btree ("user_id","person_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_user_due" ON "tasks" USING btree ("user_id","due_date");--> statement-breakpoint
CREATE INDEX "idx_tasks_notion_page" ON "tasks" USING btree ("notion_page_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_todoist_task" ON "tasks" USING btree ("todoist_task_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_parent_project" ON "tasks" USING btree ("parent_project_id");--> statement-breakpoint
CREATE INDEX "idx_messages_user_id" ON "messages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_messages_user_created" ON "messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_messages_sendblue" ON "messages" USING btree ("sendblue_message_id");--> statement-breakpoint
CREATE INDEX "idx_messages_direction" ON "messages" USING btree ("user_id","direction");--> statement-breakpoint
CREATE INDEX "idx_conversation_states_user" ON "conversation_states" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_conversation_states_expires" ON "conversation_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_conversation_states_type" ON "conversation_states" USING btree ("user_id","state_type");