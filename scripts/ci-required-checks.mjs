export const REQUIRED_CI_COMMANDS = ["npm ci", "npm run typecheck", "npm run lint", "npm run build", "npm test", "npm test --prefix deepseek-harness-mobile"];

// Returns why the CI workflow would let a change merge without passing
// install, typecheck, lint, build and the full test suite. Empty = enforced.
export function findCiEnforcementGaps(workflow) {
  const text = String(workflow).replace(/\r\n/g, "\n");
  const gaps = [];
  const on = text.match(/^on:\n((?:[ \t]+.*\n?|\n)*)/m)?.[1] ?? "";
  for (const event of ["push", "pull_request"]) {
    if (!new RegExp(`^\\s+${event}:`, "m").test(on)) gaps.push(`CI does not run on ${event}`);
  }
  if (/^\s+(?:paths|paths-ignore|branches-ignore):/m.test(on)) gaps.push("CI triggers are filtered, so some changes skip the checks");
  if (/^\s*continue-on-error:/m.test(text)) gaps.push("CI uses continue-on-error, so a failing step can still pass");

  const steps = text.split(/\n(?=\s+- )/).filter(step => /^\s+- /.test(step));
  for (const command of REQUIRED_CI_COMMANDS) {
    const step = steps.find(block => new RegExp(`(?:^|\\n)\\s+(?:- )?run: ${command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?:\\n|$)`).test(block));
    if (!step) gaps.push(`CI does not run \`${command}\``);
    else if (/(?:^|\n)\s+(?:- )?if:/.test(step)) gaps.push(`CI runs \`${command}\` only conditionally`);
  }
  return gaps;
}
