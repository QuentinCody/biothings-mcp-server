/**
 * BioThings API adapter — routes requests to MyGene, MyVariant, or MyChem
 * based on path prefix.
 *
 * Virtual path namespaces:
 *   /gene/*     → mygene.info/v3
 *   /variant/*  → myvariant.info/v1
 *   /chem/*     → mychem.info/v1
 */

import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import {
	mygeneFetch,
	myvariantFetch,
	mychemFetch,
	biothingsPost,
	MYGENE_BASE,
	MYVARIANT_BASE,
	MYCHEM_BASE,
} from "./http";

const ROUTE_MAP: Array<{
	prefix: string;
	fetch: typeof mygeneFetch;
	base: string;
}> = [
	{ prefix: "/gene/", fetch: mygeneFetch, base: MYGENE_BASE },
	{ prefix: "/variant/", fetch: myvariantFetch, base: MYVARIANT_BASE },
	{ prefix: "/chem/", fetch: mychemFetch, base: MYCHEM_BASE },
];

export function createBioThingsApiFetch(): ApiFetchFn {
	return async (request) => {
		const route = ROUTE_MAP.find((r) => request.path.startsWith(r.prefix));

		if (!route) {
			const error = new Error(
				`Unknown BioThings path prefix: ${request.path}. Use /gene/, /variant/, or /chem/.`,
			) as Error & { status: number; data: unknown };
			error.status = 400;
			error.data = null;
			throw error;
		}

		// Strip the virtual prefix: /gene/query → /query
		const realPath = request.path.slice(route.prefix.length - 1);

		// Handle POST requests (batch queries)
		if (request.method === "POST" && request.body) {
			const body =
				typeof request.body === "string"
					? JSON.parse(request.body)
					: (request.body as Record<string, string>);
			const response = await biothingsPost(route.base, realPath, body);

			if (!response.ok) {
				let errorBody: string;
				try {
					errorBody = await response.text();
				} catch {
					errorBody = response.statusText;
				}
				const error = new Error(`HTTP ${response.status}: ${errorBody.slice(0, 200)}`) as Error & {
					status: number;
					data: unknown;
				};
				error.status = response.status;
				error.data = errorBody;
				throw error;
			}

			const data = await response.json();
			return { status: response.status, data };
		}

		// Handle GET requests
		const response = await route.fetch(realPath, request.params);

		if (!response.ok) {
			let errorBody: string;
			try {
				errorBody = await response.text();
			} catch {
				errorBody = response.statusText;
			}
			const error = new Error(`HTTP ${response.status}: ${errorBody.slice(0, 200)}`) as Error & {
				status: number;
				data: unknown;
			};
			error.status = response.status;
			error.data = errorBody;
			throw error;
		}

		const contentType = response.headers.get("content-type") || "";
		if (!contentType.includes("json")) {
			const text = await response.text();
			return { status: response.status, data: text };
		}

		const data = await response.json();
		return { status: response.status, data };
	};
}
