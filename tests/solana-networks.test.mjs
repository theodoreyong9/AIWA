import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOLANA_NETWORKS, DEFAULT_NETWORK, networkConfig } from '../public/js/core/identity/solana-networks.js';

test('default network is devnet — safe by default, not mainnet', () => {
  assert.equal(DEFAULT_NETWORK, 'devnet');
});

test('devnet is explicitly marked as providing no real Sybil resistance', () => {
  assert.equal(SOLANA_NETWORKS.devnet.isRealCost, false);
});

test('mainnet-beta is explicitly marked as a real cost', () => {
  assert.equal(SOLANA_NETWORKS['mainnet-beta'].isRealCost, true);
});

test('networkConfig() returns devnet config by default', () => {
  const config = networkConfig();
  assert.equal(config.rpcEndpoint, 'https://api.devnet.solana.com');
});

test('networkConfig() throws on an unknown network rather than silently defaulting', () => {
  assert.throws(() => networkConfig('testnet-typo'), /Unknown network/);
});

test('devnet has faucet links, mainnet does not', () => {
  assert.ok(SOLANA_NETWORKS.devnet.faucets.length > 0);
  assert.equal(SOLANA_NETWORKS['mainnet-beta'].faucets.length, 0);
});
