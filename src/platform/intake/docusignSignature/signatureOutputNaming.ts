export interface SignatureOutputNameInput {
  requestId: string;
  signatureItemId: string;
  envelopeId: string;
}

function requireOpaquePart(value: string, name: string): void {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${name} is required.`);
  }
}

/** Deterministic 64-bit digest keeps local generated filenames bare and path-safe. */
function filenameDigest(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

/** Returns bare generated filenames only. Filing code owns the destination folder. */
export function signatureOutputFileNames(input: SignatureOutputNameInput): {
  signedPdfFileName: string;
  certificateFileName: string;
} {
  requireOpaquePart(input.requestId, 'requestId');
  requireOpaquePart(input.signatureItemId, 'signatureItemId');
  requireOpaquePart(input.envelopeId, 'envelopeId');
  const digest = filenameDigest(`${input.requestId}\u001f${input.signatureItemId}\u001f${input.envelopeId}`);
  return {
    signedPdfFileName: `signed-form-${digest}.pdf`,
    certificateFileName: `signature-certificate-${digest}.pdf`,
  };
}
