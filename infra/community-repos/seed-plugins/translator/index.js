const SETTINGS_PAGE_ID = "translator-settings";
const TARGET_LANGUAGE_KEY = "targetLanguage";
const DEFAULT_TARGET_LANGUAGE = "Spanish";
const SUPPORTED_LANGUAGES = [
  "Spanish",
  "French",
  "German",
  "Italian",
  "Portuguese",
  "Dutch",
  "Japanese",
  "Korean",
  "Mandarin Chinese",
  "Arabic",
  "Hindi",
  "Russian",
  "English"
];
async function getTargetLanguage(api) {
  const stored = await api.settings.get(TARGET_LANGUAGE_KEY);
  if (typeof stored === "string" && stored.trim().length > 0) return stored;
  return DEFAULT_TARGET_LANGUAGE;
}
const plugin = {
  async activate(api) {
    api.settings.addPage({
      id: SETTINGS_PAGE_ID,
      title: "Translator",
      schema: {
        [TARGET_LANGUAGE_KEY]: {
          type: "select",
          default: DEFAULT_TARGET_LANGUAGE,
          label: "Target language",
          choices: SUPPORTED_LANGUAGES
        }
      }
    });
    api.commands.register("translator.translate", async () => {
      const selection = await api.editor.getSelection();
      if (!selection || !selection.text.trim()) {
        api.notify.warn("Translator: select some text first.");
        return null;
      }
      const targetLanguage = await getTargetLanguage(api);
      api.notify.info(`Translating to ${targetLanguage}...`);
      let translated;
      try {
        translated = await api.ai.invoke({
          system: "You are a precise translator. Output only the translation. Preserve formatting, punctuation, and inline Markdown. Do not add commentary, quotation marks, or labels.",
          prompt: `Translate the following text into ${targetLanguage}:

${selection.text}`
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        api.notify.error(`Translator: AI request failed. ${message}`);
        return null;
      }
      const cleaned = translated.trim();
      if (!cleaned) {
        api.notify.warn("Translator: empty response from AI provider.");
        return null;
      }
      await api.editor.replaceSelection(cleaned);
      api.notify.info(`Translated ${selection.text.length} chars to ${targetLanguage}.`);
      return cleaned;
    });
    api.toolbar.addButton({
      id: "translator-button",
      icon: "languages",
      tooltip: "Translate selection",
      command: "translator.translate"
    });
  }
};
export {
  plugin as default
};
