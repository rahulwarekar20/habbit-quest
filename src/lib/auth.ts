/**
 * Prototype credential hashing. Passwords and parent PINs are stored only as SHA-256 hashes
 * in this browser. This is not production auth: the published app needs a real auth service.
 */

export async function hashSecret(secret: string): Promise<string> {
  const bytes = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const isValidPin = (pin: string) => /^\d{4}$/.test(pin);
