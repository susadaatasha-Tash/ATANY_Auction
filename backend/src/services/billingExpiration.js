// backend/src/services/billingExpiration.js
// Cron entrypoint — overdue billing + scheduled plan changes at period end.
import { expireOverdueBillings } from './subscriptionService.js';
import { applyScheduledChangesDue } from './subscriptionPlanChangeService.js';

export async function runBillingJobs() {
  const overdue = await expireOverdueBillings();
  const scheduled = await applyScheduledChangesDue();
  return { overdue, scheduled };
}

export { expireOverdueBillings, applyScheduledChangesDue };
