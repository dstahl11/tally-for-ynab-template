CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`on_budget` integer NOT NULL,
	`closed` integer DEFAULT false NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`raw` text NOT NULL,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `alert_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` text NOT NULL,
	`month` text NOT NULL,
	`threshold` integer NOT NULL,
	`sent_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_alert_events_once` ON `alert_events` (`category_id`,`month`,`threshold`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`group_name` text NOT NULL,
	`name` text NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`note` text,
	`goal_type` text,
	`goal_target_milli` integer,
	`goal_target_date` text,
	`raw` text NOT NULL,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_categories_group_name` ON `categories` (`group_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_categories_name_active` ON `categories` (`name`,`deleted`);--> statement-breakpoint
CREATE TABLE `category_months` (
	`category_id` text NOT NULL,
	`month` text NOT NULL,
	`budgeted_milli` integer DEFAULT 0 NOT NULL,
	`activity_milli` integer DEFAULT 0 NOT NULL,
	`balance_milli` integer DEFAULT 0 NOT NULL,
	`goal_under_funded_milli` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`category_id`, `month`),
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_category_months_month` ON `category_months` (`month`);--> statement-breakpoint
CREATE TABLE `chat_usage` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `day`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `magic_links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `magic_links_token_hash_unique` ON `magic_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_magic_links_user_created` ON `magic_links` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `messages_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`direction` text NOT NULL,
	`to_phone` text NOT NULL,
	`from_phone` text NOT NULL,
	`body` text NOT NULL,
	`twilio_sid` text,
	`related_proposal_id` text,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transaction_id` text NOT NULL,
	`from_category_id` text,
	`to_category_id` text NOT NULL,
	`source` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `payees` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`raw` text NOT NULL,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`summary_sms` text NOT NULL,
	`status` text NOT NULL,
	`recipient_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`executed_at` text,
	`execution_result` text,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `queue_items` (
	`transaction_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`suggestions` text NOT NULL,
	`enrichment` text,
	`asked_at` text,
	`retry_at` text,
	`answered_at` text,
	`answer_category_id` text,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_queue_items_state_retry` ON `queue_items` (`state`,`retry_at`);--> statement-breakpoint
CREATE TABLE `rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`match_field` text NOT NULL,
	`match_type` text NOT NULL,
	`pattern` text NOT NULL,
	`secondary_pattern` text,
	`action` text NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`hit_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rules_active_priority` ON `rules` (`enabled`,`priority`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`resource` text PRIMARY KEY NOT NULL,
	`server_knowledge` integer DEFAULT 0 NOT NULL,
	`last_synced_at` text,
	`last_reconciled_at` text,
	`status` text DEFAULT 'ok' NOT NULL,
	`detail` text
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`amount_milli` integer NOT NULL,
	`payee_id` text,
	`payee_name` text,
	`payee_norm` text,
	`import_payee_name` text,
	`import_payee_name_original` text,
	`category_id` text,
	`category_name` text,
	`account_id` text NOT NULL,
	`account_name` text NOT NULL,
	`memo` text,
	`approved` integer NOT NULL,
	`cleared` text NOT NULL,
	`transfer_account_id` text,
	`transfer_transaction_id` text,
	`matched_transaction_id` text,
	`is_split` integer DEFAULT false NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`raw` text NOT NULL,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_transactions_date` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX `idx_transactions_category_date` ON `transactions` (`category_id`,`date`);--> statement-breakpoint
CREATE INDEX `idx_transactions_original_payee` ON `transactions` (`import_payee_name_original`);--> statement-breakpoint
CREATE INDEX `idx_transactions_payee_norm` ON `transactions` (`payee_norm`);--> statement-breakpoint
CREATE INDEX `idx_transactions_approved_deleted` ON `transactions` (`approved`,`deleted`);--> statement-breakpoint
CREATE INDEX `idx_transactions_account_date` ON `transactions` (`account_id`,`date`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`role` text NOT NULL,
	`account_id` text,
	`visible_group_id` text,
	`visible_category_ids` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_unique` ON `users` (`phone`);--> statement-breakpoint
CREATE TABLE `write_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`actor` text NOT NULL,
	`endpoint` text NOT NULL,
	`request` text NOT NULL,
	`response_status` integer,
	`response` text,
	`reversal_hint` text NOT NULL,
	`dry_run` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_write_log_at` ON `write_log` (`at`);