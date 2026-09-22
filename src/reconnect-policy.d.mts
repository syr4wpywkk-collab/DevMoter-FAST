export declare const DEFAULT_RECONNECT_BASE_MS: number;
export declare const DEFAULT_RECONNECT_MAX_MS: number;
export declare function reconnectDelay(
  attempt: number,
  options?: { baseMs?: number; maxMs?: number }
): number;
export declare function shouldScheduleReconnect(online: boolean, hasTimer: boolean): boolean;
export declare function shouldOpenEventSource(online: boolean, hasSource: boolean): boolean;
