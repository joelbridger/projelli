import { RequestsBoardContainer, type RequestsBoardContainerProps } from './RequestsBoardContainer';

/** Compatibility entry point for callers/tests that still name the primary filter. */
export type OnboardingBoardContainerProps = Omit<RequestsBoardContainerProps, 'filter' | 'testId' | 'title'>;

export function OnboardingBoardContainer(props: OnboardingBoardContainerProps) {
  return <RequestsBoardContainer {...props} filter="onboarding" testId="onboarding-board" title="Onboarding" />;
}

export default OnboardingBoardContainer;
