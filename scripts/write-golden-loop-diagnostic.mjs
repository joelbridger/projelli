import { writeDiagnosticArtifact } from './golden-loop-diagnostics.mjs';

const [phase] = process.argv.slice(2);
if (phase === '--validate') process.exit(0);
const result = await writeDiagnosticArtifact({ phase });
console.error(`GOLDEN LOOP DIAGNOSTIC: path=${result.path} sha256=${result.sha256} classification=${result.artifact.classification}`);
