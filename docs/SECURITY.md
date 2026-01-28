# Business OS Security Model

This document describes the security model, threat mitigations, and best practices for Business OS.

## Overview

Business OS is designed as a **local-first** application that prioritizes user privacy and data security. All data is stored locally on the user's device, and the user maintains full control over their information.

## Threat Model

### What We Protect Against

1. **Path Traversal Attacks**
   - Attempts to read/write files outside the workspace
   - URL-encoded traversal sequences
   - Mixed path separator attacks

2. **Symlink Escape Attacks**
   - Symlinks pointing outside workspace boundaries
   - Chained symlink resolution

3. **Prompt Injection Attacks**
   - User content manipulating AI behavior
   - Role confusion attacks
   - Instruction override attempts

4. **API Key Exposure**
   - Keys leaking in logs or error messages
   - Keys transmitted insecurely
   - Keys stored in accessible locations

5. **Cross-Site Scripting (XSS)**
   - Content Security Policy (CSP) violations
   - Unsafe script execution

### What Is Out of Scope

1. **Physical Device Access** - If an attacker has physical access to your device, all local data is potentially compromised.

2. **Operating System Vulnerabilities** - We rely on the OS for security primitives.

3. **Network MITM** - We use HTTPS for all API calls, but cannot protect against compromised certificate authorities.

4. **Malicious AI Model Responses** - We cannot prevent AI models from generating harmful content.

## Security Controls

### Path Validation (PathValidator)

All file operations go through `PathValidator` which enforces:

```typescript
// Blocks these patterns:
- ../ and ..\ traversal
- %2e%2e URL-encoded traversal
- Absolute paths outside workspace
- Null bytes in paths
- Control characters in filenames
```

**Location:** `src/modules/workspace/PathValidator.ts`

### Symlink Protection

Symlinks are validated to ensure they don't escape the workspace:

```typescript
// Before following a symlink:
validator.validateSymlinkTarget(symlinkPath, resolvedTarget);
// Throws SecurityError if target is outside workspace
```

### Content Security Policy (CSP)

The Tauri application enforces a strict CSP:

```
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'self' https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com;
```

This prevents:
- Loading external scripts
- Connecting to unauthorized APIs
- Loading resources from untrusted sources

### API Key Security

API keys are protected through:

1. **Secure Storage**: Keys are stored in the OS keychain (Tauri keychain plugin)
2. **Memory Only**: Keys are only decrypted when needed
3. **No Logging**: Keys are masked before any logging
4. **HTTPS Only**: Keys are only transmitted over HTTPS
5. **Header Only**: Keys are never included in URLs

### File System Scoping (Tauri)

Tauri's fs plugin is configured with restricted scopes:

```json
{
  "plugins": {
    "fs": {
      "scope": {
        "allow": ["$HOME/**", "$DOCUMENT/**", "$DESKTOP/**", "$DOWNLOAD/**"],
        "deny": [
          "$HOME/.*",          // Hidden files
          "$HOME/Library/**",  // macOS system
          "$HOME/AppData/**",  // Windows system
          "C:\\Windows\\**",   // Windows system
          "/etc/**",           // Unix system
          "/usr/**",
          "/bin/**",
          "/sbin/**"
        ]
      }
    }
  }
}
```

### Prompt Injection Mitigation

When including user content in AI prompts:

1. **Sanitization**: Remove/escape dangerous patterns
2. **Wrapping**: Clearly delimit user content
3. **Role Separation**: User content is never interpreted as instructions

```typescript
import { sanitizeForPrompt, wrapUserContent } from '@/utils/prompt-security';

const safeContent = wrapUserContent(userInput, 'BUSINESS_IDEA');
const prompt = `Analyze this idea: ${safeContent}`;
```

## Security Testing

Security tests are located in `tests/security/`:

- `path-traversal.test.ts` - Path validation tests
- `symlink-escape.test.ts` - Symlink protection tests
- `prompt-injection.test.ts` - Prompt sanitization tests
- `api-key-security.test.ts` - API key handling tests

Run security tests:

```bash
npm run test:security
```

## Audit Logging

All AI actions are logged to an append-only audit log:

```typescript
interface AuditEntry {
  timestamp: string;
  action: string;
  details: object;
  userId?: string;
}
```

This enables:
- Tracking all AI-generated content
- Identifying unauthorized operations
- Forensic analysis if needed

**Location:** `src/modules/audit/AuditService.ts`

## Incident Response

If you discover a security vulnerability:

1. **Do Not** disclose publicly
2. **Do** report to the maintainers privately
3. **Include**: Description, reproduction steps, impact assessment

## Security Checklist for Contributors

Before submitting code:

- [ ] No hardcoded API keys or secrets
- [ ] All file paths validated through PathValidator
- [ ] User content sanitized before AI prompts
- [ ] Error messages don't leak sensitive data
- [ ] No console.log of sensitive information
- [ ] New dependencies audited for vulnerabilities

## Known Limitations

1. **Browser Environment**: The browser version (without Tauri) has limited security compared to the desktop version, as it cannot access the OS keychain.

2. **AI Model Trust**: We trust that AI model APIs (Anthropic, OpenAI) handle our requests securely.

3. **Single User**: Business OS is designed for single-user operation. Multi-user scenarios require additional access controls.

4. **No Encryption at Rest**: Files in the workspace are not encrypted. Use OS-level encryption (BitLocker, FileVault) for protection.

## Security Updates

This security model was last reviewed: January 2025

Major security changes are documented in CHANGELOG.md with the `[Security]` prefix.
