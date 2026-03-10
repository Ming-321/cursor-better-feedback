export interface FeedbackImage {
  name: string;
  data: string;
  mimeType: string;
}

export interface FeedbackResult {
  text: string;
  images?: FeedbackImage[];
}

export class FeedbackState {
  private current: {
    resolve: (result: FeedbackResult) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
    cleanup: () => void;
  } | null = null;

  waitForFeedback(timeoutMs: number, signal?: AbortSignal): Promise<FeedbackResult> {
    this.cancelPending("New feedback request received");
    return new Promise<FeedbackResult>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("Aborted"));
        return;
      }

      const safeTimeout = Number.isFinite(timeoutMs)
        ? Math.max(1000, Math.min(timeoutMs, 3_600_000))
        : 600_000;

      const timer = setTimeout(() => {
        settle();
        reject(new Error("Feedback timeout"));
      }, safeTimeout);

      const onAbort = () => {
        this.cancelPending("Aborted by host");
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      const settle = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.current = null;
      };

      this.current = {
        resolve: (result: FeedbackResult) => {
          settle();
          resolve(result);
        },
        reject: (err: Error) => {
          settle();
          reject(err);
        },
        timer,
        cleanup: settle,
      };
    });
  }

  submitFeedback(result: FeedbackResult): boolean {
    const trimmed = result.text.trim();
    if (!trimmed || !this.current) return false;
    this.current.resolve({ text: trimmed, images: result.images });
    return true;
  }

  cancelPending(reason?: string): void {
    if (this.current) {
      this.current.reject(new Error(reason ?? "Cancelled"));
    }
  }

  get hasPending(): boolean {
    return this.current !== null;
  }
}
