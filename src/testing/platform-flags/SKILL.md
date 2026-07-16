# Platform flags test mock

`@/testing/platform-flags` is the only supported way to mock
`@/platform/flags`. It keeps every real public export and changes only the
exports a test deliberately overrides.

Use one hoisted state object and one `vi.mock` factory at the top of the test:

```ts
import type { PlatformFlagsMockState } from '@/testing/platform-flags';

const { mockPlatformFlags, resetPlatformFlagsOverrides, setPlatformFlagsOverrides } =
  await vi.hoisted(async () => import('@/testing/platform-flags'));

const flags = vi.hoisted(() => ({
  overrides: { useFlag: undefined } as PlatformFlagsMockState['overrides'],
}));

vi.mock('@/platform/flags', async (importOriginal) =>
  mockPlatformFlags(importOriginal, flags)
);

beforeEach(() => {
  resetPlatformFlagsOverrides(flags);
  setPlatformFlagsOverrides(flags, { useFlag: () => true });
});

afterEach(() => {
  resetPlatformFlagsOverrides(flags);
});
```

Configure the override for each test (or in that test's setup), then reset it
in cleanup so one test cannot affect the next. The `vi.mock` factory stays in
the test file because Vitest hoists it; the helper supplies the async
`importOriginal` + spread body.

Do not write a direct non-partial `vi.mock('@/platform/flags', ...)` factory.
Do not keep a hand-written list of current exports. Both create a closed-world
mock: a later public export can disappear inside a transitive import and crash
an otherwise unrelated test. The real module plus its spread is required.
