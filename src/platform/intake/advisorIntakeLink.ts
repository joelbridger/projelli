import { b64ToBytes } from './pageSeal';
import { buildIntakeUrl } from './intakeLifecycle';
import { buildLinkFragment } from './intakeLink';
import { loadIntakeLinkSecret } from './intakeKeychain';

export function configuredIntakeHost(): string {
  const env = (import.meta as { env?: { VITE_INTAKE_HOST?: string } }).env?.VITE_INTAKE_HOST;
  return (env && env.trim()) || 'https://forms.lanternplatform.app';
}

export async function reconstructAdvisorIntakeLink(options: {
  intakeId: string;
  publicKeyRawB64: string;
  intakeHost?: string;
}): Promise<string> {
  const linkSecretB64 = await loadIntakeLinkSecret(options.intakeId);
  if (!linkSecretB64) throw new Error('This link is missing its saved secret.');
  return buildIntakeUrl(
    options.intakeHost ?? configuredIntakeHost(),
    options.intakeId,
    buildLinkFragment(linkSecretB64, b64ToBytes(options.publicKeyRawB64)),
  );
}
