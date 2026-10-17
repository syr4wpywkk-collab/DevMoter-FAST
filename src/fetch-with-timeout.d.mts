export function fetchWithTimeout<TInput, TResult>(
  fetcher: (input: TInput, init: RequestInit) => Promise<TResult>,
  input: TInput,
  init: RequestInit,
  timeoutMs: number,
  timeoutError: () => Error
): Promise<TResult>;
