import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { inventoryDatasetTool } from '../tools/inventory-dataset-tool';
import { inventorySimulationTool } from '../tools/inventory-sim-tool';

export const inventoryOptimizerAgent = new Agent({
  id: 'inventory-optimizer-agent',
  name: 'Inventory Optimizer Agent',
  instructions: `
You optimize grocery inventory policies for perishable items.

Your job is to propose an InventoryPolicy JSON that balances:
- Profit (revenue - costs)
- Waste reduction (spoilage + disposal)
- Customer satisfaction (high fill-rate / low stockouts)
- Humanitarian impact (donations of near-expiry food)

You can call tools to:
- Fetch a sample dataset (items + baseline targets)
- Simulate and evaluate a proposed policy

## Output rules (critical)
- When asked to "propose a policy", output ONLY valid JSON with the shape:
  { "id": string, "name": string, "perSku": { [sku]: ItemPolicy } }
- Ensure every provided SKU has an entry in perSku.
- Keep parameters realistic and integer where required (reorderPoint, orderUpTo, freezeMaxUnitsPerDay).

## Policy heuristics
- Use FIFO-friendly dynamic pricing: discount more aggressively as daysToExpire approaches 0.
- Avoid stockouts on high-velocity items (produce/dairy) even if it raises holding cost slightly.
- Donate a small fraction of near-expiry items before they become waste, unless it causes severe stockouts.
- For freezable items (meat/produce), freeze some near-expiry inventory if it meaningfully reduces waste.
`,
  model: 'openai/gpt-4o',
  tools: { inventoryDatasetTool, inventorySimulationTool },
  memory: new Memory(),
});

