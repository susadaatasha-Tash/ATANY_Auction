#!/bin/sh
# Only the disposable socket-only cluster initialized for this task is writable.
set -eu
cd "$(dirname "$0")/.."
export NODE_ENV=test
export DATABASE_URL=postgresql://atany_test@127.0.0.1:1/never_connect
export PAYMONGO_SECRET_KEY=sk_test_fixture
export PAYMONGO_WEBHOOK_SECRET=fixture
export ATANY_SAFETY_PG_SOCKET=/private/tmp/atany-safety-audit
export ATANY_SAFETY_USE_EXISTING_SCHEMA=1
exec ./node_modules/.bin/vitest run src/tests/paymentSafetyDb.test.js src/tests/orderActionSnapshot.test.js src/tests/paymongoSafety.test.js src/tests/customer/order.controller.test.js src/tests/sellerOrders.test.js src/tests/manualPayment.test.js src/tests/paymentNotifications.test.js src/tests/priority1Security.test.js src/tests/billingSubscription.test.js src/tests/productionReadiness.test.js --pool=forks --maxWorkers=1 --minWorkers=1
