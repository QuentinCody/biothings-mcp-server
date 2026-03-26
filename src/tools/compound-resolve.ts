/**
 * biothings_compound_resolve — Batch compound entity resolution via MyChem.info.
 *
 * Accepts InChIKeys, DrugBank IDs, ChEMBL IDs, or PubChem CIDs (mixed).
 * Returns cross-references: ChEMBL, DrugBank, PubChem CID, UNII, ChEBI.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { batchResolve } from "../lib/batch";
import { shouldStage, stageToDoAndRespond } from "@bio-mcp/shared/staging/utils";
import type { CompoundResolution, BioThingsHit } from "../lib/types";

interface CompoundEnv {
	BIOTHINGS_DATA_DO?: unknown;
}

function parseHit(hit: BioThingsHit): CompoundResolution {
	if (hit.notfound) {
		return { query: hit.query, found: false };
	}

	const chembl = hit.chembl as Record<string, unknown> | undefined;
	const drugbank = hit.drugbank as Record<string, unknown> | undefined;
	const pubchem = hit.pubchem as Record<string, unknown> | undefined;
	const unii = hit.unii as Record<string, unknown> | undefined;
	const chebi = hit.chebi as Record<string, unknown> | undefined;

	return {
		query: hit.query,
		found: true,
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
		`Compound Resolution: ${found.length} found, ${notFound.length} not found out of ${results.length} queries`,
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

async function runCompoundResolve(ids: string[], env?: CompoundEnv) {
	const hits = await batchResolve(ids, "compound");
	const results = hits.map(parseHit);
	const preview = formatPreview(results);

	const resultJson = JSON.stringify(results);
	if (shouldStage(resultJson.length) && env?.BIOTHINGS_DATA_DO) {
		try {
			const staged = await stageToDoAndRespond(
				results,
				env.BIOTHINGS_DATA_DO as DurableObjectNamespace,
				"biothings_compound",
			);
			return {
				content: [{ type: "text" as const, text: `${preview}\n\nData staged (${results.length} rows). Use biothings_query_data with data_access_id '${staged.dataAccessId}'.` }],
				structuredContent: {
					success: true,
					data: undefined,
					_staging: staged._staging,
					_meta: { entity_type: "compound", total: results.length, found: results.filter((r) => r.found).length },
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
				entity_type: "compound",
				total: results.length,
				found: results.filter((r) => r.found).length,
				...(isLarge ? { truncated: true, hint: "Use biothings_query_data to explore staged data." } : {}),
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
			"Accepts up to 1000 IDs per call (auto-chunked if more).",
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
		return runCompoundResolve(args.ids, runtimeEnv as CompoundEnv);
	};

	server.registerTool("mcp_biothings_compound_resolve", schema, handler);
	server.registerTool("biothings_compound_resolve", schema, handler);
}
