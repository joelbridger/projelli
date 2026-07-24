import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("TEST firm operator containment", () => {
  test("has one fixed loopback destination, refuses arguments, hides every secret, and discards response bodies", async () => {
    const source = await readFile(resolve(import.meta.dir, "../scripts/test-firm-operator.ts"), "utf8");
    expect(source).toContain('const URL = "http://127.0.0.1:5194"');
    expect(source).toContain("process.argv.length !== 2");
    expect(source).toContain('const tty = "/dev/tty"');
    expect(source).toContain('["stty", "-echo"]');
    expect(source).toContain('["stty", "echo"]');
    expect(source).toContain('action !== "create Sarah TEST firm" && action !== "retire Sarah TEST firm"');
    expect(source).toContain("/admin/test-firm/retire");
    expect(source).toContain("// Deliberately consume neither error nor success response bodies");
    expect(source).not.toContain("process.env");
    expect(source).not.toMatch(/\.text\(|\.json\(|console\.log/u);
  });
});
