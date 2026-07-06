"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

// `data` = array of rows from the `readings` table, most-recent-first
// (same shape you already fetch for the "ask the farm" context).
export default function ReadingsChart({ data, colors }) {
  const formatted = data
    .slice()
    .reverse()
    .map((r) => ({
      time: new Date(r.created_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      Temp: r.temp,
      Humidity: r.humidity,
      Soil: r.soil,
    }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={formatted} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.hairline} />
        <XAxis dataKey="time" stroke={colors.muted} fontSize={11} />
        <YAxis stroke={colors.muted} fontSize={11} />
        <Tooltip
          contentStyle={{
            background: colors.bgRaised,
            border: `1px solid ${colors.hairline}`,
            color: colors.cream,
            fontSize: 12,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: colors.muted }} />
        <Line type="monotone" dataKey="Temp" stroke={colors.chilli} dot={false} strokeWidth={2} />
        <Line type="monotone" dataKey="Humidity" stroke={colors.leaf} dot={false} strokeWidth={2} />
        <Line type="monotone" dataKey="Soil" stroke={colors.amber} dot={false} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}
