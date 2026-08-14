// solana-networks.js — network endpoints for the identity-cost
// mechanism. Devnet is the default deliberately: it lets the full flow
// (wallet, burn, broadcast, verify, register) be exercised end to end
// with zero real money at risk, using real cryptography and real
// on-chain finality — the only thing devnet SOL lacks is market value.
//
// That lack of value is not a footnote: on devnet, c_id provides ZERO
// real Sybil resistance (§24), since anyone can mint unlimited free SOL
// from a faucet and burn it costlessly. Devnet is for proving the
// MECHANISM works; only a mainnet burn is a real economic cost. Any UI
// using this module must show which network is active, not bury it.

export const SOLANA_NETWORKS = {
  devnet: {
    label: 'Devnet (testing only — free SOL, no real Sybil resistance)',
    rpcEndpoint: 'https://api.devnet.solana.com',
    isRealCost: false,
    faucets: [
      { label: 'Solana Faucet', url: 'https://faucet.solana.com' },
      { label: 'QuickNode Faucet', url: 'https://faucet.quicknode.com/solana/devnet' },
    ],
  },
  'mainnet-beta': {
    label: 'Mainnet (real SOL, irreversible — real c_id per §24)',
    rpcEndpoint: 'https://api.mainnet-beta.solana.com',
    isRealCost: true,
    faucets: [],
  },
};

export const DEFAULT_NETWORK = 'devnet';

export function networkConfig(network = DEFAULT_NETWORK) {
  const config = SOLANA_NETWORKS[network];
  if (!config) {
    throw new Error(`Unknown network: '${network}'. Valid options: ${Object.keys(SOLANA_NETWORKS).join(', ')}`);
  }
  return config;
}
