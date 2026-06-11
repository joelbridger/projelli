import { test, expect } from "bun:test";
import { putState, takeState, putCode, takeCode } from "../src/lib/ssoState.ts";

test("state is single-use and round-trips", () => {
  putState("s1", { orgId: "o1", issuer: "i", clientId: "c", codeVerifier: "v", nonce: "n", loopbackPort: 5000 }, 60);
  const got = takeState("s1");
  expect(got?.orgId).toBe("o1");
  expect(takeState("s1")).toBeNull(); // consumed
});

test("state expires", () => {
  putState("s2", { orgId: "o", issuer: "i", clientId: "c", codeVerifier: "v", nonce: "n", loopbackPort: 1 }, 0);
  expect(takeState("s2")).toBeNull();
});

test("one-time code is single-use", () => {
  putCode("code-hash-1", { userId: "u1" }, 60);
  expect(takeCode("code-hash-1")?.userId).toBe("u1");
  expect(takeCode("code-hash-1")).toBeNull();
});
