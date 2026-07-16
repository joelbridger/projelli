export type CalendarFoundationErrorCode =
  | 'invalid_utc_timestamp'
  | 'calendar_not_found'
  | 'calendar_read_only'
  | 'canonical_reload_missing';

/** Stable public rejection type for calendar foundation trust-boundary failures. */
export class CalendarFoundationError extends Error {
  readonly code: CalendarFoundationErrorCode;

  constructor(code: CalendarFoundationErrorCode, message: string) {
    super(message);
    this.name = 'CalendarFoundationError';
    this.code = code;
  }
}
