export async function reconnectAfterSync(sync, reconnect) {
  try {
    return { error: null, value: await sync() };
  } catch (error) {
    return { error, value: undefined };
  } finally {
    reconnect();
  }
}
