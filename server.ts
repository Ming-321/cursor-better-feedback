import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { FeedbackState } from "./feedback-state.js";

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_IMAGE_COUNT = 5;
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;

const feedbackImageSchema = z.object({
  name: z.string().max(256),
  data: z.string().max(MAX_IMAGE_BYTES),
  mimeType: z.string().refine((v) => ALLOWED_MIME_TYPES.has(v), {
    message: "Unsupported image type",
  }),
});

const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

const FEEDBACK_DESCRIPTION = `Interactive feedback collection tool.

USAGE RULES:
1. You MUST call this tool when completing a milestone, encountering problems, or needing user input — do not skip it.
2. After receiving non-empty feedback, adjust behavior accordingly and call this tool again to continue the dialogue.
3. Only stop calling when the user explicitly says "end", "done", or "no more interaction needed".
4. Keep message concise (1-2 sentences) — present detailed content in the conversation first; message serves as a brief summary or question.
5. Summarize completed work or ask a specific question via the message parameter.`;

const RESOURCE_URI = "ui://feedback/mcp-app.html";

const DEFAULT_TIMEOUT = Math.max(
  60,
  Math.min(3600, parseInt(process.env.FEEDBACK_TIMEOUT ?? "1200", 10) || 1200),
);

const RAW_FONT_SIZE = process.env.FEEDBACK_FONT_SIZE ?? "12px";
const FONT_SIZE = /^[\d.]+(px|rem|em|pt|%)$/.test(RAW_FONT_SIZE)
  ? RAW_FONT_SIZE
  : "12px";

const timeoutSchema = z
  .number()
  .int()
  .positive()
  .max(3600)
  .optional()
  .default(DEFAULT_TIMEOUT)
  .describe(`Timeout in seconds (1-3600, default ${DEFAULT_TIMEOUT})`);

function registerTools(server: McpServer, state: FeedbackState): void {
  registerAppTool(
    server,
    "feedback",
    {
      title: "Interactive Feedback",
      description: FEEDBACK_DESCRIPTION,
      inputSchema: {
        message: z.string().describe("Brief summary or question for the user"),
        timeout: timeoutSchema,
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ message, timeout }, extra): Promise<CallToolResult> => {
      try {
        const result = await state.waitForFeedback(
          timeout * 1000,
          (extra as { signal?: AbortSignal } | undefined)?.signal,
        );
        const content: CallToolResult["content"] = [
          { type: "text", text: result.text },
        ];
        if (result.images?.length) {
          for (const img of result.images) {
            content.push({
              type: "image",
              data: img.data,
              mimeType: img.mimeType,
            });
          }
        }
        return {
          content,
          structuredContent: { message, feedback: result.text },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `Feedback not received: ${msg}. Please provide your feedback in the next message.`,
            },
          ],
        };
      }
    },
  );

  registerAppTool(
    server,
    "submit_feedback",
    {
      description: "Submit user feedback from the UI",
      inputSchema: {
        text: z
          .string()
          .min(1, "Feedback text must not be empty")
          .describe("User feedback text"),
        images: z
          .array(feedbackImageSchema)
          .max(MAX_IMAGE_COUNT)
          .optional()
          .describe("Optional attached images"),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    },
    async ({ text, images }): Promise<CallToolResult> => {
      const validImages = Array.isArray(images) && images.length > 0
        ? (images as Array<{ name: string; data: string; mimeType: string }>)
        : undefined;
      const ok = state.submitFeedback({
        text: text as string,
        images: validImages,
      });
      return {
        content: [
          {
            type: "text",
            text: ok ? "Feedback submitted" : "No pending feedback",
          },
        ],
        structuredContent: { success: ok },
      };
    },
  );

  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE, _meta: { ui: { prefersBorder: false } } },
    async (): Promise<ReadResourceResult> => {
      let html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );
      html = html.replace(
        "</head>",
        `<style>:root{--feedback-font-size:${FONT_SIZE}}</style></head>`,
      );
      return {
        contents: [
          { uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );
}

export function createServer(sharedState?: FeedbackState): McpServer {
  const server = new McpServer({
    name: "Cursor Better Feedback",
    version: "0.1.0",
  });
  const state = sharedState ?? new FeedbackState();

  registerTools(server, state);

  return server;
}
