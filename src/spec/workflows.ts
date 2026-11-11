import type { WorkflowRecipe } from "@bio-mcp/shared/codemode/catalog";

export const biothingsWorkflows: WorkflowRecipe[] = [
  {
    title: "Disease identifiers with native source context",
    description: "Keep observed build/source metadata beside every returned disease match or notfound row. MONDO and DOID references can resolve to the same document without proving identical clinical meaning. Metadata does not pin subsequent reads.",
    keywords: ["disease", "MONDO", "DOID", "source", "build"],
    code: `const metadata = await api.get('/disease/metadata');
const records = await api.post('/disease/query', {q:'MONDO:0007947,DOID:14323',scopes:'_id,mondo.xrefs.doid',fields:'mondo.label,mondo.xrefs,mondo.is_obsolete,mondo.replaced_by'});
return {metadata,records,release_pinned:false,clinical_equivalence_verified:false};`,
  },
  {
    title: "Gene species context from an exact native taxonomy ID",
    description: "Join MyGene's native taxid to MyTaxon's exact document ID and retain rank/lineage plus both services' observed metadata. Do not search numeric IDs as scientific names. Staged/error responses remain recoverable; no release pinning or cross-species gene equivalence is inferred.",
    keywords: ["gene", "taxon", "species", "lineage", "taxid"],
    code: `const [gene_metadata,taxon_metadata] = await Promise.all([api.get('/gene/metadata'),api.get('/taxon/metadata')]);
const gene = await api.get('/gene/gene/1017',{fields:'symbol,entrezgene,taxid,ensembl.gene'});
if(gene.__staged || gene.__api_error) return {gene_metadata,taxon_metadata,gene,taxon_id_match:false};
const taxid = String(gene.taxid ?? '');
if(!/^[1-9][0-9]*$/.test(taxid)) return {gene_metadata,taxon_metadata,gene,taxon_id_match:false};
const taxon = await api.get('/taxon/taxon/'+taxid,{fields:'taxid,scientific_name,rank,parent_taxid,lineage'});
return {gene_metadata,taxon_metadata,gene,taxon,requested_taxid:taxid,taxon_id_match:!taxon.__staged && !taxon.__api_error && String(taxon.taxid)===taxid,release_pinned:false};`,
  },
];
