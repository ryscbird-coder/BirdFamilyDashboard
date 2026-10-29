CREATE TABLE `hub_icloud` (
	`singleton` integer PRIMARY KEY NOT NULL,
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
	CONSTRAINT "hub_icloud_singleton" CHECK("hub_icloud"."singleton" = 1),
	CONSTRAINT "hub_icloud_valid_calendars" CHECK(json_valid("hub_icloud"."calendars")),
	CONSTRAINT "hub_icloud_valid_selected" CHECK(json_valid("hub_icloud"."selected"))
);
