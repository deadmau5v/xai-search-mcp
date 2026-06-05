/**
 * XAI Search MCP Server
 *
 * A Streamable HTTP MCP server built with Cloudflare Agents SDK (McpAgent).
 * Implements the X_Search tool for deep searching x.com posts/articles
 * via xAI's Responses API with x_search built-in tool.
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
  MCP_OBJECT: DurableObjectNamespace;
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
    version: "2.0.0",
  });

  initialState: AppState = {
    lastQuery: "",
    totalCalls: 0,
  };

  async init() {
    // -----------------------------------------------------------------------
    // Tool: X_Search – Deep search on x.com via xAI Responses API
    // -----------------------------------------------------------------------
    try {
      this.server.tool(
        "X_Search",
        "Deep search x.com posts and articles using xAI Grok. "
          + "Supports filtering by handles, date ranges, and media understanding.",
        XSearchInputSchema,
        async (params) => {
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

          // Build x_search tool with optional parameters
          const xSearchTool: Record<string, unknown> = { type: "x_search" };
          if (params.allowed_x_handles?.length) {
            xSearchTool.allowed_x_handles = params.allowed_x_handles;
          }
          if (params.excluded_x_handles?.length) {
            xSearchTool.excluded_x_handles = params.excluded_x_handles;
          }
          if (params.from_date) {
            xSearchTool.from_date = params.from_date;
          }
          if (params.to_date) {
            xSearchTool.to_date = params.to_date;
          }
          if (params.enable_image_understanding) {
            xSearchTool.enable_image_understanding = true;
          }
          if (params.enable_video_understanding) {
            xSearchTool.enable_video_understanding = true;
          }

          // xAI Responses API request body
          const requestBody = {
            model: "grok-4.20-non-reasoning",
            input: params.query,
            tools: [xSearchTool],
          };

          try {
            const response = await fetch("https://api.x.ai/v1/responses", {
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
              id?: string;
              model?: string;
              output?: Array<{
                type?: string;
                content?: Array<{
                  type?: string;
                  text?: string;
                  annotations?: Array<{
                    type?: string;
                    url?: string;
                    title?: string;
                    start_index?: number;
                    end_index?: number;
                  }>;
                }>;
                name?: string;
                input?: string;
                call_id?: string;
                status?: string;
              }>;
              usage?: {
                input_tokens?: number;
                output_tokens?: number;
                total_tokens?: number;
                server_side_tool_usage_details?: {
                  x_search_calls?: number;
                  web_search_calls?: number;
                };
              };
            };

            // Extract the message content from the output array
            let contentText = "";
            const annotations: Array<{
              url: string;
              title: string;
            }> = [];

            for (const item of data.output ?? []) {
              if (item.type === "message" && item.content) {
                for (const c of item.content) {
                  if (c.type === "output_text" && c.text) {
                    contentText += c.text;
                  }
                  // Collect URL citations from annotations
                  if (c.annotations) {
                    for (const a of c.annotations) {
                      if (a.type === "url_citation" && a.url) {
                        annotations.push({
                          url: a.url,
                          title: a.title ?? String(a.start_index ?? ""),
                        });
                      }
                    }
                  }
                }
              }
            }

            if (!contentText) {
              contentText = "No results found.";
            }

            // Deduplicate annotations by URL
            const seenUrls = new Set<string>();
            const uniqueAnnotations = annotations.filter((a) => {
              if (seenUrls.has(a.url)) return false;
              seenUrls.add(a.url);
              return true;
            });

            // Format sources from annotations
            let sourcesText = "";
            if (uniqueAnnotations.length > 0) {
              sourcesText =
                "\n\n## Sources\n"
                + uniqueAnnotations
                  .map((a, i) => `${i + 1}. ${a.title} – ${a.url}`)
                  .join("\n");
            }

            // Format tool usage info
            let toolUsageText = "";
            const toolDetails = data.usage?.server_side_tool_usage_details;
            if (toolDetails && (toolDetails.x_search_calls || toolDetails.web_search_calls)) {
              const parts: string[] = [];
              if (toolDetails.x_search_calls) {
                parts.push(`- x_search: ${toolDetails.x_search_calls} calls`);
              }
              if (toolDetails.web_search_calls) {
                parts.push(`- web_search: ${toolDetails.web_search_calls} calls`);
              }
              toolUsageText = "\n\n## Tool Usage\n" + parts.join("\n");
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
                  text: contentText + sourcesText + toolUsageText,
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
    } catch (err) {
      console.error("[XaiSearchMCP] init() error:", err);
    }
  }

  onStateUpdate(state: AppState | undefined, source: Connection | "server") {
    console.log("[XaiSearchMCP] state updated:", JSON.stringify(state));
  }
}

// ---------------------------------------------------------------------------
// Export – McpAgent.serve() handles Streamable HTTP transport automatically
// ---------------------------------------------------------------------------
export default XaiSearchMCP.serve("/mcp");
