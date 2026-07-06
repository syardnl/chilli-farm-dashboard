"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ChilliPlant3D from "./ChilliPlant3D";
import ReadingsChart from "./ReadingsChart";

// ---------- design tokens ----------
const COLORS = {
  bg: "#1C1410",
  bgRaised: "#251C16",
  hairline: "#3A2E24",
  chilli: "#C1121F",
  leaf: "#4C7A3D",
  amber: "#E8A33D",
  cream: "#F2E9DC",
  muted: "#948573",
};

const HISTORY_LIMIT = 30; // how many recent readings to keep for the chart
const POLL_MS = 10000; // safety-net polling interval, runs alongside realtime
const PENDING_TIMEOUT_MS = 8000; // give up waiting for confirmation after this long

export default function Dashboard() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]); // most-recent-first
  const [stale, setStale] = useState(false);
  const [deviceState, setDeviceState] = useState({ pump: "off", roof: "open" });
  const [aiScore, setAiScore] = useState(null);
  const [insight, setInsight] = useState(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const [pumpBusy, setPumpBusy] = useState(false);
  const [roofBusy, setRoofBusy] = useState(false);

  // NEW: surfaces realtime connection problems instead of failing silently
  const [realtimeIssue, setRealtimeIssue] = useState(false);

  // ---- FIX: tracks devices with a command in flight, so a stale poll or
  // realtime event can't stomp on the optimistic value before the backend
  // has actually confirmed it. Keyed by device -> { target, timeoutId }.
  const pendingRef = useRef({});

  // Applies an incoming {device: state} update from either the poll or the
  // realtime subscription. If a device is "pending" (a command is in
  // flight), the incoming value is only accepted once it matches the
  // target the user actually asked for -- anything else (i.e. the old,
  // not-yet-updated value) is ignored instead of overwriting the optimistic UI.
  function applyConfirmedDeviceState(incoming, { busySetters } = {}) {
    setDeviceState((prev) => {
      const next = { ...prev };
      for (const [device, state] of Object.entries(incoming)) {
        const pending = pendingRef.current[device];
        if (pending && state !== pending.target) {
          // Stale value relative to an in-flight command -- skip it.
          continue;
        }
        next[device] = state;
        if (pending) {
          clearTimeout(pending.timeoutId);
          delete pendingRef.current[device];
          busySetters?.[device]?.(false);
        }
      }
      return next;
    });
  }

  // ---- auth guard ----
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push("/login");
      } else {
        setCheckingAuth(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session) router.push("/login");
      }
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [router]);

  // ---- live readings (single latest row) ----
  useEffect(() => {
    if (checkingAuth) return;

    const fetchLatest = () => {
      supabase
        .from("readings")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .then(({ data, error }) => {
          if (!error) setLatest(data?.[0] ?? null);
        });
    };

    fetchLatest();

    const channel = supabase
      .channel("readings-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "readings" },
        (payload) => {
          setLatest(payload.new);
          setHistory((prev) => [payload.new, ...prev].slice(0, HISTORY_LIMIT));
        }
      )
      .subscribe((status) => {
        console.log("Readings channel:", status);
        setRealtimeIssue(status !== "SUBSCRIBED");
      });

    // NEW: polling fallback — if realtime silently drops (RLS/publication
    // misconfig, network hiccup, etc.) the page still refreshes on its own.
    const poll = setInterval(fetchLatest, POLL_MS);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [checkingAuth]);

  // NEW: history for the trend chart (separate from the single "latest" fetch above)
  useEffect(() => {
    if (checkingAuth) return;

    const fetchHistory = () => {
      supabase
        .from("readings")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(HISTORY_LIMIT)
        .then(({ data, error }) => {
          if (!error) setHistory(data ?? []);
        });
    };

    fetchHistory();
    const poll = setInterval(fetchHistory, 30000); // belt-and-suspenders refresh
    return () => clearInterval(poll);
  }, [checkingAuth]);

  // ---- stale banner ----
  useEffect(() => {
    const timer = setInterval(() => {
      if (!latest?.created_at) return;
      const age = Date.now() - new Date(latest.created_at).getTime();
      setStale(age > 60000);
    }, 5000);

    return () => clearInterval(timer);
  }, [latest]);

  // ---- confirmed device state ----
  useEffect(() => {
    if (checkingAuth) return;

    const busySetters = { pump: setPumpBusy, roof: setRoofBusy };

    const fetchDeviceState = () => {
      supabase
        .from("device_state")
        .select("*")
        .then(({ data }) => {
          if (!data) return;
          const incoming = {};
          data.forEach((row) => {
            incoming[row.device] = row.state;
          });
          // FIX: routed through applyConfirmedDeviceState so a poll tick
          // that lands mid-command can't overwrite the optimistic value
          // with the still-stale row from before the command took effect.
          applyConfirmedDeviceState(incoming, { busySetters });
        });
    };

    fetchDeviceState();

    const channel = supabase
      .channel("device-state-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "device_state" },
        (payload) => {
          // FIX: same guard applied to the realtime path for consistency.
          applyConfirmedDeviceState(
            { [payload.new.device]: payload.new.state },
            { busySetters }
          );
        }
      )
      .subscribe((status) => {
        console.log("Device state:", status);
      });

    const poll = setInterval(fetchDeviceState, POLL_MS);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [checkingAuth]);

  // ---- AI scores + insights ----
  useEffect(() => {
    if (checkingAuth) return;

    const fetchScore = () => {
      supabase
        .from("ai_scores")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .then(({ data }) => setAiScore(data?.[0] ?? null));
    };

    const fetchInsight = () => {
      supabase
        .from("ai_insights")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .then(({ data }) => setInsight(data?.[0] ?? null));
    };

    fetchScore();
    fetchInsight();

    const scoreChannel = supabase
      .channel("ai-score-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ai_scores" },
        (payload) => setAiScore(payload.new)
      )
      .subscribe((status) => console.log("AI Score:", status));

    const insightChannel = supabase
      .channel("ai-insight-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ai_insights" },
        (payload) => setInsight(payload.new)
      )
      .subscribe((status) => console.log("AI Insight:", status));

    // AI tables update on a slower cadence (60s / 30min), so a longer poll is enough
    const poll = setInterval(() => {
      fetchScore();
      fetchInsight();
    }, 30000);

    return () => {
      supabase.removeChannel(scoreChannel);
      supabase.removeChannel(insightChannel);
      clearInterval(poll);
    };
  }, [checkingAuth]);

  // ---- actuator control (optimistic UI + rollback) ----
  async function sendCommand(device, value, optimisticState, busyFlag, setBusy) {
    if (busyFlag) return;
    setBusy(true);

    const previousValue = deviceState[device];
    setDeviceState((prev) => ({ ...prev, [device]: optimisticState }));

    // FIX: mark this device "pending" so the poll/realtime handlers know
    // to ignore any confirmation that doesn't match this target value yet
    // -- this is what stops the temporary revert-then-correct flicker.
    if (pendingRef.current[device]) {
      clearTimeout(pendingRef.current[device].timeoutId);
    }
    const timeoutId = setTimeout(() => {
      // Safety net: if nothing ever confirms (backend down, dropped
      // message, etc.), don't leave the button permanently disabled.
      delete pendingRef.current[device];
      setBusy(false);
    }, PENDING_TIMEOUT_MS);
    pendingRef.current[device] = { target: optimisticState, timeoutId };

    const { error } = await supabase
      .from("commands")
      .insert({ device, action: "set", value });

    if (error) {
      clearTimeout(timeoutId);
      delete pendingRef.current[device];
      setDeviceState((prev) => ({ ...prev, [device]: previousValue }));
      setBusy(false);
      alert("Command failed: " + error.message);
    }
    // NOTE: on success, setBusy(false) now happens inside
    // applyConfirmedDeviceState once the real state actually arrives
    // (or via the timeout above as a fallback) -- not on a blind delay.
  }

  // ---- ask the farm ----
  async function askFarm() {
    if (!question.trim()) return;
    setAsking(true);
    setAnswer("");
    try {
      const { data: recent } = await supabase
        .from("readings")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      const res = await fetch("/api/ask-farm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, context: recent }),
      });
      const json = await res.json();
      setAnswer(json.answer ?? "No answer returned.");
    } catch (e) {
      setAnswer("Something went wrong reaching the farm assistant.");
    } finally {
      setAsking(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (checkingAuth) {
    return (
      <div
        style={{ background: COLORS.bg, color: COLORS.cream }}
        className="min-h-screen flex items-center justify-center"
      >
        <p className="font-mono text-sm" style={{ color: COLORS.muted }}>
          Checking session…
        </p>
      </div>
    );
  }

  return (
    <div
      style={{ background: COLORS.bg, color: COLORS.cream, minHeight: "100vh" }}
      className="font-sans"
    >
      {/* header */}
      <header
        style={{ borderColor: COLORS.hairline }}
        className="border-b px-6 py-5 flex items-center justify-between"
      >
        <div>
          <p
            style={{ color: COLORS.muted }}
            className="text-xs tracking-[0.2em] uppercase font-mono"
          >
            Chilli Farm IoT
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Field Control</h1>
        </div>
        <div className="flex items-center gap-4">
          <StatusPill stale={stale} hasData={!!latest} />
          <button
            onClick={handleSignOut}
            style={{ color: COLORS.muted, borderColor: COLORS.hairline }}
            className="text-xs font-mono border rounded-lg px-3 py-1.5 hover:opacity-80"
          >
            Sign out
          </button>
        </div>
      </header>

      {stale && (
        <div
          style={{ background: COLORS.chilli }}
          className="text-center text-sm font-mono py-2 tracking-wide"
        >
          ⚠ No new reading in over 60s — check the ESP32 / Node-RED bridge
          {realtimeIssue && " (realtime link degraded, showing polled data)"}
        </div>
      )}

      <main className="px-6 py-8 max-w-6xl mx-auto space-y-10">
        {/* sensor gauges */}
        <section>
          <SectionLabel>Live Readings</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mt-3">
            <Dial label="Temp" value={latest?.temp} unit="°C" min={15} max={45} color={COLORS.chilli} />
            <Dial label="Humidity" value={latest?.humidity} unit="%" min={0} max={100} color={COLORS.leaf} />
            <Dial label="Soil" value={latest?.soil} unit="" min={0} max={1023} color={COLORS.amber} invert />
            <Dial label="Light" value={latest?.ldr} unit="" min={0} max={1023} color={COLORS.muted} />
            <RainTile rain={latest?.rain} />
          </div>
        </section>

        {/* NEW: historical trend chart */}
        <section>
          <SectionLabel>24h Trend</SectionLabel>
          <div
            style={{ background: COLORS.bgRaised, borderColor: COLORS.hairline }}
            className="rounded-xl border p-5 mt-3"
          >
            {history.length > 0 ? (
              <ReadingsChart data={history} colors={COLORS} />
            ) : (
              <p className="text-sm font-mono" style={{ color: COLORS.muted }}>
                Waiting for enough readings to plot…
              </p>
            )}
          </div>
        </section>

        {/* actuator control */}
        <section>
          <SectionLabel>Actuators</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
            <ActuatorCard
              name="Pump"
              state={deviceState.pump}
              onLabel="ON"
              offLabel="OFF"
              onColor={COLORS.leaf}
              offColor={COLORS.chilli}
              busy={pumpBusy}
              onClickOn={() => sendCommand("pump", "on", "on", pumpBusy, setPumpBusy)}
              onClickOff={() => sendCommand("pump", "off", "off", pumpBusy, setPumpBusy)}
            />
            <ActuatorCard
              name="Roof"
              state={deviceState.roof}
              onLabel="CLOSE"
              offLabel="OPEN"
              stateOnValue="closed"
              stateOffValue="open"
              busy={roofBusy}
              onClickOn={() => sendCommand("roof", "close", "closed", roofBusy, setRoofBusy)}
              onClickOff={() => sendCommand("roof", "open", "open", roofBusy, setRoofBusy)}
            />
          </div>
        </section>

        {/* AI panel */}
        <section>
          <SectionLabel>Plant-Health Assistant</SectionLabel>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-3">
            <div
              style={{ background: COLORS.bgRaised, borderColor: COLORS.hairline }}
              className="rounded-xl border p-5 lg:col-span-1"
            >
              <p className="font-mono text-sm" style={{ color: COLORS.muted }}>
                Dry ETA
              </p>
              <p className="text-3xl font-semibold mt-1">
                {aiScore?.dry_eta_minutes != null ? formatMinutes(aiScore.dry_eta_minutes) : "—"}
              </p>
              <div className="mt-5 space-y-3">
                <RiskBar label="Disease risk" value={aiScore?.disease_risk} />
                <RiskBar label="Heat risk" value={aiScore?.heat_risk} />
              </div>
            </div>

            <div
              style={{ background: COLORS.bgRaised, borderColor: COLORS.hairline }}
              className="rounded-xl border p-5 lg:col-span-2"
            >
              <p className="font-mono text-sm" style={{ color: COLORS.muted }}>
                Latest report
              </p>
              <p className="mt-2 leading-relaxed">
                {insight?.summary ?? "No report generated yet."}
              </p>
              {insight?.created_at && (
                <p className="text-xs mt-3 font-mono" style={{ color: COLORS.muted }}>
                  {new Date(insight.created_at).toLocaleString()}
                </p>
              )}
            </div>
          </div>

          {/* NEW: 3D plant condition viewer */}
          <div
            style={{ background: COLORS.bgRaised, borderColor: COLORS.hairline }}
            className="rounded-xl border p-5 mt-4"
          >
            <p className="font-mono text-sm mb-2" style={{ color: COLORS.muted }}>
              Plant condition (live)
            </p>
            <ChilliPlant3D
              soil={latest?.soil}
              rain={latest?.rain}
              diseaseRisk={aiScore?.disease_risk}
              heatRisk={aiScore?.heat_risk}
            />
            <p className="text-xs font-mono mt-2 text-center" style={{ color: COLORS.muted }}>
              Droop reflects soil moisture • leaf color reflects disease risk • chilli tone reflects heat risk
            </p>
          </div>

          {/* ask the farm */}
          <div
            style={{ background: COLORS.bgRaised, borderColor: COLORS.hairline }}
            className="rounded-xl border p-5 mt-4"
          >
            <p className="font-mono text-sm mb-3" style={{ color: COLORS.muted }}>
              Ask the farm
            </p>
            <div className="flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && askFarm()}
                placeholder="e.g. Should I water tonight?"
                style={{
                  background: COLORS.bg,
                  borderColor: COLORS.hairline,
                  color: COLORS.cream,
                }}
                className="flex-1 rounded-lg border px-3 py-2 outline-none focus:ring-2"
              />
              <button
                onClick={askFarm}
                disabled={asking}
                style={{ background: COLORS.chilli }}
                className="rounded-lg px-4 py-2 font-medium disabled:opacity-50 transition"
              >
                {asking ? "Asking…" : "Ask"}
              </button>
            </div>
            {answer && (
              <p className="mt-4 leading-relaxed" style={{ color: COLORS.cream }}>
                {answer}
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

// ---------------- subcomponents (unchanged from original) ----------------

function SectionLabel({ children }) {
  return (
    <h2 style={{ color: COLORS.muted }} className="text-xs font-mono tracking-[0.2em] uppercase">
      {children}
    </h2>
  );
}

function StatusPill({ stale, hasData }) {
  const label = !hasData ? "Connecting…" : stale ? "Stale" : "Live";
  const color = !hasData ? COLORS.muted : stale ? COLORS.chilli : COLORS.leaf;
  return (
    <div className="flex items-center gap-2 font-mono text-xs">
      <span style={{ background: color }} className="w-2 h-2 rounded-full inline-block" />
      <span style={{ color }}>{label}</span>
    </div>
  );
}

function Dial({ label, value, unit, min, max, color, invert }) {
  const hasValue = value != null;
  const pct = hasValue ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  const displayPct = invert ? 1 - pct : pct;
  const angle = displayPct * 270;

  return (
    <div
      style={{ background: COLORS.bgRaised, borderColor: COLORS.hairline }}
      className="rounded-xl border p-4 flex flex-col items-center"
    >
      <div
        className="relative w-20 h-20 rounded-full flex items-center justify-center"
        style={{
          background: `conic-gradient(${color} ${angle}deg, ${COLORS.hairline} ${angle}deg 270deg, transparent 270deg 360deg)`,
        }}
      >
        <div style={{ background: COLORS.bgRaised }} className="w-14 h-14 rounded-full flex items-center justify-center">
          <span className="font-mono text-sm">
            {hasValue ? Math.round(value) : "--"}
            <span style={{ color: COLORS.muted }} className="text-[10px] ml-0.5">
              {unit}
            </span>
          </span>
        </div>
      </div>
      <p style={{ color: COLORS.muted }} className="text-xs font-mono mt-2 uppercase tracking-wide">
        {label}
      </p>
    </div>
  );
}

function RainTile({ rain }) {
  const active = !!rain;
  return (
    <div
      style={{ background: active ? COLORS.leaf : COLORS.bgRaised, borderColor: COLORS.hairline }}
      className="rounded-xl border p-4 flex flex-col items-center justify-center transition"
    >
      <span className="text-2xl">{active ? "🌧" : "☀"}</span>
      <p style={{ color: active ? COLORS.cream : COLORS.muted }} className="text-xs font-mono mt-2 uppercase tracking-wide">
        {active ? "Raining" : "Dry"}
      </p>
    </div>
  );
}

function ActuatorCard({
  name,
  state,
  onLabel,
  offLabel,
  stateOnValue = "on",
  stateOffValue = "off",
  onColor = COLORS.chilli,
  offColor = COLORS.leaf,
  busy,
  onClickOn,
  onClickOff,
}) {
  const isOn = state === stateOnValue;
  return (
    <div
      style={{ background: COLORS.bgRaised, borderColor: COLORS.hairline }}
      className="rounded-xl border p-5 flex items-center justify-between"
    >
      <div>
        <p className="font-medium">{name}</p>
        <p style={{ color: COLORS.muted }} className="text-xs font-mono mt-1 uppercase">
          {state ?? "unknown"}
        </p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onClickOff}
          disabled={busy}
          style={{ background: !isOn ? offColor : "transparent", borderColor: COLORS.hairline }}
          className="rounded-lg border px-3 py-1.5 text-sm font-mono disabled:opacity-50"
        >
          {offLabel}
        </button>
        <button
          onClick={onClickOn}
          disabled={busy}
          style={{ background: isOn ? onColor : "transparent", borderColor: COLORS.hairline }}
          className="rounded-lg border px-3 py-1.5 text-sm font-mono disabled:opacity-50"
        >
          {onLabel}
        </button>
      </div>
    </div>
  );
}

function RiskBar({ label, value }) {
  const v = value ?? 0;
  const color = v < 30 ? COLORS.leaf : v < 60 ? COLORS.amber : COLORS.chilli;
  return (
    <div>
      <div className="flex justify-between text-xs font-mono mb-1">
        <span style={{ color: COLORS.muted }}>{label}</span>
        <span>{value != null ? `${value}%` : "—"}</span>
      </div>
      <div style={{ background: COLORS.hairline }} className="h-2 rounded-full overflow-hidden">
        <div style={{ width: `${v}%`, background: color }} className="h-full transition-all duration-500" />
      </div>
    </div>
  );
}

function formatMinutes(mins) {
  if (mins <= 0) return "Dry now";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
