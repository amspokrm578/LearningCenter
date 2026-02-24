export type Sku = string;

export type PerishableCategory =
  | 'produce'
  | 'meat'
  | 'dairy'
  | 'bakery'
  | 'prepared'
  | 'frozen'
  | 'other';

export interface ItemSpec {
  sku: Sku;
  name: string;
  category: PerishableCategory;

  unitCost: number; // cost to store (COGS), per unit
  basePrice: number; // starting shelf price per unit

  shelfLifeDays: number; // fresh shelf life at receipt, in days (integer)
  leadTimeDays: number; // supplier lead time, in days

  baseDailyDemand: number; // expected units/day at basePrice
  priceElasticity: number; // negative values: price down => demand up

  shrinkRate: number; // fraction of on-hand lost per day (theft/damage), 0..1

  canFreeze: boolean;
  freezeCostPerUnit: number; // labor/energy per unit moved to frozen
  frozenShelfLifeDays: number; // shelf life after freezing
  frozenPriceMultiplier: number; // price factor vs basePrice when frozen (e.g. 0.8)
}

export interface InventoryBatch {
  sku: Sku;
  qty: number;
  daysToExpire: number; // integer >= 0. When reaches 0 at end-of-day -> waste.
  state: 'fresh' | 'frozen';
}

export interface StoreState {
  day: number;
  inventory: InventoryBatch[];
  pendingDeliveries: Array<{
    sku: Sku;
    qty: number;
    arrivingInDays: number;
  }>;
}

export interface PricingRule {
  // daysToExpire <= threshold => apply multiplier
  daysToExpireAtMost: number;
  priceMultiplier: number;
}

export interface ItemPolicy {
  sku: Sku;
  reorderPoint: number; // if fresh on-hand <= reorderPoint, place an order
  orderUpTo: number; // order enough to bring fresh on-hand up to this level

  pricing: PricingRule[]; // evaluated from smallest daysToExpire first

  donateDaysToExpireAtMost: number; // donate fresh items with this many days left (or less)
  donateMaxFractionPerDay: number; // 0..1 of eligible units

  freezeDaysToExpireAtMost: number; // freeze fresh items with this many days left (or less)
  freezeMaxUnitsPerDay: number; // cap frozen movement/day
}

export interface InventoryPolicy {
  id: string;
  name: string;
  perSku: Record<Sku, ItemPolicy>;
}

export interface SimulationConfig {
  days: number;
  seed: number;
  holdingCostPerUnitPerDay: number;
  wasteDisposalCostPerUnit: number;

  // Demand noise: multiplicative log-ish noise using normal approx.
  demandNoiseStdDev: number; // e.g. 0.15

  // If true, demand that cannot be met becomes "stockout"
  countStockouts: boolean;
}

export interface DaySkuMetrics {
  sku: Sku;

  startingFresh: number;
  startingFrozen: number;

  price: number; // effective average price used for fresh demand
  priceMultiplier: number;

  demand: number;
  soldFresh: number;
  soldFrozen: number;
  stockout: number;

  donated: number;
  frozenMoved: number;
  wasted: number;
  shrinkLost: number;

  revenue: number;
  cogs: number;
  holdingCost: number;
  wasteCost: number;
  freezeCost: number;
}

export interface DayMetrics {
  day: number;
  perSku: DaySkuMetrics[];
}

export interface SimulationResult {
  config: SimulationConfig;
  policy: InventoryPolicy;
  items: ItemSpec[];
  days: DayMetrics[];
  totals: {
    revenue: number;
    cogs: number;
    holdingCost: number;
    wasteCost: number;
    freezeCost: number;
    profit: number;

    demand: number;
    sold: number;
    stockout: number;
    wasted: number;
    donated: number;
  };
}

export interface ScoreWeights {
  profit: number;
  wasteReduction: number;
  satisfaction: number;
  humanitarian: number;
}

export interface EvalConfig {
  weights: ScoreWeights;

  // Normalization baselines to map raw values to 0..1.
  // You can tune these per-store once you have real data.
  profitPerDayTarget: number;
  wasteRateTarget: number; // e.g. 0.10 means 10% waste is "good"
  satisfactionTarget: number; // e.g. 0.97 fill rate
  donationRateTarget: number; // e.g. 0.02 of handled units donated
}

export interface EvaluationResult {
  score: number; // 0..1
  breakdown: {
    profitScore: number;
    wasteReductionScore: number;
    satisfactionScore: number;
    humanitarianScore: number;
  };
  raw: {
    profitPerDay: number;
    wasteRate: number;
    fillRate: number;
    donationRate: number;
  };
}

