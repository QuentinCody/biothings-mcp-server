/**
 * BioThings API adapter — routes requests to five annotation services
 * based on path prefix.
 *
 * Virtual path namespaces:
 *   /gene/*     → mygene.info/v3
 *   /variant/*  → myvariant.info/v1
 *   /chem/*     → mychem.info/v1
 *   /disease/*  → mydisease.info/v1
 *   /taxon/*    → mytaxon.info/v1
 */

import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { readBioThings } from "./read";
import { biothingsCompleteness } from "./completeness";
import { applyCommercialFilter, type BioThingsService, commercialRequestRule, isMetadataPath } from "./commercial-profile";
import {
	mygeneFetch,
	myvariantFetch,
	mychemFetch,
	mydiseaseFetch,
	mytaxonFetch,
	biothingsPost,
	MYGENE_BASE,
	MYVARIANT_BASE,
	MYCHEM_BASE,
	MYDISEASE_BASE,
	MYTAXON_BASE,
} from "./http";

const ROUTE_MAP: Array<{
	prefix: string;
	service: BioThingsService;
	fetch: typeof mygeneFetch;
	base: string;
}> = [
	{ prefix: "/gene/", service: "gene", fetch: mygeneFetch, base: MYGENE_BASE },
	{ prefix: "/variant/", service: "variant", fetch: myvariantFetch, base: MYVARIANT_BASE },
	{ prefix: "/chem/", service: "chem", fetch: mychemFetch, base: MYCHEM_BASE },
	{ prefix: "/disease/", service: "disease", fetch: mydiseaseFetch, base: MYDISEASE_BASE },
	{ prefix: "/taxon/", service: "taxon", fetch: mytaxonFetch, base: MYTAXON_BASE },
];

function apiError(message: string, status: number, data: unknown = null) {
  return Object.assign(new Error(message), { status, data });
}

function batchBody(body: unknown): Record<string, string> {
  let parsed = body;
  if (typeof body === "string") {
    try { parsed = JSON.parse(body); }
    catch { throw apiError("Invalid JSON in request body", 400); }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw apiError("Batch body must be an object of form parameters", 400);
  }
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
}

type Params = Parameters<ApiFetchFn>[0]["params"];

/**
 * The path without its query string and fragment, and the params with each
 * pair of that query string added. The fetch sends a query string inside the
 * path to the upstream, so the commercial rule must read it as parameters.
 */
export function withPathQuery(path: string, params: Params): { path: string; params: Params } {
  const mark = path.search(/[?#]/);
  if (mark < 0) return { path, params };
  const merged: Record<string, unknown> = { ...params };
  const query = path[mark] === "?" ? path.slice(mark + 1).split("#")[0] : "";
  for (const [key, value] of new URLSearchParams(query)) {
    const prior = merged[key];
    merged[key] = prior === undefined ? value : [...(Array.isArray(prior) ? prior : [prior]), value];
  }
  return { path: path.slice(0, mark), params: merged };
}

export function createBioThingsApiFetch(): ApiFetchFn {
  return async (request) => {
    if (request.method !== "GET" && request.method !== "POST") throw apiError("BioThings supports GET reads and POST batch queries", 405);
    const route = ROUTE_MAP.find(r => request.path.startsWith(r.prefix));
    if (!route) throw apiError(`Unknown BioThings path prefix: ${request.path}. Use ${ROUTE_MAP.map(r => r.prefix).join(", ")}.`, 400);
    const reselling = request.licenseProfile === "commercial";
    const upstreamPath = request.path.slice(route.prefix.length - 1);
    let { path, params } = reselling ? withPathQuery(upstreamPath, request.params) : { path: upstreamPath, params: request.params };
    let body = request.method === "POST" ? batchBody(request.body) : undefined;
    // A reselling caller gets only the source fields whose license permits commercial use (commercial-profile.ts).
    const commercial = reselling && !isMetadataPath(path);
    let stripped: string[] = [];
    if (commercial) {
      const rule = commercialRequestRule(route.service, path, params, body);
      if ("refusal" in rule) return rule.refusal;
      ({ params, body, stripped } = rule);
    }
    const response = body
      ? await biothingsPost(route.base, path, body, params)
      : await route.fetch(path, params);
    const result = await readBioThings(response);
    if (result.data && typeof result.data === "object" && "error" in result.data && typeof result.data.error === "string")
      throw apiError("BioThings reported an application error", 502, { http_status: result.status, native: result.data });
    if (commercial) {
      const filtered = applyCommercialFilter(route.service, result.data, stripped);
      if ("refusal" in filtered) return filtered.refusal;
      result.data = filtered.data;
    }
    const completeness = biothingsCompleteness(result.data, request.path);
    return completeness ? { ...result, completeness, upstreamTotal: completeness.total_available ?? null } : result;
  };
}
