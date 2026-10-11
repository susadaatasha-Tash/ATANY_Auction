// frontend/src/roles/admin/lib/subscriptionPlans.js
// Compatibility re-export — single catalog lives in shared/lib/subscriptionPlans.js
export {
  SUBSCRIPTION_PLANS,
  getSubscriptionPlanCatalog,
  findPlanByName,
  findPlanById,
  getPlanForPlanCode,
  getPlanForBillingAmount,
  resolvePlanForRecord,
  comparePlanOrders,
  planActionKind,
  planActionLabel,
  normalizeBillingInterval,
  getPlanPeriodPrice,
  intervalLabel,
  intervalSuffix,
  planPriceLabel,
  computeAnnualPrice,
  ANNUAL_DISCOUNT_PERCENT,
} from '../../../shared/lib/subscriptionPlans';
