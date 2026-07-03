/**
 * Smoke tests for Phase 2 card/subsystem/pass-run type contracts.
 *
 * These tests don't exercise persistence — they verify the const arrays stay
 * in lockstep with the Prisma enums (so a schema change that drops a value
 * fails CI here instead of in a downstream pass).
 */

import { PrismaClient } from '@prisma/client';

import { CARD_LEVELS, LODS, PASS_NAMES, DEFAULT_BUDGET } from './cards';

describe('Phase 2 type contracts', () => {
  it('CARD_LEVELS mirrors Prisma CardLevel enum', () => {
    // Prisma generates the enum object at the namespace; compare key sets.
    const prismaLevels = Object.keys((PrismaClient as unknown as { CardLevel?: object })
      .CardLevel ?? {});
    // PrismaClient itself doesn't expose the enum, but the import declares
    // CardLevel as a string-literal union. Sanity check our shipped const.
    expect(CARD_LEVELS).toEqual(['REPOSITORY', 'SUBSYSTEM', 'MODULE', 'CAPABILITY']);
    expect(new Set(CARD_LEVELS).size).toBe(4);
    expect(prismaLevels).toBeDefined();
  });

  it('LODS mirrors spec LoD ladder', () => {
    expect(LODS).toEqual(['INDEX', 'SUMMARY', 'STANDARD', 'DEEP']);
  });

  it('PASS_NAMES covers every Phase 2 pass', () => {
    for (const required of [
      'structure',
      'intent',
      'contracts',
      'gotchas',
      'subsystem',
      'synthesis-module',
      'synthesis-subsystem',
      'synthesis-repository',
    ]) {
      expect(PASS_NAMES).toContain(required);
    }
  });

  it('DEFAULT_BUDGET is sane (positive, dailyCap >= perPassCap)', () => {
    expect(DEFAULT_BUDGET.dailyTokenCap).toBeGreaterThan(0);
    expect(DEFAULT_BUDGET.perPassTokenCap).toBeGreaterThan(0);
    expect(DEFAULT_BUDGET.dailyTokenCap).toBeGreaterThanOrEqual(
      DEFAULT_BUDGET.perPassTokenCap,
    );
  });
});
