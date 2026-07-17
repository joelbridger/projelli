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

// The action list re-checks the live client (from the off-barrel owner binding)
// at use time; a consumer cannot supply or replace that client.
declare const context: AskAnswerActionContext<
  FixtureClientRef,
  FixtureMeetingRef,
  FixtureAuthority,
  FixtureAudit
>;
void listAskAnswerActions(context);
