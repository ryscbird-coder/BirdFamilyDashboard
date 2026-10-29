CREATE TABLE `hub_recipe_ai_daily_usage` (
	`day` text PRIMARY KEY NOT NULL,
	`calls` integer NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "hub_recipe_ai_daily_count" CHECK("hub_recipe_ai_daily_usage"."calls" BETWEEN 0 AND 20)
);
