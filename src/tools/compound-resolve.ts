/**
 * biothings_compound_resolve — Batch compound entity resolution via MyChem.info.
 *
 * Accepts InChIKeys, DrugBank IDs, ChEMBL IDs, or PubChem CIDs (mixed).
 * Returns cross-references: ChEMBL, DrugBank, PubChem CID, UNII, ChEBI.
 */

import { getRequestLicenseProfile, type MaybeExtra } from "@bio-mcp/shared";
import type { McpServer } from "@bio-mcp/shared/mcp";
import { z } from "zod";
import { batchResolveWithProfile } from "../lib/batch";
import { biothingsResolution } from "../lib/tool-result";

import type { CompoundResolution, BioThingsHit } from "../lib/types";

interface CompoundEnv {
	BIOTHINGS_DATA_DO?: unknown;
}

function parseHit(hit: BioThingsHit): CompoundResolution {
	if (hit.notfound) {
		return { query: hit.query, found: false, native: hit };
	}

	const chembl = hit.chembl as Record<string, unknown> | undefined;
	const drugbank = hit.drugbank as Record<string, unknown> | undefined;
	const pubchem = hit.pubchem as Record<string, unknown> | undefined;
	const unii = hit.unii as Record<string, unknown> | undefined;
	const chebi = hit.chebi as Record<string, unknown> | undefined;

	return {
		query: hit.query,
		found: true,
		native: hit,
		chembl_id: chembl?.molecule_chembl_id as string | undefined,
		drugbank_id: drugbank?.id as string | undefined,
		pubchem_cid: pubchem?.cid as number | undefined,
		unii: unii?.unii as string | undefined,
		chebi_id: chebi?.id as string | undefined,
	};
}

function formatPreview(results: CompoundResolution[]): string {
	const found = results.filter((r) => r.found);
	const notFound = results.filter((r) => !r.found);
	const lines: string[] = [
		`Compound Resolution: ${found.length} matching rows, ${notFound.length} notfound rows (${results.length} response rows; multiple matches may share a query)`,
		"",
	];

	for (const r of found.slice(0, 10)) {
		const ids: string[] = [];
		if (r.chembl_id) ids.push(`ChEMBL:${r.chembl_id}`);
		if (r.drugbank_id) ids.push(`DrugBank:${r.drugbank_id}`);
		if (r.pubchem_cid) ids.push(`PubChem:${r.pubchem_cid}`);
		if (r.unii) ids.push(`UNII:${r.unii}`);
		if (r.chebi_id) ids.push(`ChEBI:${r.chebi_id}`);
		lines.push(`  ${r.query}: ${ids.join(", ")}`);
	}

	if (found.length > 10) lines.push(`  ... and ${found.length - 10} more`);
	if (notFound.length > 0) {
		lines.push(`\nNot found: ${notFound.map((r) => r.query).join(", ")}`);
	}
	return lines.join("\n");
}

async function runCompoundResolve(ids: string[], licenseProfile: "commercial" | undefined) {
	const { hits, licenseFilter } = await batchResolveWithProfile(ids, "compound", { licenseProfile });
	const results = hits.map(parseHit);
	const preview = formatPreview(results);


	return {
		content: [{ type: "text" as const, text: preview }],
		structuredContent: {
			success: true,
			data: results,
			...(licenseFilter ? { _license_filter: licenseFilter } : {}),
			_meta: {
				entity_type: "compound",
				input_count: ids.length,
				total: results.length,
				found: results.filter((r) => r.found).length,
			},
		},
	};
}

export function registerCompoundResolve(server: McpServer, env?: CompoundEnv): void {
	const schema = {
		title: "Resolve Compound Identifiers",
		description:
			"Batch resolve compound identifiers (InChIKeys, DrugBank IDs, ChEMBL IDs, PubChem CIDs) to cross-references " +
			"via MyChem.info. Returns ChEMBL ID, DrugBank ID, PubChem CID, UNII, and ChEBI ID. " +
			"Accepts up to 5000 IDs per call in local 1000-input chunks. Complete native hits retain all mappings, scores and source licenses; convenience scalar fields may show only the first value and do not establish canonical or equivalent identities.",
		inputSchema: {
			ids: z
				.array(z.string().min(1))
				.min(1)
				.max(5000)
				.describe("Compound identifiers to resolve (e.g. CHEMBL25, DB00945, 2244, HEFNNWSXXWATRW-UHFFFAOYSA-N)"),
		},
	};

	const handler = async (args: { ids: string[] }, extra: unknown) => {
		const runtimeEnv = env || (extra as { env?: CompoundEnv })?.env || {};
		const licenseProfile = getRequestLicenseProfile(extra as MaybeExtra | undefined);
		return biothingsResolution(() => runCompoundResolve(args.ids, licenseProfile), runtimeEnv, "biothings_compound_resolve", args, extra);
	};

	server.registerTool("mcp_biothings_compound_resolve", schema, handler);
	server.registerTool("biothings_compound_resolve", schema, handler);
}
