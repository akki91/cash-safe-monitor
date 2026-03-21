CREATE TABLE IF NOT EXISTS "alerts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"safe_address" varchar(42) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"health_factor" numeric(20, 6),
	"message" text,
	"details" jsonb,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "safe_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"safe_address" varchar(42) NOT NULL,
	"total_collateral_usd" numeric(20, 6),
	"total_debt_usd" numeric(20, 6),
	"max_borrow_usd" numeric(20, 6),
	"health_factor" numeric(20, 6),
	"collateral_details" jsonb,
	"debt_details" jsonb,
	"is_liquidatable" boolean DEFAULT false,
	"extra_data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_safes" (
	"address" varchar(42) PRIMARY KEY NOT NULL,
	"owner" varchar(42),
	"mode" varchar(10),
	"tier" varchar(10),
	"discovered_at" timestamp DEFAULT now() NOT NULL,
	"last_polled_at" timestamp,
	"current_health" numeric(20, 6),
	"total_collateral_usd" numeric(20, 6),
	"total_debt_usd" numeric(20, 6),
	"is_liquidatable" boolean DEFAULT false,
	"has_debt" boolean DEFAULT false
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_safe_address_user_safes_address_fk" FOREIGN KEY ("safe_address") REFERENCES "public"."user_safes"("address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "safe_snapshots" ADD CONSTRAINT "safe_snapshots_safe_address_user_safes_address_fk" FOREIGN KEY ("safe_address") REFERENCES "public"."user_safes"("address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_alerts_severity" ON "alerts" USING btree ("severity","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_alerts_safe" ON "alerts" USING btree ("safe_address","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_snapshots_safe_time" ON "safe_snapshots" USING btree ("safe_address","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_snapshots_health" ON "safe_snapshots" USING btree ("health_factor");