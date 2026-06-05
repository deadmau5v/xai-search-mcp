/**
 * XAI Search MCP Server
 *
 * A Streamable HTTP MCP server built with Cloudflare Agents SDK (McpAgent).
 * Implements the X_Search tool for deep searching x.com posts/articles
 * via xAI's Grok model, authenticated with XAI_API_KEY.
 */

import { McpAgent } from "agents/mcp";
import type { Connection } from "partyserver";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Env {
  XAI_API_KEY: string;
}

interface AppState {
  lastQuery: string;
  totalCalls: number;
}

// ---------------------------------------------------------------------------
// X_Search tool input schema
// ---------------------------------------------------------------------------
const XSearchInputSchema = {
  query: z.string().describe("Search query to find posts/articles on x.com"),
  allowed_x_handles: z
    .array(z.string())
    .max(20)
    .optional()
    .describe("Only consider posts from these X handles (max 20)"),
  excluded_x_handles: z
    .array(z.string())
    .max(20)
    .optional()
    .describe("Exclude posts from these X handles (max 20)"),
  from_date: z
    .string()
    .optional()
    .describe("Start date for search range (ISO8601 format, e.g. 2025-01-01)"),
  to_date: z
    .string()
    .optional()
    .describe("End date for search range (ISO8601 format, e.g. 2025-12-31)"),
  enable_image_understanding: z
    .boolean()
    .optional()
    .describe("Enable analysis of images in posts"),
  enable_video_understanding: z
    .boolean()
    .optional()
    .describe("Enable analysis of videos in posts"),
};

// ---------------------------------------------------------------------------
// McpAgent – stateful MCP server backed by a Durable Object
// ---------------------------------------------------------------------------
export class XaiSearchMCP extends McpAgent<Env, AppState> {
  server = new McpServer({
    name: "xai-search-mcp",
    version: "1.0.0",
  });

  initialState: AppState = {
    lastQuery: "",
    totalCalls: 0,
  };

  async init() {
    // -----------------------------------------------------------------------
    // Tool: X_Search – Deep search on x.com via xAI API
    // -----------------------------------------------------------------------
    this.server.tool(
      "X_Search",
      "Deep search x.com posts and articles using xAI Grok. "
        + "Supports filtering by handles, date ranges, and media understanding.",
      XSearchInputSchema,
      async (params, extra) => {
        const apiKey = this.env.XAI_API_KEY;

        if (!apiKey) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: XAI_API_KEY is not configured. "
                  + "Please set the XAI_API_KEY environment variable.",
              },
            ],
            isError: true,
          };
        }

        // Build the xAI chat completion request with x_search tool
        const requestBody: Record<string, unknown> = {
          model: "grok-3-latest",
          messages: [
            {
              role: "user",
              content: params.query,
            },
          ],
          search_parameters: {
            mode: "auto",
            sources: [{ type: "x" }],
          },
          tool_choice: "auto",
        };

        // Build x_search parameters
        const xSearchParams: Record<string, unknown> = {};
        if (params.allowed_x_handles?.length) {
          xSearchParams.allowed_x_handles = params.allowed_x_handles;
        }
        if (params.excluded_x_handles?.length) {
          xSearchParams.excluded_x_handles = params.excluded_x_handles;
        }
        if (params.from_date) {
          xSearchParams.from_date = params.from_date;
        }
        if (params.to_date) {
          xSearchParams.to_date = params.to_date;
        }
        if (params.enable_image_understanding) {
          xSearchParams.enable_image_understanding = true;
        }
        if (params.enable_video_understanding) {
          xSearchParams.enable_video_understanding = true;
        }

        // Attach x_search as a server-side tool
        requestBody.tools = [
          {
            type: "x_search",
            ...(Object.keys(xSearchParams).length > 0 ? xSearchParams : {}),
          },
        ];

        try {
          const response = await fetch("https://api.x.ai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            const errorText = await response.text();
            return {
              content: [
                {
                  type: "text" as const,
                  text: `xAI API error (${response.status}): ${errorText}`,
                },
              ],
              isError: true,
            };
          }

          const data = (await response.json()) as {
            choices?: Array<{
              message?: { content?: string };
            }>;
            citations?: Array<{
              url?: string;
              title?: string;
              snippet?: string;
            }>;
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              total_tokens?: number;
            };
            server_side_tool_usage?: Array<{
              type: string;
              num_calls: number;
            }>;
          };

          // Extract the response content
          const content =
            data.choices?.[0]?.message?.content ?? "No results found.";

          // Format citations if available
          let citationText = "";
          if (data.citations?.length) {
            citationText =
              "\n\n## Sources\n"
              + data.citations
                .map(
                  (c, i) =>
                    `${i + 1}. ${c.title ?? "Untitled"} – ${c.url ?? "N/A"}${c.snippet ? `\n   > ${c.snippet}` : ""}`,
                )
                .join("\n");
          }

          // Format tool usage info
          let toolUsageText = "";
          if (data.server_side_tool_usage?.length) {
            toolUsageText =
              "\n\n## Tool Usage\n"
              + data.server_side_tool_usage
                .map((t) => `- ${t.type}: ${t.num_calls} calls`)
                .join("\n");
          }

          // Persist state
          this.setState({
            lastQuery: params.query,
            totalCalls: this.state.totalCalls + 1,
          });

          return {
            content: [
              {
                type: "text" as const,
                text: content + citationText + toolUsageText,
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Network error: ${(err as Error).message}`,
              },
            ],
            isError: true,
          };
        }
      },
    );
  }

  onStateUpdate(state: AppState | undefined, source: Connection | "server") {
    console.log("[XaiSearchMCP] state updated:", JSON.stringify(state));
  }
}

// ---------------------------------------------------------------------------
// Export – McpAgent.serve() handles Streamable HTTP transport automatically
// ---------------------------------------------------------------------------
export default XaiSearchMCP.serve("/mcp");
