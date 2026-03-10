# cursor-better-feedback

[English](README.md) | 中文

为 [Cursor](https://cursor.com) 打造的 MCP 反馈工具，提供聊天面板内的交互式 UI。替代内置的 AskQuestion，基于 [MCP Apps](https://modelcontextprotocol.io) 实现更稳定的人机交互。

| 等待反馈 | 提交成功 |
|:---:|:---:|
| ![Before](https://raw.githubusercontent.com/Ming-321/cursor-better-feedback/master/figures/feedback-before.png) | ![After](https://raw.githubusercontent.com/Ming-321/cursor-better-feedback/master/figures/feedback-after.png) |

## 功能特性

- 交互式反馈 UI，直接渲染在 Cursor 聊天面板中（MCP Apps iframe）
- 消息区域支持 Markdown 渲染（原始 HTML 已过滤 + DOMPurify 双层安全防护）
- 超时时间和字体大小可通过环境变量配置
- 自动适配宿主主题/样式
- 快捷键：`Ctrl+Enter` / `Cmd+Enter` 提交
- 双传输模式：stdio（默认，用于 Cursor）+ HTTP（仅开发用）

## 安装

在 Cursor MCP 配置文件（`.cursor/mcp.json`）中添加：

```json
{
  "mcpServers": {
    "feedback": {
      "command": "npx",
      "args": ["cursor-better-feedback"],
      "env": {
        "FEEDBACK_TIMEOUT": "1200",
        "FEEDBACK_FONT_SIZE": "12px"
      }
    }
  }
}
```

或使用本地路径：

```json
{
  "mcpServers": {
    "feedback": {
      "command": "node",
      "args": ["/path/to/cursor-better-feedback/dist/main.js"]
    }
  }
}
```

### 配置项

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FEEDBACK_TIMEOUT` | `1200` | 默认超时时间，单位秒（60-3600） |
| `FEEDBACK_FONT_SIZE` | `12px` | UI 字体大小（如 `12px`、`0.875rem`） |

## 工作原理

1. LLM 在需要用户输入时调用 `feedback(message="...")`
2. Cursor 在 iframe 中渲染反馈 UI（MCP Apps）
3. 用户输入反馈并点击提交（或按 `Ctrl+Enter`）
4. UI 调用 `submit_feedback` 解决挂起的工具调用
5. LLM 收到反馈文本，继续执行

## 推荐 Cursor 规则

将以下规则添加到 `.cursor/rules/feedback.mdc`，启用反馈驱动交互和自动重试：

```markdown
---
description: "Feedback MCP 交互协议与弹性策略"
globs:
alwaysApply: true
---

# Feedback 交互协议

## 交互规范（强制）

- **必须**使用 `feedback` 工具进行确认/选择 — 禁止用纯文本提问代替
- 讨论阶段只用自然语言，不输出大段代码（伪代码/最小片段辅助说明除外）
- 遇到任何不明确或缺失的信息，**立即**向用户确认，不得自行假设

## 回合结束（强制）

每次回复结束后**必须**调用 `feedback`："还有其他需要吗？你也可以直接输入下一个指令。"
- 用户表示"结束" / "完成" / "不需要了" → 结束对话
- 其他回复 → 作为下一轮指令继续
- **唯一豁免**：用户本轮已明确表示结束

## 弹性策略

1. 优先调用 `feedback` 工具
2. 如果返回 `Tool not found` 或连接错误：
   - 等待 5 秒，最多重试 **3 次**
3. 3 次重试均失败 → 降级为内置 `AskQuestion`

网络波动可能导致 Cursor 临时断开所有 MCP 连接。
feedback 服务（stdio）本身不受影响，Cursor 通常会自动重连。
```

## 已知限制

- 同一时间只支持一个待处理的反馈会话。新的 `feedback` 调用会取消之前的挂起会话。不支持多 Agent 并发反馈。
- UI 的上下内边距由 Cursor 的 iframe 容器控制，无法在应用内调整。

## 环境要求

- Cursor v2.6+（需要 MCP Apps 支持）
- Node.js >= 18

## 传输模式

- **stdio**（默认）：用于 Cursor 集成，通过标准输入/输出通信。
- **HTTP**（`--http` 参数）：仅用于开发/测试，绑定 `127.0.0.1:3001`，不建议生产使用。

## 本地开发

```bash
npm install
npm run build
npm run serve          # stdio 模式（默认）
npm run serve:http     # HTTP 模式（仅本地，用于测试）
npm run dev            # 开发模式（监听 + HTTP）
```

### 使用 basic-host 测试

```bash
# 终端 1：以 HTTP 模式启动服务
npm run build && npm run serve:http

# 终端 2：启动 basic-host 测试工具
cd /tmp/mcp-ext-apps/examples/basic-host
npm install
SERVERS='["http://localhost:3001/mcp"]' npm start

# 在浏览器中打开 http://localhost:8080
```

## 许可证

[MIT](LICENSE)
