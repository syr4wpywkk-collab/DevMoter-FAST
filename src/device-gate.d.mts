export class DeviceAuthError extends Error {
  status: number;
  constructor(message: string, status: number);
}
export function isDeviceAuthError(error: unknown, status?: number): boolean;
export function responseError(status: number, message?: string): Error;
export function openDeviceRegistration(win?: Window): void;
export function createDeviceGate(
  doc: Document,
  options?: { onRegister?: () => void; className?: string; compact?: boolean }
): HTMLDivElement;
