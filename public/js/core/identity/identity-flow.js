// identity-flow.js — orchestrates the full identity-registration flow:
// build/sign/broadcast a burn transaction, wait for finality, fetch and
// normalize it, then verify and register it. This is the thin,
// necessarily network-dependent composition layer on top of the pieces
// that ARE independently tested: solana-wallet.js (real keypair/tx
// construction, tested against the real @solana/web3.js) and
// identity-cost.js (pure verification/registration, fully tested).
//
// This file itself is NOT exercised in this development sandbox — it
// requires a live Connection to a real Solana network (devnet or
// mainnet, see solana-networks.js) — but every piece it calls has
// already been independently verified as far as this environment
// allows. Test this specific orchestration only in a real browser.

import { networkConfig, DEFAULT_NETWORK } from './solana-networks.js';
import { broadcastBurnTransaction } from './solana-wallet.js';
import { fetchNormalizedBurnTx } from './solana-rpc.js';
import { registerIdentityCost } from './identity-cost.js';

/**
 * Burns `lamports` from `keypair` on `network`, waits for finality,
 * verifies the resulting transaction, and registers it as `domain`'s
 * identity cost. Throws on any failure (insufficient balance, RPC
 * error, verification failure) rather than silently returning a
 * half-completed result — a partially-failed identity registration
 * must never look like a successful one.
 *
 * @param {typeof import('@solana/web3.js')} solanaWeb3
 * @param {import('@solana/web3.js').Keypair} keypair
 * @param {import('./identity-cost.js').IdentityCostState} state
 * @param {{ domain: string, lamports: number, network?: keyof typeof import('./solana-networks.js').SOLANA_NETWORKS }} params
 * @returns {Promise<{ state: import('./identity-cost.js').IdentityCostState, signature: string }>}
 */
export async function registerDomainViaBurn(solanaWeb3, keypair, state, { domain, lamports, network = DEFAULT_NETWORK }) {
  const { rpcEndpoint } = networkConfig(network);
  const connection = new solanaWeb3.Connection(rpcEndpoint, 'finalized');

  const signature = await broadcastBurnTransaction(solanaWeb3, connection, keypair, lamports);

  const tx = await fetchNormalizedBurnTx(signature, { network });
  if (!tx) {
    throw new Error(`Burn transaction ${signature} was broadcast but could not be fetched back at 'finalized' commitment`);
  }

  const result = registerIdentityCost(state, { domain, tx, minLamports: lamports });
  if (!result.accepted) {
    throw new Error(`Burn succeeded (${signature}) but registration was rejected: ${result.reason}`);
  }

  return { state: result.state, signature };
}
