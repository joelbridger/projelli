/**
 * Ordered chapter list for the onboarding journey.
 * Imported by JourneyHost (via App.tsx) to drive the full first-run experience.
 */

import type { Chapter } from '../engine/types';
import { ch1Welcome } from './Ch1Welcome';
import { ch2AboutYou } from './Ch2AboutYou';
import { ch3FilesStayHome } from './Ch3FilesStayHome';
import { ch4MeetTheAI } from './Ch4MeetTheAI';
import { ch5ChooseYourBrain } from './Ch5ChooseYourBrain';
import { ch6Email } from './Ch6Email';
import { ch7SoloOrFirm } from './Ch7SoloOrFirm';
import { ch8SeeItWork } from './Ch8SeeItWork';

export const journeyChapters: Chapter[] = [
  ch1Welcome,
  ch2AboutYou,
  ch3FilesStayHome,
  ch4MeetTheAI,
  ch5ChooseYourBrain,
  ch6Email,
  ch7SoloOrFirm,
  ch8SeeItWork,
];
