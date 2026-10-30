CREATE TABLE `hub_recipe_photos` (
	`recipe_id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`sha256` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "hub_recipe_photo_bounds" CHECK("hub_recipe_photos"."width" BETWEEN 1 AND 480 AND "hub_recipe_photos"."height" BETWEEN 1 AND 480 AND "hub_recipe_photos"."size_bytes" BETWEEN 1 AND 40000)
);
--> statement-breakpoint
CREATE INDEX `hub_recipe_photo_object` ON `hub_recipe_photos` (`object_key`);