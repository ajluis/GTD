CREATE TABLE "conversation_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"key_entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"memory_type" text DEFAULT 'interaction' NOT NULL,
	"relevance_score" integer DEFAULT 50 NOT NULL,
	"retrieval_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_retrieved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "todoist_entity_cache" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"projects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_patterns" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"typical_task_times" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"common_labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"frequent_projects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"word_associations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"task_type_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"person_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_corrections" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"default_project" text,
	"working_hours" jsonb,
	"label_mappings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"project_mappings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priority_keywords" jsonb DEFAULT '{"high":[],"medium":[],"low":[]}'::jsonb NOT NULL,
	"default_context" text,
	"date_aliases" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_memory" ADD CONSTRAINT "conversation_memory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todoist_entity_cache" ADD CONSTRAINT "todoist_entity_cache_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_patterns" ADD CONSTRAINT "user_patterns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_conversation_memory_user" ON "conversation_memory" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_conversation_memory_type" ON "conversation_memory" USING btree ("user_id","memory_type");--> statement-breakpoint
CREATE INDEX "idx_conversation_memory_relevance" ON "conversation_memory" USING btree ("user_id","relevance_score");--> statement-breakpoint
CREATE INDEX "idx_conversation_memory_created" ON "conversation_memory" USING btree ("user_id","created_at");