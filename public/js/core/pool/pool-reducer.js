// pool-reducer.js — the project's first real causal contract beyond a
// plain transfer: value pooled from real, independent contributors and
// distributed by a deterministic, weighted-random rule, with no
// server, no cron, no privileged executor. Originally built and named
// for one specific use (a community jackpot) — renamed once it became
// clear the mechanism itself has nothing jackpot-specific in it: pot
// minting, real contributions, a weighted draw, and a signature-free-
// but-recomputation-verified payout. "Jackpot" is one application of
// this primitive, built as a real module on top of it
// (examples/jackpot-plugin/jackpot.js); a raffle, a lottery, or any
// other winner-take-all random distribution funded by real, pooled
// AIWA is exactly as reachable from here, needing only a new plugin,
// never a change to this file.
//
// One honest scope boundary, not hidden: the distribution rule this
// file implements is specifically weighted-random, winner-take-all
// (computeWeightedDraw). A genuinely different rule — split
// proportionally among every contributor, for instance — is a
// different reducer, not a configuration option of this one; this file
// does not attempt to make the distribution rule itself pluggable.
//
// Adapted from a real reference implementation (a real donation-and-
// weighted-draw jackpot funded through a neobank) with two deliberate
// simplifications, stated honestly rather than silently dropped:
//
//   - No 50/50 carry-forward. The winner takes the entire cycle's pool.
//     Splitting a single claim into a winner-share and a carry-share
//     would require extending conservation.js's own transmutation
//     mechanism to support one-to-many derivation, a separate,
//     larger change this first version does not attempt.
//   - No diversity bonus. The reference implementation's bonus
//     rewarded donating to several different named recipients — safe
//     there because a trusted server tracked the real recipient list.
//     Here, "who else you gifted to" would be self-declared inside the
//     pool-contribute event itself, with no independent way to verify
//     it without a much larger design; rather than ship a bonus a
//     contributor could inflate by lying, this version omits it.
//     Sending real gifts to friends stays possible (ctx.transferClaim),
//     simply without a ticket multiplier attached.
//
// The real engineering problem this file exists to solve: how does a
// leaderless system pay out a pool without a trusted party ever moving
// money on anyone's behalf? A pool address (e.g. 'jackpot-pot:my-pool')
// has no keypair, by design — nobody can ever sign a transfer out of
// it, which is not a limitation to work around, it is the reason this
// is safe. conservation-bridge.js's 'pot-release' event type (added
// alongside this file) accepts a claim leaving a pool address WITHOUT a
// signature, but only when an injected verifier confirms the release is
// exactly what recomputing this file's own deterministic contract, from
// the real causally-ordered contribution history, says it should be.
// Nothing here is signed; everything here is checked by recomputation —
// the same discipline this whole project already applies to event ids,
// module hashes, and formula parity, applied for the first time to an
// actual payment.

/**
 * The pool address a given pool's contributions and payouts move
 * through — a string, never a real domain, never backed by a keypair.
 * Two different poolIds never collide (content-derived, not chosen
 * freely enough to shadow another pool by accident). The literal
 * prefix stays 'jackpot-pot:' for backward compatibility with every
 * pool already minted under it — renaming the FUNCTION and the FILE
 * does not retroactively change addresses already live in H_d.
 * @param {string} poolId
 */
export function potAddress(poolId) {
  return `jackpot-pot:${poolId}`;
}

export function initialPoolState() {
  return {
    pools: {}, // poolId -> { cycleLengthContributions, mintedBy, mintedAt }
    cycles: {}, // poolId -> { [cycleIndex]: { contributions: [{contributorDomain, claimId, amount}], closed: bool } }
    usedContributionClaimIds: {}, // claimId -> true, across every pool — a real transferred claim can back exactly one contribution, ever
    rejections: [],
  };
}

function reject(state, eventId, reason) {
  return { ...state, rejections: [...state.rejections, { eventId, reason }] };
}

/** Which cycle is currently accepting contributions for this pool — the first cycle whose contribution count hasn't yet reached the pool's own configured length. Purely derived from the folded history itself, never a self-declared field on any event, so nobody can choose which cycle their own contribution lands in. */
function currentOpenCycleIndex(state, poolId) {
  const pool = state.pools[poolId];
  const cyclesForPool = state.cycles[poolId] ?? {};
  let i = 0;
  while ((cyclesForPool[i]?.contributions.length ?? 0) >= pool.cycleLengthContributions) i++;
  return i;
}

/**
 * Folds one event. `conservationState` is the FULLY materialized
 * Conservation state over the same H_d — read-only context, never
 * mutated here. Using the final materialized state (not an
 * incrementally-tracked partial one) is deliberate and correct: a
 * contribution referencing a claim the pool no longer owns (because it
 * was already paid out, or never really transferred there) is rejected
 * exactly because the FINAL ownership check fails, which is precisely
 * the protection needed.
 *
 * @param {ReturnType<typeof initialPoolState>} state
 * @param {{ id: string, payload: any }} event
 * @param {import('../conservation/conservation.js').ConservationState} conservationState
 */
export function applyPoolEvent(state, event, conservationState) {
  const payload = event.payload;
  if (!payload || typeof payload.type !== 'string') return state;

  if (payload.type === 'pool-init') {
    const { poolId, cycleLengthContributions, mintedBy, at } = payload;
    if (typeof poolId !== 'string' || !poolId) return reject(state, event.id, 'missing poolId');
    if (state.pools[poolId]) return reject(state, event.id, `pool '${poolId}' already initialized — permanent once minted`);
    if (!Number.isInteger(cycleLengthContributions) || cycleLengthContributions < 1) {
      return reject(state, event.id, 'cycleLengthContributions must be a positive integer');
    }
    return { ...state, pools: { ...state.pools, [poolId]: { cycleLengthContributions, mintedBy: mintedBy ?? null, mintedAt: at ?? 0 } } };
  }

  if (payload.type === 'pool-contribute') {
    const { poolId, contributorDomain, claimId } = payload;
    if (typeof poolId !== 'string' || !poolId) return reject(state, event.id, 'missing poolId');
    const pool = state.pools[poolId];
    if (!pool) return reject(state, event.id, `pool '${poolId}' does not exist`);
    if (typeof contributorDomain !== 'string' || !contributorDomain) return reject(state, event.id, 'missing contributorDomain');
    if (typeof claimId !== 'string' || !claimId) return reject(state, event.id, 'missing claimId');
    if (state.usedContributionClaimIds[claimId]) return reject(state, event.id, `claim '${claimId}' already backs a contribution — cannot be reused`);

    const claim = conservationState.claims[claimId];
    if (!claim) return reject(state, event.id, `claim '${claimId}' does not exist`);
    if (claim.owner !== potAddress(poolId)) return reject(state, event.id, `claim '${claimId}' is not owned by pool '${poolId}' — the real transfer into the pool never happened, or already moved elsewhere`);
    if (claim.status !== 'active') return reject(state, event.id, `claim '${claimId}' is not active (status: ${claim.status})`);

    const cycleIndex = currentOpenCycleIndex(state, poolId);
    const cyclesForPool = state.cycles[poolId] ?? {};
    const cycle = cyclesForPool[cycleIndex] ?? { contributions: [] };
    const newCycle = { contributions: [...cycle.contributions, { contributorDomain, claimId, amount: claim.amount }] };

    return {
      ...state,
      cycles: { ...state.cycles, [poolId]: { ...cyclesForPool, [cycleIndex]: newCycle } },
      usedContributionClaimIds: { ...state.usedContributionClaimIds, [claimId]: true },
    };
  }

  return state;
}

/**
 * registry(H_d) for pools — mirror of every other materialize*
 * function in this project. `conservationState` must be the SAME
 * event list's already-materialized Conservation state, passed in by
 * the caller (main.js materializes Conservation first, then this) —
 * an explicit dependency, not a hidden cross-import.
 */
export function materializePool(orderedEvents, conservationState) {
  return orderedEvents.reduce((state, event) => applyPoolEvent(state, event, conservationState), initialPoolState());
}

/**
 * The deterministic draw itself — a specific distribution rule
 * (weighted-random, winner-take-all), not the only one this general
 * pool primitive could ever support (see this file's own header).
 * Mirror of the reference implementation's real hashToTicketIndex
 * logic, reimplemented here rather than imported. Pure and synchronous
 * except for the one real hash call, which Web Crypto makes async.
 *
 * @param {string} poolId
 * @param {number} cycleIndex
 * @param {Array<{contributorDomain: string, claimId: string, amount: number}>} contributions
 * @returns {Promise<{ winnerDomain: string, totalAmount: number, drawHash: string } | null>} null if there is nothing to draw (e.g. zero contributions, which should not happen for a genuinely closed cycle, but is handled rather than assumed impossible)
 */
export async function computeWeightedDraw(poolId, cycleIndex, contributions) {
  if (contributions.length === 0) return null;

  const hashInput = `${poolId}|${cycleIndex}|${contributions.map((c) => `${c.contributorDomain}:${c.claimId}:${c.amount}`).join('|')}`;
  const drawHash = await sha256hex(hashInput);

  let totalTickets = 0;
  const ranges = contributions.map((c) => {
    const start = totalTickets;
    const tickets = Math.floor(c.amount); // 1 ticket per whole unit contributed — see this file's header on the dropped diversity bonus
    totalTickets += tickets;
    return { contributorDomain: c.contributorDomain, start, end: totalTickets - 1 };
  });
  if (totalTickets === 0) return null; // every contribution rounded down to zero tickets

  const winningIndex = hashToTicketIndex(drawHash, totalTickets);
  const winnerRange = ranges.find((r) => winningIndex >= r.start && winningIndex <= r.end);
  const totalAmount = contributions.reduce((sum, c) => sum + c.amount, 0);

  return { winnerDomain: winnerRange.contributorDomain, totalAmount, drawHash };
}

async function sha256hex(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hashToTicketIndex(hexHash, totalTickets) {
  const bigVal = BigInt('0x' + hexHash.slice(0, 16));
  return Number(bigVal % BigInt(totalTickets));
}

/**
 * The injected verifier conservation-bridge.js's 'pot-release' event
 * calls — see that file's header for why this is safe without a
 * signature. Every check here is a recomputation against the real,
 * causally-ordered contribution history and the real Conservation
 * state, never a trust decision made on anyone's say-so.
 *
 * @param {ReturnType<typeof initialPoolState>} poolState
 * @param {import('../conservation/conservation.js').ConservationState} conservationState
 * @param {string} claimId
 * @param {string} from
 * @param {string} to
 * @param {{ poolId: string, cycleIndex: number }} releaseProof
 */
export async function verifyPoolPayout(poolState, conservationState, claimId, from, to, releaseProof) {
  if (!releaseProof || typeof releaseProof.poolId !== 'string' || !Number.isInteger(releaseProof.cycleIndex)) return false;
  const { poolId, cycleIndex } = releaseProof;

  const pool = poolState.pools[poolId];
  if (!pool) return false;
  if (from !== potAddress(poolId)) return false;

  const cycle = poolState.cycles[poolId]?.[cycleIndex];
  if (!cycle) return false;
  if (cycle.contributions.length < pool.cycleLengthContributions) return false; // cycle is not actually closed yet

  const belongsToCycle = cycle.contributions.some((c) => c.claimId === claimId);
  if (!belongsToCycle) return false; // this claim was never part of this cycle's real contributions

  const claim = conservationState.claims[claimId];
  if (!claim || claim.owner !== from || claim.status !== 'active') return false; // already released, or never really there

  const draw = await computeWeightedDraw(poolId, cycleIndex, cycle.contributions);
  if (!draw) return false;
  return to === draw.winnerDomain;
}
