# How the Token Radar values a launch

Every number on the board comes from the sealed DefiLlama snapshot and from the three files beside this
one: `model.mjs` fits the value model, `farm.mjs` prices the farm plans, and `board.mjs` assembles the
rows. They are the same files the program reads — it imports them out of this directory — so the source
you are reading is the source that wrote the board, not a copy of it.

## The model is fitted, not written down

The snapshot holds two populations: protocols whose token already trades, with a market cap and a TVL the
market has priced, and protocols that record no token, which is what the board ranks. The traded ones are
the training set. From them the model fits

    ln(market cap) = b0 + b1 · ln(TVL) + b2 · (seven-day growth, per cent)

by ordinary least squares at run time, and the coefficients on the board are the ones this snapshot
produced. No multiple is written down, no protocol name is ever read, and the same expression scores every
row.

The fitted coefficient on TVL comes out **below 1**, which is what the comps say: a larger protocol trades
at a *smaller* multiple of its TVL. That is why the flat median multiple — which the board also shows in
its own column, beside the fitted number — over-values the largest protocols. It is a median over a set
that is mostly small protocols.

## What is fitted, and what is only stated

Two terms are not fitted, and this file says so rather than implying otherwise:

- **Growth** is banded to −60% to +150%. Four of the snapshot's 754 seven-day changes fall outside that
  band; each is a re-listing, a bridge migration, or a near-zero base divided into, so the band is where
  those four stop carrying the regression.
- **Maturity** is `0.55 + 0.45 · min(age in days, 1095) / 1095`, a protocol with no listing day being
  treated as 365 days old. Every comp has *already launched*, so the comps cannot say what a pre-token
  protocol's tenure is worth. This is a prior over the protocols with no token, marked as a prior; a
  longer record is read as the stronger claim to a launch.

Two thirds of the level is measured. The rest is labelled.

## The model measures itself

An implied value is worth what its accuracy is. The board prints that accuracy, measured on the snapshot's
own comps: each comp is left out in turn, the model is refitted without it, and its prediction is compared
with the market cap that protocol's token *actually* trades at. Two baselines are scored the same way on
the same comps — a flat median market-cap-to-TVL multiple, and that multiple taken inside the protocol's
own category. All three numbers sit in the header of the board, and the fitted model's median
out-of-sample error is lower than both.

One limit is published with them: the fit uses the middle 90% of realised multiples. In this snapshot they
run from 0.004 to 36, and a least-squares fit on logs gives those tails a leverage the level of a
*typical* protocol should not have. The count trimmed is on the board.

## The number is a median with a band

The published implied value is the fitted distribution's **median**, `exp(fitted value) × maturity`. Not
the mean: `exp()` of a mean is pulled up by the lognormal tail, by the factor the board shows. Every row
carries its 90% band, the mean beside the median, and what the flat multiple would have said — so a reader
can see both conventions and where this model disagrees with them.

An implied value is this radar's own claim about what a token would be worth *if the protocol's record
stayed as it is*. It is not a prediction that a token will be issued, and it is not investment advice.
DefiLlama's record is not proof: a protocol here may hold a token its record does not carry.

## The tiers, and why the watchlist is not the whole board

The house watchlist is 40 protocols: at or above $50M of TVL, no token recorded, and not a wrapped,
staked or bridged product of one that already trades. It is a floor, never a ceiling, so the board carries
three tiers and labels every row with the one it came from:

- **watchlist** — the 40 the house named. All of them are ranked, always.
- **above floor** — pre-token protocols at or above $50M that the house list leaves out, because
  DefiLlama records a parent protocol for them. No worse a subject, so ranked and marked.
- **early** — pre-token protocols below the floor: the finds a radar exists to turn up before they grow
  to the house's line.

Protocols that already trade are never mixed into the ranking. They are carried separately, with the
multiple the market gives them, on the **Traded comps** view: the evidence, not the subject.

## The farm plans

Each plan is seven steps built from the protocol's own record — its category, its chains, its TVL and its
age — and never from its name. Every step states what it costs and how long it takes, and the plan's total
cost is a count of transactions at the chain's own rate: three to open the position, three fifths of one a
week to keep it warm, two to claim. A reader can re-add the total from the steps themselves.

The **verdict** is that cost as a share of the position a protocol of that size can take: over a tenth of
the capital is *skip*, over three per cent is *thin*, and under it is *farm*. It is advice about gas, not
about the protocol: a plan can be cheap and still worthless.
