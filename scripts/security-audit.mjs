import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const failures = [];
const passes = [];

function check(condition, message) {
  if (condition) passes.push(message);
  else failures.push(message);
}

async function text(path) {
  return readFile(path, "utf8");
}

const pkg = JSON.parse(await text("package.json"));
const lock = JSON.parse(await text("package-lock.json"));

check(lock.lockfileVersion === 3, "package-lock uses lockfileVersion 3");
check(pkg.scripts?.["security:audit"] === "node scripts/security-audit.mjs", "security:audit script is registered");

for (const group of ["dependencies", "devDependencies"]) {
  for (const [name, spec] of Object.entries(pkg[group] || {})) {
    const value = String(spec);
    check(
      !/^(?:git(?:\+[^:]+)?:|https?:|file:|link:|github:|gitlab:|bitbucket:)/i.test(value),
      group + " " + name + " does not use a remote/file dependency spec"
    );
    check(
      lock.packages?.[""]?.[group]?.[name] === spec,
      group + " " + name + " matches the lockfile root"
    );
  }
}

const server = await text("server.mjs");
const auth = await text("server/auth.mjs");
const helpers = await text("server/security-helpers.mjs");
const launcher = await text("scripts/start-pocket.sh");
const vite = await text("vite.config.ts");
const headers = await text("server/security-headers.mjs");

check(server.includes('process.env.POCKET_HOST || "127.0.0.1"'), "DevMoter defaults to loopback");
check(vite.includes('host: "127.0.0.1"'), "Vite dev server defaults to loopback");
check(auth.includes("password.length < 16"), "DevMoter enforces a minimum authentication password length");
check(auth.includes("requireSameOriginMutation"), "same-origin mutation guard is present");
check(helpers.includes("CODEX_RPC_ALLOWLIST"), "Codex RPC allowlist is present");
check(launcher.includes('chmod 700 "$STATE_DIR"'), "launcher protects the config directory");
check(launcher.includes('chmod 600 "$SECRET_FILE"'), "launcher protects the OpenCode password file");
check(launcher.includes('chmod 600 "$AUTH_SECRET_FILE"'), "launcher protects the DevMoter password file");
check(server.includes("staticSecurityHeaders("), "static responses use centralized security headers");
check(headers.includes('"script-src \'self\'"'), "CSP restricts scripts to self");
check(headers.includes('"frame-ancestors \'none\'"'), "CSP blocks framing");
check(headers.includes('"x-content-type-options": "nosniff"'), "nosniff header is enabled");

// Cross-surface guardrails: these checks cannot replace runtime tests or CodeQL,
// but they prevent accidental removal of key security boundaries across modules.
const socketEndpoint = await text("server/terminal-websocket.mjs");
const setupDetector = await text("server/setup/detector.mjs");
const setupExecutor = await text("server/setup/executor.mjs");
const setupPlan = await text("server/setup/plan.mjs");
const integration = await text("server/integrations.mjs");
const fileHelpers = await text("server/security-helpers.mjs");
const securityDocs = await text("SECURITY.md");
const codeqlWorkflow = await text(".github/workflows/codeql.yml");
const ciWorkflow = await text(".github/workflows/ci.yml");
const auditWorkflow = await text(".github/workflows/security-audit.yml");

check(socketEndpoint.includes("expectedRequestOrigin") && socketEndpoint.includes("authorizeSocket"),
  "terminal WebSocket origin and ticket gates remain present");
check(setupDetector.includes("shell: false") && setupDetector.includes("filteredEnvironment"),
  "setup detector executes only argument-array commands with filtered environment");
check(setupPlan.includes("parseExecuteRequest") && setupPlan.includes("planSnapshots"),
  "setup execution remains bound to server-issued plans");
check(setupExecutor.includes("supportedAutomaticInstaller") && setupExecutor.includes("userOwnedNpmPrefix"),
  "setup automatic executors retain an allowlist and a user-owned npm prefix");
check(integration.includes("validateAntigravityRemoteUrl") && integration.includes("spawn("),
  "host integration URL validation and controlled spawning remain present");
check(fileHelpers.includes("maxEncodedLength") && fileHelpers.indexOf("maxEncodedLength") < fileHelpers.indexOf("Buffer.from(encoded"),
  "upload payload is size-bounded before base64 decoding");
check(fileHelpers.includes("value.startsWith(\"/\")") && fileHelpers.includes("String.fromCharCode(0)"),
  "Markdown filename guard rejects absolute paths and NULs");
check(!/^tailscale serve reset\\s*$/m.test(securityDocs),
  "security documentation does not recommend destructive Tailscale Serve reset");
check(codeqlWorkflow.includes("javascript-typescript") && codeqlWorkflow.includes("language: [javascript-typescript, actions]"),
  "CodeQL scans JavaScript/TypeScript and GitHub Actions");
for (const [name, workflow] of [["CI", ciWorkflow], ["Security Audit", auditWorkflow]]) {
  check(/permissions:\\n\\s+contents: read/.test(workflow), name + " has a read-only repository token");
  check(workflow.includes("persist-credentials: false"), name + " does not persist checkout credentials");
  check(!/uses: (?:actions|github)\\/[^@\\s]+@v\\d+\\b/m.test(workflow),
    name + " GitHub Actions are pinned to immutable commit SHAs");
}

for (const required of ["SECURITY.md", "THREAT_MODEL.md"]) {
  try {
    await readFile(required);
    passes.push(required + " exists");
  } catch {
    failures.push(required + " is missing");
  }
}

let tracked = [];
try {
  tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
} catch {
  failures.push("git ls-files could not enumerate tracked files");
}

const sensitiveName = /(^|\/)(?:\.env|\.npmrc|\.pypirc|id_(?:rsa|dsa|ecdsa|ed25519)|credentials(?:\.[^/]*)?|.*\.(?:pem|key|p12|pfx))$/i;
const allowedEnvTemplate = /(^|\/)\.env\.(?:example|sample|template)$/i;
const suspiciousTrackedPaths = tracked.filter(path =>
  !allowedEnvTemplate.test(path) && sensitiveName.test(path)
);
if (suspiciousTrackedPaths.length === 0) {
  passes.push("no likely secret files are tracked");
} else {
  for (const path of suspiciousTrackedPaths) failures.push("likely secret file is tracked: " + path);
}

const secretPatterns = [
  { name: "private key", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "GitHub token", regex: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/ },
  { name: "OpenAI-style key", regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { name: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Slack token", regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ }
];

const scanExtensions = /\.(?:js|mjs|cjs|ts|tsx|json|md|html|css|yml|yaml|sh|txt)$/i;
for (const path of tracked) {
  if (!scanExtensions.test(path)) continue;
  if (basename(path) === "package-lock.json") continue;
  let body;
  try {
    body = await readFile(path, "utf8");
  } catch {
    continue;
  }
  if (body.length > 2000000) continue;
  for (const pattern of secretPatterns) {
    const match = body.match(pattern.regex);
    if (!match) continue;
    if (/fake|example|placeholder|dummy/i.test(match[0])) continue;
    failures.push("possible " + pattern.name + " in " + path);
  }
}

console.log("Security audit: " + passes.length + " checks passed");
for (const item of passes) console.log("  ✓ " + item);

if (failures.length) {
  console.error("\nSecurity audit failed with " + failures.length + " issue(s):");
  for (const item of failures) console.error("  ✗ " + item);
  process.exitCode = 1;
} else {
  console.log("\nSecurity audit passed.");
}
