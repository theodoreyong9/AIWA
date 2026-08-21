// solana-rpc.js — the actual network call to Solana (devnet or
// mainnet, see solana-networks.js). This file CANNOT be exercised or
// verified from this project's development sandbox: outbound network
// access here is restricted to a fixed allowlist of package-registry
// domains and does not include Solana RPC endpoints — the exact same
// limitation documented in README.md for why the real wasm32 build
// can't be produced locally either. Its correctness depends on matching
// Solana's real JSON-RPC response shape, which has been implemented
// carefully against the documented API, but has NOT been exercised
// against a live response from this environment. Treat this file as
// unverified until it's actually run in a browser against a real
// endpoint.
//
// Everything testable (the actual accept/reject logic) lives in
// identity-cost.js and is fully covered there — this file's only job is
// producing the NormalizedBurnTx shape that verifyBurnProof() expects,
// from a real transaction signature.
//
// Churn resistance (identity-cost.js's own header): `result.slot`
// is a standard, documented field on Solana's `getTransaction` RPC
// response — already present in the exact same parsed object this file
// already reads `result.transaction`/`result.meta.err`/
// `result.meta.preBalances`/`postBalances` from, but never previously
// read itself, silently discarded. Now captured into `NormalizedBurnTx`
// — no new RPC call, no new network dependency, only one more field
// read from a response already being fetched for every registration.

import { SOLANA_INCINERATOR_ADDRESS } from './identity-cost.js';
import { networkConfig, DEFAULT_NETWORK } from './solana-networks.js';

/**
 * Fetches a transaction at 'finalized' commitment and normalizes it
 * into the shape identity-cost.js's verifyBurnProof() expects.
 * Requesting 'finalized' commitment specifically means: if this returns
 * a non-null result at all, the transaction is already irreversible —
 * there is no separate "confirmationStatus" field to re-check
 * afterward, the commitment level of the request itself IS the
 * finality guarantee.
 *
 * @param {string} signature
 * @param {{ network?: keyof typeof import('./solana-networks.js').SOLANA_NETWORKS }} [opts]
 * @returns {Promise<import('./identity-cost.js').NormalizedBurnTx | null>}
 *   null if the transaction isn't found (not yet finalized, or doesn't exist)
 */
export async function fetchNormalizedBurnTx(signature, { network = DEFAULT_NETWORK } = {}) {
  const { rpcEndpoint } = networkConfig(network);
  const response = await fetch(rpcEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: [signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Solana RPC request failed: HTTP ${response.status}`);
  }

  const { result, error } = await response.json();
  if (error) {
    throw new Error(`Solana RPC error: ${error.message ?? JSON.stringify(error)}`);
  }
  if (!result) {
    return null; // not found at finalized commitment
  }

  const accountKeys = result.transaction.message.accountKeys.map((k) => (typeof k === 'string' ? k : k.pubkey));
  const incineratorIndex = accountKeys.indexOf(SOLANA_INCINERATOR_ADDRESS);
  if (incineratorIndex === -1) {
    // Transaction exists but never touches the incinerator address at all.
    return {
      signature,
      err: result.meta.err,
      incineratorBalanceDeltaLamports: 0,
      commitment: 'finalized',
      slot: Number.isFinite(result.slot) ? result.slot : null,
    };
  }

  const pre = result.meta.preBalances[incineratorIndex];
  const post = result.meta.postBalances[incineratorIndex];

  return {
    signature,
    err: result.meta.err,
    incineratorBalanceDeltaLamports: post - pre,
    commitment: 'finalized',
    slot: Number.isFinite(result.slot) ? result.slot : null,
  };
}
