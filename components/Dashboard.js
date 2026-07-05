"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

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

export default function Dashboard() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [latest, setLatest] = useState(null);
  const [stale, setStale] = useState(false);
  const [deviceState, setDeviceState] = useState({ pump: "off", roof: "open" });
  const [aiScore, setAiScore] = useState(null);
  const [insight, setInsight] = useState(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const [pumpBusy, setPumpBusy] = useState(false);
  const [roofBusy, setRoofBusy] = useState(false);

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

// ---- live readings ----
useEffect(() => {
  if (checkingAuth) return;

  // initial fetch
  supabase
    .from("readings")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .then(({ data }) => {
      setLatest(data?.[0] ?? null);
    });

  // realtime
  const channel = supabase
    .channel("readings-live")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "readings",
      },
      (payload) => {
        setLatest(payload.new);
      }
    )
    .subscribe((status) => {
      console.log("Readings channel:", status);
    });

  return () => {
    supabase.removeChannel(channel);
  };
}, [checkingAuth]);

// ---- stale banner ----
useEffect(() => {
  const timer = setInterval(() => {
    if (!latest?.created_at) return;

    const age =
      Date.now() - new Date(latest.created_at).getTime();

    setStale(age > 60000);
  }, 5000);

  return () => clearInterval(timer);
}, [latest]);

// ---- confirmed device state ----
useEffect(() => {
  if (checkingAuth) return;

  // initial fetch
  supabase
    .from("device_state")
    .select("*")
    .then(({ data }) => {
      if (!data) return;

      const next = {};

      data.forEach((row) => {
        next[row.device] = row.state;
      });

      setDeviceState(next);
    });

  // realtime
  const channel = supabase
    .channel("device-state-live")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "device_state",
      },
      (payload) => {
        setDeviceState((prev) => ({
          ...prev,
          [payload.new.device]: payload.new.state,
        }));
      }
    )
    .subscribe((status) => {
      console.log("Device state:", status);
    });

  return () => {
    supabase.removeChannel(channel);
  };
}, [checkingAuth]);

// ---- AI scores + insights ----
useEffect(() => {
  if (checkingAuth) return;

  // latest ai score
  supabase
    .from("ai_scores")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .then(({ data }) => {
      setAiScore(data?.[0] ?? null);
    });

  // latest insight
  supabase
    .from("ai_insights")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .then(({ data }) => {
      setInsight(data?.[0] ?? null);
    });

  // realtime ai scores
  const scoreChannel = supabase
    .channel("ai-score-live")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "ai_scores",
      },
      (payload) => {
        setAiScore(payload.new);
      }
    )
    .subscribe((status) => {
      console.log("AI Score:", status);
    });

  // realtime insights
  const insightChannel = supabase
    .channel("ai-insight-live")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "ai_insights",
      },
      (payload) => {
        setInsight(payload.new);
      }
    )
    .subscribe((status) => {
      console.log("AI Insight:", status);
    });

  return () => {
    supabase.removeChannel(scoreChannel);
    supabase.removeChannel(insightChannel);
  };
}, [checkingAuth]);

  // ---- actuator control (optimistic UI + rollback) ----
  // `value` = what gets sent to the commands table (the action, e.g. "close")
  // `optimisticState` = what device_state actually stores once applied (e.g. "closed")
  // These can differ (roof: action "close" -> resulting state "closed"), so
  // both must be passed explicitly instead of assuming they're the same string.
  async function sendCommand(device, value, optimisticState, busyFlag, setBusy) {
    if (busyFlag) return;
    setBusy(true);

    // remember previous state in case we need to roll back
    const previousValue = deviceState[device];

    // optimistic update: reflect the change immediately, don't wait for Realtime
    setDeviceState((prev) => ({ ...prev, [device]: optimisticState }));

    const { error } = await supabase
      .from("commands")
      .insert({ device, action: "set", value });

    if (error) {
      // rollback on failure
      setDeviceState((prev) => ({ ...prev, [device]: previousValue }));
      alert("Command failed: " + error.message);
    }

    setTimeout(() => setBusy(false), 1500);
  }

  // ---- ask the farm (Phase 7.4) ----
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
          <h1 className="text-2xl font-semibold tracking-tight">
            Field Control
          </h1>
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
        </div>
      )}

      <main className="px-6 py-8 max-w-6xl mx-auto space-y-10">
        {/* sensor gauges */}
        <section>
          <SectionLabel>Live Readings</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mt-3">
            <Dial
              label="Temp"
              value={latest?.temp}
              unit="°C"
              min={15}
              max={45}
              color={COLORS.chilli}
            />
            <Dial
              label="Humidity"
              value={latest?.humidity}
              unit="%"
              min={0}
              max={100}
              color={COLORS.leaf}
            />
            <Dial
              label="Soil"
              value={latest?.soil}
              unit=""
              min={0}
              max={1023}
              color={COLORS.amber}
              invert
            />
            <Dial
              label="Light"
              value={latest?.ldr}
              unit=""
              min={0}
              max={1023}
              color={COLORS.muted}
            />
            <RainTile rain={latest?.rain} />
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
                {aiScore?.dry_eta_minutes != null
                  ? formatMinutes(aiScore.dry_eta_minutes)
                  : "—"}
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
                <p
                  className="text-xs mt-3 font-mono"
                  style={{ color: COLORS.muted }}
                >
                  {new Date(insight.created_at).toLocaleString()}
                </p>
              )}
            </div>
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

// ---------------- subcomponents ----------------

function SectionLabel({ children }) {
  return (
    <h2
      style={{ color: COLORS.muted }}
      className="text-xs font-mono tracking-[0.2em] uppercase"
    >
      {children}
    </h2>
  );
}

function StatusPill({ stale, hasData }) {
  const label = !hasData ? "Connecting…" : stale ? "Stale" : "Live";
  const color = !hasData ? COLORS.muted : stale ? COLORS.chilli : COLORS.leaf;
  return (
    <div className="flex items-center gap-2 font-mono text-xs">
      <span
        style={{ background: color }}
        className="w-2 h-2 rounded-full inline-block"
      />
      <span style={{ color }}>{label}</span>
    </div>
  );
}

function Dial({ label, value, unit, min, max, color, invert }) {
  const hasValue = value != null;
  const pct = hasValue
    ? Math.min(1, Math.max(0, (value - min) / (max - min)))
    : 0;
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
        <div
          style={{ background: COLORS.bgRaised }}
          className="w-14 h-14 rounded-full flex items-center justify-center"
        >
          <span className="font-mono text-sm">
            {hasValue ? Math.round(value) : "--"}
            <span style={{ color: COLORS.muted }} className="text-[10px] ml-0.5">
              {unit}
            </span>
          </span>
        </div>
      </div>
      <p
        style={{ color: COLORS.muted }}
        className="text-xs font-mono mt-2 uppercase tracking-wide"
      >
        {label}
      </p>
    </div>
  );
}

function RainTile({ rain }) {
  const active = !!rain;
  return (
    <div
      style={{
        background: active ? COLORS.leaf : COLORS.bgRaised,
        borderColor: COLORS.hairline,
      }}
      className="rounded-xl border p-4 flex flex-col items-center justify-center transition"
    >
      <span className="text-2xl">{active ? "🌧" : "☀"}</span>
      <p
        style={{ color: active ? COLORS.cream : COLORS.muted }}
        className="text-xs font-mono mt-2 uppercase tracking-wide"
      >
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
        <p
          style={{ color: COLORS.muted }}
          className="text-xs font-mono mt-1 uppercase"
        >
          {state ?? "unknown"}
        </p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onClickOff}
          disabled={busy}
          style={{
            background: !isOn ? COLORS.leaf : "transparent",
            borderColor: COLORS.hairline,
          }}
          className="rounded-lg border px-3 py-1.5 text-sm font-mono disabled:opacity-50"
        >
          {offLabel}
        </button>
        <button
          onClick={onClickOn}
          disabled={busy}
          style={{
            background: isOn ? COLORS.chilli : "transparent",
            borderColor: COLORS.hairline,
          }}
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
      <div
        style={{ background: COLORS.hairline }}
        className="h-2 rounded-full overflow-hidden"
      >
        <div
          style={{ width: `${v}%`, background: color }}
          className="h-full transition-all duration-500"
        />
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