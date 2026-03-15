/**
 * biothings_variant_resolve — Batch variant entity resolution via MyVariant.info.
 *
 * Accepts HGVS IDs, dbSNP rsIDs, or ClinVar RCV accessions (mixed).
 * Returns cross-references: HGVS _id, dbSNP rsid, ClinVar variant_id, COSMIC ID.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { batchResolve } from "../lib/batch";
import { shouldStage, stageToDoAndRespond } from "@bio-mcp/shared/staging/utils";
import type { VariantResolution, BioThingsHit } from "../lib/types";

interface VariantEnv {
	BIOTHINGS_DATA_DO?: unknown;
}

function parseHit(hit: BioThingsHit): VariantResolution {
	if (hit.notfound) {
		return { query: hit.query, found: false };
	}

	const dbsnp = hit.dbsnp as Record<string, unknown> | undefined;
	const clinvar = hit.clinvar as Record<string, unknown> | undefined;
	const cosmic = hit.cosmic as Record<string, unknown> | undefined;

	const cosmicObj = cosmic?.cosmic_id;
	let cosmicId: string | undefined;
	if (typeof cosmicObj === "string") cosmicId = cosmicObj;
	else if (Array.isArray(cosmicObj)) cosmicId = cosmicObj[0] as string;

	return {
		query: hit.query,
		found: true,
		hgvs_id: hit._id as string | undefined,
		rsid: dbsnp?.rsid as string | undefined,
		clinvar_variant_id: clinvar?.variant_id as number | undefined,
		cosmic_id: cosmicId,
	};
}

function formatPreview(results: VariantResolution[]): string {
	const found = results.filter((r) => r.found);
	const notFound = results.filter((r) => !r.found);
	const lines: string[] = [
		`Variant Resolution: ${found.length} found, ${notFound.length} not found out of ${results.length} queries`,
		"",
	];

	for (const r of found.slice(0, 10)) {
		const ids: string[] = [];
		if (r.rsid) ids.push(`rsID:${r.rsid}`);
		if (r.hgvs_id) ids.push(`HGVS:${r.hgvs_id}`);
		if (r.clinvar_variant_id) ids.push(`ClinVar:${r.clinvar_variant_id}`);
		if (r.cosmic_id) ids.push(`COSMIC:${r.cosmic_id}`);
		lines.push(`  ${r.query}: ${ids.join(", ")}`);
	}

	if (found.length > 10) lines.push(`  ... and ${found.length - 10} more`);
	if (notFound.length > 0) {
		lines.push(`\nNot found: ${notFound.map((r) => r.query).join(", ")}`);
	}
	return lines.join("\n");
}

async function runVariantResolve(ids: string[], env?: VariantEnv) {
	const hits = await batchResolve(ids, "variant");
	const results = hits.map(parseHit);
	const preview = formatPreview(results);

	const resultJson = JSON.stringify(results);
	if (shouldStage(resultJson.length) && env?.BIOTHINGS_DATA_DO) {
		try {
			const staged = await stageToDoAndRespond(
				results,
				env.BIOTHINGS_DATA_DO as any,
				"biothings_variant",
			);
			return {
				content: [{ type: "text" as const, text: `${preview}\n\nData staged (${results.length} rows). Use biothings_query_data with data_access_id '${staged.dataAccessId}'.` }],
				structuredContent: {
					success: true,
					data: undefined,
					_staging: staged._staging,
					_meta: { entity_type: "variant", total: results.length, found: results.filter((r) => r.found).length },
				},
			};
		} catch {
			// fall through to inline
		}
	}

	const isLarge = resultJson.length > 100_000;
	return {
		content: [{ type: "text" as const, text: preview }],
		structuredContent: {
			success: true,
			data: isLarge ? undefined : results,
			_meta: {
				entity_type: "variant",
				total: results.length,
				found: results.filter((r) => r.found).length,
				...(isLarge ? { truncated: true, hint: "Use biothings_query_data to explore staged data." } : {}),
			},
		},
	};
}

export function registerVariantResolve(server: McpServer, env?: VariantEnv) {
	const schema = {
		title: "Resolve Variant Identifiers",
		description:
			"Batch resolve variant identifiers (HGVS IDs, dbSNP rsIDs, ClinVar RCV accessions) to cross-references " +
			"via MyVariant.info. Returns HGVS _id, dbSNP rsid, ClinVar variant_id, and COSMIC ID. " +
			"Accepts up to 1000 IDs per call (auto-chunked if more).",
		inputSchema: {
			ids: z
				.array(z.string().min(1))
				.min(1)
				.max(5000)
				.describe("Variant identifiers to resolve (e.g. rs58991260, chr7:g.140453136A>T, RCV000033006)"),
		},
	};

	const handler = async (args: { ids: string[] }, extra: unknown) => {
		const runtimeEnv = env || (extra as { env?: VariantEnv })?.env || {};
		return runVariantResolve(args.ids, runtimeEnv as VariantEnv);
	};

	server.registerTool("mcp_biothings_variant_resolve", schema, handler);
	server.registerTool("biothings_variant_resolve", schema, handler);
}
