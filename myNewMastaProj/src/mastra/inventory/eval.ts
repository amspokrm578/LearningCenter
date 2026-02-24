import type { EvalConfig, EvaluationResult, SimulationResult } from './types';

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function safeDiv(n: number, d: number) {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 0;
  return n / d;
}

// Smooth step-ish normalization that maps target -> ~0.5 and grows toward 1 above target.
function normalizePositive(value: number, target: number) {
  if (target <= 0) return clamp01(value > 0 ? 1 : 0);
  const x = value / target;
  // logistic-like with gentle slope around 1.0
  const y = 1 / (1 + Math.exp(-3 * (x - 1)));
  return clamp01(y);
}

function normalizeLowerIsBetter(value: number, target: number) {
  if (target <= 0) return clamp01(value <= 0 ? 1 : 0);
  const x = value / target;
  const y = 1 / (1 + Math.exp(3 * (x - 1))); // inverted
  return clamp01(y);
}

export function evaluateSimulation(sim: SimulationResult, cfg: EvalConfig): EvaluationResult {
  const days = Math.max(1, sim.config.days);
  const handled = sim.totals.sold + sim.totals.wasted + sim.totals.donated;

  const profitPerDay = sim.totals.profit / days;
  const wasteRate = safeDiv(sim.totals.wasted, Math.max(1, handled));
  const fillRate = 1 - safeDiv(sim.totals.stockout, Math.max(1, sim.totals.demand));
  const donationRate = safeDiv(sim.totals.donated, Math.max(1, handled));

  const profitScore = normalizePositive(profitPerDay, cfg.profitPerDayTarget);
  const wasteReductionScore = normalizeLowerIsBetter(wasteRate, cfg.wasteRateTarget);
  const satisfactionScore = normalizePositive(fillRate, cfg.satisfactionTarget);
  const humanitarianScore = normalizePositive(donationRate, cfg.donationRateTarget);

  const w = cfg.weights;
  const denom = Math.max(1e-9, w.profit + w.wasteReduction + w.satisfaction + w.humanitarian);
  const score =
    (w.profit * profitScore +
      w.wasteReduction * wasteReductionScore +
      w.satisfaction * satisfactionScore +
      w.humanitarian * humanitarianScore) /
    denom;

  return {
    score: clamp01(score),
    breakdown: {
      profitScore,
      wasteReductionScore,
      satisfactionScore,
      humanitarianScore,
    },
    raw: {
      profitPerDay,
      wasteRate,
      fillRate: clamp01(fillRate),
      donationRate,
    },
  };
}

