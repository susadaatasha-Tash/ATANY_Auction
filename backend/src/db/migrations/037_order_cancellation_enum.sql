-- 037_order_cancellation_enum — Add 'cancelled' to order_status enum
--
-- MUST run as a separate file from 037_order_cancellation.sql because
-- PostgreSQL does not allow using a newly added enum value in the same
-- transaction that added it. The migration runner sends each file as one
-- implicit transaction, so ALTER TYPE ADD VALUE must be isolated.
--
-- Idempotent: safe to re-run.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'cancelled' AND enumtypid = 'order_status'::regtype) THEN
    ALTER TYPE order_status ADD VALUE 'cancelled';
  END IF;
END $$;
