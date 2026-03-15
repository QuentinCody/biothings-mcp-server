/**
 * Shared types for BioThings entity resolution results.
 */

/** A single result from a BioThings batch query */
export interface BioThingsHit {
	query: string;
	_id?: string;
	_score?: number;
	notfound?: boolean;
	[key: string]: unknown;
}

/** Resolved gene cross-references */
export interface GeneResolution {
	query: string;
	found: boolean;
	entrezgene?: number;
	ensembl_gene?: string;
	ensembl_protein?: string[];
	uniprot?: string;
	hgnc?: string;
	symbol?: string;
	alias?: string[];
}

/** Resolved variant cross-references */
export interface VariantResolution {
	query: string;
	found: boolean;
	hgvs_id?: string;
	rsid?: string;
	clinvar_variant_id?: number;
	cosmic_id?: string;
}

/** Resolved compound cross-references */
export interface CompoundResolution {
	query: string;
	found: boolean;
	chembl_id?: string;
	drugbank_id?: string;
	pubchem_cid?: number;
	unii?: string;
	chebi_id?: string;
}
