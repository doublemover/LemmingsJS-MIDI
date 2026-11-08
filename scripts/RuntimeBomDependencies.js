export function normalizeBomDependencies(dependencies) {
  const graph = new Map();
  for (const { ref, dependsOn = [] } of dependencies) {
    if (typeof ref !== 'string' || !ref || !Array.isArray(dependsOn) || dependsOn.some(child => typeof child !== 'string' || !child)) {
      throw new Error('Invalid CycloneDX dependency graph.');
    }
    let children = graph.get(ref);
    if (!children) graph.set(ref, children = new Set());
    for (const child of dependsOn) children.add(child);
  }
  return [...graph].sort(([a], [b]) => a.localeCompare(b)).map(([ref, children]) => ({ ref, dependsOn: [...children].sort() }));
}
