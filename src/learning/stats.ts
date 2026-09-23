/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

export type ProportionTest = { rateA: number; rateB: number; z: number; pValue: number; lift: number };

/** Two-sided two-proportion z-test. */
export function twoProportionTest(successA: number, nA: number, successB: number, nB: number): ProportionTest {
  const rateA = nA ? successA / nA : 0;
  const rateB = nB ? successB / nB : 0;
  const pooled = nA + nB ? (successA + successB) / (nA + nB) : 0;
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / Math.max(nA, 1) + 1 / Math.max(nB, 1)));
  const z = se > 0 ? (rateB - rateA) / se : 0;
  const pValue = se > 0 ? 2 * (1 - normalCdf(Math.abs(z))) : 1;
  return { rateA, rateB, z, pValue, lift: rateA > 0 ? (rateB - rateA) / rateA : 0 };
}
