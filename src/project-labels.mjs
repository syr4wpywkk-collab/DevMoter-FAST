const MAX_LABEL = 60;

function segments(path) {
  return String(path || "").split(/[\\/]+/).filter(Boolean);
}

function fallbackName(project) {
  const name = typeof project?.name === "string" ? project.name.trim() : "";
  if (name) return name;
  return segments(project?.path).at(-1) || String(project?.id || "Project");
}

function truncate(text) {
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
}

/**
 * Builds select-option labels for projects: the project name only. When two or
 * more projects share a name, each gets the shortest trailing parent-directory
 * suffix that tells it apart from the others ("DevMoter-FAST · work").
 * Ids, values and paths are never changed; only the visible label is built here.
 */
export function projectOptionLabels(projects) {
  const list = Array.isArray(projects) ? projects : [];
  const names = list.map(fallbackName);
  const groups = new Map();
  names.forEach((name, index) => {
    const group = groups.get(name) || [];
    group.push(index);
    groups.set(name, group);
  });
  const labels = names.map(truncate);
  for (const [name, indexes] of groups) {
    if (indexes.length < 2) continue;
    // Parent directories nearest to the project come first.
    const parents = indexes.map(index => segments(list[index]?.path).slice(0, -1).reverse());
    const depth = Math.max(0, ...parents.map(parts => parts.length));
    let chosen = null;
    for (let take = 1; take <= depth && !chosen; take += 1) {
      const suffixes = parents.map(parts => parts.slice(0, take).reverse().join("/"));
      if (new Set(suffixes).size === suffixes.length) chosen = suffixes;
    }
    indexes.forEach((index, position) => {
      const suffix = chosen?.[position] || String(position + 1);
      labels[index] = `${truncate(name)} · ${suffix}`;
    });
  }
  return labels;
}
