import { Decimal } from 'decimal.js';

import { MONEY_DECIMAL_PLACES } from '../config/constants.js';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export { Decimal, MONEY_DECIMAL_PLACES };
