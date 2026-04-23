"use client";

// Interactive keys console. Talks to /api/admin/keys with X-Admin-Token from localStorage.
// v0.2 carries no per-user session — see route.ts for the auth model.

import { useCallback, useEffect, useMemo, useState } from "react";

type ApiKeyScope =
  | "invoice:read"
  | "invoice:write"
  | "pay:execute"
  | "receipt:read"
  | "compliance:check"
  | "reputation:read";

type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  env: "live" | "test";
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
};

const ALL_SCOPES: ApiKeyScope[] = [
  "invoice:read",
  "invoice:write",
  "pay:execute",
  "receipt:read",
  "compliance:check",
  "reputation:read",
];

const TOKEN_KEY = "flowlink.admin.token";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export default function KeysTable() {
  const [token, setToken] = useState<string>("");
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [env, setEnv] = useState<"live" | "test">("test");
  const [scopes, setScopes] = useState<Set<ApiKeyScope>>(new Set(["invoice:read", "receipt:read"]));
  const [revealed, setRevealed] = useState<{ rawKey: string; prefix: string } | null>(null);
  const headers = useMemo(
    () => ({ "Content-Type": "application/json", "X-Admin-Token": token }),
    [token],
  );

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(TOKEN_KEY) : null;
    if (stored) setToken(stored);
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/keys", { headers, cache: "no-store" });
      if (!res.ok) throw new Error(`list failed: ${res.status}`);
      const json = (await res.json()) as { data: KeyRow[] };
      setKeys(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "list failed");
    } finally {
      setLoading(false);
    }
  }, [token, headers]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveToken = (next: string) => {
    setToken(next);
    if (typeof window !== "undefined") window.localStorage.setItem(TOKEN_KEY, next);
  };

  const toggleScope = (scope: ApiKeyScope) => {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };

  const mint = async () => {
    if (!name.trim() || scopes.size === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/keys", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: name.trim(), scopes: Array.from(scopes), env }),
      });
      if (!res.ok) throw new Error(`mint failed: ${res.status}`);
      const json = (await res.json()) as { rawKey: string; prefix: string };
      setRevealed({ rawKey: json.rawKey, prefix: json.prefix });
      setName("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "mint failed");
    } finally {
      setLoading(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm("Revoke this key? Calls signed with it will start failing immediately.")) return;
    try {
      const res = await fetch("/api/admin/keys", {
        method: "DELETE",
        headers,
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(`revoke failed: ${res.status}`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "revoke failed");
    }
  };

  if (!token) {
    return (
      <div className="rounded-xl border border-mint-200 bg-white p-5">
        <div className="mb-2 text-sm font-bold text-teal-800">Admin token required</div>
        <p className="mb-3 text-xs text-ink-500">
          v0.2 gates this console on a single shared <code className="font-mono">ADMIN_TOKEN</code>{" "}
          env var. Paste it once; we keep it in <code className="font-mono">localStorage</code> for
          this browser only.
        </p>
        <input
          type="password"
          placeholder="paste ADMIN_TOKEN"
          className="w-full rounded-md border border-mint-200 px-3 py-2 font-mono text-sm focus:border-teal-500 focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === "Enter") saveToken((e.target as HTMLInputElement).value);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <MintForm
        name={name}
        setName={setName}
        env={env}
        setEnv={setEnv}
        scopes={scopes}
        toggleScope={toggleScope}
        onMint={mint}
        loading={loading}
      />

      {revealed && <RevealBox rawKey={revealed.rawKey} onDismiss={() => setRevealed(null)} />}
      {error && (
        <div className="rounded-md border border-red-400 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-mint-200 bg-white font-mono text-xs">
        <div className="grid grid-cols-[1.4fr_1.2fr_1.4fr_0.8fr_0.7fr_70px] gap-2 bg-mint-50 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-ink-400">
          <div>Name</div><div>Prefix</div><div>Scopes</div><div>Last used</div><div>Status</div><div />
        </div>
        {keys.length === 0 && (
          <div className="px-4 py-6 text-center text-ink-400">
            {loading ? "loading…" : "no keys yet — mint one above"}
          </div>
        )}
        {keys.map((k) => (
          <KeyRowItem key={k.id} k={k} onRevoke={() => revoke(k.id)} />
        ))}
      </div>
    </div>
  );
}

function MintForm(props: {
  name: string;
  setName: (s: string) => void;
  env: "live" | "test";
  setEnv: (e: "live" | "test") => void;
  scopes: Set<ApiKeyScope>;
  toggleScope: (s: ApiKeyScope) => void;
  onMint: () => void;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-mint-200 bg-white p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_120px_auto] md:items-end">
        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-ink-400">Name</span>
          <input
            value={props.name}
            onChange={(e) => props.setName(e.target.value)}
            placeholder="e.g. mcp-bridge-laptop"
            className="w-full rounded-md border border-mint-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-ink-400">Env</span>
          <select
            value={props.env}
            onChange={(e) => props.setEnv(e.target.value as "live" | "test")}
            className="w-full rounded-md border border-mint-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
          >
            <option value="test">test</option>
            <option value="live">live</option>
          </select>
        </label>
        <button
          type="button"
          onClick={props.onMint}
          disabled={props.loading || props.name.trim().length === 0 || props.scopes.size === 0}
          className="rounded-md bg-gradient-to-b from-teal-500 to-teal-700 px-4 py-2 text-sm font-bold text-white shadow disabled:cursor-not-allowed disabled:opacity-50"
        >
          {props.loading ? "Minting…" : "Mint a new key"}
        </button>
      </div>
      <fieldset className="mt-3">
        <legend className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-400">Scopes</legend>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {ALL_SCOPES.map((s) => (
            <label key={s} className="flex items-center gap-2 rounded-md border border-mint-200 px-2 py-1.5 text-xs">
              <input
                type="checkbox"
                checked={props.scopes.has(s)}
                onChange={() => props.toggleScope(s)}
                className="accent-teal-500"
              />
              <code className="font-mono text-[11px] text-teal-700">{s}</code>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function RevealBox({ rawKey, onDismiss }: { rawKey: string; onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-teal-900 p-4 text-mint-100 shadow-lg">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold uppercase tracking-widest text-mint-200/70">
          Just minted · copy now (won&apos;t show again)
        </div>
        <div className="mt-1 truncate font-mono text-sm text-white">{rawKey}</div>
      </div>
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(rawKey)}
        className="rounded-md bg-teal-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-600"
      >
        Copy
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-md border border-mint-200/30 px-3 py-1.5 text-xs font-bold text-mint-100 hover:bg-teal-800"
      >
        Dismiss
      </button>
    </div>
  );
}

function KeyRowItem({ k, onRevoke }: { k: KeyRow; onRevoke: () => void }) {
  const isRevoked = k.revoked_at != null;
  return (
    <div
      className={`grid grid-cols-[1.4fr_1.2fr_1.4fr_0.8fr_0.7fr_70px] items-center gap-2 border-t border-mint-100 px-4 py-3 ${
        isRevoked ? "opacity-55" : ""
      }`}
    >
      <div className="truncate font-sans text-sm font-bold text-teal-700">{k.name}</div>
      <div className="truncate text-ink-700">{k.prefix}…</div>
      <div className="truncate text-[10.5px] text-ink-500">
        {k.scopes.length === ALL_SCOPES.length ? "all 6 scopes" : k.scopes.join(", ")}
      </div>
      <div className="text-[10.5px] text-ink-400">{timeAgo(k.last_used_at)}</div>
      <div>
        <span
          className={`inline-block rounded px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider ${
            isRevoked
              ? "bg-red-500/20 text-red-700"
              : k.env === "live"
                ? "bg-green-500/20 text-green-600"
                : "bg-teal-500/20 text-teal-700"
          }`}
        >
          {isRevoked ? "revoked" : k.env}
        </span>
      </div>
      <div className="text-right">
        {!isRevoked && (
          <button
            type="button"
            onClick={onRevoke}
            className="rounded border border-mint-200 px-2 py-1 font-sans text-[10px] font-bold text-ink-500 hover:border-red-400 hover:text-red-700"
          >
            Revoke
          </button>
        )}
      </div>
    </div>
  );
}
