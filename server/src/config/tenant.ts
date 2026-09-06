/**
 * Tenancy.
 *
 * The product is built around an organisation scope even though the demo runs
 * one tenant: every business row carries `organisationId`, every query filters
 * on it, and the value comes from the signed-in session rather than from a
 * request body. Adding a second customer is then a data change.
 */
export const DEMO_ORGANISATION_ID = 'org-demo';

/**
 * The organisation the caller is acting in. A membership lookup replaces this
 * function the day the product sells to a second customer; until then every
 * caller resolves to the single seeded tenant, and no route reads a tenant id
 * from user input.
 */
export function organisationFor(_user: { id: string }): string {
  void _user;
  return DEMO_ORGANISATION_ID;
}
