import {
  askScopeBuilder,
  buildAskRetrievalPlan,
  listAskModes,
  noLocalAnswer,
  resolveAskScope,
} from '@/features/ask';
import { fixtureAccess } from './ownerFixture';

const scope = resolveAskScope(askScopeBuilder.wholeFirm('fixture-workspace'));
void listAskModes(scope, fixtureAccess);
void buildAskRetrievalPlan(scope, [], [], fixtureAccess);
void noLocalAnswer();
