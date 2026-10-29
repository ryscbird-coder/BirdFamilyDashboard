CREATE TABLE `hub_calendar_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`encrypted_url` text NOT NULL,
	`url_hash` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'configured' NOT NULL,
	`last_attempt` text,
	`last_success` text,
	`last_error` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hub_calendar_subscription_actor_url` ON `hub_calendar_subscriptions` (`user_id`,`url_hash`);