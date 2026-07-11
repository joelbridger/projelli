/** Shared red-team examples. Values are deliberately inert test strings. */
export const SECRET_SCRUB_FIXTURES = {
  bearer: 'Authorization: Bearer bearer-test-value-123456',
  jwt: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.signature-test-value',
  apiKeys: 'sk-ant-api03-test-value-1234567890 AIzaSyD-test-value-1234567890 ghp_testvalue1234567890 xoxb-test-value-123456 rk_live_testvalue123456',
  oauth: 'code=oauth-code-value&access_token=access-value&refresh_token=refresh-value&client_secret=client-secret-value&code_verifier=verifier-value',
  passwordForms: 'password: secret-pass\nPASSWORD=other-pass\npostgres://user:db-pass@example.test/database\nCookie: session=abc123',
  privateKey: '-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----',
  urls: 'https://example.test/i/abc#intake-secret https://s3.example.test/file?X-Amz-Signature=aws-secret https://storage.example.test/file?X-Goog-Signature=google-secret https://blob.example.test/file?sig=azure-secret',
  encoded: 'access%5Ftoken%3Dencoded-secret',
  zeroWidth: 'api\u200b_key=zero-width-secret',
  folded: 'Authorization: Bearer folded-\n secret-value',
  markdown: '[client link](https://example.test/i/abc#private-link)',
  attachmentText: 'Attached statement includes api_key=attachment-secret-value.',
  attachmentFilename: 'access_token=filename-secret-value.pdf',
  safe: [
    'https://example.test/help?topic=tax',
    'The word token is ordinary prose here.',
    'const token = getDisplayToken();',
    'Client Ada has a meeting on Tuesday.',
  ],
} as const;
