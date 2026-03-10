# Cursor 封禁策略与网络稳定性调研报告
> 深度: Lightweight

## 问题分析

本调研为 cursor-better-feedback 项目的前置信息收集，回答两个核心问题：
1. Cursor 对 MCP feedback 工具是否有封禁/限制风险？
2. MCP 工具和 Shell 命令在网络波动下的行为差异是什么？

---

## 一、Cursor 封禁与限制策略

### 1.1 计费模型（2025年6月后）

| 计划 | 费用 | 额度 | 超限处理 |
|------|------|------|----------|
| Pro | $20/月 | $20 frontier model 用量 | 短暂宽限期后限速，可付费追加 |
| Pro+ | $60/月 | 3x Pro 额度 | 同上 |
| Ultra | $200/月 | 20x Pro 额度 | 同上 |
| Auto 模式 | 包含在 Pro | 无限制 | 自动路由到不同 frontier 模型 |

**关键变化**：从按请求计费（500次/月）转为按 token 用量计费。$20 额度约覆盖 225 Sonnet 4 / 550 Gemini / 650 GPT 4.1 请求。

**来源**：https://cursor.com/en-US/blog/june-2025-pricing

### 1.2 MCP Feedback 工具封禁风险

**结论：风险极低。**

| 维度 | 调查结果 |
|------|----------|
| 官方态度 | MCP 是 Cursor 核心功能，官方提供集成文档、工具目录和白名单；ToS 未禁止 feedback 工具 |
| 社区案例 | 未发现因使用 interactive-feedback-mcp 或 mcp-feedback-enhanced 被封禁的案例 |
| 技术原理 | 同一请求内的多次 tool call 不计为独立请求，feedback 工具利用的是官方支持的机制 |
| Windsurf 对比 | Windsurf 封禁了 node 脚本方案（Permission denied），但 Cursor 无类似封禁历史 |
| 已知封禁 | Cursor 仅打击过试用机 ID 重置等明确滥用行为；国区地理限制导致的 Unauthorized 非针对工具 |

**风险因素**：
- 若将来 Cursor 改变计费方式（如按 tool call 计费），feedback 工具的优势可能消失
- 极端滥用（如自动循环调用以无限延长会话）可能触发通用监控
- 新版本可能引入更严格的 tool call 限制

### 1.3 MCP 工具数量限制

- 实际上限约 **40 个活跃 MCP 工具**（v50.03 起可单独禁用）
- 超过上限导致性能下降和工具选择准确率降低
- 社区论坛讨论表明上限已扩展到 80+ 工具

### 1.4 安全策略

- 新增 MCP server 需用户批准
- 修改已有 MCP server 定义需重新批准（CVE-2025-54136 修复后）
- 企业版支持 MCP 白名单（仅允许列表内 server）
- Agent 默认使用 MCP 工具前需确认（可开启 auto-run）

---

## 二、MCP 工具与 Shell 命令网络稳定性对比

### 2.1 架构层面的网络依赖

```
用户操作 → Cursor IDE → [网络] → LLM 云端（决策 + 生成 tool call）
                                        ↓
                              [网络] ← tool call 指令返回
                                        ↓
                              本地执行（stdio MCP / Shell）
                              或网络执行（SSE MCP）
                                        ↓
                              [网络] → 结果发送回 LLM
```

**核心事实**：无论使用 MCP 还是 Shell，agent 的 tool call 决策都依赖网络（LLM 在云端）。网络中断时，两者都无法获得新的 LLM 指令。

### 2.2 两种 MCP 传输协议

| 特性 | stdio（本地进程） | SSE/HTTP（网络端点） |
|------|-------------------|---------------------|
| 启动方式 | Cursor 作为子进程管理 | 连接到 URL 端点 |
| 网络依赖 | 无（stdin/stdout 管道） | 需要 HTTP 连接 |
| 断连影响 | 几乎不受影响 | 频繁报 "Not connected"、Body Timeout |
| 重连机制 | Cursor 管理进程生命周期 | 无自动指数退避重连，需手动 toggle |
| 适用场景 | 本地工具（feedback、文件操作） | 远程服务（数据库、API） |

### 2.3 网络中断时的具体行为

| 场景 | MCP (stdio) | MCP (SSE) | Shell 命令 |
|------|-------------|-----------|-----------|
| 工具执行中网络断 | 工具可完成执行，结果暂存 | 连接直接中断 | 工具可完成执行，结果暂存 |
| 结果返回 LLM | 失败，会话 stall | 失败，会话 stall | 失败，会话 stall |
| 恢复方式 | 等网络恢复或重启会话 | 手动 toggle + 等网络 | 等网络恢复或重启会话 |
| 错误提示 | 聊天窗口显示错误，可重试 | "Not connected" | "Connection Error: stalled" |

**关键结论**：stdio MCP 和 Shell 在「工具执行」层面的网络稳定性**完全一致**——都是本地进程，不依赖网络。瓶颈在于「LLM 决策 → 工具调用 → 结果回传」这条链路必须走网络。

### 2.4 已知 MCP 稳定性问题（Cursor 端）

| 问题 | 影响 | 状态 |
|------|------|------|
| 单个 MCP server 崩溃时所有连接被断 | 级联故障 | 已知 Bug |
| 自动重连机制并行重试后失败 | 需手动 toggle | 已知 Bug |
| Sleep/Wake 后 DNS 失败导致 MCP 断连 | 需重载窗口 | 已知 Bug |
| Tool call 路由到错误 MCP server | 数据完整性风险 | 已知 Bug |
| mcp.json 修改触发多重重连 | 连接不稳定 | 已知 Bug |

### 2.5 WSL/SSH 远程场景

| 方面 | 详情 |
|------|------|
| MCP server 运行位置 | 默认在 Windows host 侧（Cursor 所在机器），除非 command 前缀 `wsl.exe` 则在 Linux 侧 |
| WSL MCP 调用 | 直接调用失败，需通过 `wsl` 命令包装 |
| SSH Remote MCP | "Client closed" 频发，命令可能在本地而非远程执行 |
| mcp-feedback-enhanced Web UI | 适合远程场景，通过端口转发（8765）访问 |
| mcp-feedback-enhanced Desktop | 基于 Tauri，远程/headless 不推荐 |
| 多窗口支持 | Web UI 支持多标签/session，v2.1.1 修复多屏定位 |
| 已知问题 | 浏览器无法自动启动（headless）、WSL2 DNS 导致超时、PATH 冲突 |

---

## 三、MCP Apps — 全新技术路线（2026年3月发现）

### 3.1 重大发现

Cursor v2.6（**2026年3月3日发布，一周前**）正式支持了 **MCP Apps** 扩展。这是 MCP 协议的官方扩展，允许工具在**聊天面板内直接渲染交互式 HTML/JS 界面**（沙箱 iframe），无需打开外部网页或 GUI 窗口。

**这彻底改变了 feedback 工具的技术路线选择。**

### 3.2 MCP Apps 核心机制

```
Agent 调用工具 → MCP Server 返回结果 + ui:// 资源引用
                    ↓
Cursor 获取 UI 资源 → 在聊天面板内渲染沙箱 iframe
                    ↓
用户在 iframe 中交互 → 通过 postMessage JSON-RPC 与 MCP Server 双向通信
                    ↓
App 可调用 Server 工具、更新 Model 上下文、发送后续消息
```

**关键特性**：
- **聊天内嵌 UI**：不需要打开外部网页或桌面窗口
- **沙箱安全**：iframe 隔离，无法访问宿主页面
- **双向通信**：App ↔ Host 通过 postMessage JSON-RPC
- **优雅降级**：不支持 MCP Apps 的客户端仍收到文本响应
- **UI 预加载**：工具描述中声明 `_meta.ui.resourceUri`，Host 可预加载

### 3.3 对 feedback 工具的意义

| 维度 | 传统 MCP 方案（外部 Web UI） | MCP Apps 方案（聊天内嵌） |
|------|---------------------------|-------------------------|
| 用户体验 | 需打开独立网页 | 直接在聊天面板交互 |
| 远程开发 | 需端口转发 | 无需额外配置（UI 在 Cursor 内渲染） |
| 多窗口冲突 | 需端口/锁机制 | 每个聊天会话独立 |
| 安装复杂度 | 需考虑 GUI 依赖 | 纯 HTML/JS，无 GUI 依赖 |
| WSL 兼容 | 需 wsl 包装 + 浏览器 | MCP server stdio 运行，UI 在 Cursor 端渲染 |
| 封禁风险 | 低 | 极低（官方新功能） |

### 3.4 社区反馈与实际体验（截至 2026-03-10）

**MCP Apps 发布仅一周，深度使用反馈极为有限。** 以下从多个维度综合分析：

#### Cursor 官方论坛反馈

- **v2.6 公告帖**（forum.cursor.com/t/153479）：504 次浏览，社区反响平淡，无深度使用报告
- **MCP Apps 专帖**（forum.cursor.com/t/153482）：发布后暂无用户报告实际 Bug 或使用体验
- **MCP 工具综合体验帖**（forum.cursor.com/t/148437）：多名用户反馈 MCP 工具通用问题：
  - LLM 经常不主动调用 MCP 工具，即使在 rules 中指定也不稳定
  - 需要手动在 prompt 中提到具体工具名才会使用
  - 多数用户最终倾向用 CLI 命令替代 MCP（"CLI 更可靠、消耗更少 token"）
  - MCP 的"黑盒"性质让大公司用户不安
- **MCP 基础层持续不稳定**：v2.5.20 后服务器崩溃、工具丢失、OAuth token 不刷新等问题频繁报告

#### 社交媒体和开发者社区

- X/Twitter 开发者正面评价 "chat UI 中显示 MCP Apps 严重改变 workflow"
- Reddit "一周内构建 50 个 MCP Apps"，构建门槛低
- MCPJam 提供了 MCP Apps 模拟器和详细教程（cute-dogs-server 示例）
- Storybook MCP 已集成 MCP Apps 支持
- Marketplace 中 Amplitude/Figma/tldraw 等生产级插件已可用

#### MCP Apps 技术实现（来自 MCPJam 教程验证）

构建一个 MCP App 需要：

1. **MCP Server**：注册工具时声明 `_meta: { "ui/resourceUri": "ui://tool-name" }`
2. **UI 资源**：注册 `ui://` URI，mimeType 为 `text/html+mcp`，内容为编译后的 HTML bundle
3. **数据流**：工具返回 `structuredContent` → Host 传递给 iframe → UI 通过 `ontoolresult` 获取
4. **双向通信**：UI 调用 `app.callTool()` → Host 中转到 MCP Server → 返回结果
5. **SDK**：`@modelcontextprotocol/ext-apps` 提供 React/Vue/Svelte/Vanilla JS 支持

#### 已知限制和风险

| 风险 | 详情 | 严重程度 |
|------|------|----------|
| 极新 | v2.6 一周前发布，论坛无深度使用报告 | 高 |
| iframe 尺寸 | 受 chat 面板限制，支持 resize 但无上限文档 | 中 |
| 输入框焦点 | iframe 嵌入的经典问题，Cursor 优化未知 | 中 |
| LLM 不主动调用 | 论坛反复报告 LLM 不自动使用 MCP 工具 | 高（feedback 场景需 prompt 引导） |
| MCP 基础层不稳 | 级联断连、工具丢失、自动重连失败 | 高（影响所有 MCP 方案） |
| 图片渲染 | 已报告 MCP 返回图片在 chat 中不渲染 | 中 |
| WSL/SSH | 无 MCP Apps 专属报告，stdio transport 理论无问题 | 低 |

#### MCP Elicitation（2025年6月新增协议）

- MCP 协议新增 `elicitation/create` 机制，允许 server 在工具执行中暂停并请求用户输入
- 支持 JSON Schema 定义表单字段（string/number/boolean/enum）
- 在单次请求和会话中完成，无需额外 LLM 往返
- 已有提案将 MCP Apps UI 绑定到 elicitation 请求（ext-apps #511）
- **Cursor 是否支持 elicitation 尚未确认**，需后续实测

### 3.5 已有 feedback 类 MCP 工具对比

| 工具 | UI 方式 | MCP Apps | 备注 |
|------|---------|----------|------|
| mcp-feedback-enhanced（含用户 fork） | 外部网页 + Tauri 桌面 | 否 | 功能最全，SSH 适配，但需开端口 |
| interactive-feedback-mcp | 外部网页 | 否 | 轻量，多 IDE 支持 |
| noopstudios/interactive-feedback-mcp | 原生 GUI (Qt) | 否 | 跨平台原生 |
| Human-In-The-Loop MCP | 原生对话框 | 否 | 多种输入类型（文本/确认/多选） |

**结论**：目前**尚无** feedback 工具使用 MCP Apps 在聊天面板内嵌 UI。所有现有方案均为外部网页或桌面窗口。这是一个空白机会，但也意味着我们需要自行踩坑。

### 3.6 Cursor Hooks 作为补充

Cursor Hooks（`preToolUse`/`postToolUse`）可用于观察和控制 agent 行为：
- Exit code 2 可阻止工具执行（deny）
- 可实现 human-in-the-loop 审批门控
- 已知限制：AskQuestion 工具不触发 hooks

---

## 四、对 cursor-better-feedback 项目的启示

### 4.1 技术路线对比（含新路线）

| 因素 | MCP + 外部 Web UI | MCP Apps（聊天内嵌）| Node 脚本 |
|------|-------------------|-------------------|-----------|
| 封禁风险 | 低 | 极低（官方新功能） | 中 |
| 用户体验 | 需打开网页 | 聊天内直接交互 | 需额外窗口 |
| 网络依赖 | stdio 无依赖 | stdio 无依赖 | 本地进程 |
| 远程开发 | 需端口转发 | 原生支持 | 需额外处理 |
| 多窗口 | 需端口区分 | 原生支持 | 需额外机制 |
| 安装复杂度 | 中（Python + deps） | 低（纯 JS） | 中（vsix/npm） |
| 成熟度 | 高 | 低（一周前） | 高 |
| 降级能力 | 纯文本 MCP | 自动降级为文本 | 无 |

### 4.2 推荐路线

**主方案：MCP Apps（聊天内嵌 UI）**
- 最佳用户体验，完美解决"打开网页麻烦"的问题
- 远程开发/WSL/多窗口原生支持
- 官方支持，封禁风险极低

**降级方案：传统 MCP 纯文本反馈**
- 当 MCP Apps 不可用时自动回退
- 保证基本的 feedback 功能

### 4.3 关键设计约束

1. **必须使用 stdio 传输**：避免 SSE 的网络稳定性问题
2. **MCP Apps + 优雅降级**：检测 Host 是否支持 MCP Apps，不支持时回退文本
3. **网络瓶颈在 LLM 链路**：feedback 工具减少不必要的 LLM 往返
4. **进程健壮性**：Cursor 的 MCP 重连有 Bug，server 应尽量不崩溃
5. **轻量依赖**：尽量用 Vanilla JS 或轻量框架，减少安装复杂度

### 4.4 现有方案参考价值

| 方案 | 月下载量 | 参考价值 |
|------|---------|---------|
| mcp-feedback-enhanced | ~5,785 | Web UI 的 HTML/JS 实现、SSH 环境检测逻辑、多语言支持 |
| interactive-feedback-mcp | 更高 | MCP 工具接口设计、prompt engineering 建议 |
| MCP Apps 官方示例 | — | transcript-server（语音转文字）最接近 feedback 场景 |

---

## 来源

- Cursor 官方定价说明：https://cursor.com/en-US/blog/june-2025-pricing
- Cursor MCP 文档：https://cursor.com/help/customization/mcp
- MCP 断连问题：https://github.com/cursor/cursor/issues/3994
- MCP 重连 Bug：https://forum.cursor.com/t/auto-reconnection-to-mcp-servers-is-broken/141497
- MCP 级联故障：https://forum.cursor.com/t/cursor-mcp-server-subsystem-is-totally-snafu/143156
- 网络中断行为：https://forum.cursor.com/t/connection-error-stalled-agent-requests-for-hours/149395
- WSL MCP 使用：https://dogpawhat.tech/blog/mcp-cursor-wsl/
- SSH MCP 问题：https://forum.cursor.com/t/mcp-failed-in-ssh-remote-server/56058
- mcp-feedback-enhanced：https://github.com/Minidoracat/mcp-feedback-enhanced
- interactive-feedback-mcp：https://github.com/ISimon3/interactive-feedback-mcp
- Cursor ToS：https://cursor.com/en-US/terms-of-service
- 工具调用网络问题：https://forum.cursor.com/t/tool-calls-failing-network-related/83425
- Cursor MCP 安全漏洞：https://research.checkpoint.com/2025/cursor-vulnerability-mcpoison/

## 后续可探索方向

- **MCP Apps 实测**：在 Cursor v2.6 中实际构建一个最小 MCP Apps 原型，验证 feedback 输入框的可用性
- **MCP Elicitation 支持**：验证 Cursor 是否已支持 elicitation/create 协议
- **MCP Apps + Elicitation 结合**：跟踪 ext-apps #511 提案进展
- **WSL 实测**：在当前 WSL 环境中测试 MCP Apps 渲染行为
- Cursor Background Agents 对 MCP Apps 的支持情况
- Cursor 未来计费模式变化的可能性
