import {
  askScopeBuilder,
  buildAskRetrievalPlan,
  listAskModes,
  noLocalAnswer,
  resolveAskScope,
} from '@/features/ask';
import { fixtureOwners } from './ownerFixture';

const scope = resolveAskScope(askScopeBuilder.wholeFirm('fixture-workspace'));
void listAskModes(scope);
void buildAskRetrievalPlan(scope, [], [], fixtureOwners);
void noLocalAnswer();
