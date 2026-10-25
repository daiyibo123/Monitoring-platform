import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, UnauthorizedError, type TestKeyResponse } from "../api";
import type { Site, SiteBalance } from "../types";
import { useToast } from "../components/Toast";
import type { OverviewStats, RunInfo } from "../components/Overview";
import { siteBalance } from "../lib/balance";
import { chinaDayStart } from "../lib/format";
import { runPool } from "../lib/pool";
import { siteAvailable, sortKeys, sortSites } from "../lib/sort";
import { keyState, type KeyState } from "../lib/status";

const TEST_CONCURRENCY = 3;
const BALANCE_CONCURRENCY = 3;

type Tally = Record<"ok" | "no_quota" | "dead" | "error" | "skipped" | "failed", number> & { aborted: boolean };
const emptyTally = (): Tally => ({ ok: 0, no_quota: 0, dead: 0, error: 0, skipped: 0, failed: 0, aborted: false });

function summary(t: Tally): string {
  const parts = [
    t.ok && `可用 ${t.ok}`,
    t.no_quota && `无额度 ${t.no_quota}`,
    t.error && `检测异常 ${t.error}`,
    t.dead && `不可用 ${t.dead}`,
    t.failed && `请求失败 ${t.failed}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "没有需要测活的 Key";
}

function toggle(set: (fn: (prev: Set<number>) => Set<number>) => void, id: number, on: boolean) {
  set((prev) => {
    if (prev.has(id) === on) return prev;
    const next = new Set(prev);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });
}

// All dashboard data + test/balance orchestration. Every key test is its own
// request (bounded concurrency), so no single Pages Function invocation ever
// runs into the Cloudflare subrequest / connection / waitUntil limits.
export function useDashboard(onLogout: () => void) {
  const toast = useToast();
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<Set<number>>(new Set());
  const [queued, setQueued] = useState<Set<number>>(new Set());
  const [balanceBusy, setBalanceBusy] = useState<Set<number>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [run, setRun] = useState<{ label: string; total: number; done: number } | null>(null);
  const [booting, setBooting] = useState(true); // entry sequence (list → balances → auto-test)
  const sitesRef = useRef(sites);
  sitesRef.current = sites;
  const busyRef = useRef(new Set<number>());
  const abortRef = useRef<AbortController | null>(null);
  const started = useRef(false);

  const fail = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof UnauthorizedError) {
        abortRef.current?.abort();
        onLogout();
        return;
      }
      toast(err instanceof Error ? err.message : fallback, "error");
    },
    [onLogout, toast],
  );

  const patchBalance = (siteId: number, balance: SiteBalance | null | undefined) =>
    balance !== undefined && setSites((prev) => prev.map((s) => (s.id === siteId ? { ...s, balance } : s)));

  const applyTest = (r: TestKeyResponse) =>
    setSites((prev) =>
      prev.map((s) => {
        if (!s.keys.some((k) => k.id === r.key_id)) return s;
        const keys = r.status !== undefined ? s.keys.map((k) => (k.id === r.key_id ? { ...k, status: r.status ?? null } : k)) : s.keys;
        return { ...s, keys, balance: r.balance !== undefined ? r.balance : s.balance };
      }),
    );

  const load = useCallback(async () => {
    try {
      setSites(await api.listSites());
    } catch (err) {
      fail(err, "加载失败");
    } finally {
      setLoading(false);
    }
  }, [fail]);

  // Per-site balance refresh; returns how many sites failed.
  const refreshBalances = useCallback(
    async (ids: number[], force: boolean) => {
      let failed = 0;
      await runPool(ids, BALANCE_CONCURRENCY, async (id) => {
        toggle(setBalanceBusy, id, true);
        try {
          const r = await api.refreshBalance(id, force);
          patchBalance(id, r.balance);
          if (r.balance?.error && (r.balance.ok_at == null || (r.balance.checked_at ?? 0) > r.balance.ok_at)) failed++;
        } catch (err) {
          failed++;
          if (err instanceof UnauthorizedError) fail(err, "");
        } finally {
          toggle(setBalanceBusy, id, false);
        }
      });
      return failed;
    },
    [fail],
  );

  const runTests = useCallback(
    async (ids: number[], label: string, auto: boolean): Promise<Tally> => {
      const tally = emptyTally();
      const list = ids.filter((id) => !busyRef.current.has(id));
      if (!list.length) return tally;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      list.forEach((id) => busyRef.current.add(id));
      setQueued((prev) => new Set([...prev, ...list]));
      setRun({ label, total: list.length, done: 0 });
      const testOneOf = async (id: number) => {
        toggle(setQueued, id, false);
        toggle(setTesting, id, true);
        try {
          const r = await api.testKey(id, auto);
          if (r.skipped) tally.skipped++;
          else {
            applyTest(r);
            tally[r.status?.state ?? "failed"]++;
          }
        } catch (err) {
          tally.failed++;
          if (err instanceof UnauthorizedError) fail(err, "");
        } finally {
          busyRef.current.delete(id);
          toggle(setTesting, id, false);
          setRun((p) => (p ? { ...p, done: p.done + 1 } : p));
        }
      };
      // One key at a time per site (sites in parallel): keys of one site share
      // an upstream account, and parallel requests trip its concurrency / rate
      // limits — a working key then looks broken. Real use is one at a time too.
      const siteOf = new Map(sitesRef.current.flatMap((s) => s.keys.map((k) => [k.id, s.id] as const)));
      const groups = new Map<number, number[]>();
      for (const id of list) {
        const sid = siteOf.get(id) ?? -id;
        const g = groups.get(sid);
        if (g) g.push(id);
        else groups.set(sid, [id]);
      }
      try {
        await runPool(
          [...groups.values()],
          TEST_CONCURRENCY,
          async (ids) => {
            for (const id of ids) {
              if (ctrl.signal.aborted) break;
              await testOneOf(id);
            }
          },
          ctrl.signal,
        );
      } finally {
        tally.aborted = ctrl.signal.aborted;
        list.forEach((id) => busyRef.current.delete(id));
        setQueued((prev) => new Set([...prev].filter((id) => !list.includes(id))));
        setRun(null);
        if (abortRef.current === ctrl) abortRef.current = null;
      }
      return tally;
    },
    [fail],
  );

  const orderedIds = (only?: number) =>
    sortSites(sitesRef.current)
      .filter((s) => only == null || s.id === only)
      .flatMap((s) => sortKeys(s).map((k) => k.id));

  const testOne = useCallback(
    async (id: number) => {
      if (busyRef.current.has(id)) return;
      busyRef.current.add(id);
      toggle(setTesting, id, true);
      try {
        applyTest(await api.testKey(id));
      } catch (err) {
        fail(err, "测活失败");
      } finally {
        busyRef.current.delete(id);
        toggle(setTesting, id, false);
      }
    },
    [fail],
  );

  // Entry: list → balances → today's pending auto-tests (each key once a day).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      await load();
      await refreshBalances(sitesRef.current.filter((s) => s.keys.length).map((s) => s.id), false);
      try {
        const { key_ids } = await api.pendingTests();
        if (!key_ids.length) return;
        const pending = new Set(key_ids);
        const t = await runTests(orderedIds().filter((id) => pending.has(id)), "每日自动测活", true);
        if (t.skipped) await load();
        if (t.ok + t.no_quota + t.dead + t.error + t.failed > 0) toast(`今日自动测活完成：${summary(t)}`, t.dead || t.error ? "info" : "success");
      } catch (err) {
        fail(err, "获取今日测活任务失败");
      } finally {
        setBooting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const testAll = async () => {
    setRefreshing(true);
    await refreshBalances(sitesRef.current.filter((s) => s.keys.length).map((s) => s.id), true);
    setRefreshing(false);
    const t = await runTests(orderedIds(), "全部测活", false);
    toast(`${t.aborted ? "已停止" : "全部测活完成"}：${summary(t)}`, t.dead || t.error ? "info" : "success");
  };

  const testSite = async (site: Site) => {
    await refreshBalances([site.id], true);
    const t = await runTests(orderedIds(site.id), `测活「${site.name}」`, false);
    toast(`「${site.name}」${t.aborted ? "已停止：" : ""}${summary(t)}`, t.dead || t.error ? "info" : "success");
  };

  const refreshAll = async () => {
    setRefreshing(true);
    const failed = await refreshBalances(sitesRef.current.filter((s) => s.keys.length).map((s) => s.id), true);
    setRefreshing(false);
    toast(failed ? `${failed} 个网站余额读取失败，已保留上次数据` : "余额已刷新", failed ? "info" : "success");
  };

  const stats = useMemo<OverviewStats>(() => {
    const byState: Record<KeyState, number> = { available: 0, no_quota: 0, error: 0, dead: 0, untested: 0 };
    const today = chinaDayStart();
    let total = 0;
    let withBal = 0;
    let up = 0;
    let keys = 0;
    let testedToday = 0;
    let last: number | null = null;
    for (const s of sites) {
      const bal = siteBalance(s);
      if (bal != null) {
        total += bal;
        withBal++;
      }
      if (siteAvailable(s)) up++;
      for (const k of s.keys) {
        keys++;
        byState[keyState(k.status, bal)]++;
        const t = k.status?.tested_at;
        if (t != null && t >= today) testedToday++;
        if (t != null && (last == null || t > last)) last = t;
      }
    }
    return { sites: sites.length, sitesUp: up, keys, byState, totalBalance: withBal ? total : null, sitesWithBalance: withBal, testedToday, lastTestedAt: last };
  }, [sites]);

  const runInfo = useMemo<RunInfo | null>(() => {
    if (!run) return null;
    const names = new Map<number, string>();
    for (const s of sites) for (const k of s.keys) names.set(k.id, `${s.name} · ${k.label || k.group_name || `#${k.id}`}`);
    return { ...run, current: [...testing].map((id) => names.get(id) ?? `#${id}`) };
  }, [run, sites, testing]);

  return {
    sites,
    loading,
    testing,
    queued,
    balanceBusy,
    refreshing,
    busy: booting || refreshing || run != null,
    run: runInfo,
    stats,
    load,
    testOne,
    testAll,
    testSite,
    refreshAll,
    stop: () => abortRef.current?.abort(),
  };
}
