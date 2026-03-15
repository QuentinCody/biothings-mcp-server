/**
 * Batch resolution helpers for BioThings APIs.
 *
 * All BioThings batch endpoints cap at 1000 IDs per request.
 * This module auto-chunks larger lists and merges results.
 */

import { biothingsPost, MYGENE_BASE, MYVARIANT_BASE, MYCHEM_BASE } from "./http";
import type { BioThingsHit } from "./types";

const MAX_BATCH_SIZE = 1000;

interface BatchConfig {
	base: string;
	path: string;
	scopes: string;
	fields: string;
}

const GENE_CONFIG: BatchConfig = {
	base: MYGENE_BASE,
	path: "/query",
	scopes: "symbol,alias,entrezgene,ensembl.gene",
	fields: "entrezgene,ensembl.gene,ensembl.protein,uniprot.Swiss-Prot,HGNC,symbol,alias",
};

const VARIANT_CONFIG: BatchConfig = {
	base: MYVARIANT_BASE,
	path: "/query",
	scopes: "_id,dbsnp.rsid,clinvar.rcv.accession",
	fields: "_id,dbsnp.rsid,clinvar.variant_id,cosmic.cosmic_id",
};

const COMPOUND_CONFIG: BatchConfig = {
	base: MYCHEM_BASE,
	path: "/query",
	scopes: "_id,drugbank.id,chembl.molecule_chembl_id,pubchem.cid",
	fields: "chembl.molecule_chembl_id,drugbank.id,pubchem.cid,unii.unii,chebi.id",
};

export const BATCH_CONFIGS = {
	gene: GENE_CONFIG,
	variant: VARIANT_CONFIG,
	compound: COMPOUND_CONFIG,
} as const;

export type EntityType = keyof typeof BATCH_CONFIGS;

/**
 * Chunk an array into groups of `size`.
 */
function chunk<T>(arr: T[], size: number): T[][] {
	const result: T[][] = [];
	for (let i = 0; i < arr.length; i += size) {
		result.push(arr.slice(i, i + size));
	}
	return result;
}

export interface BatchOptions {
	/** Species filter (e.g. "human", "mouse", "9606"). Only applies to gene queries. */
	species?: string;
}

/**
 * Execute a batch query against a BioThings endpoint.
 * Auto-chunks lists > 1000 IDs and merges results.
 */
export async function batchResolve(
	ids: string[],
	entityType: EntityType,
	options?: BatchOptions,
): Promise<BioThingsHit[]> {
	const config = BATCH_CONFIGS[entityType];
	const chunks = chunk(ids, MAX_BATCH_SIZE);
	const allResults: BioThingsHit[] = [];

	for (const batch of chunks) {
		const body: Record<string, string> = {
			q: batch.join(","),
			scopes: config.scopes,
			fields: config.fields,
		};

		// Species filter only applies to gene queries
		if (options?.species && entityType === "gene") {
			body.species = options.species;
		}

		const response = await biothingsPost(config.base, config.path, body);

		if (!response.ok) {
			const errorText = await response.text().catch(() => response.statusText);
			throw new Error(`BioThings ${entityType} batch query failed: HTTP ${response.status} — ${errorText.slice(0, 200)}`);
		}

		const data = await response.json();

		if (Array.isArray(data)) {
			allResults.push(...(data as BioThingsHit[]));
		}
	}

	return allResults;
}
