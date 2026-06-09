/**
 * Generate an Ed25519 keypair for signing seat tokens and print the PEMs.
 *
 *   bun run keygen
 *
 * Copy the private PEM into the server's SEAT_PRIVATE_KEY_PEM (or write it to a
 * file referenced by SEAT_PRIVATE_KEY_PATH, chmod 600). The PUBLIC PEM is what
 * the desktop client embeds to verify seat tokens offline — it is safe to ship.
 *
 * Never commit the private key.
 */

import { generateKeyPairSync } from "node:crypto";

const kp = generateKeyPairSync("ed25519");
const priv = kp.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const pub = kp.publicKey.export({ type: "spki", format: "pem" }) as string;

console.log("# Seat-token Ed25519 keypair — generated", new Date().toISOString());
console.log("# Put the PRIVATE key in the server env (SEAT_PRIVATE_KEY_PEM or _PATH). Keep it secret.");
console.log("# Ship the PUBLIC key embedded in the desktop client. It is safe to publish.\n");
console.log("---- SEAT_PRIVATE_KEY_PEM (server only) ----");
console.log(priv.trim());
console.log("\n---- SEAT_PUBLIC_KEY_PEM (client embeds this) ----");
console.log(pub.trim());

// Single-line escaped form for env files that don't allow multi-line values.
console.log("\n# Single-line (escaped) forms for .env:");
console.log(`SEAT_PRIVATE_KEY_PEM="${priv.trim().replace(/\n/g, "\\n")}"`);
console.log(`SEAT_PUBLIC_KEY_PEM="${pub.trim().replace(/\n/g, "\\n")}"`);
