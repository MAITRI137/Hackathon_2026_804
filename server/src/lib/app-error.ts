export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    public readonly userMessage: string,
    public readonly recovery?: string,
  ) {
    super(userMessage);
    this.name = 'AppError';
  }
}
