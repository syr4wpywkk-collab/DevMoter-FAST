export function fetchWithTimeout<TInput, TResult>(
  fetcher: (input: TInput, init: RequestInit) => Promise<TResult>,
  input: TInput,
  init: RequestInit,
  timeoutMs: number,
  timeoutError: () => Error
): Promise<TResult>;

export const READ_REQUEST_TIMEOUT_MS: number;
export function fetchReadWithTimeout<TInput, TResult>(
  fetcher: (input: TInput, init: RequestInit) => Promise<TResult>,
  input: TInput,
  init: RequestInit,
  timeoutError: () => Error,
  timeoutMs?: number
): Promise<TResult>;
