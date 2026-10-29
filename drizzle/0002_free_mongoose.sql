CREATE TABLE `hub_household_feed` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow` text NOT NULL,
	`source_id` text NOT NULL,
	`data` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "hub_feed_valid_json" CHECK(json_valid("hub_household_feed"."data"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hub_feed_workflow_source` ON `hub_household_feed` (`workflow`,`source_id`);