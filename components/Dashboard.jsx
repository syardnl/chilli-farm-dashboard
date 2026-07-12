"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ChilliPlant3D from "./ChilliPlant3D";
import ReadingsChart from "./ReadingsChart";
import { getToken, onMessage } from "firebase/messaging";
import { getFirebaseMessaging } from "@/lib/firebase-client";


// ---------- design tokens ----------
const COLORS = {
  bg: "#03130D",
  bgRaised: "rgba(8, 40, 27, 0.72)",
  bgGlass: "rgba(10, 55, 37, 0.54)",
  hairline: "rgba(110, 231, 183, 0.22)",
  chilli: "#FF4D6D",
  leaf: "#39FF88",
  leafDark: "#00C853",
  neon: "#00FF9C",
  emerald: "#10B981",
  lime: "#A3FF12",
  amber: "#FFD166",
  cyan: "#44FFD2",
  cream: "#F0FFF8",
  muted: "#91B8A6",
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
  const [deviceMode, setDeviceMode] = useState({ pump: "auto", roof: "auto" });
  const [aiScore, setAiScore] = useState(null);
  const [insight, setInsight] = useState(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const [pumpBusy, setPumpBusy] = useState(false);
  const [roofBusy, setRoofBusy] = useState(false);
  const [notificationStatus, setNotificationStatus] =
  useState("default");

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

  useEffect(() => {
  let unsubscribe = null;

  async function initializeForegroundMessaging() {
    const messaging =
      await getFirebaseMessaging();

    if (!messaging) return;

    unsubscribe = onMessage(
      messaging,
      (payload) => {
        console.log(
          "Foreground notification:",
          payload
        );

        const title =
          payload.notification?.title ||
          payload.data?.title ||
          "Chilli Farm Alert";

        const body =
          payload.notification?.body ||
          payload.data?.body ||
          "A farm event has been detected.";

        if (
          Notification.permission === "granted"
        ) {
          new Notification(title, {
            body,
            icon: "/icons/icon-192.png",
          });
        }
      }
    );
  }

  initializeForegroundMessaging();

  return () => {
    if (unsubscribe) {
      unsubscribe();
    }
  };
}, []);

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
            if (row.mode) {
              setDeviceMode((prev) => ({ ...prev, [row.device]: row.mode }));
            }
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
          if (payload.new.mode) {
            setDeviceMode((prev) => ({
              ...prev,
              [payload.new.device]: payload.new.mode,
            }));
          }
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

  // ESP32 readings are the source of truth for actual actuator state and mode.
  useEffect(() => {
    if (!latest) return;

    const incoming = {};
    if (latest.pump) incoming.pump = latest.pump;
    if (latest.roof) incoming.roof = latest.roof;
    applyConfirmedDeviceState(incoming, {
      busySetters: { pump: setPumpBusy, roof: setRoofBusy },
    });

    setDeviceMode({
      pump: latest.pump_mode ? "manual" : "auto",
      roof: latest.roof_mode ? "manual" : "auto",
    });
  }, [latest]);

  async function sendAutoCommand(device, busyFlag, setBusy) {
    if (busyFlag) return;

    setBusy(true);
    setDeviceMode((prev) => ({ ...prev, [device]: "auto" }));

    const { error } = await supabase
      .from("commands")
      .insert({ device, action: "set", value: "auto" });

    if (error) {
      setBusy(false);
      alert("Command failed: " + error.message);
      return;
    }

    // Actual state is not guessed; it will be updated from ESP32 confirmation.
    setTimeout(() => setBusy(false), 1500);
  }

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
    setDeviceMode((prev) => ({ ...prev, [device]: "manual" }));

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

  async function enablePushNotifications() {
  try {
    if (!("Notification" in window)) {
      alert("Browser ini tidak menyokong notification.");
      return;
    }

    if (!("serviceWorker" in navigator)) {
      alert("Browser ini tidak menyokong service worker.");
      return;
    }

    const permission =
      await Notification.requestPermission();

    setNotificationStatus(permission);

    if (permission !== "granted") {
      alert(
        "Notification tidak dibenarkan. Sila benarkan melalui browser settings."
      );
      return;
    }

    const registration =
      await navigator.serviceWorker.register(
        "/firebase-messaging-sw.js"
      );

    await navigator.serviceWorker.ready;

    const messaging =
      await getFirebaseMessaging();

    if (!messaging) {
      alert(
        "Firebase Messaging tidak disokong pada browser ini."
      );
      return;
    }

    const token = await getToken(messaging, {
      vapidKey:
        process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      throw new Error(
        "FCM registration token tidak berjaya dijana."
      );
    }

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError) {
      throw sessionError;
    }

    if (!session?.user?.id) {
      throw new Error(
        "Sila log masuk sebelum mengaktifkan notification."
      );
    }

    const { error } = await supabase
  .from("push_subscriptions")
  .upsert(
    {
      user_id: session.user.id,
      token,
      user_agent: navigator.userAgent,
      platform:
        navigator.userAgentData?.platform ||
        navigator.platform ||
        "unknown",
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "token",
    }
  );

if (error) {
  throw error;
}

await registration.showNotification(
  "Chilli Farm Notifications Enabled",
  {
    body:
      "Telefon ini kini boleh menerima amaran daripada ladang.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: "notification-enabled",
    data: {
      url: "/",
    },
  }
);

alert("Notification berjaya diaktifkan.");

    if (error) {
      throw error;
    }

    await registration.showNotification(
  "Chilli Farm Notifications Enabled",
  {
    body:
      "Telefon ini kini boleh menerima amaran daripada ladang.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: {
      url: "/",
    },
  }
);

    alert("Notification berjaya diaktifkan.");
  } catch (error) {
    console.error(
      "Enable notification failed:",
      error
    );

    alert(
      `Gagal mengaktifkan notification: ${error.message}`
    );
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
      style={{ color: COLORS.cream, minHeight: "100vh" }}
      className="font-sans bombastic-dashboard relative overflow-hidden"
    >
      <style jsx global>{`
        :root {
          color-scheme: dark;
        }

        body {
          margin: 0;
          background: #03130d;
        }

        .bombastic-dashboard {
          background:
            radial-gradient(circle at 12% 10%, rgba(0, 255, 156, 0.17), transparent 26%),
            radial-gradient(circle at 88% 18%, rgba(68, 255, 210, 0.11), transparent 28%),
            radial-gradient(circle at 50% 100%, rgba(163, 255, 18, 0.09), transparent 32%),
            linear-gradient(145deg, #020b07 0%, #041b12 45%, #062719 100%);
        }

        .bombastic-dashboard::before {
          content: "";
          position: fixed;
          inset: 0;
          pointer-events: none;
          opacity: 0.34;
          background-image:
            linear-gradient(rgba(57,255,136,.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(57,255,136,.035) 1px, transparent 1px);
          background-size: 42px 42px;
          mask-image: linear-gradient(to bottom, black, transparent 85%);
        }

        .ambient-orb {
          position: fixed;
          width: 420px;
          height: 420px;
          border-radius: 999px;
          filter: blur(85px);
          opacity: .16;
          pointer-events: none;
          animation: floatOrb 12s ease-in-out infinite;
        }

        .ambient-orb.one {
          top: -120px;
          left: -90px;
          background: #00ff9c;
        }

        .ambient-orb.two {
          right: -120px;
          top: 25%;
          background: #44ffd2;
          animation-delay: -5s;
        }

        .ambient-orb.three {
          left: 34%;
          bottom: -210px;
          background: #a3ff12;
          animation-delay: -8s;
        }

        @keyframes floatOrb {
          0%, 100% { transform: translate3d(0,0,0) scale(1); }
          50% { transform: translate3d(28px,-24px,0) scale(1.08); }
        }

        .glass-card {
          background: linear-gradient(
            145deg,
            rgba(13, 53, 37, 0.82),
            rgba(5, 27, 18, 0.72)
          );
          border: 1px solid rgba(110, 231, 183, 0.2);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.045),
            0 18px 50px rgba(0,0,0,.28),
            0 0 0 1px rgba(0,255,156,.025);
          backdrop-filter: blur(18px);
          transition: transform .24s ease, border-color .24s ease, box-shadow .24s ease;
        }

        .glass-card:hover {
          transform: translateY(-4px);
          border-color: rgba(57,255,136,.48);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.07),
            0 24px 60px rgba(0,0,0,.34),
            0 0 34px rgba(0,255,156,.08);
        }

        .hero-title {
          background: linear-gradient(90deg, #f0fff8, #39ff88, #44ffd2, #f0fff8);
          background-size: 260% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: shimmerText 7s linear infinite;
        }

        @keyframes shimmerText {
          to { background-position: 260% 0; }
        }

        .neon-dot {
          box-shadow: 0 0 8px currentColor, 0 0 18px currentColor;
          animation: pulseDot 1.8s ease-in-out infinite;
        }

        @keyframes pulseDot {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.35); opacity: .68; }
        }

        .actuator-button {
          position: relative;
          overflow: hidden;
          transition: transform .18s ease, box-shadow .18s ease, opacity .18s ease;
        }

        .actuator-button:hover:not(:disabled) {
          transform: translateY(-2px) scale(1.02);
        }

        .actuator-button::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(120deg, transparent 20%, rgba(255,255,255,.18), transparent 80%);
          transform: translateX(-120%);
          transition: transform .55s ease;
        }

        .actuator-button:hover::after {
          transform: translateX(120%);
        }

        .section-label {
          text-shadow: 0 0 18px rgba(57,255,136,.28);
        }

        .dial-ring {
          filter: drop-shadow(0 0 12px rgba(57,255,136,.13));
        }

        .top-glow {
          box-shadow: 0 1px 0 rgba(57,255,136,.12), 0 12px 35px rgba(0,0,0,.2);
          backdrop-filter: blur(18px);
          background: rgba(2, 14, 9, .58);
        }
      `}</style>

      <div className="ambient-orb one" />
      <div className="ambient-orb two" />
      <div className="ambient-orb three" />
      {/* header */}
      <header
        style={{ borderColor: COLORS.hairline }}
        className="top-glow sticky top-0 z-40 border-b px-6 py-5 flex items-center justify-between"
      >
        <div>
          <p
            style={{ color: COLORS.muted }}
            className="text-xs tracking-[0.2em] uppercase font-mono"
          >
            Chilli Farm IoT
          </p>
          <h1 className="hero-title text-3xl sm:text-4xl font-black tracking-tight">
            Field Control
          </h1>
          <p className="text-xs sm:text-sm mt-1" style={{ color: COLORS.muted }}>
            Precision automation • Live intelligence • Total control
          </p>
        </div>
        <div className="flex items-center gap-4">
          <StatusPill stale={stale} hasData={!!latest} />

          <button
  onClick={enablePushNotifications}
  disabled={notificationStatus === "granted"}
  style={{
    color: COLORS.cream,
    borderColor: COLORS.hairline,
    background:
      notificationStatus === "granted"
        ? COLORS.leafDark
        : "transparent",
  }}
  className="
    actuator-button
    text-xs
    font-mono
    border
    rounded-xl
    px-4
    py-2
    disabled:opacity-70
  "
>
  {notificationStatus === "granted"
    ? "Notifications Enabled"
    : "Enable Notifications"}
</button>
          <button
            onClick={handleSignOut}
            style={{ color: COLORS.muted, borderColor: COLORS.hairline }}
            className="actuator-button text-xs font-mono border rounded-xl px-4 py-2 hover:opacity-90"
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

      <main className="relative z-10 px-5 sm:px-6 py-9 max-w-7xl mx-auto space-y-12">
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
            className="glass-card rounded-2xl border p-5 mt-3"
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
              mode={deviceMode.pump}
              onClickAuto={() => sendAutoCommand("pump", pumpBusy, setPumpBusy)}
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
              mode={deviceMode.roof}
              onClickAuto={() => sendAutoCommand("roof", roofBusy, setRoofBusy)}
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
              className="glass-card rounded-2xl border p-5 lg:col-span-1"
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
              className="glass-card rounded-2xl border p-5 lg:col-span-2"
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
            className="glass-card rounded-2xl border p-5 mt-4"
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
            className="glass-card rounded-2xl border p-5 mt-4"
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
                className="flex-1 rounded-xl border px-4 py-3 outline-none focus:ring-2 focus:ring-emerald-400/40 transition"
              />
              <button
                onClick={askFarm}
                disabled={asking}
                style={{ background: COLORS.leafDark }}
                className="actuator-button rounded-xl px-5 py-3 font-bold disabled:opacity-50 transition shadow-lg"
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
    <h2 style={{ color: COLORS.muted }} className="section-label text-xs font-mono tracking-[0.25em] uppercase">
      {children}
    </h2>
  );
}

function StatusPill({ stale, hasData }) {
  const label = !hasData ? "Connecting…" : stale ? "Stale" : "Live";
  const color = !hasData ? COLORS.muted : stale ? COLORS.chilli : COLORS.leaf;
  return (
    <div className="flex items-center gap-2 font-mono text-xs">
      <span style={{ background: color }} className="neon-dot w-2.5 h-2.5 rounded-full inline-block" />
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
      className="glass-card rounded-2xl border p-4 flex flex-col items-center"
    >
      <div
        className="dial-ring relative w-24 h-24 rounded-full flex items-center justify-center"
        style={{
          background: `conic-gradient(${color} ${angle}deg, ${COLORS.hairline} ${angle}deg 270deg, transparent 270deg 360deg)`,
        }}
      >
        <div style={{ background: COLORS.bgRaised }} className="w-16 h-16 rounded-full flex items-center justify-center shadow-inner">
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
      className="glass-card rounded-2xl border p-4 flex flex-col items-center justify-center transition"
    >
      <span className="text-4xl drop-shadow-lg">{active ? "🌧" : "☀"}</span>
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
  mode,
  onClickAuto,
  onClickOn,
  onClickOff,
}) {
  const isOn = state === stateOnValue;
  return (
    <div
      style={{ background: COLORS.bgRaised, borderColor: COLORS.hairline }}
      className="glass-card rounded-2xl border p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
    >
      <div>
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
            style={{
              background: "linear-gradient(145deg, rgba(57,255,136,.2), rgba(68,255,210,.08))",
              border: `1px solid ${COLORS.hairline}`,
              boxShadow: "0 0 24px rgba(57,255,136,.10)",
            }}
          >
            {name === "Pump" ? "💧" : "🏠"}
          </div>
          <div>
            <p className="font-bold text-lg">{name}</p>
            <p style={{ color: COLORS.muted }} className="text-xs font-mono mt-1 uppercase tracking-wider">
              {state ?? "unknown"} · {mode ?? "unknown"}
            </p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onClickAuto}
          disabled={busy}
          style={{
            background: mode === "auto"
              ? "linear-gradient(135deg, #00C853, #00FF9C)"
              : "rgba(255,255,255,.025)",
            borderColor: mode === "auto" ? COLORS.neon : COLORS.hairline,
            boxShadow: mode === "auto" ? "0 0 24px rgba(0,255,156,.25)" : "none",
          }}
          className="actuator-button rounded-xl border px-4 py-2 text-sm font-bold font-mono disabled:opacity-50"
        >
          AUTO
        </button>
        <button
          onClick={onClickOff}
          disabled={busy}
          style={{
            background: !isOn
              ? `linear-gradient(135deg, ${offColor}, ${COLORS.emerald})`
              : "rgba(255,255,255,.025)",
            borderColor: !isOn ? offColor : COLORS.hairline,
            boxShadow: !isOn ? `0 0 24px ${offColor}45` : "none",
          }}
          className="actuator-button rounded-xl border px-4 py-2 text-sm font-bold font-mono disabled:opacity-50"
        >
          {offLabel}
        </button>
        <button
          onClick={onClickOn}
          disabled={busy}
          style={{
            background: isOn
              ? `linear-gradient(135deg, ${onColor}, ${COLORS.neon})`
              : "rgba(255,255,255,.025)",
            borderColor: isOn ? onColor : COLORS.hairline,
            boxShadow: isOn ? `0 0 24px ${onColor}45` : "none",
          }}
          className="actuator-button rounded-xl border px-4 py-2 text-sm font-bold font-mono disabled:opacity-50"
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
