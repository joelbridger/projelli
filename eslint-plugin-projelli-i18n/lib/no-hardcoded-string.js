const SKIP_PARENTS = new Set(['JSXAttribute']);
const SKIP_TAGS = new Set(['code', 'pre', 'script', 'style']);

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow hardcoded JSX text strings; use t() or <Trans>',
    },
    messages: {
      hardcoded: 'Hardcoded user-facing string. Wrap in t() or <Trans>.',
    },
    schema: [],
  },
  create(context) {
    function countWords(text) {
      const trimmed = text.trim();
      if (!trimmed) return 0;
      return trimmed.split(/\s+/).filter((w) => /[a-zA-Z]/.test(w)).length;
    }

    function getEnclosingTagName(node) {
      let parent = node.parent;
      while (parent && parent.type !== 'JSXElement') {
        parent = parent.parent;
      }
      if (!parent) return null;
      const opening = parent.openingElement;
      return opening?.name?.name?.toLowerCase?.() ?? null;
    }

    return {
      JSXText(node) {
        if (SKIP_PARENTS.has(node.parent?.type)) return;
        const tag = getEnclosingTagName(node);
        if (tag && SKIP_TAGS.has(tag)) return;
        if (countWords(node.value) < 3) return;
        context.report({ node, messageId: 'hardcoded' });
      },
    };
  },
};
