/**
 * scripts/lib/gate-scope.mjs — THE one file-scope derivation for every gate checker.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 * Three independent gate checkers, written by three different lanes, each derived
 * their file scope from `git ls-files`. The git INDEX is not the set of files that
 * exist, compile, or ship — it is the set of files that have been ADDED to git.
 * A file that is untracked (written but never `git add`ed) or gitignored (matched
 * by a `.gitignore` rule — the root `.gitignore`'s bare `dist` already shadows
 * every nested `dist/` in this repo) is invisible to `git ls-files` and therefore
 * invisible to any checker scoped by it. Those checkers printed a green tick and a
 * scanned-file COUNT over exactly the region they could not see.
 *
 * Two instances of one blind spot is a class, so the primitive is removed rather
 * than the call sites patched: no gate checker derives scope for itself any more.
 * They all call this, and "index-only" is not expressible here.
 *
 * ── THE DERIVATION ───────────────────────────────────────────────────────────
 *   domain = the declared walk roots (a POSITIVE declaration, not an exclusion)
 *   scope  = (a direct filesystem walk of the domain)
 *            UNION
 *            (every file the TypeScript compiler resolves for the declared
 *             projects, restricted to the same domain)
 *
 * TWO INDEPENDENT ORACLES OVER ONE DOMAIN, and they fail differently:
 *   • The WALK half sees files the compiler never resolves — a `.txt`, a `.js`, a
 *     brand-new file nothing imports yet, and anything untracked or gitignored.
 *   • The COMPILER half is the independent cross-oracle on the walk. If the walk
 *     ever UNDER-enumerates — a pruning bug, an unreadable directory, a future
 *     "just skip this one" edit — the compiler still resolves the file and the
 *     union stays complete. `deriveGateScope` returns both halves so a checker can
 *     print what each contributed instead of assuming both are load-bearing.
 * Neither half can hide a file from the other, and NEITHER half consults git.
 *
 * ── NO EXCLUSION CHANNEL ─────────────────────────────────────────────────────
 * There is no `exclude`, `ignore`, `skip`, or `allow` parameter, and no
 * environment variable. A caller declares a POSITIVE domain (`walkRoots`,
 * `projects`) and gets everything in it. The only directories the walk does not
 * descend are `.git` (git's own object store — not repository source) and
 * `node_modules` (dependency trees this repository does not author). Both are
 * module-level constants, identical for every caller, and both were already
 * outside `git ls-files`, so this scope is a strict SUPERSET of the scope it
 * replaces — never a narrowing.
 *
 * ── EVERY UNRESOLVABLE SCOPE THROWS ──────────────────────────────────────────
 * A missing tsc, a missing tsconfig, a compiler that errors out, a declared walk
 * root that is not on disk, a dangling symlink, a symlink whose target leaves the
 * repository, an empty result, or a file whose extension is outside a declared
 * all-TypeScript domain: every one of these THROWS. An in-repository symlink is
 * neither followed nor dropped — its own path enters scope and its target is not
 * walked. A scope that cannot be derived is never read as an empty scope,
 * because "found nothing" and "could not look" produce the same clean output and
 * a checker must not confuse them.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * Directories the walk does not descend, for every caller, always.
 * NOT an exclusion channel: callers cannot add to this and cannot read it out.
 * `.git` is git's object store; `node_modules` is a dependency tree this
 * repository does not author. Neither was ever inside `git ls-files` either.
 */
const NEVER_REPOSITORY_SOURCE = new Set(['.git', 'node_modules']);

const posix = (value) => value.split(sep).join('/');

function fail(label, message) {
  throw new Error(`${label}: refusing to derive a file scope — ${message}`);
}

/**
 * Derive a gate checker's file scope from build ground truth.
 *
 * @param {object} options
 * @param {string} options.label            Checker name, used in every error message.
 * @param {string} options.root             Absolute repository root.
 * @param {string[]} options.walkRoots      Repo-relative directories to walk. `'.'` means the whole repository.
 * @param {{dir: string, tsconfig?: string}[]} options.projects
 *        TypeScript projects whose resolved file list is unioned in. `dir` is
 *        repo-relative and is the cwd tsc runs in; `tsconfig` (repo-relative)
 *        selects a non-default project file.
 * @param {Set<string>|null} [options.requireExtensions]
 *        When the domain is declared to be entirely TypeScript, any file in scope
 *        whose extension is outside this set THROWS. It never skips the file.
 * @returns {{files: string[], fromCompiler: string[], fromWalk: string[]}}
 *          `files` is the sorted union in repo-relative POSIX form. The two halves
 *          are returned separately so a caller (or a proof) can measure what each
 *          half actually contributes instead of assuming both are load-bearing.
 */
export function deriveGateScope({ label, root, walkRoots, projects, requireExtensions = null }) {
  if (typeof label !== 'string' || label.length === 0) throw new Error('deriveGateScope requires a label');
  if (typeof root !== 'string' || !isAbsolute(root)) fail(label, 'root must be an absolute repository path');
  if (!Array.isArray(walkRoots) || walkRoots.length === 0) fail(label, 'at least one walk root must be declared');
  if (!Array.isArray(projects) || projects.length === 0) fail(label, 'at least one TypeScript project must be declared');

  const inDomain = domainPredicate(walkRoots);
  const compiler = compilerFiles(label, root, projects);
  const walked = walkFiles(label, root, walkRoots);

  // A symlink is recorded but never followed, so a directory link pointing OUT
  // of the repository is normally harmless (`src-tauri/target` -> the shared
  // cargo cache is the standing example on this host). It stops being harmless
  // the moment the build actually compiles through it: those files would be
  // real source that neither half of this derivation can see. That exact case —
  // and only that case — fails closed.
  for (const link of walked.externalDirectoryLinks) {
    const smuggled = compiler.outsideRepository.filter((file) => file === link.target || file.startsWith(`${link.target}/`));
    if (smuggled.length > 0) {
      fail(
        label,
        `the build compiles ${smuggled.length} file(s) through a symlink that leaves the repository: ` +
          `${link.path} -> ${link.target} (e.g. ${smuggled[0]}). Those files are real source that no filesystem ` +
          `walk of this repository can see. Bring them inside the repository or stop compiling through the link.`,
      );
    }
  }

  const fromCompiler = compiler.insideRepository.filter(inDomain);
  const fromWalk = walked.files;
  const files = [...new Set([...fromCompiler, ...fromWalk])].sort();

  if (files.length === 0) {
    fail(label, `the derived scope is empty (walk roots: ${walkRoots.join(', ')}). An empty scan is not a pass.`);
  }
  if (requireExtensions) {
    const unknown = files.filter((file) => !requireExtensions.has(extname(file)));
    if (unknown.length > 0) {
      fail(
        label,
        `the declared domain is TypeScript-only but these files are in it: ${unknown.slice(0, 20).join(', ')}` +
          `${unknown.length > 20 ? ` (+${unknown.length - 20} more)` : ''}. Review and scan them, or move them out of the domain.`,
      );
    }
  }
  return { files, fromCompiler, fromWalk };
}

/**
 * The declared domain, as a predicate over repo-relative paths. `'.'` means the
 * whole repository. This is the ONLY narrowing in the module and it is the
 * caller's positive declaration of what it is responsible for — not a list of
 * things to skip inside that responsibility.
 */
function domainPredicate(walkRoots) {
  const roots = walkRoots.map((walkRoot) => posix(walkRoot).replace(/^\.\/?$/, '').replace(/\/+$/, ''));
  if (roots.some((walkRoot) => walkRoot === '')) return () => true;
  return (file) => roots.some((walkRoot) => file === walkRoot || file.startsWith(`${walkRoot}/`));
}

/** The TypeScript compiler's own resolved file list, restricted to this repository. */
function compilerFiles(label, root, projects) {
  const out = [];
  const outside = [];
  for (const project of projects) {
    if (!project || typeof project.dir !== 'string') fail(label, 'every declared project needs a repo-relative `dir`');
    const cwd = resolve(root, project.dir);
    if (!existsSync(cwd)) fail(label, `declared TypeScript project directory is not on disk: ${project.dir}`);

    const tsc = [resolve(cwd, 'node_modules/.bin/tsc'), resolve(root, 'node_modules/.bin/tsc')].find((candidate) =>
      existsSync(candidate),
    );
    if (!tsc) {
      fail(label, `no TypeScript compiler is installed for project '${project.dir}'. The compiler is the scope oracle; without it the scope is UNKNOWN, not empty.`);
    }

    const args = ['--noEmit', '--listFilesOnly', '--pretty', 'false'];
    if (project.tsconfig) {
      const tsconfig = resolve(root, project.tsconfig);
      if (!existsSync(tsconfig)) fail(label, `declared tsconfig is not on disk: ${project.tsconfig}`);
      args.push('-p', tsconfig);
    } else if (!existsSync(resolve(cwd, 'tsconfig.json'))) {
      fail(label, `project '${project.dir}' has no tsconfig.json`);
    }

    let output;
    try {
      output = execFileSync(tsc, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    } catch (error) {
      const detail = [error?.stdout, error?.stderr, error?.message].filter(Boolean).join('\n').trim();
      fail(label, `the TypeScript compiler could not list the files of project '${project.dir}', so the scan cannot know what it has not seen.\n${detail}`);
    }

    const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      fail(label, `the TypeScript compiler listed zero files for project '${project.dir}'. A compiler that resolves nothing is a broken oracle, not an empty project.`);
    }
    for (const line of lines) {
      const absolute = resolve(cwd, line);
      const rel = posix(relative(root, absolute));
      if (rel.startsWith('../') || isAbsolute(rel)) {
        outside.push(posix(absolute)); // recorded, not dropped: the symlink check below needs it
        continue;
      }
      if (rel.split('/').some((segment) => NEVER_REPOSITORY_SOURCE.has(segment))) continue;
      out.push(rel);
    }
  }
  return { insideRepository: out, outsideRepository: outside };
}

/**
 * Everything actually on disk under the declared roots.
 * Returns the file list plus every directory symlink whose target leaves the
 * repository, so the caller can fail closed if the build compiles through one.
 */
function walkFiles(label, root, walkRoots) {
  const out = [];
  const externalDirectoryLinks = [];
  for (const walkRoot of walkRoots) {
    const base = resolve(root, walkRoot);
    if (!existsSync(base)) fail(label, `declared walk root is not on disk: ${walkRoot}`);
    const walk = (dir) => {
      const entries = readdirSync(dir, { withFileTypes: true });
      // A directory that carries its own `.git` is a DIFFERENT repository — a
      // nested checkout, a submodule, or one of this repo's own `.worktrees/*`
      // lane trees. Its files are that repository's source, not this one's, and
      // scanning them would let another lane's tree decide this gate's verdict.
      // Structural, module-level, identical for every caller; the repository
      // root itself is never pruned by it.
      if (dir !== base && entries.some((entry) => entry.name === '.git')) return;
      for (const entry of entries) {
        // Name-based pruning happens BEFORE the symlink refusal: a repository may
        // legitimately symlink its own node_modules, and that is not repository source.
        if (NEVER_REPOSITORY_SOURCE.has(entry.name)) continue;
        const absolute = resolve(dir, entry.name);
        if (entry.isSymbolicLink()) {
          // A symlink is ACCOUNTED FOR but never DESCENDED. Its own path enters
          // scope (a path-shaped check must still see the alias); its target is
          // not walked, so nothing is scanned twice and no link can graft a
          // foreign tree into the scope. A DANGLING link throws — an entry that
          // cannot be resolved is not an absent entry. A link out of the
          // repository is recorded and handed back to `deriveGateScope`, which
          // fails closed if the compiler turns out to build through it.
          let target;
          try {
            target = realpathSync(absolute);
          } catch (error) {
            fail(label, `dangling symlink inside a declared walk root: ${posix(relative(root, absolute))} (${error?.message ?? 'unresolvable'}). An unresolvable entry is not an absent one.`);
          }
          const targetRel = posix(relative(root, target));
          if (targetRel.startsWith('../') || isAbsolute(targetRel)) {
            // Outside the repository. A link to a FILE presents foreign content
            // as repository source and is refused outright. A link to a
            // DIRECTORY is a mount point for generated artefacts (this host's
            // `src-tauri/target` -> the shared cargo cache is the standing
            // example); it is recorded, never descended, and `deriveGateScope`
            // still fails closed if the compiler turns out to build through it.
            if (!statSync(target).isDirectory()) {
              fail(label, `symlink to a file outside the repository: ${posix(relative(root, absolute))} -> ${target}. A link cannot present unreviewed content as repository source.`);
            }
            externalDirectoryLinks.push({ path: posix(relative(root, absolute)), target: posix(target) });
          }
          out.push(posix(relative(root, absolute)));
          continue;
        }
        if (entry.isDirectory()) walk(absolute);
        else if (entry.isFile()) out.push(posix(relative(root, absolute)));
      }
    };
    walk(base);
  }
  return { files: out, externalDirectoryLinks };
}
