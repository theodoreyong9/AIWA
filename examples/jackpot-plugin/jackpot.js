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
