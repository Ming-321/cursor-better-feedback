# 项目级 Cursor MCP 测试配置
> 深度: Minimal

## 任务说明
为当前仓库完成本地依赖安装、构建产物生成，并写入项目级 Cursor MCP 配置，便于直接在当前工作区测试 `feedback` MCP server。

## 设计决策
- 使用项目级配置文件 `.cursor/mcp.json`，避免影响全局 Cursor 配置。
- 优先使用已构建产物 `dist/main.js`，减少运行时对 `tsx` 的依赖，测试路径更接近实际发布形态。
- 配置通过 `node dist/main.js --stdio` 启动 MCP server，符合仓库文档中的 Cursor 集成方式。

---

## 实现计划

### Phase 0: 安装、构建与项目级 MCP 配置

**涉及文件：**
- 修改: `package-lock.json`（如 `npm install` 带来锁文件更新）
- 新增: `.cursor/mcp.json`
- 使用: `dist/main.js`

**关键改动：**
- 在仓库根目录执行 `npm install`。
- 在仓库根目录执行 `npm run build`，生成最新 `dist/` 构建产物。
- 新增 `.cursor/mcp.json`，配置 `feedback` server 使用 `node /root/workspace/tools/cursor-better-feedback/dist/main.js --stdio` 启动。

**验证：**
- 在 `/root/workspace/tools/cursor-better-feedback` 执行 `npm run build`，预期构建成功。
- 在 `/root/workspace/tools/cursor-better-feedback` 执行 `timeout 5s node dist/main.js --stdio`，预期进程可启动且 5 秒内无报错退出。
- 检查 `.cursor/mcp.json` 文件内容存在且为合法 JSON。

## 状态
- [x] Phase 0: 安装、构建与项目级 MCP 配置
- [x] 验证与审阅
