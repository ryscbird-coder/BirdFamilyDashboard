CREATE TABLE `hub_icloud_accounts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`credentials` text NOT NULL,
	`calendars` text NOT NULL,
	`selected` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'configured' NOT NULL,
	`last_attempt` text,
	`last_success` text,
	`last_error` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "hub_icloud_account_calendars" CHECK(json_valid("hub_icloud_accounts"."calendars")),
	CONSTRAINT "hub_icloud_account_selected" CHECK(json_valid("hub_icloud_accounts"."selected"))
);
--> statement-breakpoint
CREATE TABLE `hub_icloud_calendar_links` (
	`calendar_key` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`shared_calendar_id` text NOT NULL,
	`display_name` text NOT NULL,
	`color` text,
	`person_id` text,
	`selected` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hub_icloud_link_account_calendar` ON `hub_icloud_calendar_links` (`user_id`,`calendar_id`);--> statement-breakpoint
CREATE TABLE `hub_icloud_contributions` (
	`contribution_key` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`event_key` text NOT NULL,
	`record_id` text NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "hub_icloud_contribution_json" CHECK(json_valid("hub_icloud_contributions"."data"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hub_icloud_contribution_provider` ON `hub_icloud_contributions` (`user_id`,`calendar_id`,`provider_id`);--> statement-breakpoint
CREATE TABLE `hub_icloud_revision` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "hub_icloud_revision_singleton" CHECK("hub_icloud_revision"."singleton" = 1)
);
