// formula-registry-reducer.js — makes θ (the reward formula's
// parameters, reward.js's RewardParams) a real economic object instead
// of a JS variable anyone can edit live in Parameters. Built directly
// from the question asked: "puis-je changer la formule quand je veux ?
// [...] ça doit être immuable" — it should, and until this file, it
// wasn't: theta lived as a plain `let` in main.js, mutable at any time,
// never a DAG event, meaning two domains could silently disagree on
// what the SAME accrual event is worth. That's a fork, not a bug in
// the normal sense — it was just never named as one.
//
// A 'formula-register' DAG event is a mint: an id bound permanently to
// a fixed (alpha, beta, gamma, C, minQ). No update path exists, ever —
// unlike module code (which CAN be updated, §27.4), a minted formula's
// parameters are fixed at birth. The same id can never be reused for
// different parameters; a second 'formula-register' for an
// already-minted id is rejected outright, matching the same
// content-addressing discipline as everything else in this project
// (§8.1) applied to an economic object instead of a ledger event or
// module's code.
//
// The real Proof-of-Will formula this project adopted (§10) is not
// minted through this mechanism at all — it is 'genesis', a fixed
// protocol default available to every domain with no event and no
// burn required, precisely to avoid a bootstrapping paradox: a domain
// needs SOME formula to accrue anything before it could ever mint a
// new one under real economic rules. Every OTHER formula is a genuine
// mint, and this reducer enforces the one thing it can pure-fold
// (immutability); the burn requirement itself is enforced at the
// application layer before a mint event is ever constructed — the same
// division of responsibility as checkSubmissionEligibility's wiring
// (module-submission.js): this file has no business importing
// identity-cost.js, so it doesn't.

export const GENESIS_FORMULA_ID = 'genesis';
export const GENESIS_FORMULA_PARAMS = { alpha: 1.1, beta: 2.2, gamma: 3, C: 33 ** 3, minQ: 1 };

export function initialFormulaRegistryState() {
  return { formulas: { [GENESIS_FORMULA_ID]: { ...GENESIS_FORMULA_PARAMS, mintedBy: null, mintedAt: 0 } }, rejections: [] };
}

export function applyFormulaEvent(state, event) {
  const payload = event.payload;
  if (!payload || payload.type !== 'formula-register') return state;

  const { id, alpha, beta, gamma, C, minQ, mintedBy, at } = payload;
  const reject = (reason) => ({ ...state, rejections: [...state.rejections, { eventId: event.id, id: id ?? null, reason }] });

  if (typeof id !== 'string' || !id) return reject('missing or invalid formula id');
  if (id === GENESIS_FORMULA_ID) return reject(`'${GENESIS_FORMULA_ID}' is reserved for the protocol default and cannot be re-minted`);
  if (state.formulas[id]) return reject(`formula id '${id}' is already minted — parameters are permanent once registered`);
  if (![alpha, beta, gamma, C, minQ].every(Number.isFinite)) return reject('alpha, beta, gamma, C, and minQ must all be finite numbers');

  return { ...state, formulas: { ...state.formulas, [id]: { alpha, beta, gamma, C, minQ, mintedBy: mintedBy ?? null, mintedAt: at ?? 0 } } };
}

/**
 * registry(H_d) for minted formulas — mirror of
 * materializeModuleRegistry() / materializeIdentity(). 'genesis' is
 * always present even over an empty event list.
 */
export function materializeFormulas(orderedEvents) {
  return orderedEvents.reduce(applyFormulaEvent, initialFormulaRegistryState());
}
