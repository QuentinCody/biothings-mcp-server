import type { Completeness } from "@bio-mcp/shared";
export const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export const fieldMap = (value: Record<string, unknown>) => Object.keys(value).length > 0 && Object.values(value).every(field => record(field) && typeof field.type === "string" && typeof field.index === "boolean");
const scoped = (returned: number, detail: string): Completeness => ({ complete: false, returned,
  truncation: { reason: "unknown", detail, remedy: "Retain native query, paging, notfound, build/source versions and licenses. Returned annotations are not exhaustive mappings, equivalent concepts or biological absence evidence." } });

function direct(value: unknown, path?: string): Completeness | undefined {
  if (Array.isArray(value)) return scoped(value.length, "Native response rows, including repeated matches and notfound entries; not a count of distinct inputs or complete per-input mappings.");
  if (!record(value)) return undefined;
  if (path?.endsWith("/metadata/fields") || fieldMap(value)) return scoped(Object.keys(value).length, "Field definitions from this metadata observation, not annotated entities.");
  if (path?.endsWith("/metadata") || typeof value.biothing_type === "string") return scoped(1, "One observed build/source metadata record; this does not pin subsequent queries.");
  if (Array.isArray(value.hits)) {
    const result = scoped(value.hits.length, "One BioThings query page; native total is not a count of returned rows or verified biological absence.");
    if (typeof value.total === "number" && Number.isSafeInteger(value.total) && value.total >= value.hits.length) {
      result.total_available = value.total;
      if (value.total > value.hits.length && result.truncation) result.truncation.reason = "page_limit";
    }
    return result;
  }
  if (typeof value._id === "string") return scoped(1, "One source annotation document, retaining native identity and source-specific evidence.");
  return undefined;
}

export function biothingsCompleteness(value: unknown, path?: string): Completeness | undefined {
  if (path) { const coverage = direct(value, path); if (coverage) return coverage; }
  const pending = [value]; const observations: Completeness[] = [];
  while (pending.length) {
    const item = pending.pop(); if (!item || typeof item !== "object") continue;
    if (record(item) && item.__staged === true) {
      if (record(item._staging) && record(item._staging.completeness) && item._staging.completeness.complete === false)
        observations.push({ ...item._staging.completeness, complete: false });
      continue;
    }
    const coverage = direct(item);
    if (coverage) observations.push(coverage); else pending.push(...Object.values(item));
  }
  if (observations.length < 2) return observations[0];
  return { complete: false, truncation: { reason: "unknown", detail: "Composed BioThings evidence contains independently scoped metadata and annotation observations.", remedy: "Keep each service, source and request distinct; do not add unrelated counts or infer pinned releases." } };
}
