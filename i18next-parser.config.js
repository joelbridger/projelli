export default {
  locales: ['en', 'es', 'de'],
  output: 'src/locales/$LOCALE.json',
  input: ['src/**/*.{ts,tsx}'],
  defaultNamespace: 'translation',
  keepRemoved: false,
  failOnWarnings: false,
  failOnUpdate: false,
  lexers: {
    js: ['JavascriptLexer'],
    ts: ['JavascriptLexer'],
    jsx: ['JsxLexer'],
    tsx: ['JsxLexer'],
  },
};
