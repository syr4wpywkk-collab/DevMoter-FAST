export function createLatestRequestGuard(): {
  begin(): number;
  isCurrent(requestGeneration: number): boolean;
};
