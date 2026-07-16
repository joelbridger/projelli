import {
  askSourceRegistry,
  askScopeBuilder,
  askSourceBelongsToScope,
  resolveAskScope,
  type AskSourceDescriptor,
} from '@/features/ask';

const scope = resolveAskScope(
  askScopeBuilder.chosenSources('fixture-workspace', 'matter-1', ['source-1'])
);
declare const source: AskSourceDescriptor;
void askSourceRegistry;
void askSourceBelongsToScope(scope, source);
