export type PlaceholderValues = Record<string, string | number>;

const PLACEHOLDER_PATTERN = /^\{\{(\w+)\}\}$/;

// Deep-walks the *parsed* workflow JSON (not a text-level template pass),
// replacing string values that are ENTIRELY a "{{token}}" placeholder with
// the corresponding typed value. This sidesteps two real problems a naive
// JSON.stringify(...).replace(...) text pass would have: raw prompt text
// containing an unescaped quote or newline breaking the surrounding JSON,
// and accidentally matching "{{" that happens to appear inside the graph's
// own structure rather than a real placeholder.
export function renderWorkflow(workflow: unknown, values: PlaceholderValues): Record<string, unknown> {
  const rendered = walk(workflow, values);

  const remaining = JSON.stringify(rendered).match(/\{\{\w+\}\}/);
  if (remaining) {
    throw new Error(`Unresolved workflow placeholder: ${remaining[0]}`);
  }

  return rendered as Record<string, unknown>;
}

function walk(node: unknown, values: PlaceholderValues): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => walk(item, values));
  }

  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, walk(value, values)]));
  }

  if (typeof node === 'string') {
    const match = node.match(PLACEHOLDER_PATTERN);
    if (match) {
      const key = match[1];
      if (!(key in values)) {
        throw new Error(`Unresolved workflow placeholder: ${node}`);
      }
      return values[key];
    }
  }

  return node;
}
