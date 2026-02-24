import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { evaluateSimulation } from '../inventory/eval';
import { simulateInventory } from '../inventory/simulate';

const pricingRuleSchema = z.object({
  daysToExpireAtMost: z.number().int().nonnegative(),
  priceMultiplier: z.number().positive(),
});

const itemPolicySchema = z.object({
  sku: z.string(),
  reorderPoint: z.number().int().nonnegative(),
  orderUpTo: z.number().int().nonnegative(),
  pricing: z.array(pricingRuleSchema).default([]),
  donateDaysToExpireAtMost: z.number().int().nonnegative(),
  donateMaxFractionPerDay: z.number().min(0).max(1),
  freezeDaysToExpireAtMost: z.number().int().nonnegative(),
  freezeMaxUnitsPerDay: z.number().int().nonnegative(),
});

const inventoryPolicySchema = z.object({
  id: z.string(),
  name: z.string(),
  perSku: z.record(itemPolicySchema),
});

const itemSpecSchema = z.object({
  sku: z.string(),
  name: z.string(),
  category: z.enum([
    'produce',
    'meat',
    'dairy',
    'bakery',
    'prepared',
    'frozen',
    'other',
  ]),
  unitCost: z.number().nonnegative(),
  basePrice: z.number().nonnegative(),
  shelfLifeDays: z.number().int().positive(),
  leadTimeDays: z.number().int().nonnegative(),
  baseDailyDemand: z.number().nonnegative(),
  priceElasticity: z.number(),
  shrinkRate: z.number().min(0).max(1),
  canFreeze: z.boolean(),
  freezeCostPerUnit: z.number().nonnegative(),
  frozenShelfLifeDays: z.number().int().positive(),
  frozenPriceMultiplier: z.number().positive(),
});

const simConfigSchema = z.object({
  days: z.number().int().positive(),
  seed: z.number().int(),
  holdingCostPerUnitPerDay: z.number().nonnegative(),
  wasteDisposalCostPerUnit: z.number().nonnegative(),
  demandNoiseStdDev: z.number().nonnegative(),
  countStockouts: z.boolean(),
});

const evalConfigSchema = z.object({
  weights: z.object({
    profit: z.number().nonnegative(),
    wasteReduction: z.number().nonnegative(),
    satisfaction: z.number().nonnegative(),
    humanitarian: z.number().nonnegative(),
  }),
  profitPerDayTarget: z.number(),
  wasteRateTarget: z.number().min(0).max(1),
  satisfactionTarget: z.number().min(0).max(1),
  donationRateTarget: z.number().min(0).max(1),
});

export const inventorySimulationTool = createTool({
  id: 'run-inventory-simulation',
  description:
    'Runs an inventory simulation and returns evaluation score + key metrics for a proposed policy.',
  inputSchema: z.object({
    items: z.array(itemSpecSchema),
    policy: inventoryPolicySchema,
    simConfig: simConfigSchema,
    evalConfig: evalConfigSchema,
    includeDailyBreakdown: z
      .boolean()
      .default(false)
      .describe('If true, returns day-by-day SKU metrics (can be large)'),
  }),
  outputSchema: z.object({
    evaluation: z.object({
      score: z.number().min(0).max(1),
      breakdown: z.object({
        profitScore: z.number().min(0).max(1),
        wasteReductionScore: z.number().min(0).max(1),
        satisfactionScore: z.number().min(0).max(1),
        humanitarianScore: z.number().min(0).max(1),
      }),
      raw: z.object({
        profitPerDay: z.number(),
        wasteRate: z.number().min(0).max(1),
        fillRate: z.number().min(0).max(1),
        donationRate: z.number().min(0).max(1),
      }),
    }),
    totals: z.object({
      revenue: z.number(),
      cogs: z.number(),
      holdingCost: z.number(),
      wasteCost: z.number(),
      freezeCost: z.number(),
      profit: z.number(),
      demand: z.number(),
      sold: z.number(),
      stockout: z.number(),
      wasted: z.number(),
      donated: z.number(),
    }),
    perSkuTotals: z.array(
      z.object({
        sku: z.string(),
        sold: z.number(),
        stockout: z.number(),
        wasted: z.number(),
        donated: z.number(),
      }),
    ),
    dailyBreakdown: z.any().optional(),
  }),
  execute: async (inputData) => {
    const sim = simulateInventory({
      items: inputData.items as any,
      policy: inputData.policy as any,
      config: inputData.simConfig as any,
    });
    const evaluation = evaluateSimulation(sim, inputData.evalConfig as any);

    const perSkuTotalsMap = new Map<
      string,
      { sku: string; sold: number; stockout: number; wasted: number; donated: number }
    >();
    for (const it of inputData.items) {
      perSkuTotalsMap.set(it.sku, { sku: it.sku, sold: 0, stockout: 0, wasted: 0, donated: 0 });
    }
    for (const d of sim.days) {
      for (const s of d.perSku) {
        const row = perSkuTotalsMap.get(s.sku) ?? {
          sku: s.sku,
          sold: 0,
          stockout: 0,
          wasted: 0,
          donated: 0,
        };
        row.sold += s.soldFresh + s.soldFrozen;
        row.stockout += s.stockout;
        row.wasted += s.wasted;
        row.donated += s.donated;
        perSkuTotalsMap.set(s.sku, row);
      }
    }

    return {
      evaluation,
      totals: sim.totals,
      perSkuTotals: [...perSkuTotalsMap.values()],
      dailyBreakdown: inputData.includeDailyBreakdown ? sim.days : undefined,
    };
  },
});

