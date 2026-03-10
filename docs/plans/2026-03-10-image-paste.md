# 粘贴图像功能
> 深度: Lightweight

## 问题分析

`submit_feedback` 的 images 字段已在 v0.1 设计时预留（`z.array(z.object({ name, data, mimeType })).optional()`），但全链路未实现：
- UI 无 paste 监听，无图片预览
- server handler 只取 `text`，忽略 `images`
- `FeedbackState.submitFeedback()` 只接受 `string`，无法传递图片
- `feedback` 工具返回仅 text content，不含 image content

需要打通：粘贴 → 预览 → 提交 → 状态传递 → LLM 返回 的完整链路。

## 修复方案

### 约束
- 交互：仅 Ctrl+V 粘贴（不支持拖拽/文件选择），监听绑在 `feedbackInput`（textarea）上
- 格式：接受所有 `image/*`（截图通常 PNG）
- 大小：单张 ≤ 5MB（raw），最多 5 张
- 编码：UI 侧使用 `FileReader.readAsDataURL()` 读取，提交前 strip `data:...;base64,` 前缀，仅传纯 base64 字符串
- MCP ImageContent 格式：`{ type: "image", data: <纯 base64>, mimeType: string }` — 已从 SDK 类型确认
- 提交策略：**文本必填，图片为可选附件**。不支持纯图片无文本提交（保持现有 `text.min(1)` schema 和 `text.trim()` 非空检查不变）

### 1. `feedback-state.ts`

`resolve` 类型从 `string` 扩展为结构体：

```typescript
interface FeedbackResult {
  text: string;
  images?: Array<{ name: string; data: string; mimeType: string }>;
}
```

`waitForFeedback` 返回 `Promise<FeedbackResult>`，`submitFeedback` 接受 `FeedbackResult`。

### 2. `server.ts`

`submit_feedback` handler 从参数中提取 `images` 并传入 `state.submitFeedback({ text, images })`。

`feedback` 工具返回时，除 text content 外，追加 image content：
```typescript
content: [
  { type: "text", text: result.text },
  ...result.images?.map(img => ({ type: "image" as const, data: img.data, mimeType: img.mimeType })) ?? [],
]
```

### 3. `src/mcp-app.ts`

- 在 textarea（`feedbackInput`）上监听 `paste` 事件
- `clipboardData.items` 中筛选 `type.startsWith("image/")`
- `FileReader.readAsDataURL()` 读取 → 存入 `pendingImages: Array<{name, data, mimeType, dataUrl}>`
- 渲染缩略图条（`<img>` + 删除按钮）
- 超过 5MB 或 5 张时 showStatus 提示
- 提交时 `arguments: { text, images: pendingImages.map(...) }`
- `resetUI()` 清空 pendingImages

### 4. `mcp-app.html`

在 textarea 和按钮之间添加图片预览容器：
```html
<div class="image-preview" id="image-preview" hidden></div>
```

### 5. `src/mcp-app.css`

图片预览容器样式：横向滚动的缩略图条，每张 60×60，右上角删除按钮。

---

## 实现计划

### Phase 0: Backend — 状态管理与 Server 层

**涉及文件：**
- 修改: `feedback-state.ts`（扩展 resolve 类型为结构体）
- 修改: `server.ts`（submit_feedback 传递 images，feedback 返回 image content）

**关键改动：**

`feedback-state.ts` — 新增类型，修改方法签名：

```typescript
export interface FeedbackImage {
  name: string;
  data: string;      // 纯 base64
  mimeType: string;
}

export interface FeedbackResult {
  text: string;
  images?: FeedbackImage[];
}
```

- `waitForFeedback` 返回类型从 `Promise<string>` 改为 `Promise<FeedbackResult>`
- `submitFeedback` 参数从 `(text: string)` 改为 `(result: FeedbackResult)`
- `current.resolve` 类型从 `(text: string) => void` 改为 `(result: FeedbackResult) => void`

`server.ts` — `submit_feedback` handler 提取 images：

```typescript
async ({ text, images }): Promise<CallToolResult> => {
  const ok = state.submitFeedback({
    text: text as string,
    images: images as FeedbackImage[] | undefined,
  });
  // ...
}
```

`feedback` handler 返回 image content：

```typescript
const result = await state.waitForFeedback(timeout * 1000, signal);
const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
  { type: "text", text: result.text },
];
if (result.images?.length) {
  for (const img of result.images) {
    content.push({ type: "image", data: img.data, mimeType: img.mimeType });
  }
}
return { content, structuredContent: { message, feedback: result.text } };
```

**验证：**
在项目根目录执行 `npx tsc -p tsconfig.server.json --noEmit`，预期无编译错误（仅检查 server 端文件，不依赖 UI 代码状态）。

### Phase 1: Frontend — 粘贴交互与图片预览

**涉及文件：**
- 修改: `mcp-app.html`（添加图片预览容器）
- 修改: `src/mcp-app.css`（缩略图条、删除按钮样式）
- 修改: `src/mcp-app.ts`（paste 事件处理、预览管理、提交携带 images）

**关键改动：**

`mcp-app.html` — 在 textarea 和按钮之间添加：

```html
<div class="image-preview" id="image-preview" hidden></div>
```

`src/mcp-app.ts` — 核心新增逻辑：

```typescript
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_IMAGES = 5;

interface PendingImage {
  name: string;
  data: string;      // 纯 base64
  mimeType: string;
  dataUrl: string;   // 完整 data URL，用于预览
}

const pendingImages: PendingImage[] = [];

// paste 事件监听（绑在 feedbackInput 上）
feedbackInput.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (!item.type.startsWith("image/")) continue;
    e.preventDefault(); // 阻止图片被粘贴为文本
    const file = item.getAsFile();
    if (!file) continue;
    if (file.size > MAX_IMAGE_SIZE) { showStatus(`图片过大 (${(file.size/1024/1024).toFixed(1)}MB > 5MB)`, "warning"); continue; }
    if (pendingImages.length >= MAX_IMAGES) { showStatus(`最多 ${MAX_IMAGES} 张图片`, "warning"); continue; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const [prefix, base64] = dataUrl.split(",", 2);
      const mimeType = prefix.match(/data:(.*?);/)?.[1] ?? file.type;
      pendingImages.push({
        name: file.name || `image-${Date.now()}.${mimeType.split("/")[1]}`,
        data: base64,
        mimeType,
        dataUrl,
      });
      renderImagePreview();
    };
    reader.readAsDataURL(file);
  }
});

function renderImagePreview() {
  const container = document.getElementById("image-preview")!;
  container.innerHTML = "";
  container.hidden = pendingImages.length === 0;
  pendingImages.forEach((img, i) => {
    const item = document.createElement("div");
    item.className = "image-preview-item";
    item.innerHTML = `<img src="${img.dataUrl}" alt="${img.name}">`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "remove-btn";
    btn.textContent = "×";
    btn.addEventListener("click", () => removeImage(i));
    item.appendChild(btn);
    container.appendChild(item);
  });
}

function removeImage(index: number) {
  pendingImages.splice(index, 1);
  renderImagePreview();
}
```

提交时携带 images：

```typescript
const result = await app.callServerTool({
  name: "submit_feedback",
  arguments: {
    text,
    ...(pendingImages.length > 0 && {
      images: pendingImages.map(({ name, data, mimeType }) => ({ name, data, mimeType })),
    }),
  },
});
```

`resetUI()` 中清空：`pendingImages.length = 0; renderImagePreview();`

`src/mcp-app.css` — 缩略图条样式：

```css
.image-preview {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding: 4px 0;
}

.image-preview-item {
  position: relative;
  flex-shrink: 0;
  width: 60px;
  height: 60px;
  border-radius: 3px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--color-text-primary, #e0e0e0) 20%, transparent);
}

.image-preview-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-preview-item .remove-btn {
  position: absolute;
  top: 0;
  right: 0;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 0 0 0 3px;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  font-size: 10px;
  line-height: 16px;
  cursor: pointer;
  padding: 0;
}
```

**验证：**

1. 构建验证：在项目根目录执行 `npm run build`，预期无编译错误、`dist/mcp-app.html` 生成、退出码 0。

2. 端到端手动验证：
   - 在项目根目录执行 `npm run serve:http`
   - 启动 basic-host：`cd /tmp/mcp-ext-apps/examples/basic-host && SERVERS='["http://localhost:3001/mcp"]' npm start`
   - 打开 `http://localhost:8080`，选择 `feedback` 工具，输入 message
   - 在 textarea 中 Ctrl+V 粘贴截图，预期：
     - 缩略图条出现，显示 60×60 预览
     - 点击 × 可删除
     - 粘贴超过 5 张时显示 warning
   - 输入文本并点击 Submit，预期：
     - 工具返回 text content + image content
     - UI 显示 Success 状态

## 状态
- [x] Phase 0: Backend — 状态管理与 Server 层
- [x] Phase 1: Frontend — 粘贴交互与图片预览
- [x] 验证与审阅
