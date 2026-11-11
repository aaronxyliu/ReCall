/** Undirected recovery graph. Insertion order determines candidate traversal. */
export function adjacency(graph) {
  const result = new Map(graph.functions.map(fn => [fn.id, new Set()]));
  for (const edge of graph.edges) {
    result.get(edge.from).add(edge.to);
    result.get(edge.to).add(edge.from);
  }
  return result;
}

/** Breadth-first neighbors, excluding the starting function. */
export function neighbors(id, graph, radius) {
  const seen = new Set([id]);
  let frontier = [id];
  for (let depth = 0; depth < radius; depth++) {
    const next = [];
    for (const current of frontier) {
      for (const neighbor of graph.get(current) || []) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  seen.delete(id);
  return seen;
}

/**
 * Cache immutable graph neighborhoods within one recovery invocation.
 * Bound retained memberships as well as entries; dense radius expansions must
 * not create an unbounded second copy of the graph. Callers must not mutate sets.
 */
export function neighborhoodLookup(graph, radius, {maxEntries = 4096, maxMembers = 250000} = {}) {
  const cache = new Map();
  let members = 0;
  return id => {
    if (cache.has(id)) return cache.get(id);
    const result = neighbors(id, graph, radius);
    if (maxEntries < 1 || result.size > maxMembers) return result;
    while (cache.size && (cache.size >= maxEntries || members + result.size > maxMembers)) {
      const oldest = cache.keys().next().value;
      members -= cache.get(oldest).size;
      cache.delete(oldest);
    }
    cache.set(id, result);
    members += result.size;
    return result;
  };
}
