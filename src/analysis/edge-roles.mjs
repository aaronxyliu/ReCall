/** Code-only relationship support for radius-one candidate pruning. */
export function edgeRoles(graph) {
  const index = new Map();
  function add(from, to, role) {
    if (!index.has(from)) index.set(from, new Map());
    const outgoing = index.get(from);
    if (!outgoing.has(to)) outgoing.set(to, new Set());
    outgoing.get(to).add(role);
  }
  for (const edge of graph.edges) {
    add(edge.from, edge.to, `${edge.kind}:out`);
    add(edge.to, edge.from, `${edge.kind}:in`);
  }
  return index;
}

/**
 * A candidate needs one accepted parent correspondence with the same edge kind
 * and direction on both sides. This is a heuristic, not semantic inequivalence:
 * compilation can remove or reverse relationships. No oracle data is used.
 */
export function supportedByEdgeRole(sourceId, bundleId, parents, accepted, sourceRoles, bundleRoles, inScope) {
  for (const parent of parents) {
    const targetRoles = bundleRoles.get(parent)?.get(bundleId);
    if (!targetRoles) continue;
    for (const parentSource of accepted.get(parent) || []) {
      if (!inScope(parentSource)) continue;
      const candidateRoles = sourceRoles.get(parentSource)?.get(sourceId);
      if (candidateRoles && [...candidateRoles].some(role => targetRoles.has(role))) return true;
    }
  }
  return false;
}
