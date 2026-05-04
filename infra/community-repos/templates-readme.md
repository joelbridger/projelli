# projelli/community-templates

The community catalog of workflow templates for [Projelli](https://projelli.com).

Anything in this repo's `entries/` folder shows up in the in-app marketplace. Users browse, install, and run these templates from inside Projelli without ever leaving the app.

## What's in here

- `entries/<id>/` — one folder per template, each with a manifest, the template body, the workflow definition, the interview questions, and screenshots.
- `catalog.json` — the marketplace index. Auto-generated from `entries/` on every push to `main`. Never hand-edit.
- `scripts/build-catalog.mjs` — the script that regenerates `catalog.json` and per-entry tarballs. Runs in CI; you can also run it locally to validate your submission before opening a PR.
- `.github/workflows/build-catalog.yml` — the GitHub Action that runs the script on every merge.

## How to submit a template

### 1. Fork this repo

```
gh repo fork projelli/community-templates
```

Or click Fork on github.com.

### 2. Add your entry

Create a folder under `entries/` whose name matches the `id` in your manifest:

```
entries/my-template/
├── manifest.json
├── template.md
├── workflow.json
├── questions.json
└── screenshots/
    └── main.png
```

The folder name MUST match `manifest.id` exactly. The build script enforces this.

### 3. Author the manifest

Your `manifest.json` follows the [TemplateManifest schema](https://github.com/projelli/projelli/blob/master/src/types/templateManifest.ts). Required fields:

```json
{
  "id": "my-template",
  "name": "My Template",
  "version": "1.0.0",
  "apiVersion": "1.0.0",
  "author": { "name": "Your Name", "githubUser": "your-handle" },
  "description": "One-sentence pitch for what this template does.",
  "category": "marketing",
  "tags": ["copywriting", "launch"],
  "screenshots": ["screenshots/main.png"],
  "files": [
    { "path": "template.md", "type": "markdown" },
    { "path": "workflow.json", "type": "workflow-definition" },
    { "path": "questions.json", "type": "interview-questions" }
  ],
  "minProjelliVersion": "2.0.0"
}
```

`screenshots` paths are relative to your entry folder. They get rewritten to absolute `raw.githubusercontent.com/...` URLs when the catalog builds.

### 4. Validate locally

```
npm install --no-save zod@^4.3.6
PROJELLI_CATALOG_KIND=templates node scripts/build-catalog.mjs
```

If your manifest validates, the script writes `catalog.json` plus `entries/my-template/tarball.tar.gz` and `entries/my-template/checksum.txt`. If it fails, you'll see a list of validation errors. Fix and re-run.

You can leave the generated tarball + checksum out of your PR; the Action regenerates them after merge.

### 5. Open a PR

```
git checkout -b add-my-template
git add entries/my-template/
git commit -m "Add my-template v1.0.0"
git push origin add-my-template
gh pr create --base main
```

PR title format: `Add <template-name> v<version>`.

In the description, include:

- One paragraph explaining what the template produces.
- The user this is for (founder researching pricing, writer drafting a press release, etc.).
- A note on what makes this different from existing templates if it's similar to one already in the catalog.

## Review criteria

A maintainer reviews every submission. We check for:

- **Schema validity.** The Action runs `build-catalog.mjs` on every PR. If it fails, the PR can't merge.
- **Originality.** We don't accept near-duplicates of templates already in the catalog. If yours is a variant, the description should make the differentiator obvious.
- **Quality.** The template body, workflow steps, and interview questions should produce something useful when run end-to-end. We try the template before merging.
- **Honest description.** The pitch matches what the template actually does.
- **Reasonable scope.** Templates that produce one focused artifact land faster than templates that try to do everything.

Most reviews finish within a few days. Push another commit to the same branch if we ask for changes.

## License

By submitting a template, you agree to publish it under MIT or a compatible permissive license (Apache-2.0, BSD-3-Clause, ISC). Add a `LICENSE` file inside your entry folder if you want to be explicit. Closed-source templates aren't accepted.

## Reporting a problem

If you find a template that produces broken output, has misleading screenshots, or hasn't been updated in a long time, open an issue with the entry id and details.

## Updating an existing template

Bump `version` in your manifest, update the files, and open a PR with the changes. Versions don't need to be sequential; the catalog always serves the latest one.

## Removing a template

Open a PR that deletes the entry folder. Existing installs in user copies of Projelli keep working; the template just disappears from the marketplace.
