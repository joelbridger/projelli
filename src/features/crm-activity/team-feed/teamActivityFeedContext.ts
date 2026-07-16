import { createContext } from 'react';
import type { TeamActivityFeed } from './contracts';

export const TeamActivityFeedContext = createContext<TeamActivityFeed | null>(null);
