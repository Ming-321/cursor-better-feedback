# MCP Feedback App — 设计文档
> 深度: Deep

## 背景

Cursor 自带的 AskQuestion 功能容易受到网络波动影响，需要一个更可靠的 feedback 工具实现用户与 agent 的交互。前期调研（见 `2026-03-10-cursor-policy-network-research.md`）确定了 MCP Apps + 降级处理的技术路线。

### 当前状态

- 项目尚无实现代码，仅有调研报告和参考项目（`reference/mcp-feedback-enhanced`）
- Cursor v2.6（2026-03-03）开始支持 MCP Apps，发布仅一周
- 参考项目使用 Python + FastAPI + WebSocket + 外部浏览器架构，与 MCP Apps 路线根本不同
- 已克隆官方 ext-apps SDK 到 `/tmp/mcp-ext-apps`，包含完整示例和 API 文档

### 约束

- **鲁棒性优先**：核心交互功能必须可靠，不追求功能丰富
- **远程兼容**：WSL、SSH 环境无需额外配置即可使用
- **易安装**：npm 一键安装，无系统级依赖
- **网络影响最小化**：stdio 传输，不开端口，不依赖外部网络

## 参考

| 来源 | 价值 |
|------|------|
| `/tmp/mcp-ext-apps/examples/basic-server-vanillajs/` | **项目起点**：标准 main.ts + server.ts 分离模式、双传输（stdio + HTTP）、Vite 构建、CSS 变量体系 |
| `/tmp/mcp-ext-apps/examples/transcript-server/` | 最接近 feedback 场景的示例（UI 收集用户输入 → 回传 server） |
| `/tmp/mcp-ext-apps/src/server/index.ts` | `registerAppTool`、`registerAppResource`、**`getUiCapability()`** 的 API 和 JSDoc |
| `/tmp/mcp-ext-apps/docs/patterns.md` | app-only tools（`visibility: ["app"]`）、host context 适配、sendMessage 等高级模式 |
| `reference/mcp-feedback-enhanced/server.py` | MCP 工具的 prompt engineering 模式（USAGE RULES），超时处理模式 |
| `docs/MCP-APP.md` | MCP Apps 官方文档总览 |
| `.cursor/skills/create-mcp-app/SKILL.md` | 标准 MCP App 构建流程和注意事项 |

## 设计决策

### 1. 技术栈

**TypeScript + MCP Apps SDK + 双传输（stdio + HTTP）**

- 语言：TypeScript（MCP Apps SDK 原生支持，前后端统一）
- MCP Server：`@modelcontextprotocol/sdk`（McpServer 类）
- MCP Apps UI：`@modelcontextprotocol/ext-apps`（App 类 + registerAppTool/Resource）
- 构建：Vite + `vite-plugin-singlefile`（UI 打包为单文件 HTML）
- 运行：`tsx`（开发）/ `node dist/index.js`（生产）
- 传输：`--stdio` 模式（Cursor 集成）+ HTTP 模式（开发测试，配合 basic-host）

### 2. 项目起点

**基于 `basic-server-vanillajs` 模板**，不从零构建。复用模板提供的：
- `main.ts` 入口（双传输切换逻辑）
- `server.ts` 的 `createServer()` 工厂模式
- `vite.config.ts`（singlefile 插件配置）
- `src/global.css`（host CSS 变量 fallback 体系）
- `package.json`（依赖版本和构建脚本）
- `tsconfig.json` / `tsconfig.server.json`

替换的部分：工具定义、UI 实现、新增 feedback-state 模块。

### 3. 核心工作流

```
LLM 调用 feedback(message="已完成XX任务")
    ↓
Server: 创建 pending feedback (Deferred)，开始阻塞等待
    ↓  ← 同时 →
Cursor: 预加载并渲染 iframe UI（通过 _meta.ui.resourceUri）
    ↓
UI: ontoolinput 收到 {message} → 展示 AI 消息 + 输入框
    ↓
用户: 输入反馈 → 点击提交
    ↓
UI: callServerTool("submit_feedback", {text: "用户反馈"})
    ↓
Server: resolve pending feedback → feedback 工具返回结果
    ↓
LLM: 收到用户反馈文字，继续工作
```

**选择阻塞工具而非 sendMessage 的理由**：
- 反馈作为工具结果返回，语义最清晰（LLM 调用 feedback() → 得到反馈）
- 与纯文本降级的接口一致（都是工具返回字符串）
- 无需额外 prompt engineering 让 LLM 理解"下一条消息是反馈"

### 4. 降级策略（智能检测）

**关键发现**：SDK 提供 `getUiCapability(clientCapabilities)` 函数，可在 `server.oninitialized` 时检测 Host 是否支持 MCP Apps。

```
server.oninitialized →
  getUiCapability(capabilities) 存在?
    ├── 是 → 注册带 UI 的 feedback 工具（阻塞 + iframe 交互）
    └── 否 → 注册纯文本版 feedback 工具（立即返回提示文字）
```

| 场景 | 检测方式 | 行为 |
|------|---------|------|
| 支持 MCP Apps 的 Host | `getUiCapability()` 返回非空 | iframe 内嵌 UI，阻塞等待用户输入 |
| 不支持 MCP Apps 的 Host | `getUiCapability()` 返回 undefined | 立即返回文本提示，无需等待超时 |

**优势**：不再依赖超时来判断降级，启动时即确定行为模式。

### 5. 工具设计

| 工具 | 对 LLM 可见 | 对 App 可见 | 参数 | 返回 |
|------|------------|------------|------|------|
| `feedback` | 是 | 是 | `message: string`（AI 消息）, `timeout?: number`（超时秒数，默认 600） | 用户反馈文本（+ 未来可扩展图片） |
| `submit_feedback` | **否**（`visibility: ["app"]`）| 是 | `text: string`, `images?: Image[]`（预留） | 确认 |

`submit_feedback` 的 images 字段预留接口（v1 传空数组，v2 支持图片上传）：
```typescript
images: z.array(z.object({
  name: z.string(),
  data: z.string(),      // base64
  mimeType: z.string()
})).optional()
```

`feedback` 工具的 description 包含 USAGE RULES（借鉴参考项目）：
- 在流程中完成阶段性任务、提问、回复时必须调用此工具获取反馈
- 收到非空反馈后根据内容调整行为并再次调用
- 用户明确表示"结束"时才可停止调用
- **message 应简洁**：MCP App 渲染空间有限，详细内容应先在对话中说明，message 仅作为关键摘要或提问
- 应通过 message 参数总结已完成的工作或提出具体问题

### 6. 反馈状态管理

```typescript
// feedback-state.ts
class FeedbackState {
  private current: {
    resolve: (text: string) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;

  waitForFeedback(timeoutMs: number): Promise<string>  // 创建 pending，等待 resolve 或 timeout
  submitFeedback(text: string): boolean                  // resolve current pending
  cancelPending(): void                                  // 取消旧 pending（新调用到来时）
}
```

单会话模型：同一时间只有一个 pending feedback。新的 `feedback` 调用自动取消旧的 pending（对旧调用返回取消消息）。

### 6.1 并发场景分析

| 场景 | 机制 | 冲突？ |
|------|------|--------|
| **跨工作区** | 每个工作区独立的 MCP server 进程 | 无冲突 |
| **本地 + SSH/WSL** | 每个 Cursor 窗口独立进程 | 无冲突 |
| **同一工作区多 agent** | 共享同一 MCP server 进程 | 新调用取消旧 pending |

MCP Apps (stdio) 不开端口，天然避免了端口冲突问题。同一工作区多 agent 的处理策略为"后来者优先"——新的 feedback 调用自动取消旧的 pending，旧调用收到取消消息。

未来若需支持多 agent 并行 feedback，可将 `FeedbackState` 从单会话改为 `Map<feedbackId, Pending>`，但 v1 不实现。

### 7. UI 设计

最小核心 UI：
- **消息展示区**：渲染 `message` 参数内容（通过 `ontoolinput` 获取）
- **文本输入区**：`<textarea>` 供用户输入反馈
- **提交按钮**：调用 `submit_feedback` 并显示成功状态
- **主题适配**：使用 host CSS 变量（`global.css`），支持 `applyDocumentTheme`、`applyHostStyleVariables`、`applyHostFonts`
- **安全区域**：响应 `safeAreaInsets`，适配不同 Host 环境

使用 Vanilla JS（无框架）。所有 handlers 在 `app.connect()` 前注册。

### 8. 项目结构

跟随官方 `basic-server-vanillajs` 模板的扁平结构：

```
cursor-better-feedback/
├── server.ts              # createServer(): feedback + submit_feedback 工具注册 + UI 资源注册
├── main.ts                # 入口: --stdio（Cursor）| HTTP（开发测试 basic-host）
├── feedback-state.ts      # 反馈状态管理（Deferred + timeout + 单会话）
├── mcp-app.html           # UI 入口 HTML（被 Vite 打包到 dist/）
├── src/
│   ├── mcp-app.ts         # UI 逻辑（App 类 + ontoolinput/ontoolresult + submit 交互）
│   ├── global.css         # Host 样式变量 fallback（复用模板）
│   └── mcp-app.css        # Feedback 专属样式
├── package.json           # 依赖 + 构建脚本（npm run build / serve / serve:stdio / dev）
├── tsconfig.json          # 全局 TS 配置
├── tsconfig.server.json   # Server 端编译配置
├── vite.config.ts         # vite-plugin-singlefile，INPUT=mcp-app.html
├── .gitignore
└── dist/                  # 构建输出
    ├── mcp-app.html       # 打包后的单文件 HTML（UI）
    ├── server.js          # 编译后的 server
    └── main.js            # 编译后的入口（bin，含 shebang）
```

### 9. 架构扩展点（为 Web UI 降级预留）

不在本次实现，但设计上保持以下扩展性：

- **状态管理独立**：`feedback-state.ts` 不依赖 MCP Apps API，未来 Web server 路由也能调用 `submitFeedback()`
- **入口已支持 HTTP**：`main.ts` 已有 HTTP transport 模式（用于开发测试），未来可扩展为 Web UI 服务端点
- **UI 可复用**：`mcp-app.html` 的核心交互逻辑可抽离为与通信层无关的模块，未来替换为 WebSocket bridge

### 10. 安装与使用

用户安装方式（目标，必须包含 `--stdio`，因为默认为 HTTP 模式）：
```json
{
  "mcpServers": {
    "feedback": {
      "command": "npx",
      "args": ["cursor-better-feedback", "--stdio"]
    }
  }
}
```

本地开发：
```json
{
  "mcpServers": {
    "feedback": {
      "command": "npx",
      "args": ["tsx", "/path/to/cursor-better-feedback/main.ts", "--stdio"]
    }
  }
}
```

开发测试（配合 basic-host）：
```bash
npm run build && npm run serve
# 另一终端: cd /tmp/mcp-ext-apps/examples/basic-host && SERVERS='["http://localhost:3001/mcp"]' npm start
```

### 11. 不实现的功能（YAGNI）

以下功能明确排除在第一版之外（但标注了接口预留状态）：

| 功能 | 接口预留 | 说明 |
|------|---------|------|
| 图片上传 | ✅ 已预留 | `submit_feedback` schema 含 `images?`，UI 预留位置 |
| 命令执行终端 | 否 | |
| 国际化（i18n） | 否 | |
| 会话持久化 | 否 | |
| 内存监控 | 否 | |
| 桌面应用（Tauri） | 否 | |
| Web UI 降级 | ✅ 架构预留 | `feedback-state.ts` 解耦，`main.ts` 已有 HTTP |
| 多会话并发 | ✅ 设计预留 | 可将 FeedbackState 改为 Map |
| Markdown 渲染 | 否 | 消息区暂用纯文本 |

---

## 实现计划

### Phase 0: 项目脚手架 & 构建配置

**涉及文件：**
- 新增: `package.json`（基于 vanillajs 模板适配，含完整依赖清单）
- 新增: `tsconfig.json`（复用模板）
- 新增: `tsconfig.server.json`（复用模板，include 加入所有 server 端文件）
- 新增: `vite.config.ts`（复用模板，无改动）
- 新增: `.gitignore`（复用模板，加入 `reference/`）
- 新增: `src/global.css`（复用模板，无改动）
- 新增: `mcp-app.html`（占位 HTML，仅含基本结构）
- 新增: `src/mcp-app.ts`（占位，仅 `console.log("placeholder")`）
- 新增: `server.ts`（占位，仅导出空 `createServer()` 返回 McpServer 实例）
- 新增: `main.ts`（占位，仅导入 server 并启动 stdio/HTTP）
- 新增: `feedback-state.ts`（占位，仅导出空 `FeedbackState` class）

**关键改动：**

`package.json`（含完整依赖，版本直接通过 `npm install` 解析）：
```json
{
  "name": "cursor-better-feedback",
  "version": "0.1.0",
  "type": "module",
  "description": "MCP feedback tool with interactive UI for Cursor",
  "main": "dist/server.js",
  "bin": { "cursor-better-feedback": "dist/main.js" },
  "scripts": {
    "build": "tsc --noEmit && cross-env INPUT=mcp-app.html vite build && tsc -p tsconfig.server.json",
    "serve": "npx tsx main.ts",
    "serve:stdio": "npx tsx main.ts --stdio",
    "dev": "cross-env NODE_ENV=development concurrently \"cross-env INPUT=mcp-app.html vite build --watch\" \"npx tsx --watch main.ts\""
  },
  "dependencies": {
    "@modelcontextprotocol/ext-apps": "^1.0.0",
    "@modelcontextprotocol/sdk": "^1.24.0",
    "cors": "^2.8.5",
    "express": "^5.1.0",
    "zod": "^4.1.13"
  },
  "devDependencies": {
    "@types/cors": "^2.8.19",
    "@types/express": "^5.0.0",
    "@types/node": "22.10.0",
    "concurrently": "^9.2.1",
    "cross-env": "^10.1.0",
    "tsx": "^4.0.0",
    "typescript": "^5.9.3",
    "vite": "^6.0.0",
    "vite-plugin-singlefile": "^2.3.0"
  }
}
```

`tsconfig.server.json` 的 include 调整为：
```json
"include": ["server.ts", "main.ts", "feedback-state.ts"]
```

注意：`tsc` 不会自动加 shebang。`main.ts` 首行需要 `#!/usr/bin/env node`，或构建后用脚本注入。`bin` 指向 `dist/main.js`，`npm` 会在安装时自动处理可执行权限。

`server.ts` 占位（使 Phase 0 可独立编译）：
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export function createServer(): McpServer {
  return new McpServer({ name: "Cursor Better Feedback", version: "0.1.0" });
}
```

`main.ts` 占位（复用模板双传输逻辑，调用 `createServer`）：
```typescript
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
async function main() {
  if (process.argv.includes("--stdio")) {
    await createServer().connect(new StdioServerTransport());
  } else {
    // HTTP 模式占位，Phase 1 完善
    console.log("HTTP mode not yet implemented");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

`feedback-state.ts` 占位：
```typescript
export class FeedbackState {}
```

`src/global.css` 直接复制自 `/tmp/mcp-ext-apps/examples/basic-server-vanillajs/src/global.css`。

**验证：**
在项目根目录执行 `npm install && npm run build`，预期：
- 无 TypeScript 编译错误
- `dist/mcp-app.html` 生成（单文件 HTML）
- 构建成功退出码 0

### Phase 1: Server 核心实现 + 降级检测

**涉及文件：**
- 修改: `feedback-state.ts`（从占位替换为完整 Deferred 实现）
- 修改: `server.ts`（从占位替换为完整工具注册 + `getUiCapability` 降级检测）
- 修改: `main.ts`（从占位替换为完整双传输入口）

**关键改动：**

`feedback-state.ts` — 完整 Deferred + timeout + 单会话：
```typescript
export class FeedbackState {
  private current: {
    resolve: (text: string) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;

  waitForFeedback(timeoutMs: number): Promise<string> {
    this.cancelPending("New feedback request received");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.current = null;
        reject(new Error("Feedback timeout"));
      }, timeoutMs);
      this.current = {
        resolve: (text: string) => { clearTimeout(timer); this.current = null; resolve(text); },
        reject: (err: Error) => { clearTimeout(timer); this.current = null; reject(err); },
        timer,
      };
    });
  }

  submitFeedback(text: string): boolean {
    if (!this.current) return false;
    this.current.resolve(text);
    return true;
  }

  cancelPending(reason?: string): void {
    if (this.current) {
      this.current.reject(new Error(reason ?? "Cancelled"));
    }
  }

  get hasPending(): boolean { return this.current !== null; }
}
```

`server.ts` — `createServer()` 含 `getUiCapability` 降级检测：
```typescript
import { getUiCapability, registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { FeedbackState } from "./feedback-state.js";

const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist") : import.meta.dirname;

const FEEDBACK_DESCRIPTION = `Interactive feedback collection tool.

USAGE RULES:
1. Call this tool when completing a milestone, encountering problems, or needing user input.
2. After receiving non-empty feedback, adjust behavior accordingly and call again.
3. Only stop calling when the user explicitly says "end" or "no more interaction needed".
4. Keep message concise — detailed content should be presented in the conversation first; message serves as a brief summary or question.
5. Summarize completed work or ask a specific question via the message parameter.`;

export function createServer(): McpServer {
  const server = new McpServer({ name: "Cursor Better Feedback", version: "0.1.0" });
  const state = new FeedbackState();
  const resourceUri = "ui://feedback/mcp-app.html";

  // 在 initialized 后检测 Host 是否支持 MCP Apps
  server.server.oninitialized = () => {
    const caps = server.server.getClientCapabilities();
    const uiCap = getUiCapability(caps as Parameters<typeof getUiCapability>[0]);
    const supportsUi = uiCap?.mimeTypes?.includes(RESOURCE_MIME_TYPE) ?? false;

    if (supportsUi) {
      // Host 支持 MCP Apps → 注册带 UI 的阻塞版
      registerAppTool(server, "feedback", {
        title: "Interactive Feedback",
        description: FEEDBACK_DESCRIPTION,
        inputSchema: { message: z.string(), timeout: z.number().optional().default(600) },
        _meta: { ui: { resourceUri } },
      }, async ({ message, timeout }): Promise<CallToolResult> => {
        try {
          const feedback = await state.waitForFeedback(timeout * 1000);
          return {
            content: [{ type: "text", text: feedback }],
            structuredContent: { message, feedback },
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Unknown error";
          return {
            content: [{ type: "text", text: `Feedback not received: ${msg}. Please provide your feedback in the next message.` }],
          };
        }
      });

      // submit_feedback（仅 App 可见）
      registerAppTool(server, "submit_feedback", {
        description: "Submit user feedback from the UI",
        inputSchema: {
          text: z.string(),
          images: z.array(z.object({ name: z.string(), data: z.string(), mimeType: z.string() })).optional(),
        },
        _meta: { ui: { resourceUri, visibility: ["app"] } },
      }, async ({ text }): Promise<CallToolResult> => {
        const ok = state.submitFeedback(text);
        return {
          content: [{ type: "text", text: ok ? "Feedback submitted" : "No pending feedback" }],
          structuredContent: { success: ok },
        };
      });

      // UI 资源注册
      registerAppResource(server, resourceUri, resourceUri,
        { mimeType: RESOURCE_MIME_TYPE },
        async (): Promise<ReadResourceResult> => {
          const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
          return { contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
        },
      );
    } else {
      // Host 不支持 MCP Apps → 注册纯文本版，立即返回提示
      server.registerTool("feedback", {
        title: "Interactive Feedback",
        description: FEEDBACK_DESCRIPTION,
        inputSchema: { message: z.string(), timeout: z.number().optional().default(600) },
      }, async ({ message }): Promise<CallToolResult> => {
        return {
          content: [{
            type: "text",
            text: `[Feedback UI unavailable] AI message: "${message}"\nPlease provide your feedback in your next message.`,
          }],
        };
      });
    }
  };

  return server;
}
```

`main.ts` — 完整双传输入口（复用模板模式）：
```typescript
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import { createServer } from "./server.js";

async function startStdioServer(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}

async function startStreamableHTTPServer(): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(cors());

  app.all("/mcp", async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  });

  const httpServer = app.listen(port, () => { console.log(`MCP server listening on http://localhost:${port}/mcp`); });
  const shutdown = () => { httpServer.close(() => process.exit(0)); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await startStdioServer();
  } else {
    await startStreamableHTTPServer();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

**验证：**
在项目根目录执行 `npm run build && npm run serve`，预期：
- Server 启动在 `http://localhost:3001/mcp`
- 用 basic-host 连接（见 Phase 2 验证步骤）可以看到 `feedback` 工具
- stdio 模式通过 `npm run serve:stdio` 启动正常

降级路径验证（纯 MCP client，不声明 UI 扩展能力）：
- 用不支持 MCP Apps 的 client（如 `@modelcontextprotocol/inspector` 或直接 HTTP POST）调用 `feedback`
- 预期：立即返回文本提示 `[Feedback UI unavailable]...`，不阻塞等待 UI

### Phase 2: UI 实现 & 端到端集成

**涉及文件：**
- 修改: `mcp-app.html`（从占位替换为完整 feedback UI 结构）
- 修改: `src/mcp-app.ts`（从占位替换为完整 App 生命周期 + 反馈交互）
- 新增: `src/mcp-app.css`（feedback 专属样式）
- 新增: `README.md`（安装与使用说明，覆盖 §10）

**关键改动：**

`mcp-app.html` 结构：
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <title>Feedback</title>
</head>
<body>
  <main class="main" id="main">
    <section class="message-area" id="message-area">
      <p id="ai-message">Waiting for message...</p>
    </section>
    <section class="feedback-area">
      <textarea id="feedback-input" placeholder="Enter your feedback..." rows="4"></textarea>
      <!-- 图片上传区域预留位置（v1 隐藏） -->
      <button id="submit-btn" type="button">Submit Feedback</button>
    </section>
    <div class="status-area" id="status-area" hidden>
      <p id="status-text"></p>
    </div>
  </main>
  <script type="module" src="/src/mcp-app.ts"></script>
</body>
</html>
```

`src/mcp-app.ts` 完整 UI 逻辑：
```typescript
import { App, applyDocumentTheme, applyHostStyleVariables, applyHostFonts, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import "./global.css";
import "./mcp-app.css";

const mainEl = document.getElementById("main") as HTMLElement;
const aiMessageEl = document.getElementById("ai-message")!;
const feedbackInput = document.getElementById("feedback-input") as HTMLTextAreaElement;
const submitBtn = document.getElementById("submit-btn") as HTMLButtonElement;
const statusArea = document.getElementById("status-area") as HTMLDivElement;
const statusText = document.getElementById("status-text")!;

function showStatus(msg: string, type: "success" | "error" | "warning") {
  statusText.textContent = msg;
  statusArea.hidden = false;
  statusArea.className = `status-area status-${type}`;
}

function applyHostContext(ctx: McpUiHostContext) {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets) {
    mainEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    mainEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    mainEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    mainEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }
}

const app = new App({ name: "Cursor Better Feedback", version: "0.1.0" });

app.ontoolinput = (params) => {
  const message = (params.arguments as { message?: string })?.message;
  if (message) aiMessageEl.textContent = message;
};
app.ontoolresult = () => { showStatus("Feedback submitted successfully", "success"); };
app.ontoolcancelled = (params) => { showStatus(`Feedback cancelled: ${params.reason ?? "unknown"}`, "warning"); };
app.onerror = console.error;
app.onhostcontextchanged = applyHostContext;
app.onteardown = async () => ({});

submitBtn.addEventListener("click", async () => {
  const text = feedbackInput.value.trim();
  if (!text) return;
  submitBtn.disabled = true;
  try {
    await app.callServerTool({ name: "submit_feedback", arguments: { text } });
  } catch (e) {
    showStatus("Failed to submit feedback", "error");
    submitBtn.disabled = false;
  }
});

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) applyHostContext(ctx);
});
```

`src/mcp-app.css` — 消息区、输入区、按钮、状态指示器样式，使用 host CSS 变量（`--color-*`、`--spacing-*`、`--border-radius-*`）。

`README.md` 包含：Cursor 配置 JSON 示例、本地开发命令、basic-host 测试步骤。

**验证：**

1. 在项目根目录执行 `npm run build`，预期 `dist/mcp-app.html` 包含完整 UI（CSS + JS 内联）。

2. 启动 server + basic-host 进行端到端测试：
   ```bash
   # 终端 1: 启动 server
   npm run build && npm run serve
   # 终端 2: 启动 basic-host
   cd /tmp/mcp-ext-apps/examples/basic-host && npm install && SERVERS='["http://localhost:3001/mcp"]' npm start
   ```
   打开 `http://localhost:8080`，选择 `feedback` 工具，输入 message，预期：
   - iframe 渲染 feedback UI，主题适配 host context
   - 消息区显示 AI message
   - 输入反馈文字并提交后，工具返回反馈文本
   - `safeAreaInsets` 正确应用为 `#main` 的 padding

3. 验证 stdio 模式可启动：
   ```bash
   npm run serve:stdio &
   # 观察进程启动无错误，然后 kill
   ```

## 状态
- [x] Phase 0: 项目脚手架 & 构建配置
- [x] Phase 1: Server 核心实现 + 降级检测
- [x] Phase 2: UI 实现 & 端到端集成
- [x] 验证与审阅
