// solana-wallet.js — real Solana keypair management and burn-transaction
// construction/signing, backing the identity-cost mechanism with actual
// working code, not a placeholder.
//
// This file is deliberately split from the network-touching parts
// (solana-rpc.js): everything here — key generation, password
// encryption, transaction building, signing, serialization — is real,
// runs against the actual @solana/web3.js library, and is fully unit
// tested (see tests/solana-wallet.test.mjs) using that real library,
// entirely offline. Only broadcasting a signed transaction to mainnet
// and confirming it requires live network access, which is a much
// smaller, separately-flagged surface than before (see
// broadcastBurnTransaction() at the bottom, and solana-rpc.js).
//
// Dependency injection, same pattern as ledger-bridge.js's injectable
// WASM loader: every function here takes `solanaWeb3` as a parameter
// rather than reading `window.solanaWeb3` directly, so tests can pass
// the real npm package while the browser build passes the
// CDN-loaded global. See loadSolanaWeb3() at the bottom for how the
// browser obtains it.

import { SOLANA_INCINERATOR_ADDRESS } from './identity-cost.js';

const PBKDF2_ITERATIONS = 200_000;

/** Generates a brand-new Solana keypair. Real Ed25519 key material. */
export function generateKeypair(solanaWeb3) {
  return solanaWeb3.Keypair.generate();
}

/**
 * Reconstructs a Keypair from a raw 64-byte secret key (the format
 * Keypair.generate() itself produces, and what gets encrypted/decrypted
 * below).
 */
export function keypairFromSecretKey(solanaWeb3, secretKeyBytes) {
  return solanaWeb3.Keypair.fromSecretKey(secretKeyBytes);
}

/**
 * Encrypts a keypair's secret key with a password: PBKDF2 (SHA-256,
 * 200,000 iterations) to derive an AES-256-GCM key, standard and
 * unremarkable on purpose — this is not a place to be clever. Returns a
 * plain object safe to JSON.stringify into localStorage.
 *
 * @param {Uint8Array} secretKeyBytes
 * @param {string} password
 * @returns {Promise<{ salt: number[], iv: number[], ciphertext: number[] }>}
 */
export async function encryptSecretKey(secretKeyBytes, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, secretKeyBytes);

  return {
    salt: Array.from(salt),
    iv: Array.from(iv),
    ciphertext: Array.from(new Uint8Array(ciphertext)),
  };
}

/**
 * Decrypts a record produced by encryptSecretKey(). Throws on wrong
 * password (AES-GCM's authentication tag fails to verify) rather than
 * silently returning garbage bytes.
 *
 * @param {{ salt: number[], iv: number[], ciphertext: number[] }} record
 * @param {string} password
 * @returns {Promise<Uint8Array>}
 */
export async function decryptSecretKey(record, password) {
  const salt = new Uint8Array(record.salt);
  const iv = new Uint8Array(record.iv);
  const ciphertext = new Uint8Array(record.ciphertext);

  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  } catch {
    throw new Error('Wrong password');
  }
  return new Uint8Array(plaintext);
}

/**
 * Builds an UNSIGNED burn transaction: a single SystemProgram transfer
 * of `lamports` to the network's real incinerator address. The caller
 * supplies `recentBlockhash` — fetching one is a network call, kept out
 * of this function so it stays offline-testable (see
 * tests/solana-wallet.test.mjs, which uses a synthetic but
 * correctly-shaped blockhash).
 *
 * @param {typeof import('@solana/web3.js')} solanaWeb3
 * @param {{ fromPubkey: import('@solana/web3.js').PublicKey, lamports: number, recentBlockhash: string }} params
 */
export function buildBurnTransaction(solanaWeb3, { fromPubkey, lamports, recentBlockhash }) {
  if (!Number.isInteger(lamports) || lamports <= 0) {
    throw new RangeError(`lamports must be a positive integer, got ${lamports}`);
  }
  const tx = new solanaWeb3.Transaction();
  tx.add(
    solanaWeb3.SystemProgram.transfer({
      fromPubkey,
      toPubkey: new solanaWeb3.PublicKey(SOLANA_INCINERATOR_ADDRESS),
      lamports,
    })
  );
  tx.recentBlockhash = recentBlockhash;
  tx.feePayer = fromPubkey;
  return tx;
}

/**
 * Signs a transaction with the given keypair and returns the raw bytes
 * ready to broadcast. Real Ed25519 signing via @solana/web3.js — the
 * same signature a real wallet extension would produce.
 */
export function signAndSerialize(tx, keypair) {
  tx.sign(keypair);
  return tx.serialize();
}

/**
 * The only part of this file that touches the network — kept as a thin,
 * separately-flagged function so the boundary is obvious. Fetches a
 * real recent blockhash, builds, signs, and broadcasts the burn
 * transaction, and waits for 'finalized' confirmation (matching
 * identity-cost.js's requirement that only a finalized burn counts).
 * NOT exercised in this development sandbox — see solana-rpc.js's
 * header for why, and test this specific function only in a real
 * browser against mainnet.
 *
 * @param {typeof import('@solana/web3.js')} solanaWeb3
 * @param {import('@solana/web3.js').Connection} connection
 * @param {import('@solana/web3.js').Keypair} keypair
 * @param {number} lamports
 * @returns {Promise<string>} the finalized transaction signature
 */
export async function broadcastBurnTransaction(solanaWeb3, connection, keypair, lamports) {
  const { blockhash } = await connection.getLatestBlockhash('finalized');
  const tx = buildBurnTransaction(solanaWeb3, { fromPubkey: keypair.publicKey, lamports, recentBlockhash: blockhash });
  const raw = signAndSerialize(tx, keypair);
  const signature = await connection.sendRawTransaction(raw);
  await connection.confirmTransaction(signature, 'finalized');
  return signature;
}

/**
 * Loads @solana/web3.js from a CDN in the browser (mirrors the loading
 * technique used elsewhere in the ecosystem for the same library — a
 * plain <script> tag, not a bundler dependency, since this project has
 * no build step). No-ops if already loaded. Untestable here (network),
 * same category as everything else network-facing in this module.
 */
export async function loadSolanaWeb3() {
  if (typeof window !== 'undefined' && window.solanaWeb3) return window.solanaWeb3;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/@solana/web3.js@1.98.0/lib/index.iife.min.js';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return window.solanaWeb3;
}
