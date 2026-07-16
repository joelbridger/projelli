import {
  bindAskSharedClient,
  listAskAnswerActions,
  type AskAnswerActionContext,
} from '@/features/ask';
import type { FixtureClientRef, FixtureMeetingRef } from './ownerFixture';
import { fixtureAccess } from './ownerFixture';

interface FixtureAuthority {
  readonly allowed: true;
}

interface FixtureAudit {
  readonly receiptId: string;
}

// The owner binds the live client; the action list re-checks it at use time.
bindAskSharedClient(fixtureAccess);

declare const context: AskAnswerActionContext<
  FixtureClientRef,
  FixtureMeetingRef,
  FixtureAuthority,
  FixtureAudit
>;
void listAskAnswerActions(context);
