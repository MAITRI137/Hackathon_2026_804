export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    public readonly userMessage: string,
    public readonly recovery?: string,
    /**
     * Structured recovery data. A version conflict carries the server value the
     * client must reconcile against, so the browser can offer a real
     * "reload or compare" choice instead of a dead end.
     */
    public readonly details?: Record<string, unknown>,
  ) {
    super(userMessage);
    this.name = 'AppError';
  }
}

/** A concurrent write won. Always carries what the server currently holds. */
export function versionConflict(
  entity: string,
  currentVersion: number | undefined,
  recovery = 'Reload the record, compare the server values, then try again.',
) {
  return new AppError(
    'VERSION_CONFLICT',
    409,
    `This ${entity} changed elsewhere while you were editing it.`,
    recovery,
    currentVersion === undefined ? undefined : { currentVersion },
  );
}
