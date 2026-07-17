import {
  askScopeBuilder,
  registerAskAnswerAction,
  registerAskMode,
  registerAskSource,
  type AskAnswerActionDescriptor,
  type AskModeDescriptor,
  type AskSourceAdapter,
} from '@/features/ask';
import type { FixtureClientRef, FixtureMeetingRef } from './ownerFixture';

const source = {
  id: 'example-local-source',
  order: 100,
  sourceKinds: ['document'],
  listCandidates: () => [],
} satisfies AskSourceAdapter<FixtureClientRef, FixtureMeetingRef>;

const mode = {
  id: 'example-normal-mode',
  order: 100,
  responseFormat: 'normal',
  buildScope: askScopeBuilder,
} satisfies AskModeDescriptor<FixtureClientRef, FixtureMeetingRef>;

interface OwnerAuthority {
  readonly allowed: boolean;
}

interface OwnerAudit {
  readonly receiptId: string;
}

const action = {
  id: 'example-review-action',
  order: 100,
  isAvailable: (context) => context.authority.allowed,
  execute: () => undefined,
} satisfies AskAnswerActionDescriptor<
  FixtureClientRef,
  FixtureMeetingRef,
  OwnerAuthority,
  OwnerAudit
>;

registerAskSource(source);
registerAskMode(mode);
registerAskAnswerAction(action);
