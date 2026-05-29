'use strict';

// JSX elements where text content is a value, not user-facing copy.
const SKIP_TAGS = new Set(['code', 'pre', 'script', 'style']);

// Parent node types whose JSX text children should never be flagged.
const SKIP_PARENT_TYPES = new Set(['JSXAttribute']);

function countAlphabeticWords(text) {
  const matches = text.match(/[a-zA-Z]+/g);
  return matches ? matches.length : 0;
}

function getEnclosingTagName(node) {
  let parent = node.parent;
  while (parent && parent.type !== 'JSXElement') {
    parent = parent.parent;
  }
  if (!parent) return null;
  const opening = parent.openingElement;
  if (!opening || !opening.name) return null;
  // <Trans>...</Trans> wraps localized children; never flag its text.
  if (opening.name.type === 'JSXIdentifier' && opening.name.name === 'Trans') {
    return 'trans';
  }
  if (opening.name.type === 'JSXIdentifier' && typeof opening.name.name === 'string') {
    return opening.name.name.toLowerCase();
  }
  return null;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow hardcoded JSX text strings. Wrap user-facing copy in t() or <Trans>.',
      recommended: false,
    },
    messages: {
      hardcoded:
        'Hardcoded user-facing string ("{{snippet}}"). Wrap in t() or <Trans>, or add `// eslint-disable-next-line keepance-i18n/no-hardcoded-string` for an intentional exception.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXText(node) {
        if (node.parent && SKIP_PARENT_TYPES.has(node.parent.type)) return;
        const tag = getEnclosingTagName(node);
        if (tag === 'trans') return;
        if (tag && SKIP_TAGS.has(tag)) return;

        const text = node.value;
        if (countAlphabeticWords(text) < 3) return;

        const snippet = text.trim().replace(/\s+/g, ' ').slice(0, 60);
        context.report({
          node,
          messageId: 'hardcoded',
          data: { snippet },
        });
      },
    };
  },
};
