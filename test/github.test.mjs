import test from "node:test";
import assert from "node:assert/strict";
import { validateRepoIdentity } from "../server/github.mjs";

test("GitHub repository identities accept normal owner/repository names", () => {
  assert.deepEqual(validateRepoIdentity("octo-org", "repo.name-1"), {
    owner: "octo-org",
    repo: "repo.name-1",
    fullName: "octo-org/repo.name-1"
  });
  assert.equal(validateRepoIdentity("octo-org", "repo.git").repo, "repo");
});

test("GitHub repository identities reject traversal and URL-shaped input", () => {
  for (const [owner, repo] of [
    ["../owner", "repo"],
    ["owner", ".."],
    ["owner", "../repo"],
    ["https://github.com/owner", "repo"],
    ["owner", "repo/name"],
    ["owner", ""]
  ]) {
    assert.throws(
      () => validateRepoIdentity(owner, repo),
      /Invalid GitHub repository identity/
    );
  }
});
