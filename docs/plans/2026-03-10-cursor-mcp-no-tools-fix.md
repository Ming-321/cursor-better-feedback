# Cursor MCP 工具未显示修复
> 深度: Lightweight

## 问题分析
- 症状：Cursor 中 MCP 面板显示 “No tools, prompts, or resources”。
- 复现：项目级 `.cursor/mcp.json` 已指向 `dist/main.js --stdio`，但 Cursor 无法发现工具。
- 根因追踪：本地 MCP probe 连接后返回 `capabilities {}`，且 `tools/list` 报 `-32601 Method not found`。
- 结论：`feedback` 工具和 UI resource 在 `initialize` 完成后才注册，导致握手阶段没有向客户端声明 tools/resources 能力；同时项目级 `mcp.json` 未显式声明 `type: "stdio"`，增加了宿主识别失败风险。

## 修复方案
- 在 `createServer()` 阶段立即注册对 LLM 可见的 `feedback` 工具，确保握手时就暴露 `tools` capability。
- `feedback` 工具在调用时基于客户端能力动态决定：支持 MCP Apps 时等待 UI 反馈，不支持时返回文本降级提示。
- 仅把 `submit_feedback` 和 UI resource 作为附加能力提前注册，避免影响主工具发现。
- 更新项目级 `.cursor/mcp.json`，显式添加 `type: "stdio"`。

---

## 实现计划

### Phase 0: 修复 MCP 工具注册时机

**涉及文件：**
- 修改: `server.ts`

**关键改动：**
- 移除 `server.server.oninitialized` 中的延迟注册逻辑。
- 在 `createServer()` 中立即注册 `feedback` 工具、`submit_feedback` 工具和 UI resource。
- 将 UI 能力检测移动到 `feedback` 工具执行路径中，按调用时能力决定走 UI 阻塞等待或文本降级。

**验证：**
- 在 `/root/workspace/tools/cursor-better-feedback` 执行本地 MCP probe，预期 `listTools` 返回 `feedback`。

### Phase 1: 修正 Cursor 项目级配置并验证

**涉及文件：**
- 修改: `.cursor/mcp.json`

**关键改动：**
- 为 `feedback` server 增加 `type: "stdio"`。
- 保持现有 `node dist/main.js --stdio` 启动方式不变。

**验证：**
- 在 `/root/workspace/tools/cursor-better-feedback` 执行 `npm run build`，预期成功。
- 在 `/root/workspace/tools/cursor-better-feedback` 执行 MCP probe，预期 `capabilities.tools` 存在且 `tools/list` 返回 `feedback`。
- 检查 `.cursor/mcp.json` 为合法 JSON 且含 `type: "stdio"`。

## 状态
- [x] Phase 0: 修复 MCP 工具注册时机
- [x] Phase 1: 修正 Cursor 项目级配置并验证
- [x] 验证与审阅
