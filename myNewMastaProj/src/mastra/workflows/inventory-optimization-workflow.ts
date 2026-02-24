import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { evaluateSimulation } from '../inventory/eval';
import { simulateInventory } from '../inventory/simulate';
import type {
  EvalConfig,
  EvaluationResult,
  InventoryPolicy,
  ItemSpec,
  SimulationConfig,
} from '../inventory/types';

const presetSchema = z.enum(['richmond-va-small']);

const datasetSchema = z.object({
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
});

function buildBaselinePolicy(items: ItemSpec[], id = 'baseline'): InventoryPolicy {
  const perSku: InventoryPolicy['perSku'] = {};

  for (const it of items) {
    const daily = Math.max(1, Math.round(it.baseDailyDemand));
    const orderUpTo = Math.max(1, Math.round(daily * 1.2));
    const reorderPoint = Math.max(0, Math.round(daily * 0.7));

    perSku[it.sku] = {
      sku: it.sku,
      reorderPoint,
      orderUpTo,
      pricing: [
        { daysToExpireAtMost: 2, priceMultiplier: 0.9 },
        { daysToExpireAtMost: 1, priceMultiplier: 0.75 },
        { daysToExpireAtMost: 0, priceMultiplier: 0.55 },
      ],
      donateDaysToExpireAtMost: 1,
      donateMaxFractionPerDay: 0.1,
      freezeDaysToExpireAtMost: it.canFreeze ? 1 : 0,
      freezeMaxUnitsPerDay: it.canFreeze ? Math.max(0, Math.round(daily * 0.15)) : 0,
    };
  }

  return {
    id,
    name: 'Baseline policy (heuristic)',
    perSku,
  };
}

function parsePolicyJson(text: string): InventoryPolicy {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as InventoryPolicy;
  } catch {
    // Fallback: extract the first top-level JSON object.
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new Error('Agent did not return JSON');
    }
    const slice = trimmed.slice(start, end + 1);
    return JSON.parse(slice) as InventoryPolicy;
  }
}

function policyHasAllSkus(policy: InventoryPolicy, items: ItemSpec[]) {
  for (const it of items) {
    if (!policy.perSku?.[it.sku]) return false;
  }
  return true;
}

function summarizeEval(e: EvaluationResult) {
  return {
    score: Number(e.score.toFixed(4)),
    profitScore: Number(e.breakdown.profitScore.toFixed(3)),
    wasteReductionScore: Number(e.breakdown.wasteReductionScore.toFixed(3)),
    satisfactionScore: Number(e.breakdown.satisfactionScore.toFixed(3)),
    humanitarianScore: Number(e.breakdown.humanitarianScore.toFixed(3)),
    profitPerDay: Number(e.raw.profitPerDay.toFixed(2)),
    wasteRate: Number(e.raw.wasteRate.toFixed(4)),
    fillRate: Number(e.raw.fillRate.toFixed(4)),
    donationRate: Number(e.raw.donationRate.toFixed(4)),
  };
}

const loadDataset = createStep({
  id: 'load-inventory-dataset',
  description: 'Loads sample perishable SKU dataset + sim/eval configs',
  inputSchema: z.object({
    preset: presetSchema.default('richmond-va-small'),
  }),
  outputSchema: datasetSchema,
  execute: async ({ inputData }) => {
    const preset = inputData?.preset ?? 'richmond-va-small';

    if (preset !== 'richmond-va-small') {
      throw new Error(`Unknown preset: ${preset}`);
    }

    const items: ItemSpec[] = [
      {
        sku: 'BANANA',
        name: 'Bananas (lb)',
        category: 'produce',
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
        category: 'dairy',
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
        category: 'meat',
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
        category: 'bakery',
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

    const simConfig: SimulationConfig = {
      days: 28,
      seed: 42,
      holdingCostPerUnitPerDay: 0.01,
      wasteDisposalCostPerUnit: 0.05,
      demandNoiseStdDev: 0.18,
      countStockouts: true,
    };

    const evalConfig: EvalConfig = {
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
    };

    return {
      store: {
        name: 'Richmond Sample Store',
        region: 'Richmond, VA',
        notes: 'Synthetic starter dataset for iterating on the self-improvement loop.',
      },
      items,
      simConfig,
      evalConfig,
    };
  },
});

export const optimizePolicy = createStep({
  id: 'optimize-inventory-policy',
  description: 'Iteratively proposes, simulates, and selects improved inventory policies',
  inputSchema: z.object({
    dataset: datasetSchema,
    iterations: z.number().int().min(1).max(20).default(6),
    candidatesPerIteration: z.number().int().min(1).max(10).default(3),
    seedBumpPerCandidate: z.number().int().min(0).max(100000).default(11),
  }),
  outputSchema: z.object({
    bestPolicy: z.any(),
    bestEvaluation: z.object({
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
    history: z.array(
      z.object({
        iteration: z.number().int(),
        candidate: z.number().int(),
        evaluation: z.any(),
        policyId: z.string(),
        policyName: z.string(),
      }),
    ),
  }),
  execute: async ({ inputData, mastra }) => {
    if (!inputData) throw new Error('Input data not found');

    const { dataset, iterations, candidatesPerIteration, seedBumpPerCandidate } = inputData;
    const items = dataset.items as unknown as ItemSpec[];
    const simConfig = dataset.simConfig as unknown as SimulationConfig;
    const evalConfig = dataset.evalConfig as unknown as EvalConfig;

    const agent = mastra?.getAgent('inventoryOptimizerAgent');
    if (!agent) {
      throw new Error(
        "Inventory optimizer agent not found. Ensure it's registered in `src/mastra/index.ts`.",
      );
    }

    const history: Array<{
      iteration: number;
      candidate: number;
      evaluation: EvaluationResult;
      policyId: string;
      policyName: string;
    }> = [];

    const evalPolicy = (policy: InventoryPolicy, seedOffset = 0) => {
      const sim = simulateInventory({
        items,
        policy,
        config: { ...simConfig, seed: simConfig.seed + seedOffset },
      });
      return evaluateSimulation(sim, evalConfig);
    };

    let bestPolicy = buildBaselinePolicy(items, 'baseline');
    let bestEvaluation = evalPolicy(bestPolicy, 0);

    history.push({
      iteration: 0,
      candidate: 0,
      evaluation: bestEvaluation,
      policyId: bestPolicy.id,
      policyName: bestPolicy.name,
    });

    for (let iter = 1; iter <= iterations; iter++) {
      for (let c = 1; c <= candidatesPerIteration; c++) {
        const seedOffset = iter * 1000 + c * seedBumpPerCandidate;

        const prompt = `
You are optimizing inventory policy for a grocery store.

Return ONLY JSON for the next candidate policy.

## Dataset (SKUs)
${JSON.stringify(
  items.map((it) => ({
    sku: it.sku,
    name: it.name,
    category: it.category,
    shelfLifeDays: it.shelfLifeDays,
    leadTimeDays: it.leadTimeDays,
    baseDailyDemand: it.baseDailyDemand,
    unitCost: it.unitCost,
    basePrice: it.basePrice,
    canFreeze: it.canFreeze,
  })),
  null,
  2,
)}

## Best-so-far policy
${JSON.stringify(bestPolicy, null, 2)}

## Best-so-far evaluation
${JSON.stringify(summarizeEval(bestEvaluation), null, 2)}

## Constraints
- Output must be valid JSON (no markdown, no commentary)
- Must include every sku in perSku
- reorderPoint and orderUpTo must be integers and orderUpTo >= reorderPoint
- pricing should include 2-4 rules that discount more as daysToExpire decreases
- donateMaxFractionPerDay should be small (0..0.25)
- If canFreeze=false, freezeMaxUnitsPerDay must be 0

## Goal
Improve total score while avoiding huge stockouts and excessive waste.
Generate a plausible variant of the best policy (don’t randomize wildly).
`;

        const resp = await agent.stream([{ role: 'user', content: prompt }]);
        let text = '';
        for await (const chunk of resp.textStream) {
          text += chunk;
        }

        let candidatePolicy: InventoryPolicy;
        try {
          candidatePolicy = parsePolicyJson(text);
        } catch (e) {
          // Skip malformed outputs but continue optimization.
          continue;
        }

        if (!policyHasAllSkus(candidatePolicy, items)) continue;

        // Basic normalization: enforce constraints around freeze on non-freezables.
        for (const it of items) {
          const p = candidatePolicy.perSku[it.sku];
          if (!p) continue;
          if (!it.canFreeze) {
            p.freezeMaxUnitsPerDay = 0;
            p.freezeDaysToExpireAtMost = 0;
          }
          if (p.orderUpTo < p.reorderPoint) {
            p.orderUpTo = p.reorderPoint;
          }
          p.reorderPoint = Math.max(0, Math.round(p.reorderPoint));
          p.orderUpTo = Math.max(0, Math.round(p.orderUpTo));
          p.freezeMaxUnitsPerDay = Math.max(0, Math.round(p.freezeMaxUnitsPerDay));
        }

        const evaluation = evalPolicy(candidatePolicy, seedOffset);
        history.push({
          iteration: iter,
          candidate: c,
          evaluation,
          policyId: candidatePolicy.id ?? `iter-${iter}-cand-${c}`,
          policyName: candidatePolicy.name ?? 'Candidate policy',
        });

        if (evaluation.score > bestEvaluation.score) {
          bestEvaluation = evaluation;
          bestPolicy = candidatePolicy;
        }
      }
    }

    return {
      bestPolicy,
      bestEvaluation,
      history: history.map((h) => ({
        iteration: h.iteration,
        candidate: h.candidate,
        evaluation: {
          score: h.evaluation.score,
          breakdown: h.evaluation.breakdown,
          raw: h.evaluation.raw,
        },
        policyId: h.policyId,
        policyName: h.policyName,
      })),
    };
  },
});

const inventoryOptimizationWorkflow = createWorkflow({
  id: 'inventory-optimization-workflow',
  inputSchema: z.object({
    preset: presetSchema.default('richmond-va-small'),
    iterations: z.number().int().min(1).max(20).default(6),
    candidatesPerIteration: z.number().int().min(1).max(10).default(3),
  }),
  outputSchema: z.object({
    store: z.object({
      name: z.string(),
      region: z.string(),
    }),
    bestPolicy: z.any(),
    bestEvaluation: z.any(),
    history: z.array(z.any()),
  }),
})
  .then(loadDataset)
  .then(
    createStep({
      id: 'run-optimizer',
      description: 'Runs optimization loop over the loaded dataset',
      inputSchema: datasetSchema.extend({
        iterations: z.number().int().min(1).max(20).default(6).optional(),
        candidatesPerIteration: z.number().int().min(1).max(10).default(3).optional(),
      }),
      outputSchema: z.object({
        store: z.object({
          name: z.string(),
          region: z.string(),
        }),
        bestPolicy: z.any(),
        bestEvaluation: z.any(),
        history: z.array(z.any()),
      }),
      execute: async ({ inputData, mastra }) => {
        if (!inputData) throw new Error('Dataset not found');
        const iterations = (inputData as any).iterations ?? 6;
        const candidatesPerIteration = (inputData as any).candidatesPerIteration ?? 3;

        const result = (await optimizePolicy.execute({
          inputData: {
            dataset: inputData,
            iterations,
            candidatesPerIteration,
            seedBumpPerCandidate: 11,
          },
          mastra,
        } as any)) as any;

        return {
          store: {
            name: inputData.store.name,
            region: inputData.store.region,
          },
          bestPolicy: result.bestPolicy,
          bestEvaluation: result.bestEvaluation,
          history: result.history,
        };
      },
    }),
  );

inventoryOptimizationWorkflow.commit();

export { inventoryOptimizationWorkflow };

