// identity-flow.js — orchestrates the network half of identity
// registration: build/sign/broadcast a burn transaction, wait for
// finality, fetch and normalize it. This is the thin, necessarily
// network-dependent composition layer on top of the pieces that ARE
// independently tested: solana-wallet.js (real keypair/tx construction,
// tested against the real @solana/web3.js) and identity-cost.js (pure
// verification, fully tested).
//
// Deliberately does NOT touch any IdentityCostState anymore — an
// earlier revision did, and registration lived in a standalone local
// variable never folded from H_d, so two domains that reconciled after
// a partition never actually learned about each other's registered
// identities (found and fixed — see identity-cost-reducer.js). This
// file's only job now is producing a verified (signature, tx) pair;
// the caller is responsible for folding that into an 'identity-register'
// DAG event, the same way every other durable fact in this project
// becomes durable — by being an event, not a local variable.
//
// This file itself is NOT exercised in this development sandbox — it
// requires a live Connection to a real Solana network (devnet or
// mainnet, see solana-networks.js) — but every piece it calls has
// already been independently verified as far as this environment
// allows. Test this specific orchestration only in a real browser.

import { networkConfig, DEFAULT_NETWORK } from './solana-networks.js';
import { broadcastBurnTransaction } from './solana-wallet.js';
import { fetchNormalizedBurnTx } from './solana-rpc.js';
import { verifyBurnProof } from './identity-cost.js';

/**
 * Burns `lamports` from `keypair` on `network`, waits for finality, and
 * verifies the resulting transaction. Throws on any failure (insufficient
 * balance, RPC error, verification failure) rather than silently
 * returning a half-completed result.
 *
 * @param {typeof import('@solana/web3.js')} solanaWeb3
 * @param {import('@solana/web3.js').Keypair} keypair
 * @param {{ lamports: number, network?: keyof typeof import('./solana-networks.js').SOLANA_NETWORKS }} params
 * @returns {Promise<{ signature: string, burnedLamports: number, slot: number | null }>}
 */
export async function broadcastAndVerifyBurn(solanaWeb3, keypair, { lamports, network = DEFAULT_NETWORK }) {
  const { rpcEndpoint } = networkConfig(network);
  const connection = new solanaWeb3.Connection(rpcEndpoint, 'finalized');

  const signature = await broadcastBurnTransaction(solanaWeb3, connection, keypair, lamports);

  const tx = await fetchNormalizedBurnTx(signature, { network });
  if (!tx) {
    throw new Error(`Burn transaction ${signature} was broadcast but could not be fetched back at 'finalized' commitment`);
  }

  const check = verifyBurnProof(tx, { minLamports: lamports });
  if (!check.valid) {
    throw new Error(`Burn succeeded (${signature}) but did not verify: ${check.reason}`);
  }

  return { signature, burnedLamports: tx.incineratorBalanceDeltaLamports, slot: tx.slot ?? null };
}
