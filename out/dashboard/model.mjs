// The token radar's value model (MODEL_VERSION below).
//
// The question: what would a protocol's token be worth if the protocol's record stayed as it is? The
// snapshot carries no answer, so the model splits it in two and answers it from one with what it learns
// from the other:
//
//   the comps     every protocol that already trades — a market cap, a TVL and a listing day in the
//                 snapshot, so the market has already priced it
//   the subjects  every protocol that records no token, which is what the board ranks
//
// THE FITTED CORE. On the comps the model fits, by ordinary least squares on the normal equations, the
// relation between a protocol's TVL, its seven-day growth and the market cap its token trades at:
//
//   ln(market cap) = b0 + b1 x ln(tvl) + b2 x (seven-day growth, in per cent)
//
// b0, b1 and b2 are fitted at run time from the snapshot. They are not constants anyone chose, and no
// table of multiples is written down. b1 is the elasticity of market cap to TVL: below 1 means a larger
// protocol trades at a SMALLER multiple of its TVL, which is what this snapshot's comps show.
//
// THE TRIMMED TAILS. The comps' realised market-cap-to-TVL multiples span 0.004 to 36. A least-squares fit
// on logs gives those tails a leverage the level of a typical protocol should not have, so the fit uses
// the middle 90 per cent of realised multiples and the trimmed count is published beside the fit.
//
// THE STATED PRIORS. Two terms are NOT fitted, and the model says so rather than implying otherwise:
//   growth   a seven-day change outside -60 to +150 per cent is a re-listing, a bridge migration or a
//            near-zero base divided into, not growth. Four of this snapshot's 754 records fall outside
//            that band, so the band is where those four stop carrying the regression.
//   maturity every comp has already launched, so the comps CANNOT say what a pre-token protocol's tenure
//            is worth. A protocol that has run longer with no token has the longer record and the
//            stronger claim to a launch, so maturity is a stated prior over the subjects, monotone in age:
//
//   maturity(age) = 0.55 + 0.45 x min(age in days, 1095) / 1095      (no listing day: 365 days)
//
// It is its own named function, so a reader can see exactly which part of the number is fitted and which
// part is assumed. Two thirds of the level is measured; the rest is labelled as a prior.
//
//   implied value = exp(fitted value) x maturity(age)
//
// The published number is the fitted distribution's MEDIAN, not its mean: exp() of a mean is pulled up by
// the lognormal tail (the smearing factor is reported so that pull is visible), and a median with a band
// beside it is the honest central claim. The band is exp(fitted value plus and minus 1.6449 residual
// standard deviations), a 90 per cent interval.
//
// IT MEASURES ITSELF. leaveOneOut() refits once per comp, leaving that comp out, and reports the median
// out-of-sample error in logs beside two baselines measured the same way on the same comps: a flat median
// market-cap-to-TVL multiple, and the same multiple taken inside the protocol's own category. The board
// prints all three, and prints the flat baseline's own answer row by row, so the model's accuracy is a
// measurement a reader can check rather than a claim the entry makes.

/** The model's identity: it names the file, the board and the method panel. */
export const MODEL_VERSION = 'logfit-2';

/** How many comps a fit needs before its coefficients mean anything. */
const MIN_COMPS = 24;

/** The two-sided 90 per cent multiplier the band is published at. */
const Z90 = 1.6449;

/** The share of the comps the fit trims from each tail of the realised multiple. */
export const TRIM_SHARE = 0.05;

/** Where a seven-day change stops being growth: one end is a re-listing, the other a near-zero base. */
export const GROWTH_FLOOR = -60;
export const GROWTH_CAP = 150;

/** The maturity prior's endpoints: a brand-new protocol, and one that has run three years. */
export const MATURITY_FLOOR = 0.55;
export const MATURITY_RANGE = 0.45;
export const MATURITY_DAYS = 1095;

/** The tenure a protocol with no listing day is given, at the prior's own scale. */
export const UNKNOWN_AGE_DAYS = 365;

const DAY_MS = 86_400_000;

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** A finite number, else `fallback`. */
function finite(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A seven-day change inside the band a change is growth in; outside it, the nearest edge. */
export function growthClamped(change) {
  return Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, finite(change, 0)));
}

/** The snapshot's listing day as a whole day count back from its as_of date; null when it has none. */
export function ageDays(asOf, listedAt) {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The stated maturity prior: what a protocol's tenure is worth as a claim to a launch. Not fitted. */
export function maturity(age) {
  const days = Math.min(Math.max(age === null ? UNKNOWN_AGE_DAYS : age, 0), MATURITY_DAYS);
  return MATURITY_FLOOR + (days / MATURITY_DAYS) * MATURITY_RANGE;
}

/** Whether a protocol records no token: the snapshot's own rule, both token fields null. */
export function isPreToken(p) {
  return p.gecko_id === null && p.symbol === null;
}

/** A name ending in a release marker is a pool of another protocol, not a launch of its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word that marks a product of a token that already trades. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** The categories whose every member is a product of a token that already trades. */
export const PRODUCT_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** The exchange names a bridged or custodial product begins with. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/**
 * Whether the board may rank a protocol: it records no token, and its own record does not say it is a
 * wrapped, staked or bridged product of one that already trades.
 */
export function isRankable(p) {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (PRODUCT_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/**
 * Which tier a rankable protocol sits in. The house watchlist is the floor, never the ceiling: `extended`
 * is a pre-token protocol at or above the floor that the house list leaves out, `early` one below it.
 */
export function tierOf(p, snapshot) {
  if (snapshot.watchlist.includes(p.slug)) return 'watchlist';
  return p.tvl_usd >= snapshot.floor_usd ? 'extended' : 'early';
}

/** The comps: the snapshot's traded protocols, with a market cap, a TVL and a listing day to fit on. */
export function comps(snapshot) {
  const out = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    const mcap = p.mcap_usd;
    if (mcap === null || !Number.isFinite(mcap) || mcap <= 0) continue;
    if (!Number.isFinite(p.tvl_usd) || p.tvl_usd <= 0) continue;
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (age === null || age < 1) continue;
    out.push({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: mcap,
      change_7d: p.change_7d,
      age_days: age,
      x: [1, Math.log(p.tvl_usd), growthClamped(p.change_7d)],
      y: Math.log(mcap),
    });
  }
  return out.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** The median of a numeric list; 0 for an empty one. Sorted numerically, so arrival order never tells. */
export function median(values) {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Solve `A x = b` by Gauss-Jordan elimination with partial pivoting; null when singular to working
 * precision. Fixed loop bounds and a deterministic pivot rule, so the same input yields the same
 * coefficients on every run.
 */
function solve(A, b) {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = m[pivot];
      m[pivot] = m[col];
      m[col] = tmp;
    }
    const d = m[col][col];
    for (let k = col; k <= n; k++) m[col][k] = m[col][k] / d;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = m[row][col];
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) m[row][k] = m[row][k] - factor * m[col][k];
    }
  }
  return m.map((row) => row[n]);
}

/**
 * Ordinary least squares on the normal equations, (X'X)^-1 X'y, with no library and no randomness, plus
 * the fit's own statistics: R squared in logs, the residual standard deviation on the right degrees of
 * freedom, and the smearing factor that would turn the fitted median into the fitted mean.
 */
function ols(rows, p = 3) {
  if (rows.length <= p + 2) return null;
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  for (const r of rows) {
    for (let i = 0; i < p; i++) {
      Xty[i] = Xty[i] + r.x[i] * r.y;
      for (let j = 0; j < p; j++) XtX[i][j] = XtX[i][j] + r.x[i] * r.x[j];
    }
  }
  const beta = solve(XtX, Xty);
  if (beta === null) return null;
  let mean = 0;
  for (const r of rows) mean += r.y;
  mean /= rows.length;
  let ssRes = 0;
  let ssTot = 0;
  let smear = 0;
  for (const r of rows) {
    let yhat = 0;
    for (let i = 0; i < p; i++) yhat += beta[i] * r.x[i];
    const e = r.y - yhat;
    ssRes += e * e;
    ssTot += (r.y - mean) * (r.y - mean);
    smear += Math.exp(e);
  }
  return { beta, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0, sigma: Math.sqrt(ssRes / Math.max(1, rows.length - p)), smearing: smear / rows.length };
}

/**
 * The comps the fit uses: the middle (1 - 2 x TRIM_SHARE) of the realised market-cap-to-TVL multiples.
 * The tails are cut because a least-squares fit on logs gives them a leverage the level of a typical
 * protocol should not have, and the count cut is published.
 */
export function trimComps(rows) {
  if (rows.length < MIN_COMPS) return { kept: rows, dropped: 0 };
  const multiples = rows.map((r) => r.y - Math.log(r.tvl_usd)).sort((a, b) => a - b);
  const at = (p) => multiples[Math.min(multiples.length - 1, Math.max(0, Math.round(p * (multiples.length - 1))))];
  const low = at(TRIM_SHARE);
  const high = at(1 - TRIM_SHARE);
  const kept = rows.filter((r) => {
    const m = r.y - Math.log(r.tvl_usd);
    return m >= low && m <= high;
  });
  return { kept, dropped: rows.length - kept.length };
}

/** Fit the model on the comps: the coefficients, the fit's statistics, and how many comps it trimmed. */
export function fitModel(snapshot) {
  const { kept, dropped } = trimComps(comps(snapshot));
  const base = ols(kept);
  if (base === null || kept.length < MIN_COMPS) {
    throw new SnapshotError(`the snapshot carries ${kept.length} tradable comps: the model needs at least ${MIN_COMPS} to fit, so this is not the sealed snapshot`);
  }
  return { fit: { ...base, n: kept.length }, comps: kept, dropped };
}

/** The feature row the fitted core takes for one protocol, in the header's order. */
export function featuresFor(p) {
  return [1, Math.log(p.tvl_usd > 0 ? p.tvl_usd : 1), growthClamped(p.change_7d)];
}

/**
 * Predict a subject's token market cap. The published number is the fitted median times the stated
 * maturity prior; the mean is carried beside it for a reader who wants the mean convention, and the band
 * is a 90 per cent interval around the median.
 */
export function predict(fit, x, age) {
  let ln = 0;
  for (let i = 0; i < fit.beta.length; i++) ln += fit.beta[i] * x[i];
  const medianValue = Math.exp(ln) * maturity(age);
  const tvl = Math.exp(x[1]);
  const cap = (v) => Math.min(100_000_000_000_000, Math.max(1, Math.round(v)));
  return {
    ln_value: ln,
    multiple: medianValue / tvl,
    implied_value_usd: cap(medianValue),
    mean_usd: cap(medianValue * fit.smearing),
    low_usd: cap(Math.exp(ln - Z90 * fit.sigma) * maturity(age)),
    high_usd: cap(Math.exp(ln + Z90 * fit.sigma) * maturity(age)),
  };
}

/**
 * Measure the fitted core out of sample on the snapshot's own comps. Each comp is left out in turn, the
 * core is refitted without it, and its prediction is compared with what that protocol's token actually
 * trades at. The two baselines are left out the same way, so all three errors are comparable: the flat
 * median multiple over the remaining comps, and that multiple inside the protocol's own category, which
 * falls back to the flat one when fewer than three peers remain, so no comp is credited to a category of
 * one. The maturity prior is not measured here: every comp has already launched.
 */
export function leaveOneOut(fit, rows) {
  const fitted = [];
  const flat = [];
  const category = [];
  for (let i = 0; i < rows.length; i++) {
    const held = rows[i];
    const rest = rows.filter((_, k) => k !== i);
    const actual = held.y;
    const refit = ols(rest);
    if (refit !== null) {
      let yhat = 0;
      for (let k = 0; k < refit.beta.length; k++) yhat += refit.beta[k] * held.x[k];
      fitted.push(Math.abs(actual - yhat));
    }
    const flatMultiple = median(rest.map((r) => r.y - Math.log(r.tvl_usd)));
    flat.push(Math.abs(actual - (Math.log(held.tvl_usd) + flatMultiple)));
    const own = rest.filter((r) => r.category === held.category);
    const peerMultiple = own.length >= 3 ? median(own.map((r) => r.y - Math.log(r.tvl_usd))) : flatMultiple;
    category.push(Math.abs(actual - (Math.log(held.tvl_usd) + peerMultiple)));
  }
  const row = (name, errors) => {
    const m = median(errors);
    return { name, median_abs_log_error: round(m, 4), typical_ratio: round(Math.exp(m), 4) };
  };
  return {
    n: rows.length,
    r2: round(fit.r2, 4),
    sigma: round(fit.sigma, 4),
    rows: [row('fitted log-log core', fitted), row('flat median market-cap / TVL multiple', flat), row('category median multiple', category)],
  };
}

/** Every category's realised market-cap-to-TVL multiple across the comps, most-peered first. */
export function categoryMultiples(rows) {
  const byCategory = new Map();
  for (const r of rows) {
    const key = r.category ?? 'Uncategorised';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [r.mcap_usd / r.tvl_usd]);
    else list.push(r.mcap_usd / r.tvl_usd);
  }
  const out = [];
  for (const [category, list] of byCategory) out.push({ category, peers: list.length, median_multiple: round(median(list), 3) });
  return out.sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
}

/** The naive baseline's own answer: the flat median multiple, shown beside the fitted one per row. */
export function flatMultiple(rows) {
  return median(rows.map((r) => r.mcap_usd / r.tvl_usd));
}

/** Round to `places` decimals, deterministically. */
export function round(value, places) {
  const f = Math.pow(10, places);
  return Math.round(value * f) / f;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    if (typeof v.slug !== 'string' || typeof v.name !== 'string' || typeof v.tvl_usd !== 'number' || !Number.isFinite(v.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: v.slug,
      name: v.name,
      category: typeof v.category === 'string' ? v.category : null,
      chains: Array.isArray(v.chains) ? v.chains.filter((c) => typeof c === 'string') : [],
      tvl_usd: v.tvl_usd,
      change_7d: typeof v.change_7d === 'number' && Number.isFinite(v.change_7d) ? v.change_7d : null,
      mcap_usd: typeof v.mcap_usd === 'number' && Number.isFinite(v.mcap_usd) ? v.mcap_usd : null,
      listed_at: typeof v.listed_at === 'string' ? v.listed_at : null,
      gecko_id: typeof v.gecko_id === 'string' ? v.gecko_id : null,
      symbol: typeof v.symbol === 'string' ? v.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist };
}
