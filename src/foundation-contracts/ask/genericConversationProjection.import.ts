import {
  askScopeBuilder,
  buildAskRetrievalPlan,
  listAskModes,
  noLocalAnswer,
  resolveAskScope,
} from '@/features/ask';

const scope = resolveAskScope(askScopeBuilder.wholeFirm('fixture-workspace'));
void listAskModes(scope);
void buildAskRetrievalPlan(scope, [], []);
void noLocalAnswer();
