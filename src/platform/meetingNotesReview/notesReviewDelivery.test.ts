import { describe, expect, it } from 'vitest';
import { isMissingFileError } from './notesReviewDelivery';

function errorWithCause(message: string, causeMessage?: string): Error {
  const error = new Error(message);
  if (causeMessage !== undefined) error.cause = new Error(causeMessage);
  return error;
}

describe('isMissingFileError', () => {
  const missingFileCases: Array<[string, Error]> = [
    ['unix ENOENT message', errorWithCause('ENOENT: no such file or directory, open \'/x/notes-review.json\'')],
    ['unix cause message', errorWithCause('Failed to read file: /x/notes-review.json', 'ENOENT: no such file or directory')],
    ['generic "not found"', errorWithCause('Path not found: /x/notes-review.json')],
    ['generic "does not exist"', errorWithCause('Workspace path does not exist: /x')],
    [
      'exact Windows ERROR_FILE_NOT_FOUND text (BUG-03)',
      errorWithCause(
        'Failed to read file: /x/notes-review.json',
        'The system cannot find the file specified. (os error 2)'
      ),
    ],
    [
      'Windows ERROR_PATH_NOT_FOUND text',
      errorWithCause(
        'Failed to read file: /x/Tasks.md',
        'The system cannot find the path specified. (os error 3)'
      ),
    ],
    ['Windows symbolic error code in the message', errorWithCause('ERROR_FILE_NOT_FOUND: /x/notes-review.json')],
  ];

  it.each(missingFileCases)('treats %s as a missing file', (_label, error) => {
    expect(isMissingFileError(error)).toBe(true);
  });

  const nonMissingFileCases: Array<[string, unknown]> = [
    ['a permission error', errorWithCause('Failed to read file: /x/notes-review.json', 'EACCES: permission denied')],
    ['an unrelated error', errorWithCause('The saved note-review record is invalid. Nothing was delivered.')],
    ['a non-Error value', 'just a string'],
  ];

  it.each(nonMissingFileCases)('does not treat %s as a missing file', (_label, error) => {
    expect(isMissingFileError(error)).toBe(false);
  });
});
