import { randomUUID } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { availableSymbols } from '@shared/engine.js';
import { FormulaError, validateFormula } from '@shared/formula.js';
import type { SalaryRule as SalaryRuleShape } from '@shared/types.js';

import { DEMO_ORGANISATION_ID } from '../config/tenant.js';
import { prisma } from '../db/prisma.js';
import { AppError, versionConflict } from '../lib/app-error.js';
import { requirePermission } from '../middleware/auth.js';
import { realtime } from '../realtime/events.js';
import { diffFields, recordAudit } from '../services/audit.js';
import { notify } from '../services/notifications.js';
import { asDate, isoDate } from '../services/payroll-inputs.js';

export const salaryRouter = Router();

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idParam = z.object({ id: z.string().min(1) });

const structureSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,30}$/),
  description: z.string().trim().max(500).default(''),
});

const ruleBody = z.object({
  structureId: z.string().min(1),
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,29}$/),
  name: z.string().trim().min(2).max(120),
  category: z.enum(['BASIC', 'ALLOWANCES', 'GROSS', 'DEDUCTIONS', 'NET']),
  sequence: z.number().int().min(1).max(999),
  type: z.enum(['FIXED', 'PERCENTAGE', 'FORMULA']),
  amount: z.string().regex(/^-?\d{1,12}(\.\d{1,2})?$/).nullable().default(null),
  percentage: z.string().regex(/^-?\d{1,4}(\.\d{1,4})?$/).nullable().default(null),
  baseCode: z.string().trim().toUpperCase().max(30).nullable().default(null),
  formula: z.string().trim().max(500).nullable().default(null),
  conditionFormula: z.string().trim().max(500).nullable().default(null),
  isActive: z.boolean().default(true),
  effectiveFrom: isoDay,
});

const serializeRule = (rule: {
  id: string;
  structureId: string;
  code: string;
  name: string;
  category: string;
  sequence: number;
  type: string;
  amount: Prisma.Decimal | null;
  percentage: Prisma.Decimal | null;
  baseCode: string | null;
  formula: string | null;
  conditionFormula: string | null;
  isActive: boolean;
  ruleVersion: number;
  effectiveFrom: Date;
  supersededAt: Date | null;
}) => ({
  ...rule,
  amount: rule.amount?.toFixed(2) ?? null,
  percentage: rule.percentage?.toString() ?? null,
  effectiveFrom: isoDate(rule.effectiveFrom),
  supersededAt: rule.supersededAt?.toISOString() ?? null,
});

/**
 * Reject a rule the payroll engine could not evaluate.
 *
 * The check runs against the same symbol table the engine builds — the payroll
 * constants plus every earlier rule code in the structure — so a formula that
 * saves here is a formula that will compute, and an operator finds out at the
 * moment they write it rather than during a payroll run.
 */
async function validateRule(
  db: Prisma.TransactionClient,
  input: z.infer<typeof ruleBody>,
  ignoreRuleId?: string,
) {
  const siblings = await db.salaryRule.findMany({
    where: { structureId: input.structureId, supersededAt: null, id: { not: ignoreRuleId } },
    orderBy: [{ sequence: 'asc' }, { code: 'asc' }],
  });
  const ordered: SalaryRuleShape[] = [
    ...siblings.map((rule) => ({
      id: rule.id,
      structureId: rule.structureId,
      code: rule.code,
      name: rule.name,
      category: rule.category,
      sequence: rule.sequence,
      type: rule.type,
      amount: rule.amount?.toFixed(2) ?? null,
      percentage: rule.percentage?.toString() ?? null,
      baseCode: rule.baseCode,
      formula: rule.formula,
      conditionFormula: rule.conditionFormula,
      isActive: rule.isActive,
      ruleVersion: rule.ruleVersion,
    })),
    {
      id: ignoreRuleId ?? 'draft',
      structureId: input.structureId,
      code: input.code,
      name: input.name,
      category: input.category,
      sequence: input.sequence,
      type: input.type,
      amount: input.amount,
      percentage: input.percentage,
      baseCode: input.baseCode,
      formula: input.formula,
      conditionFormula: input.conditionFormula,
      isActive: input.isActive,
      ruleVersion: 1,
    },
  ].sort((a, b) => a.sequence - b.sequence || a.code.localeCompare(b.code));

  const index = ordered.findIndex((rule) => rule.code === input.code);
  const symbols = availableSymbols(ordered, index);

  if (input.type === 'FIXED' && input.amount === null) {
    throw new AppError('RULE_INVALID', 400, 'A fixed rule needs an amount.');
  }
  if (input.type === 'PERCENTAGE') {
    if (input.percentage === null) throw new AppError('RULE_INVALID', 400, 'A percentage rule needs a percentage.');
    const base = input.baseCode ?? 'WAGE';
    if (!symbols.includes(base)) {
      throw new AppError(
        'RULE_INVALID',
        400,
        `The base "${base}" is not computed before ${input.code}.`,
        `Available at this position: ${symbols.join(', ')}.`,
      );
    }
  }
  try {
    if (input.type === 'FORMULA') {
      if (!input.formula) throw new AppError('RULE_INVALID', 400, 'A formula rule needs a formula.');
      validateFormula(input.formula, symbols);
    }
    if (input.conditionFormula) validateFormula(input.conditionFormula, symbols);
  } catch (error) {
    if (error instanceof FormulaError) {
      throw new AppError('RULE_INVALID', 400, error.message, `Available at this position: ${symbols.join(', ')}.`);
    }
    throw error;
  }
}

/**
 * Flag every open payroll run built on a structure as needing a recompute.
 *
 * A rule change must never make a screen disagree with the server: if the run
 * stays COMPUTED, the stored payslips are from the old rule while the config
 * screen shows the new one. Returning it to DRAFT makes the discrepancy a
 * visible task rather than a silent inconsistency.
 */
async function markStructureForRecompute(db: Prisma.TransactionClient, structureId: string) {
  const affected = await db.payrun.findMany({
    where: { salaryStructureId: structureId, status: 'COMPUTED' },
    select: { id: true },
  });
  if (affected.length === 0) return [];
  const ids = affected.map((row) => row.id);
  await db.payrun.updateMany({
    where: { id: { in: ids } },
    data: { status: 'DRAFT', computedAt: null, inputSnapshotHash: null, version: { increment: 1 } },
  });
  await db.payslip.updateMany({ where: { payrunId: { in: ids } }, data: { status: 'DRAFT' } });
  return ids;
}

/** Refuse to edit a rule that a decided payroll run already paid on. */
async function assertRuleNotDecided(db: Prisma.TransactionClient, structureId: string) {
  const decided = await db.payrun.findFirst({
    where: { salaryStructureId: structureId, status: { in: ['VALIDATED', 'PAID'] } },
    orderBy: { periodStart: 'desc' },
    select: { name: true, status: true },
  });
  return decided;
}

/* ── structures ──────────────────────────────────────────────────────────── */

salaryRouter.get('/salary-structures', requirePermission('salary.structure.read'), async (_request, response) => {
  const [structures, rules] = await prisma.$transaction([
    prisma.salaryStructure.findMany({ where: { organisationId: DEMO_ORGANISATION_ID }, orderBy: { name: 'asc' } }),
    prisma.salaryRule.findMany({ orderBy: [{ sequence: 'asc' }, { code: 'asc' }] }),
  ]);
  response.locals.recordsRead = structures.length + rules.length;
  response.json({ data: { structures, rules: rules.map(serializeRule) } });
});

salaryRouter.post('/salary-structures', requirePermission('salary.structure.write'), async (request, response) => {
  const input = structureSchema.parse(request.body);
  const actor = request.currentUser!;
  const created = await prisma.$transaction(async (tx) => {
    const clash = await tx.salaryStructure.findUnique({ where: { code: input.code } });
    if (clash) throw new AppError('STRUCTURE_EXISTS', 409, `A structure with code ${input.code} already exists.`);
    const structure = await tx.salaryStructure.create({
      data: { id: `ss-${randomUUID()}`, organisationId: DEMO_ORGANISATION_ID, ...input },
    });
    await recordAudit(tx, actor, {
      action: 'STRUCTURE_CREATED',
      entityType: 'SalaryStructure',
      entityId: structure.id,
      summary: `${structure.name} (${structure.code}) created.`,
      after: input,
      correlationId: request.requestId,
    });
    return structure;
  });
  realtime.publish({ type: 'settings.updated', entityId: created.id, affectedEmployeeIds: [] });
  response.status(201).json({ data: created });
});

salaryRouter.patch('/salary-structures/:id', requirePermission('salary.structure.write'), async (request, response) => {
  const { id } = idParam.parse(request.params);
  const input = structureSchema.partial().extend({ version: z.number().int().positive() }).parse(request.body);
  const { version, ...patch } = input;
  const actor = request.currentUser!;
  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.salaryStructure.findUnique({ where: { id } });
    if (!current) throw new AppError('STRUCTURE_NOT_FOUND', 404, 'Salary structure not found.');
    if (current.version !== version) throw versionConflict('salary structure', current.version);
    const changed = await tx.salaryStructure.updateMany({
      where: { id, version },
      data: { ...patch, version: { increment: 1 } },
    });
    if (changed.count !== 1) throw versionConflict('salary structure', current.version);
    const delta = diffFields(current as unknown as Record<string, unknown>, patch);
    await recordAudit(tx, actor, {
      action: 'STRUCTURE_UPDATED',
      entityType: 'SalaryStructure',
      entityId: id,
      summary: `${current.name}: ${Object.keys(delta.after).join(', ') || 'no field'} updated.`,
      before: delta.before,
      after: delta.after,
      correlationId: request.requestId,
    });
    return tx.salaryStructure.findUniqueOrThrow({ where: { id } });
  });
  realtime.publish({ type: 'settings.updated', entityId: id, affectedEmployeeIds: [] });
  response.json({ data: updated });
});

/* ── rules ───────────────────────────────────────────────────────────────── */

salaryRouter.post('/salary-rules', requirePermission('salary.rule.write'), async (request, response) => {
  const input = ruleBody.parse(request.body);
  const actor = request.currentUser!;
  const created = await prisma.$transaction(async (tx) => {
    const structure = await tx.salaryStructure.findUnique({ where: { id: input.structureId } });
    if (!structure) throw new AppError('STRUCTURE_NOT_FOUND', 404, 'Salary structure not found.');
    const clash = await tx.salaryRule.findFirst({
      where: { structureId: input.structureId, code: input.code, supersededAt: null },
    });
    if (clash) {
      throw new AppError(
        'RULE_EXISTS',
        409,
        `${input.code} already exists in ${structure.name}.`,
        'Edit the existing rule, which creates a new version of it.',
      );
    }
    await validateRule(tx, input);
    const rule = await tx.salaryRule.create({
      data: {
        id: `sr-${randomUUID()}`,
        structureId: input.structureId,
        code: input.code,
        name: input.name,
        category: input.category,
        sequence: input.sequence,
        type: input.type,
        amount: input.amount,
        percentage: input.percentage,
        baseCode: input.baseCode,
        formula: input.formula,
        conditionFormula: input.conditionFormula,
        isActive: input.isActive,
        ruleVersion: 1,
        effectiveFrom: asDate(input.effectiveFrom),
      },
    });
    const stale = await markStructureForRecompute(tx, input.structureId);
    await recordAudit(tx, actor, {
      action: 'RULE_CREATED',
      entityType: 'SalaryRule',
      entityId: rule.id,
      summary: `${rule.code} added to ${structure.name}, effective ${input.effectiveFrom}.`,
      after: { ...input, staleRuns: stale },
      correlationId: request.requestId,
    });
    return rule;
  });
  realtime.publish({ type: 'settings.updated', entityId: created.id, affectedEmployeeIds: [] });
  realtime.publish({ type: 'payroll.updated', entityId: created.structureId, affectedEmployeeIds: [] });
  response.status(201).json({ data: serializeRule(created) });
});

/**
 * Edit a rule.
 *
 * If no decided payroll run depends on the structure, the rule is corrected in
 * place. If one does, the change becomes a new version: the old row is closed
 * with `supersededAt` so historical payslips still resolve the formula they
 * were computed from, and the engine only ever loads live rules.
 */
salaryRouter.patch('/salary-rules/:id', requirePermission('salary.rule.write'), async (request, response) => {
  const { id } = idParam.parse(request.params);
  const parsed = ruleBody
    .partial()
    .extend({ version: z.number().int().positive(), reason: z.string().trim().max(500).default('') })
    .parse(request.body);
  const { version, reason, ...patch } = parsed;
  const actor = request.currentUser!;

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.salaryRule.findUnique({ where: { id }, include: { structure: true } });
    if (!current) throw new AppError('RULE_NOT_FOUND', 404, 'Salary rule not found.');
    if (current.supersededAt) {
      throw new AppError('RULE_SUPERSEDED', 409, 'This rule version has been superseded.', 'Edit the current version.');
    }
    if (current.ruleVersion !== version) throw versionConflict('salary rule', current.ruleVersion);

    const merged = ruleBody.parse({
      structureId: current.structureId,
      code: patch.code ?? current.code,
      name: patch.name ?? current.name,
      category: patch.category ?? current.category,
      sequence: patch.sequence ?? current.sequence,
      type: patch.type ?? current.type,
      amount: patch.amount ?? current.amount?.toFixed(2) ?? null,
      percentage: patch.percentage ?? current.percentage?.toString() ?? null,
      baseCode: patch.baseCode ?? current.baseCode,
      formula: patch.formula ?? current.formula,
      conditionFormula: patch.conditionFormula ?? current.conditionFormula,
      isActive: patch.isActive ?? current.isActive,
      effectiveFrom: patch.effectiveFrom ?? isoDate(current.effectiveFrom),
    });
    await validateRule(tx, merged, id);

    const decided = await assertRuleNotDecided(tx, current.structureId);
    const now = new Date();

    if (decided) {
      await tx.salaryRule.updateMany({
        where: { id, ruleVersion: version },
        data: { supersededAt: now, isActive: false },
      });
      const successor = await tx.salaryRule.create({
        data: {
          id: `sr-${randomUUID()}`,
          structureId: merged.structureId,
          code: merged.code,
          name: merged.name,
          category: merged.category,
          sequence: merged.sequence,
          type: merged.type,
          amount: merged.amount,
          percentage: merged.percentage,
          baseCode: merged.baseCode,
          formula: merged.formula,
          conditionFormula: merged.conditionFormula,
          isActive: merged.isActive,
          ruleVersion: current.ruleVersion + 1,
          effectiveFrom: asDate(merged.effectiveFrom),
        },
      });
      const stale = await markStructureForRecompute(tx, current.structureId);
      await recordAudit(tx, actor, {
        action: 'RULE_VERSIONED',
        entityType: 'SalaryRule',
        entityId: successor.id,
        summary: `${current.code} v${successor.ruleVersion} created because ${decided.name} is already ${decided.status.toLowerCase()}.`,
        before: { ruleId: current.id, version: current.ruleVersion, formula: current.formula },
        after: { ruleId: successor.id, version: successor.ruleVersion, formula: successor.formula, staleRuns: stale },
        reason: reason || undefined,
        correlationId: request.requestId,
      });
      await notify(tx, {
        kind: 'RULE_VERSIONED',
        role: 'HR_PAYROLL_USER',
        title: `${current.code} changed — payroll needs recomputing`,
        body: `A new version of ${current.name} takes effect ${merged.effectiveFrom}.`,
        severity: 'WARNING',
        entityType: 'SalaryRule',
        entityId: successor.id,
      });
      return successor;
    }

    const changed = await tx.salaryRule.updateMany({
      where: { id, ruleVersion: version },
      data: {
        code: merged.code,
        name: merged.name,
        category: merged.category,
        sequence: merged.sequence,
        type: merged.type,
        amount: merged.amount,
        percentage: merged.percentage,
        baseCode: merged.baseCode,
        formula: merged.formula,
        conditionFormula: merged.conditionFormula,
        isActive: merged.isActive,
        effectiveFrom: asDate(merged.effectiveFrom),
        ruleVersion: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw versionConflict('salary rule', current.ruleVersion);
    const stale = await markStructureForRecompute(tx, current.structureId);
    await recordAudit(tx, actor, {
      action: 'RULE_UPDATED',
      entityType: 'SalaryRule',
      entityId: id,
      summary: `${current.code} updated in ${current.structure.name}.`,
      before: { formula: current.formula, amount: current.amount?.toFixed(2), percentage: current.percentage?.toString() },
      after: { formula: merged.formula, amount: merged.amount, percentage: merged.percentage, staleRuns: stale },
      reason: reason || undefined,
      correlationId: request.requestId,
    });
    return tx.salaryRule.findUniqueOrThrow({ where: { id } });
  });

  realtime.publish({ type: 'settings.updated', entityId: result.id, affectedEmployeeIds: [] });
  realtime.publish({ type: 'payroll.updated', entityId: result.structureId, affectedEmployeeIds: [] });
  response.json({ data: serializeRule(result) });
});

/** Explicitly cut a new version of a rule, without changing anything else. */
salaryRouter.post('/salary-rules/:id/version', requirePermission('salary.rule.write'), async (request, response) => {
  const { id } = idParam.parse(request.params);
  const { effectiveFrom, reason } = z
    .object({ effectiveFrom: isoDay, reason: z.string().trim().min(3).max(500) })
    .parse(request.body);
  const actor = request.currentUser!;

  const successor = await prisma.$transaction(async (tx) => {
    const current = await tx.salaryRule.findUnique({ where: { id } });
    if (!current) throw new AppError('RULE_NOT_FOUND', 404, 'Salary rule not found.');
    if (current.supersededAt) throw new AppError('RULE_SUPERSEDED', 409, 'This rule version has been superseded.');
    await tx.salaryRule.update({ where: { id }, data: { supersededAt: new Date(), isActive: false } });
    const created = await tx.salaryRule.create({
      data: {
        id: `sr-${randomUUID()}`,
        structureId: current.structureId,
        code: current.code,
        name: current.name,
        category: current.category,
        sequence: current.sequence,
        type: current.type,
        amount: current.amount,
        percentage: current.percentage,
        baseCode: current.baseCode,
        formula: current.formula,
        conditionFormula: current.conditionFormula,
        isActive: true,
        ruleVersion: current.ruleVersion + 1,
        effectiveFrom: asDate(effectiveFrom),
      },
    });
    await recordAudit(tx, actor, {
      action: 'RULE_VERSIONED',
      entityType: 'SalaryRule',
      entityId: created.id,
      summary: `${current.code} v${created.ruleVersion} opened, effective ${effectiveFrom}.`,
      before: { version: current.ruleVersion },
      after: { version: created.ruleVersion, effectiveFrom },
      reason,
      correlationId: request.requestId,
    });
    return created;
  });

  realtime.publish({ type: 'settings.updated', entityId: successor.id, affectedEmployeeIds: [] });
  response.status(201).json({ data: serializeRule(successor) });
});
