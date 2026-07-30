import { buildHealthResponse, configureCitationSigning } from "@bio-mcp/shared";
import { StatelessMcpWorker } from "@bio-mcp/shared/mcp";
import { McpServer } from "@bio-mcp/shared/mcp";
import { registerGeneResolve } from "./tools/gene-resolve";
import { registerVariantResolve } from "./tools/variant-resolve";
import { registerCompoundResolve } from "./tools/compound-resolve";
import { registerQueryData } from "./tools/query-data";
import { registerGetSchema } from "./tools/get-schema";
import { registerCodeMode } from "./tools/code-mode";
import { BioThingsDataDO } from "./do";

export { BioThingsDataDO };

interface BioThingsEnv {
	BIOTHINGS_DATA_DO: DurableObjectNamespace;
	CODE_MODE_LOADER: WorkerLoader;
}

export class MyMCP extends StatelessMcpWorker {
	server = new McpServer({
		name: "biothings",
		version: "0.1.0",
	});

	async init() {

		configureCitationSigning(this.env);
		const env = this.env as unknown as BioThingsEnv;

		// Hand-built entity resolution tools
		registerGeneResolve(this.server, env);
		registerVariantResolve(this.server, env);
		registerCompoundResolve(this.server, env);

		// Staging tools
		registerQueryData(this.server, env);
		registerGetSchema(this.server, env);

		// Code Mode (search + execute) — registered last
		registerCodeMode(this.server, env);
	}
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		if (url.pathname === "/health") {
			return buildHealthResponse("biothings");
		}

		if (url.pathname === "/mcp") {
			return MyMCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response("Not found", { status: 404 });
	},
};
