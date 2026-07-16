import {
  listAskAnswerActions,
  type AskAnswerActionContext,
} from '@/features/ask';
import type { FixtureClientRef, FixtureMeetingRef } from './ownerFixture';

interface FixtureAuthority {
  readonly allowed: true;
}

interface FixtureAudit {
  readonly receiptId: string;
}

declare const context: AskAnswerActionContext<
  FixtureClientRef,
  FixtureMeetingRef,
  FixtureAuthority,
  FixtureAudit
>;
void listAskAnswerActions(context);
