import type { TFunction } from 'i18next';
import { PathValidator } from '@/platform/fs/PathValidator';
import { SecurityError } from '@/platform/fs/types';

const nameValidator = new PathValidator('/');

export function reservedNameError(name: string, t: TFunction): string | undefined {
  try {
    nameValidator.validateName(name);
    return undefined;
  } catch (error) {
    if (error instanceof SecurityError) {
      // NOTE: this key MUST stay a string literal so the i18next-parser gate can
      // statically extract it (a `t(SOME_CONST)` fails `npm run i18n:check`).
      return t('workspace.file-tree.reserved-name-error');
    }
    throw error;
  }
}
