import { webkit } from "playwright";

// Turns Playwright's "browser not installed" error into the one setup command to run (#372).
export async function launchWebKit() {
  try {
    return await webkit.launch({ headless: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Executable doesn't exist|install-deps|missing dependencies|Host system is missing/i.test(message)) throw error;
    throw new Error(`WebKit for Playwright is not ready on this machine. Run \`npm run test:workspace-browser:setup\` once, then retry.\n\n${message}`);
  }
}
