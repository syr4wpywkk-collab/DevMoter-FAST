export async function recoverAfterEventOpen(refresh, report) {
  let error = null;
  try {
    await refresh();
  } catch (failure) {
    error = failure;
  }
  report(error);
}
