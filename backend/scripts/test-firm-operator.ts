/**
 * Deliberately tiny, local-only operator for the one approved proof firm.
 * It never reads environment/files for secrets and never prints response bodies.
 */
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const URL = "http://127.0.0.1:5194";
const tty = "/dev/tty";

if (process.argv.length !== 2 || !existsSync(tty)) {
  process.stderr.write("TEST firm operator unavailable.\n");
  process.exit(1);
}

const input = createReadStream(tty);
const output = createWriteStream(tty);
const prompt = createInterface({ input, output, terminal: true });
async function hidden(label: string): Promise<string> {
  output.write(label);
  const off = Bun.spawnSync(["stty", "-echo"], { stdin: input, stdout: "ignore", stderr: "ignore" });
  if (off.exitCode !== 0) throw new Error("tty unavailable");
  try { return (await prompt.question("" )).trim(); }
  finally { Bun.spawnSync(["stty", "echo"], { stdin: input, stdout: "ignore", stderr: "ignore" }); output.write("\n"); }
}

try {
  const action = (await prompt.question("Choose: create Sarah TEST firm | retire Sarah TEST firm\n> ")).trim();
  if (action !== "create Sarah TEST firm" && action !== "retire Sarah TEST firm") throw new Error("invalid choice");
  const secret = await hidden("Provisioning secret: ");
  let body: string | undefined;
  if (action === "create Sarah TEST firm") {
    const password = await hidden("Lantern account password: ");
    const license = await hidden("One-time license key: ");
    body = JSON.stringify({ password, license_key: license });
  }
  const response = await fetch(action.startsWith("create") ? `${URL}/admin/test-firm` : `${URL}/admin/test-firm/retire`, {
    method: "POST", headers: { "x-test-firm-provisioning-secret": secret, ...(body ? { "content-type": "application/json" } : {}) }, body,
  });
  // Deliberately consume neither error nor success response bodies: IDs and
  // secrets never become a console/logging side channel.
  output.write(response.ok ? "TEST firm operation completed.\n" : "TEST firm operation failed.\n");
} catch {
  output.write("TEST firm operation failed.\n");
} finally {
  prompt.close(); input.close(); output.end();
}
