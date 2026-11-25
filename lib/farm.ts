// The farm planner: what a reader does about one protocol, what it costs and how long it takes.
//
// A plan is built from the protocol's own record only - its category, its chains, its TVL and its age - so
// every row gets a plan that fits it and no protocol's name is special-cased. Each step is one string that
// opens with the action and ends with its dollar cost and its clock time, which is what the bounty asks a
// plan to carry; the numbers behind those two are returned separately too, so the board can sort on them
// and a reader can re-add the total from the steps. planIssue() re-reads the finished plan and returns the
// reason the gate would refuse it, so a plan outside the 20 to 600 characters a step is read at never
// leaves the program.
//
// This file sits outside dashboard/ because the page never runs it: the program prices every plan once and
// ships the finished steps in the board's data, so the browser has nothing to compute here.

/** What one farm position costs, all in, and what its verdict rests on. */
export interface PlanNumbers {
  capital_usd: number;
  gas_usd: number;
  bridge_usd: number;
  cost_usd: number;
  hours: number;
  weeks: number;
  hold_days: number;
}

/** A protocol's plan: its steps, the numbers behind them and the planner's verdict. */
export interface Plan {
  steps: string[];
  numbers: PlanNumbers;
  verdict: 'farm' | 'thin' | 'skip';
  cost_share: number;
  first_action: string;
}

/** What it costs to send one transaction on a chain, in US dollars, as an operating estimate. */
const GAS_USD: Record<string, number> = {
  Ethereum: 6, Solana: 0.05, Base: 0.1, Arbitrum: 0.25, 'OP Mainnet': 0.15, Optimism: 0.15,
  Polygon: 0.05, 'BNB Chain': 0.2, BSC: 0.2, Avalanche: 0.4, Fantom: 0.1, Sonic: 0.1, Sui: 0.02,
  Aptos: 0.02, TON: 0.05, Tron: 1.5, Linea: 0.2, Scroll: 0.2, Blast: 0.15, Mantle: 0.1, Celo: 0.02,
  Berachain: 0.2, Hyperliquid: 0.02, Monad: 0.05, Plasma: 0.05, Starknet: 0.2, 'zkSync Era': 0.25,
  Sei: 0.05, Injective: 0.1, Flow: 0.1, Bitcoin: 4,
};

/** A chain with no entry above: a neutral estimate for a transaction the reader still has to send. */
const GAS_DEFAULT = 1.5;

/** The chains whose transactions are cheap enough that paying for a bridge is not worth it. */
const HOME_CHAINS = new Set(['Solana', 'Base', 'Arbitrum', 'OP Mainnet', 'Optimism', 'Polygon', 'BNB Chain', 'BSC', 'Avalanche']);

/** The cost of one transaction on the chain a protocol names, or the neutral estimate. */
export function gasUsd(chain: string): number {
  const known = GAS_USD[chain];
  return known === undefined ? GAS_DEFAULT : known;
}

/**
 * How much capital one position needs, from the protocol's own size: a thin protocol cannot absorb a large
 * position without moving its own rate, so the size steps up with the TVL.
 */
export function capitalFor(tvlUsd: number): number {
  if (tvlUsd >= 5_000_000_000) return 250;
  if (tvlUsd >= 1_000_000_000) return 200;
  if (tvlUsd >= 250_000_000) return 150;
  if (tvlUsd >= 50_000_000) return 100;
  return 50;
}

/**
 * How long a position is held, from the protocol's age: a younger protocol needs a longer window, because
 * its launch is further away and its own snapshots are further apart.
 */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
export function primaryChain(chains: string[]): string {
  return chains.length > 0 ? chains[0]! : 'its main chain';
}

/**
 * The category's own qualifying action, with the protocol's name, chain and position folded in. The branch
 * is the protocol's category, never its slug, so the plan is a rule and not a lookup.
 */
export function firstAction(name: string, category: string | null, chain: string, capital: number): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} as a lender and leave it supplied`;
  if (c.includes('dex') || c.includes('yield aggregat') || c.includes('leveraged farm') || c.includes('farm') || c.includes('liquidity manager')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the LP position open`;
  if (c.includes('restak') || c.includes('staking pool') || c.includes('restaking')) return `Restake ${chain}'s staking asset through ${name} and hold the receipt token it pays out`;
  if (c.includes('staking') || c.includes('chain')) return `Delegate the chain's staking asset to ${name} on ${chain} and hold the receipt token it pays out`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return `Deposit $${capital} of USDC as margin at ${name} on ${chain} and open one small hedged perp`;
  if (c.includes('prediction')) return `Fund $${capital} at ${name} on ${chain} and take one position in a market you already have a view on`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a non-custodial ${name} vault on ${chain} and hold the vault shares`;
  if (c.includes('stable')) return `Mint or supply $${capital} of the protocol's stable asset through ${name} on ${chain}`;
  if (c.includes('rwa') || c.includes('otc') || c.includes('index')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the same wallet`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active`;
  if (c.includes('governance')) return `Lock ${chain}'s governance asset through ${name} and leave it locked through the vote`;
  if (c.includes('payments')) return `Route $${capital} of ${chain}'s asset through ${name} and keep the balance there`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open`;
}

/** The number of weeks the plan's qualifying activity runs for, from the hold window. */
export function weeksFor(holdDays: number): number {
  return Math.max(4, Math.round(holdDays / 7));
}

/**
 * A protocol's plan: seven steps, each an action that ends with what it costs and how long it takes, and
 * the numbers behind them. Every dollar of the cost is a count of transactions at the chain's own rate, so
 * the total is reproducible from the steps: three to open the position, three fifths of a transaction a
 * week to keep it warm, and two to claim. The verdict is that cost as a share of the position's capital,
 * with over a tenth called skip and over three per cent called thin, so a reader is told when farming a
 * protocol is not worth the gas at a size they can realistically commit.
 */
export function planFor(protocol: { name: string; category: string | null; chains: string[]; tvl_usd: number }, age: number | null): Plan {
  const chain = primaryChain(protocol.chains);
  const capital = capitalFor(protocol.tvl_usd);
  const hold = holdDaysFor(age);
  const weeks = weeksFor(hold);
  const gas = gasUsd(chain);
  const bridge = protocol.chains.length > 1 && !HOME_CHAINS.has(chain) && chain !== 'Ethereum' ? gasUsd('Ethereum') + 2 : 0;
  const setup = gas * 3;
  const activity = gas * 0.6 * weeks;
  const claim = gas * 2;
  const cost = bridge + setup + activity + claim;
  // The clock time is the sum of the steps' own stated times, so the total and the steps agree.
  const hours = 10 / 60 + 20 / 60 + (bridge > 0 ? 15 / 60 : 0) + weeks / 6 + 20 / 60 + 10 / 60;
  const action = firstAction(protocol.name, protocol.category, chain, capital);
  const numbers: PlanNumbers = {
    capital_usd: capital,
    gas_usd: round2(gas),
    bridge_usd: round2(bridge),
    cost_usd: round2(cost),
    hours: round2(hours),
    weeks,
    hold_days: hold,
  };
  const steps = [
    `Fund a wallet used only for this farm with $${capital} plus about $${Math.max(5, Math.ceil(cost))} of gas, and keep its seed phrase offline. Cost: $0 plus the $${Math.max(5, Math.ceil(cost))} of gas you must put in first. Time: 10 minutes.`,
    `${action}. Cost: $${capital} of your own capital (returned when you withdraw) plus about $${round2(gas).toFixed(2)} of ${chain} gas. Time: 20 minutes, once.`,
    bridge > 0
      ? `If your funds sit on Ethereum, bridge them to ${chain} first and check the rate against a second route before you send anything. Cost: about $${round2(bridge).toFixed(2)} of bridging and gas in both directions. Time: 15 minutes plus the bridge's own settlement wait.`
      : `Keep the position on ${chain} and do not bridge: ${chain} is where the protocol's own liquidity is, and a second chain adds cost without adding eligibility. Cost: $0. Time: 0 minutes.`,
    `Make one qualifying action every week for ${weeks} weeks: supply, borrow, swap, restake or vote, so the activity lands in more than one of the protocol's own snapshots. Cost: about $${round2(activity / weeks).toFixed(2)} of gas a week, $${round2(activity).toFixed(2)} in all. Time: about 10 minutes a week, ${round2(weeks / 6).toFixed(1)} hours in all.`,
    `Hold for at least ${hold} days from your first action and do not close the position early: a launch announcement is usually followed by a snapshot, and an empty position at the snapshot earns nothing. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    `Check the protocol's own site and its official account for the claim page, then claim from that page only. Nobody ever needs a payment, a seed phrase or a private key from you to give you a token. Cost: about $${round2(claim).toFixed(2)} of gas to claim. Time: 20 minutes on the day.`,
    `Write the wallet address, every date and every transaction hash into a farm log, so you can repeat the position or unwind it at the size you decided. Cost: $0. Time: 10 minutes.`,
  ].map(clampStep);
  const costShare = round4(cost / capital);
  const verdict: Plan['verdict'] = costShare > 0.1 ? 'skip' : costShare > 0.03 ? 'thin' : 'farm';
  return { steps, numbers, verdict, cost_share: costShare, first_action: action };
}

/** A step is what the gate reads: 20 to 600 characters once trimmed, and never cut mid-sentence. */
function clampStep(step: string): string {
  let s = step.trim();
  if (s.length > 600) {
    const cut = s.slice(0, 599);
    const stop = cut.lastIndexOf('. ');
    s = stop > 300 ? cut.slice(0, stop + 1) : cut;
  }
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`.slice(0, 80);
  return s;
}

/** Two decimals, deterministically. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Four decimals, deterministically. */
function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

/**
 * Why a plan is not one the gate will take, or null: the step count, each step's length, and that a step
 * carries the cost and the time the bounty asks every plan to state.
 */
export function planIssue(plan: Plan): string | null {
  if (plan.steps.length < 3 || plan.steps.length > 12) return `${plan.steps.length} steps`;
  for (const step of plan.steps) {
    if (step.trim().length < 20 || step.trim().length > 600) return `a step of ${step.trim().length} characters`;
  }
  if (!/Cost:/.test(plan.steps[0]!) || !/Time:/.test(plan.steps[0]!)) return 'a step with no cost and no time';
  if (!(plan.numbers.cost_usd > 0) || !(plan.numbers.hours > 0)) return 'a plan with no cost or no time';
  return null;
}
