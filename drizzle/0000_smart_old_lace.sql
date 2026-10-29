CREATE TABLE `hub_admin_results` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow` text NOT NULL,
	`source_id` text NOT NULL,
	`data` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "hub_result_valid_json" CHECK(json_valid("hub_admin_results"."data"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hub_result_workflow_source` ON `hub_admin_results` (`workflow`,`source_id`);--> statement-breakpoint
CREATE TABLE `hub_members` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "hub_member_role" CHECK("hub_members"."role" IN ('owner','member'))
);
--> statement-breakpoint
CREATE TABLE `hub_operations` (
	`operation_key` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "hub_operation_valid_json" CHECK(json_valid("hub_operations"."result_json"))
);
--> statement-breakpoint
CREATE TABLE `hub_owner` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "hub_owner_singleton" CHECK("hub_owner"."singleton" = 1)
);
--> statement-breakpoint
CREATE TABLE `hub_records` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`meal_day` text GENERATED ALWAYS AS (CASE WHEN kind = 'meal' THEN json_extract(data, '$.day') ELSE NULL END) VIRTUAL,
	`meal_slot` text GENERATED ALWAYS AS (CASE WHEN kind = 'meal' THEN json_extract(data, '$.slot') ELSE NULL END) VIRTUAL,
	CONSTRAINT "hub_record_kind" CHECK("hub_records"."kind" IN ('calendar','shopping','reminder','recipe','meal','profile','source')),
	CONSTRAINT "hub_record_valid_json" CHECK(json_valid("hub_records"."data"))
);
--> statement-breakpoint
CREATE INDEX `hub_records_kind` ON `hub_records` (`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `hub_meal_day_slot` ON `hub_records` (`meal_day`,`meal_slot`);