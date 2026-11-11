/**
 * Batch resolution helpers for BioThings APIs.
 *
 * Use local 1000-ID chunks across services; provider limits can differ.
 * This module auto-chunks larger lists and merges results.
 */

import { biothingsPost, MYGENE_BASE, MYVARIANT_BASE, MYCHEM_BASE } from "./http";
import type { BioThingsHit } from "./types";
import { readBioThings } from "./read";
import { type BioThingsService, type LicenseFilter, licenseFilter, splitFields, stripRecord } from "./commercial-profile";

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
	fields: "entrezgene,ensembl.gene,ensembl.protein,uniprot.Swiss-Prot,HGNC,symbol,alias,taxid",
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
	/** "commercial": request and return only the allowlisted source fields (commercial-profile.ts). */
	licenseProfile?: "commercial";
}

const SERVICE: Record<EntityType, BioThingsService> = { gene: "gene", variant: "variant", compound: "chem" };

/**
 * The commercial form of a resolver request: the removed fields leave the
 * `fields` list, and the removed scopes leave `scopes`, because the resolver
 * (not the caller) chose them. An input that only a removed scope matches
 * (a DrugBank ID) then returns a notfound row.
 */
export function commercialBatchConfig(entityType: EntityType): BatchConfig & { removedFields: string[]; removedScopes: string[] } {
	const config = BATCH_CONFIGS[entityType];
	const fields = splitFields(SERVICE[entityType], config.fields);
	const scopes = splitFields(SERVICE[entityType], config.scopes);
	return { ...config, fields: fields.kept.join(","), scopes: scopes.kept.join(","), removedFields: fields.removed, removedScopes: scopes.removed };
}

export interface ResolvedBatch {
	hits: BioThingsHit[];
	/** Present under the commercial profile. */
	licenseFilter?: LicenseFilter & { removed_scopes?: string[] };
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
	return (await batchResolveWithProfile(ids, entityType, options)).hits;
}

/** `batchResolve`, with the `_license_filter` marker of the commercial profile. */
export async function batchResolveWithProfile(
	ids: string[],
	entityType: EntityType,
	options?: BatchOptions,
): Promise<ResolvedBatch> {
	if (options?.licenseProfile !== "commercial") return { hits: await resolveChunks(ids, entityType, BATCH_CONFIGS[entityType], options) };
	const service = SERVICE[entityType];
	const config = commercialBatchConfig(entityType);
	const removed = new Set(config.removedFields.map((field) => field.split(".")[0]));
	const hits = (await resolveChunks(ids, entityType, config, options))
		.map((hit) => stripRecord(service, hit, removed) as BioThingsHit);
	const scopes = config.removedScopes.length > 0 ? { removed_scopes: config.removedScopes } : {};
	return { hits, licenseFilter: { ...licenseFilter(service, removed), ...scopes } };
}

async function resolveChunks(
	ids: string[],
	entityType: EntityType,
	config: BatchConfig,
	options?: BatchOptions,
): Promise<BioThingsHit[]> {
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

		try {
			const { data } = await readBioThings(await biothingsPost(config.base, config.path, body));
			if (!Array.isArray(data) || data.some(hit => !hit || typeof hit !== "object" || typeof hit.query !== "string" || (hit.notfound !== true && typeof hit._id !== "string")))
				throw Object.assign(new Error(`BioThings ${entityType} returned an unrecognized batch response; no partial results returned as success`), { status: 502, data });
			allResults.push(...(data as BioThingsHit[]));
		} catch (error) {
			const detail = error && typeof error === "object" ? error : {};
			throw Object.assign(new Error(error instanceof Error ? error.message : "BioThings batch failed"), {
				status: "status" in detail ? detail.status : 502,
				data: { entity_type: entityType, source_url: `${config.base}${config.path}`, completed_results: allResults,
					failed_inputs: batch, native: "data" in detail ? detail.data : null, partial: true },
			});
		}
	}

	return allResults;
}
