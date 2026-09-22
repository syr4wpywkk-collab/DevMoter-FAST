import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProjectIndex } from "../server/project-index.mjs";

test("project index stays local, excludes sensitive/vendor files, supports rebuild/search/map/delete", async () => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-index-"));
  const projectRoot = join(root, "project");
  const stateDir = join(root, "state");
  try {
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await mkdir(join(projectRoot, "node_modules", "pkg"), { recursive: true });
    await writeFile(
      join(projectRoot, "src", "app.ts"),
      "export function helloWorld() {\n  return 'hello index';\n}\n",
      "utf8"
    );
    await writeFile(join(projectRoot, "README.md"), "# Local project\nSearchable docs\n", "utf8");
    await writeFile(join(projectRoot, ".env"), "SECRET=do-not-index\n", "utf8");
    await writeFile(join(projectRoot, "node_modules", "pkg", "index.js"), "vendor secret phrase\n", "utf8");

    const project = { id: "p1", name: "Demo", path: projectRoot };
    const index = createProjectIndex({
      stateDir,
      resolveProject: async id => {
        assert.equal(id, project.id);
        return project;
      }
    });

    const first = await index.rebuild(project.id);
    assert.equal(first.files, 2);
    assert.equal(first.reusedFiles, 0);
    assert.ok(first.skipped.some(item => item.path === ".env"));
    assert.ok(first.skipped.some(item => item.path === "node_modules"));

    const search = await index.search(project.id, "helloWorld");
    assert.equal(search.results[0].path, "src/app.ts");
    assert.equal(search.results[0].line, 1);
    assert.match(search.results[0].snippet, /helloWorld/);

    const noSecret = await index.search(project.id, "do-not-index");
    assert.equal(noSecret.results.length, 0);

    const map = await index.repoMap(project.id);
    assert.ok(map.symbols.some(symbol => symbol.name === "helloWorld"));
    assert.ok(map.directories.some(directory => directory.path === "src"));

    const second = await index.rebuild(project.id);
    assert.equal(second.reusedFiles, 2);

    const status = await index.status(project.id);
    assert.equal(status.ready, true);
    assert.equal(status.files, 2);

    await index.remove(project.id);
    assert.deepEqual(await index.status(project.id), { ready: false, projectId: project.id });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project index honors additional user excludes", async () => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-index-exclude-"));
  const projectRoot = join(root, "project");
  try {
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await mkdir(join(projectRoot, "private"), { recursive: true });
    await writeFile(join(projectRoot, "src", "ok.ts"), "export const visible = true;\n");
    await writeFile(join(projectRoot, "private", "notes.md"), "private marker\n");

    const project = { id: "p2", name: "Demo 2", path: projectRoot };
    const index = createProjectIndex({
      stateDir: join(root, "state"),
      resolveProject: async () => project
    });

    const result = await index.rebuild(project.id, { exclude: ["private"] });
    assert.equal(result.files, 1);
    assert.ok(result.skipped.some(item => item.path === "private"));
    assert.equal((await index.search(project.id, "private marker")).results.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
