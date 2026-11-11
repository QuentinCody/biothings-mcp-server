/**
 * HTTP clients for the BioThings gene, variant, chemical, disease and taxon APIs.
 *
 * These APIs share query/post conventions and are public (no auth).
 */

import { restFetch, type RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

const MYGENE_BASE = "https://mygene.info/v3";
const MYVARIANT_BASE = "https://myvariant.info/v1";
const MYCHEM_BASE = "https://mychem.info/v1";
const MYDISEASE_BASE = "https://mydisease.info/v1";
const MYTAXON_BASE = "https://mytaxon.info/v1";

export interface BioThingsFetchOptions extends Omit<RestFetchOptions, "retryOn"> {
	baseUrl?: string;
}

const UA = "biothings-mcp-server/1.0 (bio-mcp; https://github.com/QuentinCody/biothings-mcp-server)";

function makeFetcher(defaultBase: string) {
	return async (
		path: string,
		params?: Record<string, unknown>,
		opts?: BioThingsFetchOptions,
	): Promise<Response> => {
		const baseUrl = opts?.baseUrl ?? defaultBase;
		const headers: Record<string, string> = {
			Accept: "application/json",
			...(opts?.headers ?? {}),
		};

		return restFetch(baseUrl, path, params, {
			...opts,
			headers,
			retryOn: [429, 500, 502, 503],
			retries: opts?.retries ?? 3,
			timeout: opts?.timeout ?? 30_000,
			userAgent: UA,
		});
	};
}

export const mygeneFetch = makeFetcher(MYGENE_BASE);
export const myvariantFetch = makeFetcher(MYVARIANT_BASE);
export const mychemFetch = makeFetcher(MYCHEM_BASE);
export const mydiseaseFetch = makeFetcher(MYDISEASE_BASE);
export const mytaxonFetch = makeFetcher(MYTAXON_BASE);

/**
 * POST a batch query to a BioThings endpoint.
 * BioThings batch endpoints accept form-encoded body with `q`, `scopes`, `fields`.
 */
export async function biothingsPost(
	baseUrl: string,
	path: string,
	body: Record<string, string>,
	params?: Record<string, unknown>,
): Promise<Response> {
	const url = new URL(`${baseUrl}${path}`);
	for (const [name, value] of Object.entries(params ?? {})) {
		if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
	}
	return fetch(url.toString(), {
		method: "POST",
		redirect: "manual",
		signal: AbortSignal.timeout(30_000),
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
			"User-Agent": UA,
		},
		body: new URLSearchParams(body).toString(),
	});
}

export { MYGENE_BASE, MYVARIANT_BASE, MYCHEM_BASE, MYDISEASE_BASE, MYTAXON_BASE };
