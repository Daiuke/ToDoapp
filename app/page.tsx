"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ============================================================
// 型定義
// ============================================================
type WeatherType = "sunny" | "cloudy" | "rainy" | "snowy";
type TabType = "current" | "history" | "graph";
type GraphMetric = "vpd" | "temp" | "humidity";

interface Measurement {
  id: string;
  timestamp: number;
  temperature: number; // °C
  humidity: number;    // %
  vpd: number;         // g/m³
  weather: WeatherType;
  note?: string;
}

// ============================================================
// 飽差計算（日本農業標準：g/m³ 単位）
// ============================================================
function calcVPD(temp: number, humidity: number): number {
  // 飽和水蒸気圧 Es [hPa]
  const es = 6.1078 * Math.pow(10, (7.5 * temp) / (237.3 + temp));
  // 飽和水蒸気量 ρmax [g/m³]
  const rhoMax = (217 * es) / (temp + 273.15);
  // 飽差 VPD [g/m³]
  const vpd = rhoMax * (1 - humidity / 100);
  return Math.max(0, Math.round(vpd * 10) / 10);
}

// ============================================================
// 飽差ステータス定義
// ============================================================
interface VPDStatus {
  id: string;
  label: string;
  emoji: string;
  vpdRange: string;
  description: string;
  actions: { emoji: string; text: string }[];
  // Tailwind色クラス
  bg: string;
  border: string;
  textColor: string;
  badgeBg: string;
  barColor: string;
  // SVG用カラー
  svgColor: string;
  svgZoneFill: string;
}

function getVPDStatus(vpd: number): VPDStatus {
  if (vpd < 3) {
    return {
      id: "high",
      label: "高湿度環境",
      emoji: "💧",
      vpdRange: "0〜3 g/m³",
      description:
        "気孔は開いていますが蒸散が行われていません。\nカビ・病害が発生しやすい状態です。",
      actions: [
        { emoji: "🌀", text: "除湿機を稼働させる" },
        { emoji: "🪟", text: "窓を開けて換気する" },
        { emoji: "🌡️", text: "暖房で温度を少し上げる" },
      ],
      bg: "bg-blue-50",
      border: "border-blue-400",
      textColor: "text-blue-800",
      badgeBg: "bg-blue-100",
      barColor: "bg-blue-500",
      svgColor: "#2563eb",
      svgZoneFill: "#dbeafe",
    };
  }
  if (vpd <= 6) {
    return {
      id: "optimal",
      label: "適切な飽差",
      emoji: "✅",
      vpdRange: "3〜6 g/m³",
      description:
        "気孔が適切に開き蒸散が活発です。\nいちごの生育に最適な状態です！",
      actions: [
        { emoji: "👍", text: "現在の環境を維持する" },
        { emoji: "📝", text: "定期的に記録を続ける" },
      ],
      bg: "bg-green-50",
      border: "border-green-500",
      textColor: "text-green-800",
      badgeBg: "bg-green-100",
      barColor: "bg-green-500",
      svgColor: "#16a34a",
      svgZoneFill: "#dcfce7",
    };
  }
  if (vpd <= 10) {
    return {
      id: "tolerable",
      label: "許容範囲の飽差",
      emoji: "⚠️",
      vpdRange: "6〜10 g/m³",
      description:
        "許容できる範囲ですが乾燥気味です。\n適切な飽差に近づけるよう管理してください。",
      actions: [
        { emoji: "💦", text: "加湿を検討する" },
        { emoji: "🌿", text: "植物の状態をよく観察する" },
        { emoji: "🌡️", text: "急激な温度変化に注意する" },
      ],
      bg: "bg-amber-50",
      border: "border-amber-400",
      textColor: "text-amber-800",
      badgeBg: "bg-amber-100",
      barColor: "bg-amber-500",
      svgColor: "#d97706",
      svgZoneFill: "#fef3c7",
    };
  }
  if (vpd <= 15) {
    return {
      id: "low",
      label: "低湿度環境（注意）",
      emoji: "🔸",
      vpdRange: "10〜15 g/m³",
      description:
        "急激な温度上昇や湿度低下により\n気孔が閉じています。早めに対処してください。",
      actions: [
        { emoji: "💦", text: "すぐに加湿・噴霧する" },
        { emoji: "🌿", text: "遮光ネットを設置する" },
        { emoji: "🌀", text: "換気を控えめにする" },
      ],
      bg: "bg-orange-50",
      border: "border-orange-400",
      textColor: "text-orange-800",
      badgeBg: "bg-orange-100",
      barColor: "bg-orange-500",
      svgColor: "#ea580c",
      svgZoneFill: "#ffedd5",
    };
  }
  // vpd > 15
  return {
    id: "danger",
    label: "低湿度環境（危険）",
    emoji: "🚨",
    vpdRange: "15 g/m³以上",
    description:
      "気孔が完全に閉じており植物がダメージを\n受けています。今すぐ対処してください！",
    actions: [
      { emoji: "🚨", text: "今すぐ加湿・噴霧する" },
      { emoji: "🌿", text: "遮光ネットを設置する" },
      { emoji: "🌀", text: "換気を止める" },
      { emoji: "📞", text: "農業指導員に連絡する" },
    ],
    bg: "bg-red-50",
    border: "border-red-500",
    textColor: "text-red-800",
    badgeBg: "bg-red-100",
    barColor: "bg-red-500",
    svgColor: "#dc2626",
    svgZoneFill: "#fee2e2",
  };
}

// ============================================================
// 天気オプション
// ============================================================
const WEATHER_OPTIONS: { value: WeatherType; label: string; emoji: string }[] =
  [
    { value: "sunny", label: "晴れ", emoji: "☀️" },
    { value: "cloudy", label: "曇り", emoji: "☁️" },
    { value: "rainy", label: "雨", emoji: "🌧️" },
    { value: "snowy", label: "雪", emoji: "❄️" },
  ];

// ============================================================
// ユーティリティ
// ============================================================
function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}月${dd}日 ${hh}:${min}`;
}

function formatTimeOnly(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatJapaneseDate(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${"日月火水木金土"[d.getDay()]}）`;
}

// ============================================================
// VPDゲージコンポーネント
// ============================================================
function VPDGauge({ vpd }: { vpd: number }) {
  const MAX = 20;
  const pct = Math.min((vpd / MAX) * 100, 100);
  const status = getVPDStatus(vpd);

  // ゲージのグラデーション定義
  const zones = [
    { from: 0, to: 15, color: "#3b82f6" },   // 青: 高湿度
    { from: 15, to: 30, color: "#22c55e" },   // 緑: 適切
    { from: 30, to: 50, color: "#f59e0b" },   // 黄: 許容
    { from: 50, to: 75, color: "#f97316" },   // オレンジ: 低湿度注意
    { from: 75, to: 100, color: "#ef4444" },  // 赤: 低湿度危険
  ];

  return (
    <div className="w-full">
      {/* メインVPD数値 */}
      <div className="text-center mb-4">
        <div className={`text-8xl font-black leading-none ${status.textColor} animate-fade-in`}
          style={{ textShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
          {vpd.toFixed(1)}
        </div>
        <div className={`text-2xl font-semibold ${status.textColor} mt-1 opacity-80`}>
          g/m³
        </div>
      </div>

      {/* ゲージバー */}
      <div className="relative h-5 rounded-full overflow-hidden mb-1"
        style={{
          background:
            "linear-gradient(to right, #3b82f6 0%, #22c55e 15%, #f59e0b 30%, #f97316 50%, #ef4444 75%, #ef4444 100%)",
        }}>
        {/* インジケーター */}
        <div
          className="absolute top-0 h-full w-1.5 bg-gray-900 rounded-full shadow-lg transition-all duration-500"
          style={{ left: `calc(${pct}% - 3px)` }}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-400 px-0.5">
        <span>0</span>
        <span>3</span>
        <span>6</span>
        <span>10</span>
        <span>15</span>
        <span>20</span>
      </div>
    </div>
  );
}

// ============================================================
// SVGグラフコンポーネント
// ============================================================
function VPDLineChart({
  data,
  metric,
}: {
  data: Measurement[];
  metric: GraphMetric;
}) {
  if (data.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-gray-400">
        <div className="text-5xl mb-3">📈</div>
        <p className="text-lg">記録が2件以上になると</p>
        <p className="text-lg">グラフが表示されます</p>
      </div>
    );
  }

  const recent = data.slice(-24); // 最新24件
  const W = 560;
  const H = 220;
  const PAD = { top: 16, right: 24, bottom: 44, left: 48 };
  const gW = W - PAD.left - PAD.right;
  const gH = H - PAD.top - PAD.bottom;

  // メトリクス設定
  const metricConfig = {
    vpd: {
      getValue: (m: Measurement) => m.vpd,
      min: 0,
      max: 20,
      unit: "g/m³",
      label: "飽差",
      color: "#16a34a",
      // 色帯: VPD専用
      zones: [
        { from: 0, to: 3, fill: "#dbeafe" },
        { from: 3, to: 6, fill: "#dcfce7" },
        { from: 6, to: 10, fill: "#fef3c7" },
        { from: 10, to: 20, fill: "#fee2e2" },
      ],
      gridLines: [3, 6, 10, 15],
      yLabels: [0, 3, 6, 10, 15, 20],
    },
    temp: {
      getValue: (m: Measurement) => m.temperature,
      min: 0,
      max: 40,
      unit: "°C",
      label: "温度",
      color: "#dc2626",
      zones: [] as { from: number; to: number; fill: string }[],
      gridLines: [10, 20, 30],
      yLabels: [0, 10, 20, 30, 40],
    },
    humidity: {
      getValue: (m: Measurement) => m.humidity,
      min: 0,
      max: 100,
      unit: "%",
      label: "湿度",
      color: "#2563eb",
      zones: [] as { from: number; to: number; fill: string }[],
      gridLines: [25, 50, 75],
      yLabels: [0, 25, 50, 75, 100],
    },
  }[metric];

  const values = recent.map(metricConfig.getValue);
  const xScale = (i: number) =>
    gW * (i / Math.max(recent.length - 1, 1));
  const yScale = (v: number) =>
    gH - ((v - metricConfig.min) / (metricConfig.max - metricConfig.min)) * gH;

  // パス生成
  const linePath = recent
    .map((m, i) => `${i === 0 ? "M" : "L"}${xScale(i).toFixed(1)},${yScale(metricConfig.getValue(m)).toFixed(1)}`)
    .join(" ");

  // エリアパス
  const areaPath =
    linePath +
    ` L${xScale(recent.length - 1).toFixed(1)},${gH} L0,${gH} Z`;

  // X軸ラベルの間隔
  const xLabelStep = Math.ceil(recent.length / 6);

  return (
    <div className="w-full overflow-x-auto -mx-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ minWidth: 280 }}
        aria-label={`${metricConfig.label}のグラフ`}
      >
        <defs>
          <linearGradient id={`area-grad-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={metricConfig.color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={metricConfig.color} stopOpacity="0.02" />
          </linearGradient>
          <clipPath id="chart-clip">
            <rect x="0" y="0" width={gW} height={gH} />
          </clipPath>
        </defs>

        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {/* 色帯（VPDのみ） */}
          {metricConfig.zones.map((z) => {
            const y1 = yScale(z.to);
            const y2 = yScale(z.from);
            return (
              <rect
                key={z.from}
                x={0}
                y={y1}
                width={gW}
                height={y2 - y1}
                fill={z.fill}
                opacity={0.7}
                clipPath="url(#chart-clip)"
              />
            );
          })}

          {/* グリッドライン */}
          {metricConfig.gridLines.map((v) => (
            <g key={v}>
              <line
                x1={0} y1={yScale(v)} x2={gW} y2={yScale(v)}
                stroke="#9ca3af" strokeWidth={0.8} strokeDasharray="4,4"
              />
              <text
                x={-6} y={yScale(v) + 4}
                textAnchor="end" fontSize={10} fill="#9ca3af"
              >
                {v}
              </text>
            </g>
          ))}

          {/* Y軸ラベル（端） */}
          {metricConfig.yLabels
            .filter((v) => !metricConfig.gridLines.includes(v))
            .map((v) => (
              <text
                key={v}
                x={-6} y={yScale(v) + 4}
                textAnchor="end" fontSize={10} fill="#9ca3af"
              >
                {v}
              </text>
            ))}

          {/* エリア */}
          <path
            d={areaPath}
            fill={`url(#area-grad-${metric})`}
            clipPath="url(#chart-clip)"
          />

          {/* ライン */}
          <path
            d={linePath}
            fill="none"
            stroke={metricConfig.color}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            clipPath="url(#chart-clip)"
          />

          {/* データ点 */}
          {recent.map((m, i) => {
            const v = metricConfig.getValue(m);
            const dotColor =
              metric === "vpd" ? getVPDStatus(m.vpd).svgColor : metricConfig.color;
            return (
              <circle
                key={m.id}
                cx={xScale(i)} cy={yScale(v)} r={4}
                fill={dotColor}
                stroke="white" strokeWidth={1.5}
              />
            );
          })}

          {/* X軸ラベル */}
          {recent.map((m, i) => {
            if (i % xLabelStep !== 0 && i !== recent.length - 1) return null;
            return (
              <text
                key={m.id}
                x={xScale(i)} y={gH + 18}
                textAnchor="middle" fontSize={9} fill="#6b7280"
              >
                {formatTimeOnly(m.timestamp)}
              </text>
            );
          })}

          {/* 軸 */}
          <line x1={0} y1={0} x2={0} y2={gH} stroke="#d1d5db" strokeWidth={1} />
          <line x1={0} y1={gH} x2={gW} y2={gH} stroke="#d1d5db" strokeWidth={1} />

          {/* Y軸単位 */}
          <text
            x={-36} y={gH / 2}
            textAnchor="middle" fontSize={10} fill="#9ca3af"
            transform={`rotate(-90, -36, ${gH / 2})`}
          >
            {metricConfig.unit}
          </text>
        </g>
      </svg>
    </div>
  );
}

// ============================================================
// 数値インプットコンポーネント（±ボタン付き）
// ============================================================
function NumberInput({
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
  color = "green",
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  color?: string;
}) {
  const accent = color === "red" ? "bg-red-500" : color === "blue" ? "bg-blue-500" : "bg-green-600";
  const border = color === "red" ? "focus:border-red-400" : color === "blue" ? "focus:border-blue-400" : "focus:border-green-400";
  const ring = color === "red" ? "#ef4444" : color === "blue" ? "#3b82f6" : "#16a34a";

  const pct = ((value - min) / (max - min)) * 100;

  const handleChange = (v: number) => {
    onChange(Math.round(Math.min(max, Math.max(min, v)) / step) * step);
  };

  return (
    <div className="mb-6">
      {/* ラベルと数値表示 */}
      <div className="flex items-center justify-between mb-3">
        <label className="text-xl font-bold text-gray-700">{label}</label>
        <div className="flex items-center gap-2">
          {/* マイナスボタン */}
          <button
            onClick={() => handleChange(value - step)}
            className={`w-10 h-10 rounded-full ${accent} text-white text-2xl font-light flex items-center justify-center shadow-sm active:scale-90 transition-transform`}
            aria-label={`${label}を下げる`}
          >
            −
          </button>
          {/* 数値入力 */}
          <input
            type="number"
            value={value}
            onChange={(e) => handleChange(Number(e.target.value))}
            min={min} max={max} step={step}
            className={`w-24 text-center text-3xl font-black text-gray-800 border-2 border-gray-200 rounded-xl py-2 outline-none transition-colors ${border}`}
            style={{ fontVariantNumeric: "tabular-nums" }}
          />
          <span className="text-xl font-semibold text-gray-500 w-10">{unit}</span>
          {/* プラスボタン */}
          <button
            onClick={() => handleChange(value + step)}
            className={`w-10 h-10 rounded-full ${accent} text-white text-2xl font-light flex items-center justify-center shadow-sm active:scale-90 transition-transform`}
            aria-label={`${label}を上げる`}
          >
            ＋
          </button>
        </div>
      </div>
      {/* スライダー */}
      <div className="relative">
        <div
          className="absolute top-0 left-0 h-full rounded-full transition-all duration-200"
          style={{
            width: `${pct}%`,
            background: ring,
            opacity: 0.25,
            pointerEvents: "none",
          }}
        />
        <input
          type="range"
          value={value}
          onChange={(e) => handleChange(Number(e.target.value))}
          min={min} max={max} step={step}
          className="w-full relative z-10"
          style={{ accentColor: ring }}
        />
      </div>
      <div className="flex justify-between text-sm text-gray-400 mt-1 px-1">
        <span>{min}{unit}</span>
        <span>{Math.round((min + max) / 2)}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

// ============================================================
// メインアプリ
// ============================================================
export default function VPDApp() {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<TabType>("current");
  const [graphMetric, setGraphMetric] = useState<GraphMetric>("vpd");
  const [measurements, setMeasurements] = useState<Measurement[]>([]);

  // 現在の入力値
  const [temperature, setTemperature] = useState(22);
  const [humidity, setHumidity] = useState(70);
  const [weather, setWeather] = useState<WeatherType>("sunny");

  // 記録済みフィードバック
  const [savedFeedback, setSavedFeedback] = useState(false);

  // 現在時刻（1分毎更新）
  const [now, setNow] = useState(new Date());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // ローカルストレージ読み込み
    try {
      const raw = localStorage.getItem("vpd-data-v2");
      if (raw) setMeasurements(JSON.parse(raw));
    } catch {
      setMeasurements([]);
    }
    setMounted(true);

    // 時計更新
    timerRef.current = setInterval(() => setNow(new Date()), 60000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem("vpd-data-v2", JSON.stringify(measurements));
    } catch {
      // QuotaExceededError などは無視
    }
  }, [measurements, mounted]);

  // リアルタイム飽差計算
  const vpd = calcVPD(temperature, humidity);
  const status = getVPDStatus(vpd);

  // 記録処理
  const handleRecord = useCallback(() => {
    const entry: Measurement = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      temperature,
      humidity,
      vpd,
      weather,
    };
    setMeasurements((prev) => [...prev, entry]);
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2500);
  }, [temperature, humidity, vpd, weather]);

  // 削除処理
  const handleDelete = useCallback((id: string) => {
    setMeasurements((prev) => prev.filter((m) => m.id !== id));
  }, []);

  // 全削除
  const handleDeleteAll = useCallback(() => {
    if (window.confirm("すべての記録を削除しますか？\nこの操作は元に戻せません。")) {
      setMeasurements([]);
    }
  }, []);

  // ローディング
  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-green-50">
        <div className="text-center">
          <div className="text-5xl mb-3">🍓</div>
          <p className="text-green-700 text-xl font-medium">読み込み中...</p>
        </div>
      </div>
    );
  }

  // 統計情報
  const stats = (() => {
    if (measurements.length === 0) return null;
    const vpds = measurements.map((m) => m.vpd);
    const avg = vpds.reduce((a, b) => a + b, 0) / vpds.length;
    return {
      count: measurements.length,
      avg: avg.toFixed(1),
      min: Math.min(...vpds).toFixed(1),
      max: Math.max(...vpds).toFixed(1),
      optimal: Math.round(
        (measurements.filter((m) => m.vpd >= 3 && m.vpd <= 6).length /
          measurements.length) *
          100
      ),
    };
  })();

  // VPD範囲テーブル
  const vpdRangeTable = [
    {
      range: "0〜3 g/m³",
      status: "高湿度環境",
      emoji: "💧",
      action: "除湿・換気",
      bg: "bg-blue-50",
      text: "text-blue-700",
      badge: "bg-blue-100 text-blue-700",
    },
    {
      range: "3〜6 g/m³",
      status: "適切な飽差 ✅",
      emoji: "✅",
      action: "現状維持",
      bg: "bg-green-50",
      text: "text-green-700",
      badge: "bg-green-100 text-green-700",
    },
    {
      range: "6〜10 g/m³",
      status: "許容範囲",
      emoji: "⚠️",
      action: "加湿を検討",
      bg: "bg-amber-50",
      text: "text-amber-700",
      badge: "bg-amber-100 text-amber-700",
    },
    {
      range: "10〜15 g/m³",
      status: "低湿度（注意）",
      emoji: "🔸",
      action: "加湿・噴霧・遮光",
      bg: "bg-orange-50",
      text: "text-orange-700",
      badge: "bg-orange-100 text-orange-700",
    },
    {
      range: "15 g/m³以上",
      status: "低湿度（危険）",
      emoji: "🚨",
      action: "緊急対処が必要",
      bg: "bg-red-50",
      text: "text-red-700",
      badge: "bg-red-100 text-red-700",
    },
  ];

  return (
    <main className="min-h-screen bg-gray-50 select-none">
      {/* ============ ヘッダー ============ */}
      <header className="bg-green-700 text-white shadow-lg sticky top-0 z-20">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-3xl">🍓</span>
              <div>
                <h1 className="text-xl font-black tracking-wide leading-tight">
                  飽差管理アプリ
                </h1>
                <p className="text-green-200 text-sm leading-tight">
                  いちご栽培サポート
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold tabular-nums">
                {String(now.getHours()).padStart(2, "0")}:
                {String(now.getMinutes()).padStart(2, "0")}
              </div>
              <div className="text-green-200 text-xs">
                {formatJapaneseDate(now)}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ============ タブナビ ============ */}
      <nav className="bg-white border-b-2 border-gray-100 sticky top-[72px] z-10 shadow-sm">
        <div className="max-w-2xl mx-auto flex">
          {(
            [
              { id: "current", label: "現在の状態", icon: "📊" },
              { id: "history", label: "記録履歴", icon: "📋" },
              { id: "graph", label: "グラフ", icon: "📈" },
            ] as { id: TabType; label: string; icon: string }[]
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-3 text-center transition-all duration-200 border-b-3 ${
                tab === t.id
                  ? "text-green-700 border-b-[3px] border-green-600 bg-green-50 font-bold"
                  : "text-gray-500 border-b-[3px] border-transparent hover:bg-gray-50 font-medium"
              }`}
            >
              <div className="text-2xl leading-tight">{t.icon}</div>
              <div className="text-sm mt-0.5">{t.label}</div>
            </button>
          ))}
        </div>
      </nav>

      {/* ============ コンテンツ ============ */}
      <div className="max-w-2xl mx-auto px-4 py-5 pb-10">

        {/* ====== 現在の状態タブ ====== */}
        {tab === "current" && (
          <div className="space-y-4 tab-content">

            {/* 天気選択 */}
            <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-xl font-bold text-gray-700 mb-3 flex items-center gap-2">
                <span>🌤</span> 今日の天気
              </h2>
              <div className="grid grid-cols-4 gap-2">
                {WEATHER_OPTIONS.map((w) => (
                  <button
                    key={w.value}
                    onClick={() => setWeather(w.value)}
                    className={`py-4 rounded-2xl text-center transition-all duration-150 ${
                      weather === w.value
                        ? "bg-green-100 border-2 border-green-500 shadow-md scale-105"
                        : "bg-gray-50 border-2 border-transparent hover:bg-gray-100 active:scale-95"
                    }`}
                  >
                    <div className="text-4xl leading-tight">{w.emoji}</div>
                    <div className="text-base font-medium text-gray-600 mt-1">
                      {w.label}
                    </div>
                  </button>
                ))}
              </div>
            </section>

            {/* 温度・湿度入力 */}
            <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-xl font-bold text-gray-700 mb-4 flex items-center gap-2">
                <span>🌡️</span> 温度・湿度の入力
              </h2>
              <NumberInput
                label="温 度"
                unit="°C"
                value={temperature}
                min={0}
                max={45}
                step={0.5}
                onChange={setTemperature}
                color="red"
              />
              <NumberInput
                label="湿 度"
                unit="%"
                value={humidity}
                min={0}
                max={100}
                step={1}
                onChange={setHumidity}
                color="blue"
              />
            </section>

            {/* 飽差表示 */}
            <section
              className={`rounded-2xl shadow-md border-2 p-5 transition-all duration-500 ${status.bg} ${status.border}`}
            >
              <h2 className="text-xl font-bold text-gray-700 mb-4 flex items-center gap-2">
                <span>💨</span> 飽差（VPD）
              </h2>

              {/* ゲージ */}
              <VPDGauge vpd={vpd} />

              {/* ステータスバッジ */}
              <div
                className={`flex items-center justify-center gap-3 mt-5 py-4 px-5 rounded-2xl ${status.badgeBg}`}
              >
                <span className="text-4xl">{status.emoji}</span>
                <span className={`text-2xl font-black ${status.textColor}`}>
                  {status.label}
                </span>
              </div>

              {/* 説明文 */}
              <p
                className={`text-lg ${status.textColor} mt-3 text-center leading-relaxed whitespace-pre-line`}
              >
                {status.description}
              </p>
            </section>

            {/* 対処方法 */}
            <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-xl font-bold text-gray-700 mb-3 flex items-center gap-2">
                <span>👨‍🌾</span> 今すぐやること
              </h2>
              <div className="space-y-3">
                {status.actions.map((action, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-4 py-4 px-5 rounded-2xl ${status.badgeBg} action-card`}
                  >
                    <span className="text-4xl flex-shrink-0">{action.emoji}</span>
                    <span className={`text-xl font-bold ${status.textColor}`}>
                      {action.text}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* 飽差一覧表 */}
            <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-xl font-bold text-gray-700 mb-3 flex items-center gap-2">
                <span>📋</span> 飽差の目安一覧
              </h2>
              <div className="space-y-2">
                {vpdRangeTable.map((row) => {
                  const isCurrent =
                    (row.range === "0〜3 g/m³" && vpd < 3) ||
                    (row.range === "3〜6 g/m³" && vpd >= 3 && vpd <= 6) ||
                    (row.range === "6〜10 g/m³" && vpd > 6 && vpd <= 10) ||
                    (row.range === "10〜15 g/m³" && vpd > 10 && vpd <= 15) ||
                    (row.range === "15 g/m³以上" && vpd > 15);
                  return (
                    <div
                      key={row.range}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl ${row.bg} ${
                        isCurrent
                          ? "ring-2 ring-green-500 ring-offset-1 shadow-sm"
                          : ""
                      }`}
                    >
                      <span className="text-2xl flex-shrink-0">{row.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className={`text-base font-bold ${row.text}`}>
                          {row.range}
                        </div>
                        <div className={`text-sm ${row.text} opacity-80`}>
                          {row.status}　→　{row.action}
                        </div>
                      </div>
                      {isCurrent && (
                        <span className="text-green-700 font-black text-lg flex-shrink-0">
                          ◀ 現在
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 記録ボタン */}
            <button
              onClick={handleRecord}
              className={`record-btn w-full py-6 rounded-2xl text-2xl font-black shadow-lg transition-all duration-200 ${
                savedFeedback
                  ? "bg-green-500 text-white scale-98"
                  : "bg-green-700 text-white hover:bg-green-800 active:scale-97"
              }`}
            >
              {savedFeedback ? "✅　記録しました！" : "📝　記録する"}
            </button>

            {measurements.length > 0 && (
              <p className="text-center text-gray-400 text-base">
                これまでの記録：{measurements.length}件
              </p>
            )}
          </div>
        )}

        {/* ====== 記録履歴タブ ====== */}
        {tab === "history" && (
          <div className="tab-content">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-black text-gray-700">記録履歴</h2>
              <div className="flex items-center gap-3">
                <span className="text-lg text-gray-500">{measurements.length}件</span>
                {measurements.length > 0 && (
                  <button
                    onClick={handleDeleteAll}
                    className="text-sm text-red-400 hover:text-red-600 border border-red-200 rounded-lg px-3 py-1 transition-colors"
                  >
                    全削除
                  </button>
                )}
              </div>
            </div>

            {measurements.length === 0 ? (
              <div className="bg-white rounded-2xl p-12 text-center text-gray-400 shadow-sm">
                <div className="text-6xl mb-4">📋</div>
                <p className="text-xl font-medium">まだ記録がありません</p>
                <p className="text-lg mt-2">
                  「現在の状態」タブで記録してください
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {[...measurements].reverse().map((m) => {
                  const s = getVPDStatus(m.vpd);
                  const w = WEATHER_OPTIONS.find((o) => o.value === m.weather);
                  return (
                    <div
                      key={m.id}
                      className={`bg-white rounded-2xl shadow-sm border-2 p-4 ${s.border} transition-all`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          {/* ヘッダー行 */}
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-3xl">{w?.emoji}</span>
                            <span className="text-lg font-medium text-gray-500">
                              {formatTimestamp(m.timestamp)}
                            </span>
                          </div>

                          {/* 数値グリッド */}
                          <div className="grid grid-cols-3 gap-2 mb-3">
                            <div className={`text-center py-2 rounded-xl ${s.badgeBg}`}>
                              <div className="text-xs text-gray-500 mb-0.5">温度</div>
                              <div className="text-2xl font-black text-red-700">
                                {m.temperature}
                              </div>
                              <div className="text-sm text-gray-500">°C</div>
                            </div>
                            <div className={`text-center py-2 rounded-xl ${s.badgeBg}`}>
                              <div className="text-xs text-gray-500 mb-0.5">湿度</div>
                              <div className="text-2xl font-black text-blue-700">
                                {m.humidity}
                              </div>
                              <div className="text-sm text-gray-500">%</div>
                            </div>
                            <div className={`text-center py-2 rounded-xl ${s.badgeBg}`}>
                              <div className="text-xs text-gray-500 mb-0.5">飽差</div>
                              <div className={`text-2xl font-black ${s.textColor}`}>
                                {m.vpd}
                              </div>
                              <div className="text-sm text-gray-500">g/m³</div>
                            </div>
                          </div>

                          {/* ステータスバッジ */}
                          <div
                            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full ${s.badgeBg}`}
                          >
                            <span className="text-xl">{s.emoji}</span>
                            <span className={`text-base font-bold ${s.textColor}`}>
                              {s.label}
                            </span>
                          </div>
                        </div>

                        {/* 削除ボタン */}
                        <button
                          onClick={() => handleDelete(m.id)}
                          className="text-gray-300 hover:text-red-400 transition-colors p-2 flex-shrink-0 text-2xl"
                          aria-label="削除"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ====== グラフタブ ====== */}
        {tab === "graph" && (
          <div className="tab-content space-y-4">
            <h2 className="text-2xl font-black text-gray-700">グラフ</h2>

            {/* 統計カード */}
            {stats && (
              <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h3 className="text-lg font-bold text-gray-600 mb-3">
                  📊 記録の統計（全{stats.count}件）
                </h3>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  {[
                    { label: "平均飽差", value: stats.avg, unit: "g/m³", color: "text-green-700" },
                    { label: "最小飽差", value: stats.min, unit: "g/m³", color: "text-blue-700" },
                    { label: "最大飽差", value: stats.max, unit: "g/m³", color: "text-red-700" },
                    {
                      label: "適切な飽差の割合",
                      value: `${stats.optimal}`,
                      unit: "%",
                      color: "text-green-700",
                    },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="bg-gray-50 rounded-xl py-3 px-4 text-center"
                    >
                      <div className={`text-3xl font-black ${s.color} tabular-nums`}>
                        {s.value}
                        <span className="text-lg ml-0.5">{s.unit}</span>
                      </div>
                      <div className="text-sm text-gray-500 mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* 適切率バー */}
                <div>
                  <div className="flex justify-between text-sm text-gray-500 mb-1">
                    <span>適切な飽差（3〜6 g/m³）の割合</span>
                    <span className="font-bold text-green-700">{stats.optimal}%</span>
                  </div>
                  <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full transition-all duration-700"
                      style={{ width: `${stats.optimal}%` }}
                    />
                  </div>
                </div>
              </section>
            )}

            {/* グラフ本体 */}
            <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              {/* メトリクス切り替え */}
              <div className="flex gap-2 mb-4">
                {(
                  [
                    { id: "vpd", label: "飽差", color: "bg-green-100 text-green-700 border-green-300" },
                    { id: "temp", label: "温度", color: "bg-red-100 text-red-700 border-red-300" },
                    { id: "humidity", label: "湿度", color: "bg-blue-100 text-blue-700 border-blue-300" },
                  ] as { id: GraphMetric; label: string; color: string }[]
                ).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setGraphMetric(m.id)}
                    className={`flex-1 py-2 rounded-xl text-base font-bold border-2 transition-all ${
                      graphMetric === m.id
                        ? m.color + " shadow-sm"
                        : "bg-gray-50 text-gray-400 border-gray-100"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <VPDLineChart data={measurements} metric={graphMetric} />

              {/* 凡例（飽差グラフのみ） */}
              {graphMetric === "vpd" && measurements.length >= 2 && (
                <div className="flex flex-wrap gap-3 mt-4 justify-center">
                  {[
                    { color: "bg-red-200", label: "低湿度（危険）" },
                    { color: "bg-amber-200", label: "許容範囲" },
                    { color: "bg-green-200", label: "✅ 適切" },
                    { color: "bg-blue-200", label: "高湿度" },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-1.5">
                      <div className={`w-5 h-5 rounded ${item.color}`} />
                      <span className="text-sm text-gray-600">{item.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* 最新5件のサマリー */}
            {measurements.length > 0 && (
              <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h3 className="text-lg font-bold text-gray-600 mb-3">
                  🕐 最新の記録（5件）
                </h3>
                <div className="space-y-2">
                  {[...measurements]
                    .reverse()
                    .slice(0, 5)
                    .map((m) => {
                      const s = getVPDStatus(m.vpd);
                      const w = WEATHER_OPTIONS.find(
                        (o) => o.value === m.weather
                      );
                      return (
                        <div
                          key={m.id}
                          className="flex items-center gap-3 py-2 px-3 bg-gray-50 rounded-xl"
                        >
                          <span className="text-2xl">{w?.emoji}</span>
                          <span className="text-base text-gray-500 flex-shrink-0">
                            {formatTimestamp(m.timestamp)}
                          </span>
                          <div className="flex-1 text-right flex items-center justify-end gap-2">
                            <span className="text-base text-gray-600">
                              {m.temperature}°C / {m.humidity}%
                            </span>
                            <span
                              className={`px-3 py-1 rounded-full text-base font-bold ${s.badgeBg} ${s.textColor}`}
                            >
                              {m.vpd} g/m³
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
