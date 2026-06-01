// Template manifest types for the Templates Marketplace (Stream C1).
// Mirrors the JSON shape documented in docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.2.

export type TemplateFileType =
  | 'markdown'
  | 'interview-questions'
  | 'workflow-definition';

export interface TemplateFileEntry {
  path: string;
  type: TemplateFileType;
}

export interface TemplateManifestAuthor {
  name: string;
  githubUser?: string;
  url?: string;
}

export interface TemplateManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  author: TemplateManifestAuthor;
  description: string;
  category: string;
  tags: string[];
  screenshots?: string[];
  files: TemplateFileEntry[];
  minKeepanceVersion: string;
  maxKeepanceVersion?: string;
}
