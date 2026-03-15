/**
 * BioThingsDataDO — Durable Object for staging large entity resolution responses.
 *
 * Extends RestStagingDO with hints for gene, variant, and compound resolution results.
 */

import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

export class BioThingsDataDO extends RestStagingDO {
	protected getSchemaHints(data: unknown): SchemaHints | undefined {
		if (!data || typeof data !== "object") return undefined;

		// Batch resolution results come as flat arrays
		if (Array.isArray(data) && data.length > 0) {
			const sample = data[0];
			if (typeof sample !== "object" || sample === null) return undefined;

			// Gene resolution results
			if ("entrezgene" in sample || "ensembl_gene" in sample || "symbol" in sample) {
				return {
					tableName: "genes",
					indexes: ["query", "symbol", "entrezgene", "ensembl_gene", "uniprot"],
				};
			}

			// Variant resolution results
			if ("hgvs_id" in sample || "rsid" in sample || "clinvar_variant_id" in sample) {
				return {
					tableName: "variants",
					indexes: ["query", "rsid", "hgvs_id", "clinvar_variant_id"],
				};
			}

			// Compound resolution results
			if ("chembl_id" in sample || "drugbank_id" in sample || "pubchem_cid" in sample) {
				return {
					tableName: "compounds",
					indexes: ["query", "chembl_id", "drugbank_id", "pubchem_cid"],
				};
			}

			// Raw BioThings API hits (from Code Mode)
			if ("_id" in sample && "query" in sample) {
				return {
					tableName: "hits",
					indexes: ["query", "_id", "_score"],
				};
			}
		}

		return undefined;
	}
}
