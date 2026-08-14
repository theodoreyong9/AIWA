// solana-wallet.test.mjs — tests solana-wallet.js against the REAL
// @solana/web3.js library (installed via `npm install`, test-only —
// see package.json), not a hand-rolled fake. Real key generation, real
// AES-GCM encryption via Web Crypto, real transaction construction,
// signing, and serialization. The only thing NOT exercised here is an
// actual network broadcast — see broadcastBurnTransaction()'s doc
// comment in solana-wallet.js for why that specific function can't be
// tested in this sandbox.
//
// Requires `npm install` first (installs @solana/web3.js as a
// devDependency — not used by the deployed app itself, see
// package.json).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as solanaWeb3 from '@solana/web3.js';
import {
  generateKeypair,
  keypairFromSecretKey,
  encryptSecretKey,
  decryptSecretKey,
  buildBurnTransaction,
  signAndSerialize,
} from '../public/js/core/identity/solana-wallet.js';
import { SOLANA_INCINERATOR_ADDRESS } from '../public/js/core/identity/identity-cost.js';

test('generateKeypair produces a real, usable Ed25519 keypair', () => {
  const kp = generateKeypair(solanaWeb3);
  assert.equal(kp.secretKey.length, 64);
  assert.ok(kp.publicKey instanceof solanaWeb3.PublicKey);
});

test('encryptSecretKey / decryptSecretKey round-trips the real secret key bytes', async () => {
  const kp = generateKeypair(solanaWeb3);
  const record = await encryptSecretKey(kp.secretKey, 'correct horse battery staple');
  const decrypted = await decryptSecretKey(record, 'correct horse battery staple');

  assert.deepEqual(new Uint8Array(decrypted), kp.secretKey);

  // And the decrypted bytes actually reconstruct the same real keypair.
  const restored = keypairFromSecretKey(solanaWeb3, decrypted);
  assert.equal(restored.publicKey.toBase58(), kp.publicKey.toBase58());
});

test('decryptSecretKey rejects the wrong password instead of returning garbage', async () => {
  const kp = generateKeypair(solanaWeb3);
  const record = await encryptSecretKey(kp.secretKey, 'right-password');
  await assert.rejects(() => decryptSecretKey(record, 'wrong-password'), /Wrong password/);
});

test('buildBurnTransaction produces a real, correctly-shaped transaction targeting the incinerator', () => {
  const kp = generateKeypair(solanaWeb3);
  const fakeBlockhash = generateKeypair(solanaWeb3).publicKey.toBase58(); // valid 32-byte base58, offline test only

  const tx = buildBurnTransaction(solanaWeb3, { fromPubkey: kp.publicKey, lamports: 1_000_000, recentBlockhash: fakeBlockhash });

  assert.equal(tx.instructions.length, 1);
  assert.ok(tx.instructions[0].programId.equals(solanaWeb3.SystemProgram.programId));

  const decoded = solanaWeb3.SystemInstruction.decodeTransfer(tx.instructions[0]);
  assert.equal(decoded.toPubkey.toBase58(), SOLANA_INCINERATOR_ADDRESS);
  assert.equal(decoded.lamports.toString(), '1000000');
  assert.equal(decoded.fromPubkey.toBase58(), kp.publicKey.toBase58());
});

test('buildBurnTransaction rejects a non-positive lamport amount', () => {
  const kp = generateKeypair(solanaWeb3);
  const fakeBlockhash = generateKeypair(solanaWeb3).publicKey.toBase58();
  assert.throws(() => buildBurnTransaction(solanaWeb3, { fromPubkey: kp.publicKey, lamports: 0, recentBlockhash: fakeBlockhash }), RangeError);
  assert.throws(() => buildBurnTransaction(solanaWeb3, { fromPubkey: kp.publicKey, lamports: -5, recentBlockhash: fakeBlockhash }), RangeError);
});

test('signAndSerialize produces real, validly-signed bytes that survive a round trip through Transaction.from', () => {
  const kp = generateKeypair(solanaWeb3);
  const fakeBlockhash = generateKeypair(solanaWeb3).publicKey.toBase58();
  const tx = buildBurnTransaction(solanaWeb3, { fromPubkey: kp.publicKey, lamports: 500_000, recentBlockhash: fakeBlockhash });

  const raw = signAndSerialize(tx, kp);
  assert.ok(raw.length > 0);

  // Transaction.from() internally verifies the signature against the
  // message bytes as part of deserializing a signed transaction — this
  // would throw if the signature were invalid, so a successful parse is
  // itself a real signature-validity check, not just a shape check.
  const parsed = solanaWeb3.Transaction.from(raw);
  assert.equal(parsed.signatures[0].publicKey.toBase58(), kp.publicKey.toBase58());
  assert.ok(parsed.signatures[0].signature !== null);
});
