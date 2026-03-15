/**
 * HTTP clients for BioThings APIs: MyGene.info, MyVariant.info, MyChem.info
 *
 * All three APIs share the same query/post conventions and are public (no auth).
 */

import { restFetch, type RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

const MYGENE_BASE = "https://mygene.info/v3";
const MYVARIANT_BASE = "https://myvariant.info/v1";
const MYCHEM_BASE = "https://mychem.info/v1";

export interface BioThingsFetchOptions extends Omit<RestFetchOptions, "retryOn"> {
	baseUrl?: string;
}

const UA = "biothings-mcp-server/1.0 (bio-mcp; https://github.com/QuentinCody/biothings-mcp-server)";

function makeFetcher(defaultBase: string) {
	return async function (
		path: string,
		params?: Record<string, unknown>,
		opts?: BioThingsFetchOptions,
	): Promise<Response> {
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

/**
 * POST a batch query to a BioThings endpoint.
 * BioThings batch endpoints accept form-encoded body with `q`, `scopes`, `fields`.
 */
export async function biothingsPost(
	baseUrl: string,
	path: string,
	body: Record<string, string>,
): Promise<Response> {
	const url = `${baseUrl}${path}`;
	return fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
			"User-Agent": UA,
		},
		body: new URLSearchParams(body).toString(),
	});
}

export { MYGENE_BASE, MYVARIANT_BASE, MYCHEM_BASE };
