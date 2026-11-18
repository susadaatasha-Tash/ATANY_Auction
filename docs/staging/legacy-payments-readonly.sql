-- PREPARED ONLY; NOT EXECUTED. Staging synthetic records only, after catalog review.
-- Requires the baseline users/orders/payments/billing_records columns from 012–034.
-- Output is aggregate-only. No provider call, repair, backfill or identifier rewrite.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog, public;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TimeZone = 'UTC';
SET LOCAL DateStyle = 'ISO, YMD';
-- This does not bypass RLS: error rather than silently report filtered totals.
SET LOCAL row_security = off;

SELECT provider,status::text,currency,payment_method,count(*) AS records
FROM public.payments GROUP BY provider,status::text,currency,payment_method
ORDER BY provider,status::text,currency,payment_method;

SELECT count(*) FILTER (WHERE p.provider='paymongo' AND NULLIF(btrim(p.checkout_session_id),'') IS NULL
 AND (p.metadata->'checkout_creation_rejected') IS DISTINCT FROM 'true'::jsonb) AS unresolved_gateway_identity,
 count(*) FILTER (WHERE p.provider='paymongo' AND p.metadata->>'livemode' IS NULL) AS missing_mode,
 count(*) FILTER (WHERE p.metadata->>'livemode' NOT IN ('true','false')) AS invalid_mode,
 count(*) FILTER (WHERE p.provider='paymongo' AND p.metadata->>'livemode'='true') AS live_mode_rows_stop,
 count(*) FILTER (WHERE p.provider='paymongo' AND p.metadata->>'manual_payment'='true') AS manual_metadata_on_gateway_rows,
 count(*) FILTER (WHERE p.checkout_session_id IS NULL AND left(p.provider_reference_id,3)='cs_') AS session_only_in_reference,
 count(*) FILTER (WHERE p.metadata IS NOT NULL AND jsonb_typeof(p.metadata)<>'object') AS non_object_metadata,
 count(*) FILTER (WHERE p.amount<=0) AS nonpositive_amount,
 count(*) FILTER (WHERE p.currency<>'PHP') AS other_currency,
 count(*) FILTER (WHERE p.order_id IS NULL OR o.id IS NULL) AS orphan_orders,
 count(*) FILTER (WHERE p.customer_id IS NULL OR u.id IS NULL) AS orphan_customers,
 count(*) FILTER (WHERE p.customer_id IS DISTINCT FROM o.buyer_id) AS historical_assignment_mismatch
FROM public.payments p LEFT JOIN public.orders o ON o.id=p.order_id
LEFT JOIN public.users u ON u.id=p.customer_id;

-- Names/IDs are intentionally omitted; review matching rows privately only if approved.
SELECT 'checkout_session_id' AS duplicate_key,count(*) AS duplicate_groups FROM
 (SELECT checkout_session_id FROM public.payments WHERE checkout_session_id IS NOT NULL
  GROUP BY checkout_session_id HAVING count(*)>1) d
UNION ALL SELECT 'provider_reference_id',count(*) FROM
 (SELECT provider_reference_id FROM public.payments WHERE provider_reference_id IS NOT NULL
  GROUP BY provider_reference_id HAVING count(*)>1) d
UNION ALL SELECT 'paid_order',count(*) FROM
 (SELECT order_id FROM public.payments WHERE status::text='paid'
  GROUP BY order_id HAVING count(*)>1) d
UNION ALL SELECT 'order_per_auction',count(*) FROM
 (SELECT auction_id FROM public.orders WHERE auction_id IS NOT NULL
  GROUP BY auction_id HAVING count(*)>1) d;

SELECT count(*) AS orders_with_multiple_historical_sessions FROM
 (SELECT order_id FROM public.payments WHERE checkout_session_id IS NOT NULL
  GROUP BY order_id HAVING count(DISTINCT checkout_session_id)>1) s;
SELECT count(*) AS cross_order_sessions FROM
 (SELECT checkout_session_id FROM public.payments WHERE checkout_session_id IS NOT NULL
  GROUP BY checkout_session_id HAVING count(DISTINCT order_id)>1) s;
SELECT count(*) AS shared_order_billing_session_ids FROM public.payments p
JOIN public.billing_records b ON b.paymongo_checkout_session_id=p.checkout_session_id;

SELECT o.status::text,count(*) AS records,
 count(*) FILTER (WHERE o.winner_confirmed_at IS NULL) AS missing_confirmation,
 count(*) FILTER (WHERE o.payment_deadline IS NULL) AS missing_deadline,
 count(*) FILTER (WHERE o.winner_rank IS NULL OR o.winner_rank<1) AS invalid_rank,
 count(*) FILTER (WHERE o.status::text='pending' AND o.payment_deadline<=now()) AS already_due
FROM public.orders o GROUP BY o.status::text ORDER BY o.status::text;
SELECT count(*) AS cancelled_orders,
 count(*) FILTER (WHERE to_jsonb(o)->>'cancelled_by' IS NULL) AS missing_actor,
 count(*) FILTER (WHERE to_jsonb(o)->>'cancelled_at' IS NULL) AS missing_timestamp,
 count(*) FILTER (WHERE NULLIF(btrim(to_jsonb(o)->>'cancellation_reason'),'') IS NULL) AS missing_reason,
 count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.payments p
  WHERE p.order_id=o.id AND p.status::text IN ('paid','processing'))) AS paid_or_processing_history
FROM public.orders o WHERE o.status::text='cancelled';

-- Consistency fingerprints for SMALL staging datasets with all writers stopped.
-- Exclude precisely the additive columns so before/after hashes are comparable.
-- These MD5 values check accidental change; they are not a security guarantee.
-- For large datasets use a reviewed streaming snapshot/hash instead of string_agg.
SELECT count(*) AS orders,md5(COALESCE(string_agg(md5((to_jsonb(o)
 -'cancellation_reason'-'cancelled_at'-'cancelled_by')::text),'' ORDER BY o.id),'')) AS orders_fingerprint
FROM public.orders o;
SELECT count(*) AS payments,md5(COALESCE(string_agg(md5((to_jsonb(p)
 -'provider_checked_at')::text),'' ORDER BY p.id),'')) AS payments_fingerprint
FROM public.payments p;

SELECT to_regclass('public.payment_operations') IS NOT NULL
 AND to_regclass('public.payment_webhook_events') IS NOT NULL
 AND to_regclass('public.provider_collections') IS NOT NULL
 AND to_regclass('public.payment_reconciliations') IS NOT NULL AS safety_tables_exist \gset
\if :safety_tables_exist
SELECT kind,state,count(*) AS records FROM public.payment_operations GROUP BY kind,state;
SELECT count(*) AS conflicting_active_operations FROM
 (SELECT order_id FROM public.payment_operations WHERE state IN ('running','unknown')
  GROUP BY order_id HAVING count(*)>1) d;
SELECT state,count(*) AS records,min(received_at) AS oldest_receipt
FROM public.payment_webhook_events GROUP BY state;
SELECT livemode,currency,count(*) AS collections,sum(amount_centavos) AS total_centavos
FROM public.provider_collections GROUP BY livemode,currency;
SELECT reason,state,count(*) AS records FROM public.payment_reconciliations GROUP BY reason,state;
SELECT count(*) AS invalid_collection_amounts FROM public.provider_collections WHERE amount_centavos<0;
\endif
ROLLBACK;
