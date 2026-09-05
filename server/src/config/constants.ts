/**
 * Payroll foundation: store money as PostgreSQL NUMERIC(18,2), calculate with
 * Decimal, and serialize API money as strings. Never use JavaScript Number for
 * payroll arithmetic.
 */
export const MONEY_DECIMAL_PLACES = 2;
