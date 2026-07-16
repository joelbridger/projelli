import {
  askModeRegistry,
  askScopeBuilder,
  buildAskRetrievalPlan,
  noLocalAnswer,
  resolveAskScope,
} from '@/features/ask';

const scope = resolveAskScope(askScopeBuilder.wholeFirm('fixture-workspace'));
void askModeRegistry;
void buildAskRetrievalPlan(scope, [], []);
void noLocalAnswer();
