import { execFile } from "node:child_process";
import { access, mkdir, realpath, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 512 * 1024;
const COMMAND_TIMEOUT = 30_000;

function commandError(error, fallback) {
  const stderr = String(error?.stderr || "").trim();
  return new Error(stderr.slice(0, 400) || error?.message || fallback);
}

async function run(binary, args, options = {}) {
  try {
    return await execFileAsync(binary, args, {
      cwd: options.cwd,
      timeout: options.timeout ?? COMMAND_TIMEOUT,
      maxBuffer: MAX_OUTPUT,
      windowsHide: true,
      env: process.env
    });
  } catch (error) {
    throw commandError(error, `${binary} failed`);
  }
}

function validOwner(value) {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value);
}

function validRepositoryName(value) {
  return (
    /^[A-Za-z0-9._-]{1,100}$/.test(value) &&
    value !== "." &&
    value !== ".."
  );
}

export function validateRepoIdentity(owner, repo) {
  const normalizedOwner = String(owner || "").trim();
  const normalizedRepo = String(repo || "").trim().replace(/\.git$/, "");
  if (!validOwner(normalizedOwner) || !validRepositoryName(normalizedRepo)) {
    throw new Error("Invalid GitHub repository identity");
  }
  return { owner: normalizedOwner, repo: normalizedRepo, fullName: `${normalizedOwner}/${normalizedRepo}` };
}

function managedRoot(homeDir) {
  return resolve(homeDir, ".local", "share", "opencode-pocket", "repos");
}

function managedPath(homeDir, identity) {
  const root = managedRoot(homeDir);
  const destination = resolve(root, identity.owner, identity.repo);
  const rel = relative(root, destination);
  if (!rel || rel.startsWith(".." + sep) || resolve(root, rel) !== destination) {
    throw new Error("Repository destination escapes managed root");
  }
  return destination;
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { throw new Error("GitHub CLI returned invalid JSON"); }
}

async function ghApi(path, args = []) {
  const result = await run("gh", ["api", path, ...args]);
  return parseJson(result.stdout);
}

export async function githubStatus(homeDir) {
  try {
    const result = await run("gh", ["auth", "status", "--hostname", "github.com"]);
    const login = result.stderr.match(/Logged in to github\.com account ([^\s(]+)/i)?.[1] ||
      result.stdout.match(/Logged in to github\.com account ([^\s(]+)/i)?.[1] || null;
    return { available: true, authenticated: true, login, authSource: "gh", managedRoot: managedRoot(homeDir) };
  } catch (error) {
    const missing = /not found|ENOENT|spawn gh/i.test(String(error?.message || ""));
    return { available: !missing, authenticated: false, login: null, authSource: "gh", managedRoot: managedRoot(homeDir), reason: missing ? "GitHub CLI (gh) is not installed" : error.message };
  }
}

async function localState(homeDir, identity) {
  const path = managedPath(homeDir, identity);
  try {
    await access(join(path, ".git"));
    const origin = (await run("git", ["config", "--get", "remote.origin.url"], { cwd: path })).stdout.trim();
    const branch = (await run("git", ["branch", "--show-current"], { cwd: path })).stdout.trim();
    const dirty = Boolean((await run("git", ["status", "--porcelain"], { cwd: path })).stdout.trim());
    return { cloned: true, path, currentBranch: branch, dirty, origin: origin.slice(0, 300) };
  } catch { return { cloned: false, path, currentBranch: null, dirty: false, origin: null }; }
}

function repoSummary(item, local) {
  return {
    id: item.id,
    owner: item.owner?.login || item.owner?.name || "",
    name: item.name,
    fullName: item.nameWithOwner || `${item.owner?.login}/${item.name}`,
    private: Boolean(item.private ?? item.isPrivate),
    visibility: String(item.visibility || ((item.private ?? item.isPrivate) ? "private" : "public")).toUpperCase(),
    defaultBranch: item.default_branch || item.defaultBranchRef?.name || "main",
    description: item.description || "",
    updatedAt: item.updated_at || item.updatedAt || null,
    ...local
  };
}

export async function listGithubRepos(homeDir, query = "", page = 1, visibility = "all") {
  const safePage = Math.min(20, Math.max(1, Number(page) || 1));
  const search = String(query || "").trim().toLowerCase();
  const safeVisibility = ["all", "private", "public"].includes(String(visibility))
    ? String(visibility)
    : "all";
  const affiliation = "owner%2Ccollaborator%2Corganization_member";

  let items = [];
  let hasMore = false;

  if (search) {
    // Search across the authenticated user's accessible repository pages instead
    // of filtering only the first 100 results. Bound the scan to 20 pages.
    for (let currentPage = 1; currentPage <= 20; currentPage += 1) {
      const endpoint =
        `user/repos?visibility=${safeVisibility}&affiliation=${affiliation}&per_page=100&sort=updated&direction=desc&page=${currentPage}`;
      const batch = await ghApi(endpoint);
      if (!Array.isArray(batch) || batch.length === 0) break;

      for (const item of batch) {
        const haystack = `${item.full_name || ""} ${item.name || ""} ${item.description || ""}`.toLowerCase();
        if (haystack.includes(search)) items.push(item);
        if (items.length >= 100) break;
      }

      if (items.length >= 100 || batch.length < 100) break;
    }
  } else {
    const endpoint =
      `user/repos?visibility=${safeVisibility}&affiliation=${affiliation}&per_page=100&sort=updated&direction=desc&page=${safePage}`;
    items = await ghApi(endpoint);

    hasMore = Array.isArray(items) && items.length === 100 && safePage < 20;
  }

  const repositories = await Promise.all((Array.isArray(items) ? items : []).slice(0, 100).map(async item => {
    const identity = validateRepoIdentity(item.owner?.login, item.name);
    return repoSummary(
      { ...item, nameWithOwner: item.full_name, defaultBranchRef: { name: item.default_branch } },
      await localState(homeDir, identity)
    );
  }));

  return {
    repositories,
    page: safePage,
    query: search,
    visibility: safeVisibility,
    hasMore
  };
}

export async function listGithubBranches(homeDir, owner, repo) {
  const identity = validateRepoIdentity(owner, repo);
  const repositoryPath = `repos/${encodeURIComponent(identity.owner)}/${encodeURIComponent(identity.repo)}`;
  const [response, repository] = await Promise.all([
    ghApi(`${repositoryPath}/branches?per_page=100`),
    ghApi(repositoryPath)
  ]);
  const local = await localState(homeDir, identity);
  const defaultBranch = String(repository?.default_branch || "");
  return {
    branches: response.map(item => ({
      name: item.name,
      protected: Boolean(item.protected),
      current: item.name === local.currentBranch,
      default: item.name === defaultBranch
    })),
    defaultBranch,
    ...local
  };
}

async function assertOrigin(path, identity) {
  const origin = (await run("git", ["config", "--get", "remote.origin.url"], { cwd: path })).stdout.trim();
  const normalized = origin.replace(/\.git$/, "").replace(/^git@github\.com:/, "https://github.com/").replace(/\/$/, "");
  const expected = `https://github.com/${identity.fullName}`;
  if (normalized.toLowerCase() !== expected.toLowerCase()) throw new Error("Existing repository origin does not match the requested GitHub repository");
}

async function registerProject(projectsApi, identity, path) {
  const projects = await projectsApi.read();
  const existing = projects.find(project => resolve(project.path) === resolve(path));
  if (existing) return { project: existing, existed: true };
  const project = { id: randomUUID(), name: identity.repo, path, addedAt: Date.now(), github: identity.fullName };
  projects.unshift(project);
  await projectsApi.write(projects);
  return { project, existed: false };
}

export async function openGithubRepo(homeDir, projectsApi, owner, repo, branch = "") {
  const identity = validateRepoIdentity(owner, repo);
  const path = managedPath(homeDir, identity);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const current = await localState(homeDir, identity);
  if (!current.cloned) {
    await run("gh", ["repo", "clone", identity.fullName, path]);
  } else {
    await assertOrigin(path, identity);
    if (current.dirty) throw new Error("Repository has local changes; fetch or branch switching was not performed");
    await run("git", ["fetch", "--prune", "origin"], { cwd: path });
  }
  const requested = branch || (await run("git", ["branch", "--show-current"], { cwd: path })).stdout.trim() || "main";
  const branches = (await run("git", ["branch", "--all", "--format=%(refname:short)"], { cwd: path })).stdout.split(/\r?\n/).filter(Boolean);
  if (!branches.includes(requested) && !branches.includes(`origin/${requested}`)) throw new Error("Requested branch was not found after fetch");
  const active = (await run("git", ["branch", "--show-current"], { cwd: path })).stdout.trim();
  if (active !== requested) {
    if (branches.includes(requested)) await run("git", ["switch", requested], { cwd: path });
    else await run("git", ["switch", "--track", `origin/${requested}`], { cwd: path });
  }
  const registered = await registerProject(projectsApi, identity, await realpath(path));
  return { ...registered, currentBranch: requested, dirty: false, path: await realpath(path), fullName: identity.fullName };
}

export async function fetchGithubRepo(homeDir, owner, repo) {
  const identity = validateRepoIdentity(owner, repo);
  const state = await localState(homeDir, identity);
  if (!state.cloned) throw new Error("Repository is not cloned in the managed directory");
  await assertOrigin(state.path, identity);
  await run("git", ["fetch", "--prune", "origin"], { cwd: state.path });
  return { ...(await localState(homeDir, identity)), fullName: identity.fullName };
}
