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

const mainEl = document.getElementById("main") as HTMLElement;
const aiMessageEl = document.getElementById("ai-message")!;
const feedbackInput = document.getElementById(
  "feedback-input",
) as HTMLTextAreaElement;
const submitBtn = document.getElementById("submit-btn") as HTMLButtonElement;
const statusArea = document.getElementById("status-area") as HTMLDivElement;
const statusText = document.getElementById("status-text")!;

function showStatus(msg: string, type: "success" | "error" | "warning") {
  statusText.textContent = msg;
  statusArea.hidden = false;
  statusArea.className = `status-area status-${type}`;
}

function resetUI() {
  feedbackInput.disabled = false;
  feedbackInput.value = "";
  submitBtn.disabled = false;
  submitBtn.textContent = "Submit Feedback";
  submitBtn.classList.remove("btn-success");
  statusArea.hidden = true;
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

submitBtn.addEventListener("click", async () => {
  const text = feedbackInput.value.trim();
  if (!text) return;

  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting...";

  try {
    const result = await app.callServerTool({
      name: "submit_feedback",
      arguments: { text },
    });
    const sc = result?.structuredContent as Record<string, unknown> | undefined;
    if (sc?.success === true) {
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
