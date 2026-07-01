/**
 * findUniqueDefaultName — the first "base(.ext)" / "base N(.ext)" name that
 * `existsInDir` reports as not already present in the target folder.
 *
 * Create dialogs (new document/file/folder) seed their prompt with a real
 * default value (not just a placeholder) so pressing OK immediately creates
 * something. A fixed default would silently collide with — or overwrite — an
 * existing file on a second "New Word document" click, so this walks
 * "base", "base 2", "base 3", … until one is free.
 */
export async function findUniqueDefaultName(
  existsInDir: (name: string) => Promise<boolean>,
  base: string,
  ext: string = '',
): Promise<string> {
  const suffix = ext ? (ext.startsWith('.') ? ext : `.${ext}`) : '';
  let n = 1;
  let candidateBase = base;
  while (await existsInDir(`${candidateBase}${suffix}`)) {
    n += 1;
    candidateBase = `${base} ${n.toString()}`;
  }
  return candidateBase;
}
