// jackpot.js — AIWA's first real causal contract as a real, runnable
// module. No real money, no neobank, entirely AIWA: a donor's real
// value really leaves their control the moment they donate (a real,
// signed Conservation transfer, §7); the winner is decided by pure
// recomputation, never a signature or a trusted server
// (pool-reducer.js, conservation-bridge.js's 'pot-release'); anyone —
// not only the winner — can trigger a payout once it's real, since
// posting it is never itself an authorization, only correctness is.
//
// This plugin is one application of a GENERAL pool primitive
// (pool-reducer.js) — not what that mechanism is specifically for. A
// raffle, a lottery, or any other winner-take-all random distribution
// funded by real, pooled AIWA is exactly as reachable, needing only a
// new plugin like this one, never a change to the reducer underneath.
//
// Explicit, honest simplifications from the reference this was adapted
// from (see pool-reducer.js's own header for the full reasoning): the
// winner takes the ENTIRE pool, no 50/50 carry-forward; there is no
// diversity bonus — one ticket per whole unit donated, flat.
//
// Uses only the general-purpose ctx primitives (postCausalEvent,
// queryCausalState, transferClaim) — nothing jackpot-specific was ever
// added to the sandbox bridge itself, on purpose.
//
// ── What using it actually looks like ────────────────────────────
//
// Open the plugin, enter an amount, press Donate. Behind that one
// click: a real claim is issued from your own accrued balance, really
// transferred (a real, signed Conservation transfer — your balance
// genuinely goes down, right then, not just in this UI) into the pot's
// address, and recorded as this cycle's contribution. The screen
// updates to show the cycle's real donation count (e.g. "3 / 5") and
// the real pot total so far — both read back from materialized state,
// never a locally-held running counter.
//
// Once a cycle reaches its configured length (CYCLE_LENGTH below —
// 5 real donations, not 5 minutes: there is no wall clock anywhere in
// this contract), the "Check & trigger payout" button becomes
// meaningful: pressing it recomputes the deterministic weighted draw
// from the cycle's real donation history and, if a closed, unpaid
// cycle exists, posts the real release events that move every real
// donation claim in that cycle to the real, recomputed winner.
// Anyone's click does this correctly — the winner doesn't need to be
// the one who presses it, and pressing it does not, by itself,
// authorize anything; the recomputation does. If no cycle is closed
// yet, the button simply has nothing to do.
//
// ── A worked example ──────────────────────────────────────────────
//
// Alice and Bob both open this plugin on the same pot. Alice donates
// 30, Bob donates 20 — 2 of the 5 needed. Alice donates again (20) and
// Bob again (30) — 4 of 5. Whoever donates the 5th real contribution
// closes the cycle. Either Alice or Bob (or a third party who never
// donated at all — permitted, and harmless, since the recomputation
// itself is what decides) presses "Check & trigger payout": the real
// draw is recomputed from the 5 real contributions actually recorded
// (weighted by amount — Alice contributed 50 of the 100 total, so she
// has roughly even odds against Bob's 50, not a coin flip regardless
// of amount), and the real winner receives all 100 AIWA, moved via
// real 'pot-release' events, one per donation claim in that cycle.
//
// ── Registering this as a real, running module ───────────────────
//
// This file is ordinary, permissionless module code — nothing about it
// requires platform involvement to deploy. From the app: Domain screen
// → Submit plugin code, paste this file's contents, give it a real
// codeHash (computed from the exact bytes being submitted) and a
// codeUrl it can be fetched from later, and submit — the same open
// registration path (§27.4) every module uses, no allow-list, no
// approval step. Once registered and pinned to a desktop, opening it
// runs the flow described above for real.

(function () {
  const POOL_ID = 'community-pot';
  const CYCLE_LENGTH = 5; // 5 real donations close a cycle — no wall clock anywhere in this contract

  let root;

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const child of children) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    return node;
  }

  async function ensurePoolExists() {
    const state = await ctx.queryCausalState('pool');
    if (state?.pools?.[POOL_ID]) return;
    await ctx.postCausalEvent('pool-init', { poolId: POOL_ID, cycleLengthContributions: CYCLE_LENGTH });
  }

  async function donate(amount) {
    if (!Number.isFinite(amount) || amount <= 0) {
      ctx.toast('Enter a positive amount.', 'error');
      return;
    }
    const balance = await ctx.queryCausalState('myBalance');
    if (amount > balance) {
      ctx.toast(`You only have ${balance.toFixed(2)} AIWA.`, 'error');
      return;
    }
    await ensurePoolExists();

    const claimId = `${ctx.myDomainId}-jackpot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await ctx.postCausalEvent('claim-issue', { id: claimId, amount, kind: 'AIWA' });
    const poolAddress = `jackpot-pot:${POOL_ID}`; // literal address prefix stays as-is — see pool-reducer.js's own note on this
    await ctx.transferClaim(claimId, poolAddress);
    // The real claim id changes on transfer (Conservation activates a
    // new one) — find it by reading real state back, never guessed.
    const realClaim = (await ctx.queryCausalState('poolClaims', { poolId: POOL_ID }))?.find((c) => c.amount === amount);
    await ctx.postCausalEvent('pool-contribute', { poolId: POOL_ID, contributorDomain: ctx.myDomainId, claimId: realClaim ? realClaim.id : null });

    ctx.toast(`Donated ${amount} AIWA — ${Math.floor(amount)} ticket(s) this cycle.`, 'success');
    await render();
  }

  async function attemptPayout() {
    const state = await ctx.queryCausalState('pool');
    const pool = state?.pools?.[POOL_ID];
    if (!pool) return;
    const cycles = state.cycles?.[POOL_ID] ?? {};
    for (const [cycleIndexStr, cycle] of Object.entries(cycles)) {
      const cycleIndex = Number(cycleIndexStr);
      if (cycle.contributions.length < pool.cycleLengthContributions) continue; // not closed yet
      const draw = await ctx.queryCausalState('poolDraw', { poolId: POOL_ID, cycleIndex });
      if (!draw) continue;
      for (const contribution of cycle.contributions) {
        await ctx.postCausalEvent('pot-release', {
          claimId: contribution.claimId,
          from: `jackpot-pot:${POOL_ID}`,
          to: draw.winnerDomain,
          nonce: `${POOL_ID}-${cycleIndex}-${contribution.claimId}`,
          releaseProof: { poolId: POOL_ID, cycleIndex },
        });
      }
      ctx.toast(`Cycle ${cycleIndex} paid out to ${draw.winnerDomain.slice(0, 10)}…`, 'success');
    }
    await render();
  }

  async function render() {
    root.innerHTML = '';
    const state = await ctx.queryCausalState('pool');
    const pool = state?.pools?.[POOL_ID];
    const balance = await ctx.queryCausalState('myBalance');

    root.appendChild(el('h2', { textContent: '🎰 Community Pot', style: 'font-family:var(--aiwa-font-family,inherit);margin:0 0 0.4rem' }));
    root.appendChild(el('p', { textContent: `Your balance: ${balance.toFixed(2)} AIWA`, style: 'font-size:0.85rem;opacity:0.8' }));

    if (!pool) {
      root.appendChild(el('p', { textContent: 'No pot minted yet on this domain\u2019s view — donating will mint one.' }));
    } else {
      const cycles = state.cycles[POOL_ID] ?? {};
      const openIndex = Object.keys(cycles).map(Number).find((i) => (cycles[i]?.contributions.length ?? 0) < pool.cycleLengthContributions) ?? 0;
      const openCycle = cycles[openIndex] ?? { contributions: [] };
      root.appendChild(el('p', {
        textContent: `Cycle ${openIndex}: ${openCycle.contributions.length} / ${pool.cycleLengthContributions} donations`,
        style: 'font-size:0.85rem',
      }));
      const total = openCycle.contributions.reduce((s, c) => s + c.amount, 0);
      root.appendChild(el('p', { textContent: `Pot so far: ${total.toFixed(2)} AIWA`, style: 'font-size:0.85rem;opacity:0.8' }));
    }

    const input = el('input', { type: 'number', min: '0.01', step: '0.01', placeholder: 'Amount', style: 'width:100%;margin:0.5rem 0;padding:0.4rem' });
    const donateBtn = el('button', { textContent: 'Donate', style: 'width:100%;padding:0.5rem;margin-bottom:0.4rem' });
    donateBtn.addEventListener('click', () => donate(parseFloat(input.value)));
    root.appendChild(input);
    root.appendChild(donateBtn);

    const payoutBtn = el('button', {
      textContent: 'Check & trigger payout for any closed cycle',
      style: 'width:100%;padding:0.5rem;font-size:0.8rem;opacity:0.85',
    });
    payoutBtn.addEventListener('click', attemptPayout);
    root.appendChild(payoutBtn);

    root.appendChild(el('p', {
      textContent: 'Winner takes the whole cycle\u2019s pot. No carry-forward, no diversity bonus — a deliberate, honestly-scoped first version (see the whitepaper\u2019s §27.8/Appendix H.29 for why).',
      style: 'font-size:0.7rem;opacity:0.6;margin-top:0.6rem',
    }));
  }

  root = el('div', { style: 'padding:0.8rem;font-family:var(--aiwa-font-family,system-ui,sans-serif);color:var(--aiwa-color-text,#111)' });
  document.body.appendChild(root);
  render();
})();
