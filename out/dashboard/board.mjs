// The board: the snapshot in, one ranked radar out, with the derivation of every row kept beside it.
//
// buildRadar() ranks every protocol the model may score. The house watchlist is the floor it must cover;
// above that floor the snapshot also holds pre-token protocols the house list leaves out, and below it the
// smaller ones, and both are the early finds a radar exists to turn up, so they are ranked too and each
// row says which tier it came from. Protocols that already trade are never ranked against the pre-token
// ones: they are the comps the model was fitted on, carried separately with the multiple the market gives
// them, so a reader sees the market's own answer beside the model's.
//
// Every row carries the numbers the model used, the implied value it reached, the band around it and the
// farm plan for that protocol, so the page recomputes nothing the program already stated: what the judge
// sees on screen is the board.json the program wrote.

import { ageDays, categoryMultiples, featuresFor, fitModel, flatMultiple, isRankable, leaveOneOut, maturity, MODEL_VERSION, predict, round, tierOf, TRIM_SHARE, GROWTH_FLOOR, GROWTH_CAP, MATURITY_DAYS, UNKNOWN_AGE_DAYS } from './model.mjs';
import { planFor } from '../lib/farm.ts';

/** The slug order the board breaks ties on: stable, and the same on every run. */
function bySlug(a, b) {
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

/** Rank every protocol the model may score, and carry the traded comps beside them, from one snapshot. */
export function buildRadar(snapshot) {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const { fit, comps, dropped } = fitModel(snapshot);
  const validation = leaveOneOut(fit, comps);
  const flat = flatMultiple(comps);

  // The watchlist is the floor: every slug it names is ranked, whatever the rest of the rules say.
  const chosen = new Map();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const x = featuresFor(p);
    return { p, age, x, prediction: predict(fit, x, age), plan: planFor(p, age) };
  });
  scored.sort((a, b) => b.prediction.implied_value_usd - a.prediction.implied_value_usd || bySlug(a.p, b.p));

  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    tier: tierOf(s.p, snapshot),
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: null,
    listed_at: s.p.listed_at,
    age_days: s.age,
    age_known: s.age !== null,
    model_inputs: { ln_tvl: round(s.x[1], 4), growth_pct: round(s.x[2], 4), maturity: round(maturity(s.age), 4) },
    implied_value_usd: s.prediction.implied_value_usd,
    mean_usd: s.prediction.mean_usd,
    multiple: round(s.prediction.multiple, 4),
    flat_usd: Math.min(100_000_000_000_000, Math.max(1, Math.round(s.p.tvl_usd * flat))),
    band_low_usd: s.prediction.low_usd,
    band_high_usd: s.prediction.high_usd,
    verdict: s.plan.verdict,
    cost_usd: s.plan.numbers.cost_usd,
    capital_usd: s.plan.numbers.capital_usd,
    hours: s.plan.numbers.hours,
    hold_days: s.plan.numbers.hold_days,
    first_action: s.plan.first_action,
    farm_steps: s.plan.steps,
  }));

  const live = comps
    .map((c) => ({
      slug: c.slug,
      name: c.name,
      category: c.category,
      chains: c.chains,
      tvl_usd: c.tvl_usd,
      mcap_usd: c.mcap_usd,
      change_7d: c.change_7d,
      age_days: c.age_days,
      realised_multiple: round(c.mcap_usd / c.tvl_usd, 3),
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd || bySlug(a, b));

  const tier = { watchlist: 0, extended: 0, early: 0 };
  const verdict = { farm: 0, thin: 0, skip: 0 };
  for (const row of board) {
    tier[row.tier] += 1;
    verdict[row.verdict] += 1;
  }
  return {
    board,
    radar: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      model_version: MODEL_VERSION,
      model: {
        beta: fit.beta.map((b) => round(b, 6)),
        n: fit.n,
        trimmed: dropped,
        trim_share: TRIM_SHARE,
        growth_band: [GROWTH_FLOOR, GROWTH_CAP],
        maturity_days: MATURITY_DAYS,
        unknown_age_days: UNKNOWN_AGE_DAYS,
        r2: validation.r2,
        sigma: validation.sigma,
        smearing: round(fit.smearing, 6),
        flat_multiple: round(flat, 4),
      },
      validation,
      watchlist_size: snapshot.watchlist.length,
      watchlist_covered: snapshot.watchlist.filter((s) => chosen.has(s)).length,
      board_size: board.length,
      tier_counts: tier,
      verdict_counts: verdict,
      categories: categoryMultiples(comps),
      rows: board,
      live,
    },
  };
}

/** The dashboard's whole dataset as one script: no fetch, no network, nothing the page recomputes. */
export function dataScript(radar) {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, and every farm step. */
export function boardIssue(board, snapshot) {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (slugs.size !== board.length) return 'a slug appears twice';
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, not the 100 to 4000 a board holds`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i].implied_value_usd > board[i - 1].implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0].implied_value_usd === board[board.length - 1].implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const row of board) {
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      if (step.trim().length < 20 || step.trim().length > 600) return `${row.slug} has a farm step of ${step.trim().length} characters`;
    }
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000) {
      return `${row.slug} has implied value ${row.implied_value_usd}`;
    }
  }
  return null;
}
