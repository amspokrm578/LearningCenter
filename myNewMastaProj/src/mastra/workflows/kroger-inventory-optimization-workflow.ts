import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { krogerInventoryTool } from '../tools/kroger-inventory-tool';
import { optimizePolicy } from './inventory-optimization-workflow';

const krogerDatasetSchema = z.object({
  store: z.object({
    id: z.string(),
    name: z.string(),
    region: z.string().optional(),
    notes: z.string().optional(),
  }),
  items: z.array(z.any()),
  simConfig: z.any(),
  evalConfig: z.any(),
});

const loadKrogerInventory = createStep({
  id: 'load-kroger-inventory',
  description: 'Loads perishable inventory slice for a Kroger store by locationId',
  inputSchema: z.object({
    locationId: z
      .string()
      .describe('Kroger locationId from the Locations API or developer portal'),
  }),
  outputSchema: krogerDatasetSchema,
  execute: async ({ inputData }) => {
    if (!inputData?.locationId) {
      throw new Error('locationId is required');
    }
    const result = await krogerInventoryTool.execute({
      locationId: inputData.locationId,
    });
    return result as any;
  },
});

const krogerInventoryOptimizationWorkflow = createWorkflow({
  id: 'kroger-inventory-optimization-workflow',
  inputSchema: z.object({
    locationId: z
      .string()
      .describe('Kroger store locationId to optimize (e.g. from the Locations API)'),
    iterations: z.number().int().min(1).max(20).default(6),
    candidatesPerIteration: z.number().int().min(1).max(10).default(3),
  }),
  outputSchema: z.object({
    store: z.object({
      id: z.string(),
      name: z.string(),
      region: z.string().optional(),
    }),
    bestPolicy: z.any(),
    bestEvaluation: z.any(),
    history: z.array(z.any()),
  }),
})
  .then(loadKrogerInventory)
  .then(
    createStep({
      id: 'run-kroger-optimizer',
      description: 'Runs optimization loop over Kroger perishable inventory',
      inputSchema: krogerDatasetSchema.extend({
        iterations: z.number().int().min(1).max(20).default(6).optional(),
        candidatesPerIteration: z.number().int().min(1).max(10).default(3).optional(),
      }),
      outputSchema: z.object({
        store: z.object({
          id: z.string(),
          name: z.string(),
          region: z.string().optional(),
        }),
        bestPolicy: z.any(),
        bestEvaluation: z.any(),
        history: z.array(z.any()),
      }),
      execute: async ({ inputData, mastra }) => {
        if (!inputData) throw new Error('Kroger dataset not found');

        const iterations = (inputData as any).iterations ?? 6;
        const candidatesPerIteration = (inputData as any).candidatesPerIteration ?? 3;

        const result = await optimizePolicy.execute({
          inputData: {
            dataset: {
              store: {
                name: inputData.store.name,
                region: inputData.store.region ?? '',
                notes: inputData.store.notes ?? '',
              },
              items: inputData.items,
              simConfig: inputData.simConfig,
              evalConfig: inputData.evalConfig,
            },
            iterations,
            candidatesPerIteration,
            seedBumpPerCandidate: 11,
          },
          mastra,
        } as any);

        return {
          store: {
            id: inputData.store.id,
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

krogerInventoryOptimizationWorkflow.commit();

export { krogerInventoryOptimizationWorkflow };

