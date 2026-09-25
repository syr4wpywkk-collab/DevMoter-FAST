// Execution remains disabled until a fixed adapter has a safe local privilege
// broker, reviewed source handling, and platform-specific verification.
export const executorRegistry = new Map();

export function getExecutor(toolId, platform) {
  const definition = executorRegistry.get(toolId);
  if (!definition || !definition.platforms.includes(platform)) return null;
  return definition;
}
