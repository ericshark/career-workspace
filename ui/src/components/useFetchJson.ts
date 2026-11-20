"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";

/** Event other screens can dispatch (window.dispatchEvent) after logging a row, so counters refresh. */
export const PROGRESS_CHANGED = "career:progress-changed";

// Several components on one screen (nav badges, the page, its cards) read the same endpoint, and a
// page that was just visited should not start empty again. Every URL therefore has one shared entry
// that all hook instances subscribe to: a single in-flight request, one focus listener and one
// refresh timer per URL, and the last good data shown immediately while a fresh copy loads.

const REFRESH_MS = 15_000;
// Resources the change feed covers only need a slow safety refresh.
const WATCHED_REFRESH_MS = 60_000;
const FEED_MS = 2_000;
// Re-render subscribers for an unchanged response at most this often (it only refreshes "last loaded").
const IDLE_NOTIFY_MS = 30_000;

// Which source files (see /api/changes) each endpoint is built from. A resource listed here is
// refetched when one of them changes, instead of on a fixed timer.
const WATCH: Record<string, string[]> = {
  "/api/applications": ["applications", "links"],
  "/api/progress": ["applications"],
  "/api/actions": ["actions"],
  "/api/mail": ["mail"],
  "/api/recruiting": ["recruiting", "applications", "actions", "mail"],
  "/api/reviews": ["reviews", "runs", "applications"],
  "/api/opportunities": ["opportunities"],
};

/**
 * One poller for every watched resource. A resource records the change tokens that were current
 * when its fetch started (`seen`); the poll, every 2 s while the tab is visible, refetches any
 * resource whose files have a different token since. Because `seen` is taken before the data is
 * requested, a change that lands during or after a fetch can never be missed.
 */
interface FeedMember {
  keys: string[];
  seen: Record<string, string> | null;
  reload: () => Promise<void>;
}
const feed = {
  members: new Set<FeedMember>(),
  latest: null as Record<string, string> | null,
  timer: undefined as ReturnType<typeof setInterval> | undefined,
  add(member: FeedMember) {
    this.members.add(member);
    if (this.timer) return;
    this.timer = setInterval(this.onTick, FEED_MS);
    document.addEventListener("visibilitychange", this.onTick);
  },
  remove(member: FeedMember) {
    this.members.delete(member);
    if (this.members.size) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.latest = null;
    document.removeEventListener("visibilitychange", this.onTick);
  },
  onTick() {
    if (document.visibilityState === "visible") void feed.poll();
  },
  /** Read the current tokens (null if the endpoint is unavailable). */
  async read(): Promise<Record<string, string> | null> {
    try {
      const res = await fetch("/api/changes", { cache: "no-store" });
      if (!res.ok) return null;
      this.latest = (await res.json()).tokens as Record<string, string>;
      return this.latest;
    } catch {
      return null; // best effort: the slow safety refresh still runs
    }
  },
  async poll() {
    const next = await this.read();
    if (!next) return;
    for (const member of this.members)
      if (member.seen && member.keys.some((k) => next[k] !== member.seen![k]))
        void member.reload();
  },
};

interface Snapshot<T> {
  data: T | null;
  error: string | null;
  loadedAt: Date | null;
}

const EMPTY: Snapshot<never> = { data: null, error: null, loadedAt: null };

class Resource<T> {
  snapshot: Snapshot<T> = EMPTY;
  private listeners = new Set<() => void>();
  private eventListeners = 0;
  private inflight: Promise<void> | null = null;
  private rerun = false;
  // Bumped by setData so a response that started before a local update cannot overwrite it.
  private version = 0;
  private lastText: string | null = null;
  private notifiedAt = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private member: FeedMember | null;

  constructor(private url: string) {
    const keys = WATCH[url.split("?")[0]];
    this.member = keys
      ? { keys, seen: null, reload: () => this.reload() }
      : null;
  }

  private emit() {
    this.notifiedAt = Date.now();
    for (const listener of this.listeners) listener();
  }

  private onFocus = () => void this.reload();
  private onProgress = () => void this.reload();
  private onTick = () => {
    if (document.visibilityState === "visible") void this.reload();
  };

  // Each subscriber may ask for a refresh cadence; the resource runs one timer at the fastest.
  private cadence = new Map<() => void, number>();
  private timerMs = 0;

  private retime() {
    const wanted = Math.min(Infinity, ...this.cadence.values());
    const ms = Number.isFinite(wanted) ? wanted : 0;
    if (ms === this.timerMs) return;
    clearInterval(this.timer);
    this.timer = ms ? setInterval(this.onTick, ms) : undefined;
    this.timerMs = ms;
  }

  subscribe(
    listener: () => void,
    opts: { events: boolean; intervalMs?: number },
  ) {
    const first = this.listeners.size === 0;
    this.listeners.add(listener);
    if (opts.events) this.eventListeners++;
    if (first) {
      window.addEventListener("focus", this.onFocus);
      if (this.member) feed.add(this.member);
    }
    if (opts.events && this.eventListeners === 1)
      window.addEventListener(PROGRESS_CHANGED, this.onProgress);
    const cadence =
      opts.intervalMs ??
      (opts.events
        ? this.member
          ? WATCHED_REFRESH_MS
          : REFRESH_MS
        : undefined);
    if (cadence) this.cadence.set(listener, cadence);
    this.retime();
    // A new subscriber revalidates; cached data (if any) is already on screen.
    void this.reload();
    return () => {
      this.listeners.delete(listener);
      this.cadence.delete(listener);
      this.retime();
      if (opts.events && --this.eventListeners === 0)
        window.removeEventListener(PROGRESS_CHANGED, this.onProgress);
      if (this.listeners.size === 0) {
        window.removeEventListener("focus", this.onFocus);
        if (this.member) feed.remove(this.member);
      }
    };
  }

  /** Fetch now. Calls made while a request is running share it, then trigger one more fetch. */
  reload(): Promise<void> {
    if (this.inflight) {
      // A request that began earlier may predate the change that prompted this call.
      this.rerun = true;
      return this.inflight;
    }
    const run = (async () => {
      do {
        this.rerun = false;
        await this.fetchOnce();
      } while (this.rerun);
    })().finally(() => {
      this.inflight = null;
    });
    this.inflight = run;
    return run;
  }

  private async fetchOnce() {
    const startedAt = this.version;
    // Before asking for the data, note which file versions it will reflect.
    if (this.member)
      this.member.seen = feed.latest ?? (await feed.read()) ?? this.member.seen;
    try {
      const res = await fetch(this.url, { cache: "no-store" });
      const text = await res.text();
      if (startedAt !== this.version) {
        this.rerun = true; // setData ran meanwhile; fetch again instead of discarding the update
        return;
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        // A Next.js error page or proxy response, not our JSON.
        throw new Error(`HTTP ${res.status}: unexpected response`);
      }
      if (!res.ok)
        throw new Error(
          (body as { error?: { message?: string } })?.error?.message ??
            `HTTP ${res.status}`,
        );
      if (text === this.lastText && this.snapshot.error === null) {
        // Same payload: keep the same data object so React skips re-rendering dependents.
        if (Date.now() - this.notifiedAt > IDLE_NOTIFY_MS) {
          this.snapshot = { ...this.snapshot, loadedAt: new Date() };
          this.emit();
        }
        return;
      }
      this.lastText = text;
      this.snapshot = { data: body as T, error: null, loadedAt: new Date() };
      this.emit();
    } catch (e) {
      // Keep the last good data on a failed refetch.
      const message = e instanceof Error ? e.message : String(e);
      if (this.snapshot.error !== message) {
        this.snapshot = { ...this.snapshot, error: message };
        this.emit();
      }
    }
  }

  setData(next: T | null | ((previous: T | null) => T | null)) {
    const data =
      typeof next === "function"
        ? (next as (previous: T | null) => T | null)(this.snapshot.data)
        : next;
    this.version++;
    this.lastText = null;
    this.snapshot = { data, error: null, loadedAt: new Date() };
    this.emit();
  }
}

const resources = new Map<string, Resource<unknown>>();
function resourceFor<T>(url: string): Resource<T> {
  let resource = resources.get(url);
  if (!resource) {
    resource = new Resource<unknown>(url);
    resources.set(url, resource);
  }
  return resource as Resource<T>;
}

/**
 * Fetch JSON from a same-origin API route through a store shared by every component that reads the
 * same URL. Refetches when the window regains focus and, with `events`, when PROGRESS_CHANGED fires
 * or every 15 s while the tab is visible. `intervalMs` asks for a faster visible-tab refresh (for
 * state that is not file-backed, such as running jobs). Keeps the last good data on a failed refetch.
 */
export function useFetchJson<T>(
  url: string,
  opts?: { events?: boolean; intervalMs?: number },
) {
  const resource = useMemo(() => resourceFor<T>(url), [url]);
  const events = !!opts?.events;
  const intervalMs = opts?.intervalMs;
  const subscribe = useCallback(
    (listener: () => void) =>
      resource.subscribe(listener, { events, intervalMs }),
    [resource, events, intervalMs],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    () => resource.snapshot,
    () => EMPTY as Snapshot<T>,
  );
  const reload = useCallback(() => resource.reload(), [resource]);
  const setData = useCallback(
    (next: T | null | ((previous: T | null) => T | null)) =>
      resource.setData(next),
    [resource],
  );
  return {
    data: snapshot.data,
    setData,
    error: snapshot.error,
    loadedAt: snapshot.loadedAt,
    reload,
  };
}
