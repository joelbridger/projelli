import {
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

declare const context: AskAnswerActionContext<
  FixtureClientRef,
  FixtureMeetingRef,
  FixtureAuthority,
  FixtureAudit
>;
const access: typeof context.clientAccess = fixtureAccess;
void access;
void listAskAnswerActions(context);
