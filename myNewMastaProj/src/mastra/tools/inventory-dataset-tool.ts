import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const inventoryDatasetTool = createTool({
  id: 'get-inventory-dataset',
  description:
    'Returns a small sample dataset of perishable SKUs and baseline evaluation targets for simulation.',
  inputSchema: z.object({
    preset: z
      .enum(['richmond-va-small'])
      .default('richmond-va-small')
      .describe('Which built-in sample dataset to return'),
  }),
  outputSchema: z.object({
    store: z.object({
      name: z.string(),
      region: z.string(),
      notes: z.string(),
    }),
    items: z.array(
      z.object({
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
        unitCost: z.number(),
        basePrice: z.number(),
        shelfLifeDays: z.number().int().positive(),
        leadTimeDays: z.number().int().nonnegative(),
        baseDailyDemand: z.number().nonnegative(),
        priceElasticity: z.number(),
        shrinkRate: z.number().min(0).max(1),
        canFreeze: z.boolean(),
        freezeCostPerUnit: z.number().nonnegative(),
        frozenShelfLifeDays: z.number().int().positive(),
        frozenPriceMultiplier: z.number().positive(),
      }),
    ),
    simConfig: z.object({
      days: z.number().int().positive(),
      seed: z.number().int(),
      holdingCostPerUnitPerDay: z.number().nonnegative(),
      wasteDisposalCostPerUnit: z.number().nonnegative(),
      demandNoiseStdDev: z.number().nonnegative(),
      countStockouts: z.boolean(),
    }),
    evalConfig: z.object({
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
    }),
    baselinePolicyHint: z.object({
      reorderPointMultiplier: z.number().positive(),
      orderUpToMultiplier: z.number().positive(),
      maxDiscountMultiplier: z.number().positive(),
    }),
  }),
  execute: async ({ preset }) => {
    if (preset !== 'richmond-va-small') {
      throw new Error(`Unknown preset: ${preset}`);
    }

    // These are intentionally small, stylized numbers to get the loop working.
    // Replace later with Kroger API-derived store + SKU data.
    const items = [
      {
        sku: 'BANANA',
        name: 'Bananas (lb)',
        category: 'produce' as const,
        unitCost: 0.32,
        basePrice: 0.69,
        shelfLifeDays: 5,
        leadTimeDays: 1,
        baseDailyDemand: 140,
        priceElasticity: -1.1,
        shrinkRate: 0.01,
        canFreeze: true,
        freezeCostPerUnit: 0.03,
        frozenShelfLifeDays: 30,
        frozenPriceMultiplier: 0.75,
      },
      {
        sku: 'MILK_1GAL',
        name: 'Whole Milk 1 gal',
        category: 'dairy' as const,
        unitCost: 2.35,
        basePrice: 3.99,
        shelfLifeDays: 10,
        leadTimeDays: 2,
        baseDailyDemand: 38,
        priceElasticity: -0.6,
        shrinkRate: 0.005,
        canFreeze: false,
        freezeCostPerUnit: 0,
        frozenShelfLifeDays: 1,
        frozenPriceMultiplier: 1,
      },
      {
        sku: 'CHICKEN_BREAST',
        name: 'Chicken Breast (lb)',
        category: 'meat' as const,
        unitCost: 2.9,
        basePrice: 4.99,
        shelfLifeDays: 4,
        leadTimeDays: 1,
        baseDailyDemand: 22,
        priceElasticity: -1.3,
        shrinkRate: 0.01,
        canFreeze: true,
        freezeCostPerUnit: 0.08,
        frozenShelfLifeDays: 60,
        frozenPriceMultiplier: 0.85,
      },
      {
        sku: 'BAGUETTE',
        name: 'Baguette',
        category: 'bakery' as const,
        unitCost: 0.55,
        basePrice: 1.79,
        shelfLifeDays: 2,
        leadTimeDays: 0,
        baseDailyDemand: 55,
        priceElasticity: -1.8,
        shrinkRate: 0.02,
        canFreeze: false,
        freezeCostPerUnit: 0,
        frozenShelfLifeDays: 1,
        frozenPriceMultiplier: 1,
      },
    ];

    return {
      store: {
        name: 'Richmond Sample Store',
        region: 'Richmond, VA',
        notes:
          'Synthetic starter dataset for iterating on policy shape, simulation, and eval loop.',
      },
      items,
      simConfig: {
        days: 28,
        seed: 42,
        holdingCostPerUnitPerDay: 0.01,
        wasteDisposalCostPerUnit: 0.05,
        demandNoiseStdDev: 0.18,
        countStockouts: true,
      },
      evalConfig: {
        weights: {
          profit: 0.45,
          wasteReduction: 0.25,
          satisfaction: 0.2,
          humanitarian: 0.1,
        },
        profitPerDayTarget: 180,
        wasteRateTarget: 0.08,
        satisfactionTarget: 0.97,
        donationRateTarget: 0.02,
      },
      baselinePolicyHint: {
        reorderPointMultiplier: 0.7,
        orderUpToMultiplier: 1.2,
        maxDiscountMultiplier: 0.5,
      },
    };
  },
});

