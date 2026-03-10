import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import DOMPurify from "dompurify";
import { marked } from "marked";
import "./global.css";
import "./mcp-app.css";

marked.setOptions({
  breaks: true,
  gfm: true,
  async: false,
});
marked.use({
  renderer: { html: () => "" },
});

const purify = DOMPurify(window);
purify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

function sanitizeHtml(dirty: string): string {
  return purify.sanitize(dirty, {
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "del", "code", "pre",
      "ul", "ol", "li", "blockquote", "a",
      "h1", "h2", "h3", "h4", "h5", "h6",
    ],
    ALLOWED_ATTR: ["href"],
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  });
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_IMAGES = 5;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const DATA_URL_RE = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/]+=*)$/;

interface PendingImage {
  name: string;
  data: string;
  mimeType: string;
  dataUrl: string;
}

const pendingImages: PendingImage[] = [];

const mainEl = document.getElementById("main") as HTMLElement;
const aiMessageEl = document.getElementById("ai-message")!;
const feedbackInput = document.getElementById(
  "feedback-input",
) as HTMLTextAreaElement;
const submitBtn = document.getElementById("submit-btn") as HTMLButtonElement;
const statusArea = document.getElementById("status-area") as HTMLDivElement;
const statusText = document.getElementById("status-text")!;
const imagePreview = document.getElementById(
  "image-preview",
) as HTMLDivElement;

function showStatus(msg: string, type: "success" | "error" | "warning") {
  statusText.textContent = msg;
  statusArea.hidden = false;
  statusArea.className = `status-area status-${type}`;
}

function renderImagePreview() {
  imagePreview.innerHTML = "";
  imagePreview.hidden = pendingImages.length === 0;
  pendingImages.forEach((img, i) => {
    const item = document.createElement("div");
    item.className = "image-preview-item";
    const imgEl = document.createElement("img");
    imgEl.src = img.dataUrl;
    imgEl.alt = img.name;
    item.appendChild(imgEl);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "remove-btn";
    btn.textContent = "\u00d7";
    btn.addEventListener("click", () => {
      pendingImages.splice(i, 1);
      renderImagePreview();
    });
    item.appendChild(btn);
    imagePreview.appendChild(item);
  });
}

function resetUI() {
  feedbackInput.disabled = false;
  feedbackInput.value = "";
  submitBtn.disabled = false;
  submitBtn.textContent = "Submit Feedback";
  submitBtn.classList.remove("btn-success");
  statusArea.hidden = true;
  pendingImages.length = 0;
  renderImagePreview();
}

function applyHostContext(ctx: McpUiHostContext) {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets) {
    const { right, left } = ctx.safeAreaInsets;
    mainEl.style.paddingRight = right > 0 ? `${right}px` : "6px";
    mainEl.style.paddingLeft = left > 0 ? `${left}px` : "6px";
  }
}

const app = new App({ name: "Cursor Better Feedback", version: "0.1.0" });

const MSG_PREFIX = "\u{1F916}: ";

function renderMessage(text: string) {
  aiMessageEl.innerHTML = sanitizeHtml(marked.parse(MSG_PREFIX + text) as string);
}

app.ontoolinput = (params) => {
  resetUI();
  const message = (params.arguments as { message?: string })?.message;
  if (message) renderMessage(message);
};

app.ontoolinputpartial = (params) => {
  const message = (params.arguments as { message?: string })?.message;
  if (message) renderMessage(message);
};

app.ontoolresult = () => {};

app.ontoolcancelled = (params) => {
  showStatus(`Feedback cancelled: ${params.reason ?? "unknown"}`, "warning");
};

app.onerror = console.error;
app.onhostcontextchanged = applyHostContext;
app.onteardown = async () => ({});

feedbackInput.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (!item.type.startsWith("image/")) continue;
    if (!ALLOWED_IMAGE_TYPES.has(item.type)) {
      showStatus("Unsupported image format", "warning");
      continue;
    }
    e.preventDefault();
    const file = item.getAsFile();
    if (!file) continue;
    if (file.size > MAX_IMAGE_SIZE) {
      showStatus(
        `Image too large (${(file.size / 1024 / 1024).toFixed(1)}MB > 5MB)`,
        "warning",
      );
      continue;
    }
    if (pendingImages.length >= MAX_IMAGES) {
      showStatus(`Maximum ${MAX_IMAGES} images`, "warning");
      continue;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (pendingImages.length >= MAX_IMAGES) return;
      const raw = reader.result;
      if (typeof raw !== "string") return;
      const match = raw.match(DATA_URL_RE);
      if (!match) return;
      const mimeType = match[1];
      const base64 = match[2];
      if (!ALLOWED_IMAGE_TYPES.has(mimeType) || !base64) return;
      pendingImages.push({
        name:
          file.name || `image-${Date.now()}.${mimeType.split("/")[1] || "png"}`,
        data: base64,
        mimeType,
        dataUrl: raw,
      });
      renderImagePreview();
    };
    reader.onerror = () => {
      showStatus("Failed to read image", "error");
    };
    reader.readAsDataURL(file);
  }
});

submitBtn.addEventListener("click", async () => {
  const text = feedbackInput.value.trim();
  if (!text) return;

  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting...";

  try {
    const args: Record<string, unknown> = { text };
    if (pendingImages.length > 0) {
      args.images = pendingImages.map(({ name, data, mimeType }) => ({
        name,
        data,
        mimeType,
      }));
    }
    const result = await app.callServerTool({
      name: "submit_feedback",
      arguments: args,
    });
    const sc = result?.structuredContent as Record<string, unknown> | undefined;
    if (sc?.success === true) {
      pendingImages.length = 0;
      renderImagePreview();
      submitBtn.disabled = true;
      submitBtn.textContent = "Success";
      submitBtn.classList.add("btn-success");
      feedbackInput.disabled = true;
    } else {
      showStatus("No pending feedback session", "warning");
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Feedback";
    }
  } catch (_e) {
    showStatus("Failed to submit feedback", "error");
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit Feedback";
  }
});

feedbackInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    submitBtn.click();
  }
});

app
  .connect()
  .then(() => {
    const ctx = app.getHostContext();
    if (ctx) applyHostContext(ctx);
  })
  .catch((err) => {
    console.error("Failed to connect:", err);
    showStatus("Connection failed — please reload or use text feedback", "error");
    submitBtn.disabled = true;
    feedbackInput.disabled = true;
  });
