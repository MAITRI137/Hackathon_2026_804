/**
 * Restricted formula evaluator for salary rules.
 *
 * Uses mathjs with the dangerous surface removed and the parsed AST walked
 * before evaluation. There is deliberately no custom expression compiler:
 * we lock down a proven parser instead of writing one.
 *
 * Guarantees
 *  - Only allowlisted functions may be called.
 *  - Every symbol must exist in the supplied scope; unknown symbols are
 *    rejected by name, at rule-save time, before a payslip can exist.
 *  - No assignment, no function definition, no imports, no property access.
 *  - Evaluation returns both the value AND the symbols it actually read,
 *    which is what makes the Explainable Payslip's "inputs" real.
 */
import { create, all, type MathNode } from 'mathjs';
import { Decimal, money } from './money.js';

const math = create(all, { number: 'number' });

// Remove everything that could reach outside the expression.
math.import(
  {
    import: function forbidden() {
      throw new FormulaError('FORBIDDEN', 'import is not available in salary formulas');
    },
    createUnit: function forbidden() {
      throw new FormulaError('FORBIDDEN', 'createUnit is not available in salary formulas');
    },
    evaluate: function forbidden() {
      throw new FormulaError('FORBIDDEN', 'evaluate is not available in salary formulas');
    },
    parse: function forbidden() {
      throw new FormulaError('FORBIDDEN', 'parse is not available in salary formulas');
    },
    simplify: function forbidden() {
      throw new FormulaError('FORBIDDEN', 'simplify is not available in salary formulas');
    },
    derivative: function forbidden() {
      throw new FormulaError('FORBIDDEN', 'derivative is not available in salary formulas');
    },
  },
  { override: true },
);

export const ALLOWED_FUNCTIONS = new Set(['min', 'max', 'round', 'floor', 'ceil', 'abs']);

export const MAX_FORMULA_LENGTH = 500;

export type FormulaErrorCode =
  | 'SYNTAX'
  | 'UNKNOWN_SYMBOL'
  | 'FORBIDDEN'
  | 'TOO_LONG'
  | 'NOT_FINITE';

export class FormulaError extends Error {
  code: FormulaErrorCode;
  symbol?: string;

  constructor(code: FormulaErrorCode, message: string, symbol?: string) {
    super(message);
    this.name = 'FormulaError';
    this.code = code;
    this.symbol = symbol;
  }
}

export type FormulaScope = Record<string, number>;

interface Parsed {
  node: MathNode;
  symbols: string[];
}

const parseCache = new Map<string, Parsed>();

function parseOnly(source: string): Parsed {
  const src = source.trim();
  if (src.length === 0) throw new FormulaError('SYNTAX', 'Formula is empty');
  if (src.length > MAX_FORMULA_LENGTH) {
    throw new FormulaError('TOO_LONG', `Formula exceeds ${MAX_FORMULA_LENGTH} characters`);
  }

  const cached = parseCache.get(src);
  if (cached) return cached;

  let node: MathNode;
  try {
    node = math.parse(src);
  } catch (err) {
    throw new FormulaError('SYNTAX', (err as Error).message);
  }

  const symbols = new Set<string>();
  node.traverse((n) => {
    switch (n.type) {
      case 'AssignmentNode':
      case 'FunctionAssignmentNode':
        throw new FormulaError('FORBIDDEN', 'Assignment is not allowed in a salary formula');
      case 'AccessorNode':
      case 'IndexNode':
        throw new FormulaError('FORBIDDEN', 'Property access is not allowed in a salary formula');
      case 'FunctionNode': {
        const fnName = (n as unknown as { fn: { name?: string } }).fn?.name ?? '';
        if (!ALLOWED_FUNCTIONS.has(fnName)) {
          throw new FormulaError('FORBIDDEN', `Function "${fnName}" is not allowed`, fnName);
        }
        break;
      }
      case 'SymbolNode': {
        const name = (n as unknown as { name: string }).name;
        if (!ALLOWED_FUNCTIONS.has(name)) symbols.add(name);
        break;
      }
      default:
        break;
    }
  });

  const parsed: Parsed = { node, symbols: [...symbols] };
  parseCache.set(src, parsed);
  return parsed;
}

/**
 * Validate a formula against the symbols that will be available at run time.
 * Called when a rule is saved, so a broken rule never reaches a payslip.
 */
export function validateFormula(source: string, availableSymbols: string[]): void {
  const { symbols } = parseOnly(source);
  const available = new Set(availableSymbols);
  for (const s of symbols) {
    if (!available.has(s)) {
      throw new FormulaError(
        'UNKNOWN_SYMBOL',
        `Unknown symbol "${s}". Available: ${availableSymbols.join(', ')}`,
        s,
      );
    }
  }
}

export interface FormulaResult {
  value: Decimal;
  /** The symbols the formula actually read, with the values they held. */
  inputs: Record<string, number>;
}

export function evaluateFormula(source: string, scope: FormulaScope): FormulaResult {
  const { node, symbols } = parseOnly(source);

  const inputs: Record<string, number> = {};
  for (const s of symbols) {
    if (!(s in scope)) {
      throw new FormulaError('UNKNOWN_SYMBOL', `Unknown symbol "${s}"`, s);
    }
    inputs[s] = scope[s];
  }

  let raw: unknown;
  try {
    raw = node.evaluate({ ...scope });
  } catch (err) {
    if (err instanceof FormulaError) throw err;
    throw new FormulaError('SYNTAX', (err as Error).message);
  }

  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num)) {
    throw new FormulaError('NOT_FINITE', 'Formula did not produce a finite number');
  }

  return { value: money(num), inputs };
}

/** Truthiness test for a rule's optional condition formula. */
export function evaluateCondition(source: string, scope: FormulaScope): boolean {
  const { node } = parseOnly(source);
  try {
    return Boolean(node.evaluate({ ...scope }));
  } catch (err) {
    if (err instanceof FormulaError) throw err;
    throw new FormulaError('SYNTAX', (err as Error).message);
  }
}
