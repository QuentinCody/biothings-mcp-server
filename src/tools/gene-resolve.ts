/**
 * biothings_gene_resolve — Batch gene entity resolution via MyGene.info.
 *
 * Accepts gene symbols, aliases, Entrez IDs, or Ensembl gene IDs (mixed).
 * Returns cross-references: Entrez, Ensembl gene/protein, UniProt, HGNC, symbol, aliases.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { batchResolve } from "../lib/batch";
import { shouldStage, stageToDoAndRespond } from "@bio-mcp/shared/staging/utils";
import type { GeneResolution, BioThingsHit } from "../lib/types";

interface GeneEnv {
	BIOTHINGS_DATA_DO?: unknown;
}

function parseHit(hit: BioThingsHit): GeneResolution {
	if (hit.notfound) {
		return { query: hit.query, found: false };
	}

	const ensemblRaw = hit.ensembl as Record<string, unknown> | Array<Record<string, unknown>> | undefined;
	let ensemblGene: string | undefined;
	let ensemblProteins: string[] | undefined;

	if (Array.isArray(ensemblRaw)) {
		ensemblGene = ensemblRaw[0]?.gene as string | undefined;
		ensemblProteins = ensemblRaw.flatMap((e) => {
			const p = e.protein;
			return Array.isArray(p) ? p : p ? [p] : [];
		}) as string[];
	} else if (ensemblRaw) {
		ensemblGene = ensemblRaw.gene as string | undefined;
		const p = ensemblRaw.protein;
		ensemblProteins = Array.isArray(p) ? (p as string[]) : p ? [p as string] : undefined;
	}

	const uniprotRaw = hit.uniprot as Record<string, unknown> | undefined;
	const swissProt = uniprotRaw?.["Swiss-Prot"];
	const uniprot = Array.isArray(swissProt) ? (swissProt[0] as string) : (swissProt as string | undefined);

	const aliasRaw = hit.alias;
	const alias = Array.isArray(aliasRaw) ? (aliasRaw as string[]) : aliasRaw ? [aliasRaw as string] : undefined;

	return {
		query: hit.query,
		found: true,
		entrezgene: hit.entrezgene as number | undefined,
		ensembl_gene: ensemblGene,
		ensembl_protein: ensemblProteins,
		uniprot,
		hgnc: hit.HGNC as string | undefined,
		symbol: hit.symbol as string | undefined,
		alias,
	};
}

function formatPreview(results: GeneResolution[]): string {
	const found = results.filter((r) => r.found);
	const notFound = results.filter((r) => !r.found);
	const lines: string[] = [
		`Gene Resolution: ${found.length} found, ${notFound.length} not found out of ${results.length} queries`,
		"",
	];

	for (const r of found.slice(0, 10)) {
		const ids: string[] = [];
		if (r.entrezgene) ids.push(`Entrez:${r.entrezgene}`);
		if (r.ensembl_gene) ids.push(`Ensembl:${r.ensembl_gene}`);
		if (r.uniprot) ids.push(`UniProt:${r.uniprot}`);
		if (r.hgnc) ids.push(`HGNC:${r.hgnc}`);
		lines.push(`  ${r.symbol || r.query}: ${ids.join(", ")}`);
	}

	if (found.length > 10) lines.push(`  ... and ${found.length - 10} more`);
	if (notFound.length > 0) {
		lines.push(`\nNot found: ${notFound.map((r) => r.query).join(", ")}`);
	}
	return lines.join("\n");
}

async function runGeneResolve(ids: string[], env?: GeneEnv, species?: string | null) {
	// null = explicitly "all" (no filter), undefined = default to "human"
	const speciesValue = species === null ? undefined : (species ?? "human");
	const hits = await batchResolve(ids, "gene", { species: speciesValue });
	const results = hits.map(parseHit);
	const preview = formatPreview(results);

	const resultJson = JSON.stringify(results);
	if (shouldStage(resultJson.length) && env?.BIOTHINGS_DATA_DO) {
		try {
			const staged = await stageToDoAndRespond(
				results,
				env.BIOTHINGS_DATA_DO as any,
				"biothings_gene",
			);
			return {
				content: [{ type: "text" as const, text: `${preview}\n\nData staged (${results.length} rows). Use biothings_query_data with data_access_id '${staged.dataAccessId}'.` }],
				structuredContent: {
					success: true,
					data: undefined,
					_staging: staged._staging,
					_meta: { entity_type: "gene", total: results.length, found: results.filter((r) => r.found).length },
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
				entity_type: "gene",
				total: results.length,
				found: results.filter((r) => r.found).length,
				...(isLarge ? { truncated: true, hint: "Use biothings_query_data to explore staged data." } : {}),
			},
		},
	};
}

export function registerGeneResolve(server: McpServer, env?: GeneEnv) {
	const schema = {
		title: "Resolve Gene Identifiers",
		description:
			"Batch resolve gene identifiers (symbols, aliases, Entrez IDs, Ensembl gene IDs) to cross-references " +
			"via MyGene.info. Returns Entrez, Ensembl gene/protein, UniProt Swiss-Prot, HGNC, symbol, and aliases. " +
			"Defaults to human genes only. Accepts up to 1000 IDs per call (auto-chunked if more).",
		inputSchema: {
			ids: z
				.array(z.string().min(1))
				.min(1)
				.max(5000)
				.describe("Gene identifiers to resolve (symbols like BRAF, Entrez IDs like 673, Ensembl IDs like ENSG00000157764)"),
			species: z
				.string()
				.optional()
				.describe("Species filter (default: 'human'). Use 'all' for all species, or specific like 'mouse', '9606', '10090'."),
		},
	};

	const handler = async (args: { ids: string[]; species?: string }, extra: unknown) => {
		const runtimeEnv = env || (extra as { env?: GeneEnv })?.env || {};
		// "all" → null (no species filter), undefined → default to human
		const species = args.species === "all" ? null : args.species;
		return runGeneResolve(args.ids, runtimeEnv as GeneEnv, species);
	};

	server.registerTool("mcp_biothings_gene_resolve", schema, handler);
	server.registerTool("biothings_gene_resolve", schema, handler);
}
