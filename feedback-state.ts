export class FeedbackState {
  private current: {
    resolve: (text: string) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
    cleanup: () => void;
  } | null = null;

  waitForFeedback(timeoutMs: number, signal?: AbortSignal): Promise<string> {
    this.cancelPending("New feedback request received");
    return new Promise<string>((resolve, reject) => {
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
        resolve: (text: string) => {
          settle();
          resolve(text);
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

  submitFeedback(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed || !this.current) return false;
    this.current.resolve(trimmed);
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
