#!/usr/bin/env node
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const options = { configDir: __dirname, printJson: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value) throw new Error(`Missing value for ${arg}.`);
      i += 1;
      return value;
    };
    if (arg === '--config-dir') options.configDir = path.resolve(next());
    else if (arg === '--print-json') options.printJson = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function assertHttpClientsDoNotSendFragments() {
  const captured = [];
  const server = createServer((req, res) => {
    captured.push(req.url ?? '');
    res.statusCode = 204;
    res.end();
  });

  const baseUrl = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not allocate fragment-check port.'));
        return;
      }
      resolve(`http://127.0.0.1:${String(address.port)}`);
    });
  });

  try {
    await fetch(
      `${baseUrl}/i/demo-intake#v1.fragment-secret.advisor-public-key`
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const joined = captured.join('\n');
  if (joined.includes('#') || joined.includes('fragment-secret')) {
    throw new Error(
      `URL fragment reached the HTTP server log surface: ${joined}`
    );
  }

  return captured;
}

function configFiles(configDir) {
  if (!existsSync(configDir)) return [];
  return readdirSync(configDir)
    .filter((name) => /\.(?:md|snippet|yml|yaml|json|conf|caddy)$/iu.test(name))
    .map((name) => path.join(configDir, name));
}

function assertConfigDoesNotReconstructFragmentUrls(configDir) {
  const files = configFiles(configDir);
  const forbidden = [
    /location\.href/iu,
    /document\.URL/iu,
    /full[_-]?url/iu,
    /fragment-secret/iu,
  ];
  const requiredReferrerPolicyFiles = files.filter((file) =>
    file.includes('Caddyfile.')
  );
  const failures = [];

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      if (pattern.test(text)) {
        failures.push(
          `${path.basename(file)} contains forbidden URL reconstruction token ${pattern}.`
        );
      }
    }
  }

  for (const file of requiredReferrerPolicyFiles) {
    const text = readFileSync(file, 'utf8');
    if (!/Referrer-Policy\s+"no-referrer"/u.test(text)) {
      failures.push(
        `${path.basename(file)} must set Referrer-Policy "no-referrer".`
      );
    }
  }

  if (failures.length) {
    throw new Error(
      `Fragment logging config check failed:\n${failures.join('\n')}`
    );
  }

  return files.map((file) => path.basename(file));
}

export async function runFragmentNeverLoggedCheck(rawOptions = {}) {
  const configDir = rawOptions.configDir ?? __dirname;
  const capturedUrls = await assertHttpClientsDoNotSendFragments();
  const checkedConfigFiles =
    assertConfigDoesNotReconstructFragmentUrls(configDir);
  return {
    ok: true,
    capturedUrls,
    checkedConfigFiles,
    note: 'HTTP requests do not carry URL fragments; config scan found no full-URL reconstruction path.',
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await runFragmentNeverLoggedCheck(options);
  if (options.printJson)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    process.stdout.write('Fragment never-logged check passed\n');
    process.stdout.write(
      `Captured HTTP URLs: ${result.capturedUrls.join(', ')}\n`
    );
    process.stdout.write(
      `Config files checked: ${result.checkedConfigFiles.join(', ')}\n`
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  });
}
