// backend/src/config/validateEnv.js
// Fail-fast production environment validation. Never logs secret values —
// only reports which keys are missing or misconfigured.

const SECRET_HINTS = /SECRET|KEY|PASSWORD|TOKEN/i;

/**
 * Required production keys (presence only — values never printed).
 * ALLOW_INSECURE_PAYMONGO_WEBHOOKS must NOT be true in production.
 */
export function validateProductionEnv(env = process.env) {
  const errors = [];
  const missingKeys = [];

  const isProduction = env.NODE_ENV === 'production';
  if (!isProduction) {
    return { ok: true, errors: [], missingKeys: [], mode: env.NODE_ENV || 'development' };
  }

  const required = [
    'NODE_ENV',
    'DATABASE_URL',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'PAYMONGO_SECRET_KEY',
    'PAYMONGO_WEBHOOK_SECRET',
    'FRONTEND_URL',
  ];

  for (const key of required) {
    const val = env[key];
    if (val === undefined || val === null || String(val).trim() === '') {
      missingKeys.push(key);
      errors.push(`Missing required production env: ${key}`);
    }
  }

  // DATABASE_URL shape (no credentials echoed)
  if (env.DATABASE_URL && !/^postgres(ql)?:\/\//i.test(String(env.DATABASE_URL))) {
    errors.push('DATABASE_URL must be a postgresql:// connection string');
  }

  // Supabase URL shape
  if (env.SUPABASE_URL && !/^https:\/\//i.test(String(env.SUPABASE_URL))) {
    errors.push('SUPABASE_URL must be an https URL');
  }

  // Webhook secret must look configured (prefix optional)
  if (env.PAYMONGO_WEBHOOK_SECRET && String(env.PAYMONGO_WEBHOOK_SECRET).length < 8) {
    errors.push('PAYMONGO_WEBHOOK_SECRET appears too short to be a real signing secret');
  }

  // Insecure webhook bypass is forbidden in production
  if (env.ALLOW_INSECURE_PAYMONGO_WEBHOOKS === 'true') {
    errors.push(
      'ALLOW_INSECURE_PAYMONGO_WEBHOOKS must not be true in production (unverified money events)'
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    missingKeys,
    mode: 'production',
  };
}

/**
 * Development/dev warning list — never exits the process.
 */
export function warnMissingDevEnv(env = process.env) {
  const warnings = [];
  if (env.NODE_ENV === 'production') return warnings;
  if (!env.SUPABASE_URL) warnings.push('SUPABASE_URL not set');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) warnings.push('SUPABASE_SERVICE_ROLE_KEY not set');
  if (!env.DATABASE_URL) warnings.push('DATABASE_URL not set (REST fallback may be used)');
  if (!env.PAYMONGO_WEBHOOK_SECRET) {
    warnings.push('PAYMONGO_WEBHOOK_SECRET not set (webhooks fail closed unless ALLOW_INSECURE_PAYMONGO_WEBHOOKS=true)');
  }
  return warnings;
}

/** Safe one-line report — key names only. */
export function formatEnvReport(result) {
  if (result.ok) return 'production env OK';
  const parts = result.errors.map((e) => {
    // Redact anything after '=' just in case
    return String(e).replace(/=.+$/, '=[redacted]');
  });
  return parts.join('; ');
}

export default validateProductionEnv;
