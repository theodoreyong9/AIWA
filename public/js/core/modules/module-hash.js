export async function computeModuleHash(code) {
  const bytes = new TextEncoder().encode(code);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyModuleIntegrity(code, expectedHash) {
  const actual = await computeModuleHash(code);
  return actual === expectedHash;
}
