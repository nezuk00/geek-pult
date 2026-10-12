CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`collected` integer DEFAULT 0 NOT NULL,
	`message` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_runs_started` ON `runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`checked_at` text,
	`error` text,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stories` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`excerpt` text NOT NULL,
	`source_id` text NOT NULL,
	`topic` text NOT NULL,
	`published_at` text NOT NULL,
	`collected_at` text NOT NULL,
	`score` integer NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`draft` text DEFAULT '' NOT NULL,
	`sent_at` text,
	`message_id` text,
	`review` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_stories_url` ON `stories` (`url`);--> statement-breakpoint
CREATE INDEX `idx_stories_status_date` ON `stories` (`status`,`published_at`);