import { createRng } from './rng';
import type {
  DayMetrics,
  DaySkuMetrics,
  InventoryBatch,
  InventoryPolicy,
  ItemPolicy,
  ItemSpec,
  SimulationConfig,
  SimulationResult,
  Sku,
  StoreState,
} from './types';

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function sumQty(batches: InventoryBatch[], sku: Sku, state: 'fresh' | 'frozen') {
  let s = 0;
  for (const b of batches) {
    if (b.sku === sku && b.state === state) s += b.qty;
  }
  return s;
}

function sortFifo(batches: InventoryBatch[]) {
  // Sell/act on the items expiring soonest first.
  batches.sort((a, b) => a.daysToExpire - b.daysToExpire);
}

function takeFromBatches(
  batches: InventoryBatch[],
  sku: Sku,
  state: 'fresh' | 'frozen',
  qtyWanted: number,
) {
  if (qtyWanted <= 0) return 0;
  sortFifo(batches);
  let remaining = qtyWanted;
  let taken = 0;
  for (const b of batches) {
    if (remaining <= 0) break;
    if (b.sku !== sku || b.state !== state) continue;
    const q = Math.min(b.qty, remaining);
    if (q <= 0) continue;
    b.qty -= q;
    remaining -= q;
    taken += q;
  }
  // Remove empty batches.
  for (let i = batches.length - 1; i >= 0; i--) {
    if (batches[i]!.qty <= 0) batches.splice(i, 1);
  }
  return taken;
}

function applyPricing(item: ItemSpec, policy: ItemPolicy, minDaysToExpireFresh: number) {
  const rules = [...(policy.pricing ?? [])].sort(
    (a, b) => a.daysToExpireAtMost - b.daysToExpireAtMost,
  );
  let multiplier = 1;
  for (const r of rules) {
    if (minDaysToExpireFresh <= r.daysToExpireAtMost) {
      multiplier = r.priceMultiplier;
      break;
    }
  }
  const price = Math.max(0, item.basePrice * multiplier);
  return { price, multiplier };
}

function demandForDay(opts: {
  item: ItemSpec;
  priceMultiplier: number;
  rng: ReturnType<typeof createRng>;
  demandNoiseStdDev: number;
}) {
  const { item, priceMultiplier, rng, demandNoiseStdDev } = opts;
  const base = Math.max(0, item.baseDailyDemand);

  // Price effect: demand ~ (priceMultiplier)^(elasticity)
  // With elasticity negative, lower prices increase demand.
  const priceEffect = Math.pow(Math.max(0.05, priceMultiplier), item.priceElasticity);

  // Noise as multiplicative factor around 1.0
  const noise = Math.max(0, 1 + rng.normal(0, demandNoiseStdDev));

  const d = base * priceEffect * noise;
  return Math.max(0, d);
}

function ensurePolicyComplete(items: ItemSpec[], policy: InventoryPolicy) {
  for (const item of items) {
    if (!policy.perSku[item.sku]) {
      throw new Error(`Policy missing perSku entry for sku '${item.sku}'`);
    }
  }
}

export function createInitialState(items: ItemSpec[], policy: InventoryPolicy): StoreState {
  ensurePolicyComplete(items, policy);
  const inventory: InventoryBatch[] = [];

  for (const item of items) {
    const p = policy.perSku[item.sku]!;
    const startQty = Math.max(0, Math.round(p.orderUpTo));
    if (startQty > 0) {
      inventory.push({
        sku: item.sku,
        qty: startQty,
        daysToExpire: Math.max(1, Math.round(item.shelfLifeDays)),
        state: 'fresh',
      });
    }
  }

  return {
    day: 0,
    inventory,
    pendingDeliveries: [],
  };
}

export function simulateInventory(opts: {
  items: ItemSpec[];
  policy: InventoryPolicy;
  config: SimulationConfig;
  initialState?: StoreState;
}): SimulationResult {
  const { items, policy, config } = opts;
  ensurePolicyComplete(items, policy);

  const rng = createRng(config.seed);
  const state: StoreState = opts.initialState
    ? structuredClone(opts.initialState)
    : createInitialState(items, policy);

  const days: DayMetrics[] = [];

  const totals = {
    revenue: 0,
    cogs: 0,
    holdingCost: 0,
    wasteCost: 0,
    freezeCost: 0,
    profit: 0,
    demand: 0,
    sold: 0,
    stockout: 0,
    wasted: 0,
    donated: 0,
  };

  for (let day = 0; day < config.days; day++) {
    // 1) Receive deliveries arriving today.
    for (const d of state.pendingDeliveries) {
      d.arrivingInDays -= 1;
    }
    const arriving = state.pendingDeliveries.filter((d) => d.arrivingInDays <= 0);
    state.pendingDeliveries = state.pendingDeliveries.filter((d) => d.arrivingInDays > 0);
    for (const a of arriving) {
      const item = items.find((it) => it.sku === a.sku);
      if (!item) continue;
      state.inventory.push({
        sku: a.sku,
        qty: Math.max(0, Math.round(a.qty)),
        daysToExpire: Math.max(1, Math.round(item.shelfLifeDays)),
        state: 'fresh',
      });
    }

    // 2) Per-SKU actions: freeze, donate, set price, sell, shrink, waste/age.
    const perSku: DaySkuMetrics[] = [];

    for (const item of items) {
      const p = policy.perSku[item.sku]!;

      const startingFresh = sumQty(state.inventory, item.sku, 'fresh');
      const startingFrozen = sumQty(state.inventory, item.sku, 'frozen');

      // Freeze first (preempt waste), then donate (humanitarian), then sell.
      let frozenMoved = 0;
      if (item.canFreeze && p.freezeMaxUnitsPerDay > 0) {
        // Eligible fresh units: batches with daysToExpire <= threshold
        sortFifo(state.inventory);
        let remainingCap = Math.max(0, Math.floor(p.freezeMaxUnitsPerDay));

        for (const b of state.inventory) {
          if (remainingCap <= 0) break;
          if (b.sku !== item.sku || b.state !== 'fresh') continue;
          if (b.daysToExpire > p.freezeDaysToExpireAtMost) continue;

          const q = Math.min(b.qty, remainingCap);
          if (q <= 0) continue;

          b.qty -= q;
          remainingCap -= q;
          frozenMoved += q;

          // Add/merge frozen batch with fresh shelf life reset to frozenShelfLifeDays
          state.inventory.push({
            sku: item.sku,
            qty: q,
            daysToExpire: Math.max(1, Math.round(item.frozenShelfLifeDays)),
            state: 'frozen',
          });
        }

        // Cleanup empties after freeze move.
        for (let i = state.inventory.length - 1; i >= 0; i--) {
          if (state.inventory[i]!.qty <= 0) state.inventory.splice(i, 1);
        }
      }

      let donated = 0;
      if (p.donateMaxFractionPerDay > 0) {
        const maxFraction = clamp01(p.donateMaxFractionPerDay);
        sortFifo(state.inventory);
        let eligible = 0;
        for (const b of state.inventory) {
          if (b.sku === item.sku && b.state === 'fresh' && b.daysToExpire <= p.donateDaysToExpireAtMost) {
            eligible += b.qty;
          }
        }
        const donateCap = Math.floor(eligible * maxFraction);
        donated = takeFromBatches(state.inventory, item.sku, 'fresh', donateCap);
      }

      // Pricing based on "most urgent" fresh batch (min days to expire).
      let minDaysToExpireFresh = Infinity;
      for (const b of state.inventory) {
        if (b.sku === item.sku && b.state === 'fresh') {
          minDaysToExpireFresh = Math.min(minDaysToExpireFresh, b.daysToExpire);
        }
      }
      if (!Number.isFinite(minDaysToExpireFresh)) minDaysToExpireFresh = item.shelfLifeDays;

      const { price, multiplier: priceMultiplier } = applyPricing(
        item,
        p,
        Math.max(0, Math.floor(minDaysToExpireFresh)),
      );

      const demand = demandForDay({
        item,
        priceMultiplier,
        rng,
        demandNoiseStdDev: config.demandNoiseStdDev,
      });
      const demandInt = Math.max(0, Math.floor(demand));

      // Sell fresh first, then frozen as a substitute if needed.
      const soldFresh = takeFromBatches(state.inventory, item.sku, 'fresh', demandInt);
      const remainingDemand = Math.max(0, demandInt - soldFresh);

      const frozenUnitPrice = item.basePrice * item.frozenPriceMultiplier;
      const soldFrozen = remainingDemand > 0 ? takeFromBatches(state.inventory, item.sku, 'frozen', remainingDemand) : 0;
      const unmet = Math.max(0, demandInt - soldFresh - soldFrozen);
      const stockout = config.countStockouts ? unmet : 0;

      // Shrink (fresh + frozen)
      const onHandAfterSales = sumQty(state.inventory, item.sku, 'fresh') + sumQty(state.inventory, item.sku, 'frozen');
      const shrinkLost = Math.floor(onHandAfterSales * clamp01(item.shrinkRate));
      if (shrinkLost > 0) {
        // Remove from freshest first is unrealistic; remove FIFO fresh then frozen to bias toward expiry realism.
        const lostFresh = takeFromBatches(state.inventory, item.sku, 'fresh', shrinkLost);
        const lostFrozen = shrinkLost - lostFresh;
        if (lostFrozen > 0) takeFromBatches(state.inventory, item.sku, 'frozen', lostFrozen);
      }

      // Holding cost (approx: apply on end-of-day on-hand)
      const endingFresh = sumQty(state.inventory, item.sku, 'fresh');
      const endingFrozen = sumQty(state.inventory, item.sku, 'frozen');
      const holdingCost = (endingFresh + endingFrozen) * config.holdingCostPerUnitPerDay;

      // Age inventory and compute waste (anything that hits 0 after decrement).
      let wasted = 0;
      for (const b of state.inventory) {
        if (b.sku !== item.sku) continue;
        b.daysToExpire -= 1;
      }
      for (let i = state.inventory.length - 1; i >= 0; i--) {
        const b = state.inventory[i]!;
        if (b.sku !== item.sku) continue;
        if (b.daysToExpire <= 0) {
          wasted += b.qty;
          state.inventory.splice(i, 1);
        }
      }

      // Ordering decision (based on fresh only; you can refine later).
      const freshOnHandNow = sumQty(state.inventory, item.sku, 'fresh');
      if (freshOnHandNow <= p.reorderPoint) {
        const target = Math.max(0, Math.round(p.orderUpTo));
        const need = Math.max(0, target - freshOnHandNow);
        if (need > 0) {
          state.pendingDeliveries.push({
            sku: item.sku,
            qty: need,
            arrivingInDays: Math.max(0, Math.round(item.leadTimeDays)),
          });
        }
      }

      const revenue = soldFresh * price + soldFrozen * frozenUnitPrice;
      const cogs = (soldFresh + soldFrozen) * item.unitCost;
      const wasteCost = wasted * config.wasteDisposalCostPerUnit;
      const freezeCost = frozenMoved * item.freezeCostPerUnit;

      perSku.push({
        sku: item.sku,
        startingFresh,
        startingFrozen,
        price,
        priceMultiplier,
        demand: demandInt,
        soldFresh,
        soldFrozen,
        stockout,
        donated,
        frozenMoved,
        wasted,
        shrinkLost,
        revenue,
        cogs,
        holdingCost,
        wasteCost,
        freezeCost,
      });

      totals.revenue += revenue;
      totals.cogs += cogs;
      totals.holdingCost += holdingCost;
      totals.wasteCost += wasteCost;
      totals.freezeCost += freezeCost;

      totals.demand += demandInt;
      totals.sold += soldFresh + soldFrozen;
      totals.stockout += stockout;
      totals.wasted += wasted;
      totals.donated += donated;
    }

    days.push({ day, perSku });
    state.day += 1;
  }

  totals.profit = totals.revenue - totals.cogs - totals.holdingCost - totals.wasteCost - totals.freezeCost;

  return {
    config,
    policy,
    items,
    days,
    totals,
  };
}

