import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { EvalConfig, ItemSpec, SimulationConfig } from '../inventory/types';

interface KrogerAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

interface KrogerProductItemPrice {
  regular?: number;
  promo?: number;
}

interface KrogerProductItem {
  size?: string;
  price?: KrogerProductItemPrice;
}

interface KrogerProduct {
  productId: string;
  description: string;
  categories?: string[];
  items?: KrogerProductItem[];
  temperature?: {
    indicator?: string;
  };
}

interface KrogerProductsResponse {
  data: KrogerProduct[];
}

async function getKrogerToken(): Promise<string> {
  const clientId = process.env.KROGER_CLIENT_ID;
  const clientSecret = process.env.KROGER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'KROGER_CLIENT_ID and KROGER_CLIENT_SECRET must be set in the environment to use krogerInventoryTool.',
    );
  }

  const tokenUrl = 'https://api.kroger.com/v1/connect/oauth2/token';
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'product.compact location.basic',
  });

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Kroger token request failed: ${resp.status} ${text}`);
  }

  const data = (await resp.json()) as KrogerAuthResponse;
  if (!data.access_token) {
    throw new Error('Kroger token response missing access_token');
  }
  return data.access_token;
}

async function searchPerishablesForStore(opts: {
  locationId: string;
  token: string;
}): Promise<KrogerProduct[]> {
  const { locationId, token } = opts;

  // To keep the API surface small and fast for now, we query a few
  // representative perishable terms and merge results.
  const searchTerms = ['banana', 'milk', 'chicken', 'bread', 'salad', 'yogurt'];

  const all: KrogerProduct[] = [];

  for (const term of searchTerms) {
    const url = new URL('https://api.kroger.com/v1/products');
    url.searchParams.set('filter.locationId', locationId);
    url.searchParams.set('filter.term', term);
    url.searchParams.set('filter.fulfillment', 'ais');
    url.searchParams.set('size', '50');

    const resp = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!resp.ok) {
      // Skip failing term but continue overall; this keeps the tool robust.
      continue;
    }

    const data = (await resp.json()) as KrogerProductsResponse;
    if (!Array.isArray(data.data)) continue;

    for (const p of data.data) {
      // Deduplicate by productId.
      if (all.find((x) => x.productId === p.productId)) continue;
      all.push(p);
    }
  }

  return all;
}

function estimateCategory(prod: KrogerProduct): ItemSpec['category'] {
  const name = prod.description.toLowerCase();
  const cats = (prod.categories ?? []).map((c) => c.toLowerCase()).join(' ');

  if (name.includes('banana')) return 'produce';
  if (name.includes('apple') || name.includes('lettuce') || name.includes('salad')) return 'produce';
  if (name.includes('milk') || name.includes('yogurt') || name.includes('cheese')) return 'dairy';
  if (name.includes('chicken') || name.includes('beef') || name.includes('pork')) return 'meat';
  if (name.includes('bread') || name.includes('baguette') || name.includes('roll')) return 'bakery';

  if (cats.includes('produce')) return 'produce';
  if (cats.includes('dairy')) return 'dairy';
  if (cats.includes('meat')) return 'meat';
  if (cats.includes('bakery')) return 'bakery';

  return 'other';
}

function guessShelfLifeDays(cat: ItemSpec['category']): number {
  switch (cat) {
    case 'produce':
      return 5;
    case 'meat':
      return 4;
    case 'dairy':
      return 10;
    case 'bakery':
      return 2;
    case 'prepared':
      return 3;
    default:
      return 14;
  }
}

function guessBaseDailyDemand(cat: ItemSpec['category']): number {
  switch (cat) {
    case 'produce':
      return 120;
    case 'dairy':
      return 40;
    case 'meat':
      return 25;
    case 'bakery':
      return 60;
    case 'prepared':
      return 30;
    default:
      return 20;
  }
}

function guessPriceElasticity(cat: ItemSpec['category']): number {
  switch (cat) {
    case 'produce':
    case 'bakery':
      return -1.5;
    case 'meat':
      return -1.2;
    case 'dairy':
      return -0.7;
    default:
      return -1.0;
  }
}

function guessCanFreeze(cat: ItemSpec['category']): boolean {
  return cat === 'meat' || cat === 'produce';
}

function mapProductsToItemSpecs(products: KrogerProduct[]): ItemSpec[] {
  const items: ItemSpec[] = [];

  for (const p of products) {
    const cat = estimateCategory(p);
    const itemEntry = p.items?.[0];
    const price = itemEntry?.price?.regular ?? itemEntry?.price?.promo ?? 0;

    // Simple heuristic: assume unit cost is a fraction of retail.
    const unitCost = Number((price * 0.6 || 1).toFixed(2));
    const basePrice = Number((price || unitCost * 1.25).toFixed(2));

    const shelfLifeDays = guessShelfLifeDays(cat);
    const canFreeze = guessCanFreeze(cat);
    const baseDailyDemand = guessBaseDailyDemand(cat);

    const spec: ItemSpec = {
      sku: p.productId,
      name: p.description,
      category: cat,
      unitCost,
      basePrice,
      shelfLifeDays,
      leadTimeDays: 2,
      baseDailyDemand,
      priceElasticity: guessPriceElasticity(cat),
      shrinkRate: 0.01,
      canFreeze,
      freezeCostPerUnit: canFreeze ? 0.05 : 0,
      frozenShelfLifeDays: canFreeze ? shelfLifeDays * 6 : 1,
      frozenPriceMultiplier: canFreeze ? 0.8 : 1,
    };

    items.push(spec);
  }

  return items;
}

function makeSimConfig(): SimulationConfig {
  return {
    days: 28,
    seed: 101,
    holdingCostPerUnitPerDay: 0.01,
    wasteDisposalCostPerUnit: 0.05,
    demandNoiseStdDev: 0.2,
    countStockouts: true,
  };
}

function makeEvalConfig(): EvalConfig {
  return {
    weights: {
      profit: 0.5,
      wasteReduction: 0.25,
      satisfaction: 0.15,
      humanitarian: 0.1,
    },
    profitPerDayTarget: 250,
    wasteRateTarget: 0.08,
    satisfactionTarget: 0.97,
    donationRateTarget: 0.02,
  };
}

export const krogerInventoryTool = createTool({
  id: 'get-kroger-inventory',
  description:
    'Fetches a perishable-focused SKU slice from a Kroger store and maps it into simulation-ready inventory data.',
  inputSchema: z.object({
    locationId: z
      .string()
      .describe('Kroger location/store ID (locationId from the Locations API)'),
  }),
  outputSchema: z.object({
    store: z.object({
      id: z.string(),
      name: z.string(),
      region: z.string().optional(),
      notes: z.string().optional(),
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
  }),
  execute: async ({ locationId }) => {
    const token = await getKrogerToken();
    const products = await searchPerishablesForStore({ locationId, token });
    const items = mapProductsToItemSpecs(products);

    const simConfig = makeSimConfig();
    const evalConfig = makeEvalConfig();

    return {
      store: {
        id: locationId,
        name: `Kroger Store ${locationId}`,
        notes:
          'Perishable slice derived from Kroger Products API. Parameters like shelf life and demand are heuristic and should be tuned over time.',
      },
      items,
      simConfig,
      evalConfig,
    };
  },
});

