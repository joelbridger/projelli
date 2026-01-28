// Analysis Module
// Document summarization and cross-model comparison

// Doc Summary Service
export {
  DocSummaryService,
  createDocSummaryService,
  type GenerateSummaryOptions,
} from './DocSummaryService';

// Contradiction Detector
export {
  ContradictionDetector,
  createContradictionDetector,
  type Contradiction,
  type ContradictionAnalysis,
  type DetectionOptions,
} from './ContradictionDetector';

// Synthesis Generator
export {
  SynthesisGenerator,
  createSynthesisGenerator,
  type Synthesis,
  type SynthesisSection,
  type ResolvedContradiction,
  type SynthesisOptions,
} from './SynthesisGenerator';
