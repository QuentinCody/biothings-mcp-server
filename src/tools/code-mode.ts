/**
 * BioThings Code Mode — registers search + execute tools for full API access.
 *
 * search: In-process catalog query, returns matching endpoints with docs.
 * execute: V8 isolate with api.get + api.post + searchSpec/listCategories.
 */

import type { McpServer } from "@bio-mcp/shared/mcp";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { biothingsCatalog } from "../spec/catalog";
import { createBioThingsApiFetch } from "../lib/api-adapter";
import { biothingsResponse } from "../lib/tool-result";

interface CodeModeEnv {
	BIOTHINGS_DATA_DO: DurableObjectNamespace;
	CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(server: McpServer, env: CodeModeEnv): void {
	const apiFetch = createBioThingsApiFetch();
	const registrar = { tool: (...args: unknown[]) => {
		const [name, ...rest] = args;
		const handler = rest.pop() as (input: unknown, extra: unknown) => ReturnType<typeof biothingsResponse>;
		const respond = (input: unknown, extra: unknown) => biothingsResponse(() => handler(input, extra), env, String(name), extra, input);
		const register = server.tool.bind(server) as (...values: unknown[]) => void;
		register(name, ...rest, respond); register(`mcp_${String(name)}`, ...rest, respond);
	} };

	const searchTool = createSearchTool({
		prefix: "biothings",
		catalog: biothingsCatalog,
	});
	searchTool.register(registrar);

	const executeTool = createExecuteTool({
		prefix: "biothings",
		// Verifiable provenance: biothings_execute results carry a _meta.citation.
		source: { id: "biothings", name: "BioThings", url: "https://biothings.io" },
		catalog: biothingsCatalog,
		apiFetch,
		preserveApiErrors: true,
		timeout: 60000,
		maxInlineBytes: 30 * 1024,
		stagingThreshold: 30 * 1024,
		doNamespace: env.BIOTHINGS_DATA_DO,
		loader: env.CODE_MODE_LOADER,
	});
	executeTool.register(registrar);
}
