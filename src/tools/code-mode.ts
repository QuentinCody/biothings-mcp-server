/**
 * BioThings Code Mode — registers search + execute tools for full API access.
 *
 * search: In-process catalog query, returns matching endpoints with docs.
 * execute: V8 isolate with api.get + api.post + searchSpec/listCategories.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { biothingsCatalog } from "../spec/catalog";
import { createBioThingsApiFetch } from "../lib/api-adapter";

interface CodeModeEnv {
	BIOTHINGS_DATA_DO: DurableObjectNamespace;
	CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(server: McpServer, env: CodeModeEnv): void {
	const apiFetch = createBioThingsApiFetch();

	const searchTool = createSearchTool({
		prefix: "biothings",
		catalog: biothingsCatalog,
	});
	searchTool.register(server as unknown as { tool: (...args: unknown[]) => void });

	const executeTool = createExecuteTool({
		prefix: "biothings",
		catalog: biothingsCatalog,
		apiFetch,
		doNamespace: env.BIOTHINGS_DATA_DO,
		loader: env.CODE_MODE_LOADER,
	});
	executeTool.register(server as unknown as { tool: (...args: unknown[]) => void });
}
