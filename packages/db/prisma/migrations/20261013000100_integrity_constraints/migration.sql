-- ============================================================================
-- NOVYRA — integrity rules Prisma cannot express in schema.prisma.
--
-- Prisma Migrate ignores CHECK constraints, triggers and partial indexes when it
-- diffs, so these survive future `prisma migrate dev` runs. Every rule here is
-- the database-level backstop for a rule the services enforce first. Invalid
-- data cannot get in even if application code has a bug.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Human-facing sequences: do not reveal order volume.
-- ----------------------------------------------------------------------------
ALTER SEQUENCE "orders_number_seq" RESTART WITH 100001;
ALTER SEQUENCE "returns_number_seq" RESTART WITH 10001;

-- ----------------------------------------------------------------------------
-- Normalised identifiers
-- ----------------------------------------------------------------------------
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase_chk" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "users_phone_e164_chk" CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9][0-9]{6,14}$');

ALTER TABLE "newsletter_subscribers"
  ADD CONSTRAINT "newsletter_subscribers_email_lowercase_chk" CHECK ("email" = lower("email"));

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_email_lowercase_chk" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "orders_phone_e164_chk" CHECK ("phone" ~ '^\+[1-9][0-9]{6,14}$');

ALTER TABLE "coupon_redemptions"
  ADD CONSTRAINT "coupon_redemptions_email_lowercase_chk" CHECK ("email" = lower("email"));

ALTER TABLE "addresses"
  ADD CONSTRAINT "addresses_phone_e164_chk" CHECK ("phone" ~ '^\+[1-9][0-9]{6,14}$');

ALTER TABLE "order_addresses"
  ADD CONSTRAINT "order_addresses_phone_e164_chk" CHECK ("phone" ~ '^\+[1-9][0-9]{6,14}$');

ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_code_format_chk" CHECK ("code" ~ '^[A-Z0-9_-]{3,40}$');

ALTER TABLE "products"
  ADD CONSTRAINT "products_slug_format_chk" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "categories"
  ADD CONSTRAINT "categories_slug_format_chk" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "categories_not_own_parent_chk" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");
ALTER TABLE "collections"
  ADD CONSTRAINT "collections_slug_format_chk" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "collections_window_chk" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at");

ALTER TABLE "orders" ADD CONSTRAINT "orders_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "payments" ADD CONSTRAINT "payments_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "carts" ADD CONSTRAINT "carts_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$');

-- ----------------------------------------------------------------------------
-- Catalog
-- ----------------------------------------------------------------------------
ALTER TABLE "products"
  ADD CONSTRAINT "products_rating_average_chk" CHECK ("rating_average" BETWEEN 0 AND 5),
  ADD CONSTRAINT "products_review_count_chk" CHECK ("review_count" >= 0),
  ADD CONSTRAINT "products_lead_time_chk" CHECK ("lead_time_days" IS NULL OR "lead_time_days" >= 0);

ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_price_chk" CHECK ("price" >= 0),
  ADD CONSTRAINT "product_variants_compare_at_chk" CHECK ("compare_at_price" IS NULL OR "compare_at_price" > "price"),
  ADD CONSTRAINT "product_variants_cost_chk" CHECK ("cost_price" IS NULL OR "cost_price" >= 0),
  ADD CONSTRAINT "product_variants_weight_chk" CHECK ("weight_grams" IS NULL OR "weight_grams" > 0);

ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_size_chk" CHECK ("size_bytes" > 0),
  ADD CONSTRAINT "media_assets_dimensions_chk" CHECK (("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0)),
  ADD CONSTRAINT "media_assets_public_url_chk" CHECK ("visibility" = 'PRIVATE' OR "url" IS NOT NULL),
  ADD CONSTRAINT "media_assets_private_no_url_chk" CHECK ("visibility" = 'PUBLIC' OR "url" IS NULL);

-- ----------------------------------------------------------------------------
-- Inventory: stock can never go negative or be over-reserved.
-- ----------------------------------------------------------------------------
ALTER TABLE "inventory_levels"
  ADD CONSTRAINT "inventory_levels_on_hand_chk" CHECK ("on_hand" >= 0),
  ADD CONSTRAINT "inventory_levels_reserved_chk" CHECK ("reserved" >= 0 AND "reserved" <= "on_hand"),
  ADD CONSTRAINT "inventory_levels_threshold_chk" CHECK ("low_stock_threshold" IS NULL OR "low_stock_threshold" >= 0);

ALTER TABLE "inventory_reservations"
  ADD CONSTRAINT "inventory_reservations_quantity_chk" CHECK ("quantity" > 0);

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_nonzero_chk" CHECK ("on_hand_delta" <> 0 OR "reserved_delta" <> 0),
  ADD CONSTRAINT "inventory_movements_after_chk" CHECK ("on_hand_after" >= 0 AND "reserved_after" >= 0);

-- ----------------------------------------------------------------------------
-- Cart
-- ----------------------------------------------------------------------------
ALTER TABLE "carts"
  ADD CONSTRAINT "carts_owner_chk" CHECK ("user_id" IS NOT NULL OR "token_hash" IS NOT NULL);

ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_quantity_chk" CHECK ("quantity" BETWEEN 1 AND 99);

-- ----------------------------------------------------------------------------
-- Orders: totals must add up.
-- ----------------------------------------------------------------------------
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_amounts_nonnegative_chk" CHECK (
    "subtotal" >= 0 AND "discount_total" >= 0 AND "shipping_total" >= 0
    AND "tax_total" >= 0 AND "fee_total" >= 0 AND "total" >= 0
  ),
  ADD CONSTRAINT "orders_discount_le_subtotal_chk" CHECK ("discount_total" <= "subtotal"),
  ADD CONSTRAINT "orders_total_arithmetic_chk" CHECK (
    "total" = "subtotal" - "discount_total" + "shipping_total" + "fee_total"
              + CASE WHEN "prices_include_tax" THEN 0 ELSE "tax_total" END
  ),
  ADD CONSTRAINT "orders_cancelled_at_chk" CHECK ("status" <> 'CANCELLED' OR "cancelled_at" IS NOT NULL);

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_quantity_chk" CHECK ("quantity" > 0),
  ADD CONSTRAINT "order_items_amounts_chk" CHECK (
    "unit_price" >= 0 AND "discount_total" >= 0 AND "tax_total" >= 0 AND "line_total" >= 0
  ),
  ADD CONSTRAINT "order_items_discount_chk" CHECK ("discount_total" <= "unit_price" * "quantity"),
  ADD CONSTRAINT "order_items_fulfilled_chk" CHECK ("quantity_fulfilled" BETWEEN 0 AND "quantity"),
  ADD CONSTRAINT "order_items_returned_chk" CHECK ("quantity_returned" BETWEEN 0 AND "quantity_fulfilled");

-- ----------------------------------------------------------------------------
-- Payments & refunds: never refund more than was captured.
-- ----------------------------------------------------------------------------
ALTER TABLE "payment_methods"
  ADD CONSTRAINT "payment_methods_fee_chk" CHECK ("fee_fixed" >= 0 AND "fee_percent" BETWEEN 0 AND 100),
  ADD CONSTRAINT "payment_methods_limits_chk" CHECK (
    ("min_order_total" IS NULL OR "min_order_total" >= 0)
    AND ("max_order_total" IS NULL OR "min_order_total" IS NULL OR "max_order_total" >= "min_order_total")
  );

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_chk" CHECK ("amount" > 0),
  ADD CONSTRAINT "payments_captured_chk" CHECK ("amount_captured" BETWEEN 0 AND "amount"),
  ADD CONSTRAINT "payments_refunded_chk" CHECK ("amount_refunded" BETWEEN 0 AND "amount_captured");

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_amount_chk" CHECK ("amount" > 0);

-- ----------------------------------------------------------------------------
-- Coupons
-- ----------------------------------------------------------------------------
ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_value_chk" CHECK (
    CASE "type"
      WHEN 'PERCENTAGE'    THEN "value" > 0 AND "value" <= 100
      WHEN 'FIXED_AMOUNT'  THEN "value" > 0
      WHEN 'FREE_SHIPPING' THEN "value" = 0
    END
  ),
  ADD CONSTRAINT "coupons_window_chk" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at"),
  ADD CONSTRAINT "coupons_limits_chk" CHECK (
    ("usage_limit" IS NULL OR "usage_limit" > 0)
    AND ("usage_limit_per_customer" IS NULL OR "usage_limit_per_customer" > 0)
    AND ("min_subtotal" IS NULL OR "min_subtotal" >= 0)
    AND ("max_discount" IS NULL OR "max_discount" > 0)
  ),
  ADD CONSTRAINT "coupons_usage_chk" CHECK ("usage_count" >= 0 AND ("usage_limit" IS NULL OR "usage_count" <= "usage_limit"));

ALTER TABLE "coupon_redemptions"
  ADD CONSTRAINT "coupon_redemptions_amount_chk" CHECK ("discount_amount" >= 0);

-- ----------------------------------------------------------------------------
-- Reviews, returns, shipping
-- ----------------------------------------------------------------------------
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_chk" CHECK ("rating" BETWEEN 1 AND 5),
  ADD CONSTRAINT "reviews_body_length_chk" CHECK (char_length("body") BETWEEN 1 AND 5000);

ALTER TABLE "return_items"
  ADD CONSTRAINT "return_items_quantity_chk" CHECK ("quantity" > 0);

ALTER TABLE "shipment_items"
  ADD CONSTRAINT "shipment_items_quantity_chk" CHECK ("quantity" > 0);

ALTER TABLE "shipments"
  ADD CONSTRAINT "shipments_amounts_chk" CHECK ("cod_amount" >= 0 AND "declared_value" >= 0),
  ADD CONSTRAINT "shipments_pieces_chk" CHECK ("pieces" >= 1),
  ADD CONSTRAINT "shipments_weight_chk" CHECK ("weight_grams" IS NULL OR "weight_grams" > 0),
  ADD CONSTRAINT "shipments_direction_chk" CHECK ("direction" = 'OUTBOUND' OR "return_id" IS NOT NULL);

ALTER TABLE "shipping_methods"
  ADD CONSTRAINT "shipping_methods_days_chk" CHECK (
    ("min_delivery_days" IS NULL OR "min_delivery_days" >= 0)
    AND ("max_delivery_days" IS NULL OR "min_delivery_days" IS NULL OR "max_delivery_days" >= "min_delivery_days")
  );

ALTER TABLE "shipping_rates"
  ADD CONSTRAINT "shipping_rates_price_chk" CHECK ("price" >= 0),
  ADD CONSTRAINT "shipping_rates_subtotal_range_chk" CHECK ("max_subtotal" IS NULL OR "min_subtotal" IS NULL OR "max_subtotal" >= "min_subtotal"),
  ADD CONSTRAINT "shipping_rates_weight_range_chk" CHECK ("max_weight_grams" IS NULL OR "min_weight_grams" IS NULL OR "max_weight_grams" >= "min_weight_grams"),
  ADD CONSTRAINT "shipping_rates_free_above_chk" CHECK ("free_above_subtotal" IS NULL OR "free_above_subtotal" >= 0);

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_attempts_chk" CHECK ("attempts" >= 0);

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_attempts_chk" CHECK ("attempts" >= 0);

-- ----------------------------------------------------------------------------
-- Partial unique indexes ("at most one X per Y")
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX "addresses_one_default_shipping_per_user_uq"
  ON "addresses" ("user_id") WHERE "is_default_shipping";
CREATE UNIQUE INDEX "addresses_one_default_billing_per_user_uq"
  ON "addresses" ("user_id") WHERE "is_default_billing";

CREATE UNIQUE INDEX "carts_one_active_per_user_uq"
  ON "carts" ("user_id") WHERE "status" = 'ACTIVE' AND "user_id" IS NOT NULL;

CREATE UNIQUE INDEX "product_variants_one_default_per_product_uq"
  ON "product_variants" ("product_id") WHERE "is_default";

CREATE UNIQUE INDEX "inventory_locations_single_default_uq"
  ON "inventory_locations" ((true)) WHERE "is_default";

CREATE UNIQUE INDEX "shipping_zones_one_default_per_country_uq"
  ON "shipping_zones" ("country_code") WHERE "is_default";

-- Only one live (not cancelled/failed) shipment booking per return.
CREATE UNIQUE INDEX "shipments_one_live_return_pickup_uq"
  ON "shipments" ("return_id")
  WHERE "return_id" IS NOT NULL AND "status" NOT IN ('CANCELLED', 'EXCEPTION');

-- Hot-path partial indexes for background jobs.
CREATE INDEX "outbox_events_ready_idx"
  ON "outbox_events" ("available_at") WHERE "status" = 'PENDING';
CREATE INDEX "inventory_reservations_expiring_idx"
  ON "inventory_reservations" ("expires_at") WHERE "status" = 'ACTIVE' AND "expires_at" IS NOT NULL;
CREATE INDEX "notifications_ready_idx"
  ON "notifications" ("scheduled_at") WHERE "status" = 'PENDING';

-- ----------------------------------------------------------------------------
-- Append-only ledgers
--
-- UPDATE and DELETE are rejected. The single exception: an UPDATE whose only
-- change is setting the column named in TG_ARGV[0] to NULL. That is the
-- ON DELETE SET NULL issued when the referenced user is deleted.
-- TRUNCATE (test resets) does not fire row triggers. A retention job must run
-- as a maintenance role that disables the trigger explicitly.
-- ----------------------------------------------------------------------------
CREATE FUNCTION "enforce_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  nullable_fk text := TG_ARGV[0];
BEGIN
  IF TG_OP = 'UPDATE'
     AND nullable_fk IS NOT NULL
     AND (to_jsonb(NEW) ->> nullable_fk) IS NULL
     AND (to_jsonb(NEW) - nullable_fk) = (to_jsonb(OLD) - nullable_fk) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "enforce_append_only"('actor_id');

CREATE TRIGGER "inventory_movements_append_only"
  BEFORE UPDATE OR DELETE ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION "enforce_append_only"('actor_id');

CREATE TRIGGER "order_events_append_only"
  BEFORE UPDATE OR DELETE ON "order_events"
  FOR EACH ROW EXECUTE FUNCTION "enforce_append_only"('actor_id');

CREATE TRIGGER "payment_events_append_only"
  BEFORE UPDATE OR DELETE ON "payment_events"
  FOR EACH ROW EXECUTE FUNCTION "enforce_append_only"();
