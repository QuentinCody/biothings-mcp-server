/**
 * biothings_variant_resolve — Batch variant entity resolution via MyVariant.info.
 *
 * Accepts HGVS IDs, dbSNP rsIDs, or ClinVar RCV accessions (mixed).
 * Returns cross-references: HGVS _id, dbSNP rsid, ClinVar variant_id, COSMIC ID.
 */

import { getRequestLicenseProfile, type MaybeExtra } from "@bio-mcp/shared";
import type { McpServer } from "@bio-mcp/shared/mcp";
import { z } from "zod";
import { batchResolveWithProfile } from "../lib/batch";
import { biothingsResolution } from "../lib/tool-result";

import type { VariantResolution, BioThingsHit } from "../lib/types";

interface VariantEnv {
	BIOTHINGS_DATA_DO?: unknown;
}

function parseHit(hit: BioThingsHit): VariantResolution {
	if (hit.notfound) {
		return { query: hit.query, found: false, native: hit };
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
		native: hit,
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
		`Variant Resolution: ${found.length} matching rows, ${notFound.length} notfound rows (${results.length} response rows; multiple matches may share a query)`,
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

async function runVariantResolve(ids: string[], licenseProfile: "commercial" | undefined) {
	const { hits, licenseFilter } = await batchResolveWithProfile(ids, "variant", { licenseProfile });
	const results = hits.map(parseHit);
	const preview = formatPreview(results);


	return {
		content: [{ type: "text" as const, text: preview }],
		structuredContent: {
			success: true,
			data: results,
			...(licenseFilter ? { _license_filter: licenseFilter } : {}),
			_meta: {
				entity_type: "variant",
				input_count: ids.length,
				total: results.length,
				found: results.filter((r) => r.found).length,
			},
		},
	};
}

export function registerVariantResolve(server: McpServer, env?: VariantEnv): void {
	const schema = {
		title: "Resolve Variant Identifiers",
		description:
			"Batch resolve variant identifiers (HGVS IDs, dbSNP rsIDs, ClinVar RCV accessions) to cross-references " +
			"via MyVariant.info. Returns HGVS _id, dbSNP rsid, ClinVar variant_id, and COSMIC ID. " +
			"Accepts up to 5000 IDs per call in local 1000-input chunks. Complete native hits retain all mappings, scores and source licenses; convenience scalar fields may show only the first value and do not establish canonical or equivalent identities. " +
			"IMPORTANT: HGVS genomic coordinates must use GRCh37/hg19 (e.g. chr17:g.41209082dup, NOT GRCh38). " +
			"dbSNP rsIDs and ClinVar RCV accessions work regardless of assembly.",
		inputSchema: {
			ids: z
				.array(z.string().min(1))
				.min(1)
				.max(5000)
				.describe("Variant identifiers to resolve. rsIDs (rs58991260), ClinVar RCVs (RCV000033006), or HGVS genomic coords in GRCh37/hg19 (chr7:g.140453136A>T)"),
		},
	};

	const handler = async (args: { ids: string[] }, extra: unknown) => {
		const runtimeEnv = env || (extra as { env?: VariantEnv })?.env || {};
		const licenseProfile = getRequestLicenseProfile(extra as MaybeExtra | undefined);
		return biothingsResolution(() => runVariantResolve(args.ids, licenseProfile), runtimeEnv, "biothings_variant_resolve", args, extra);
	};

	server.registerTool("mcp_biothings_variant_resolve", schema, handler);
	server.registerTool("biothings_variant_resolve", schema, handler);
}
