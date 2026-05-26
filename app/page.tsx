"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ============================================================
// 型定義
// ============================================================
type WeatherType = "sunny" | "cloudy" | "rainy" | "snowy";
type TabType = "current" | "history" | "graph" | "compare";
type GraphMetric = "vpd" | "temp" | "humidity";

interface Measurement {
  id: string;
  timestamp: number;
  temperature: number;
  humidity: number;
  vpd: number;
  weather: WeatherType;
}

interface DayStats {
  avgVPD: number;
  avgTemp: number;
  avgHumidity: number;
  count: number;
  optimalCount: number;
}

// ============================================================
// 飽差計算（日本農業標準：g/m³）
// ============================================================
function calcVPD(temp: number, humidity: number): number {
  const es = 6.1078 * Math.pow(10, (7.5 * temp) / (237.3 + temp));
  const rhoMax = (217 * es) / (temp + 273.15);
  const vpd = rhoMax * (1 - humidity / 100);
  return Math.max(0, Math.round(vpd * 10) / 10);
}

// ============================================================
// 飽差ステータス
// ============================================================
interface VPDStatus {
  id: string;
  label: string;
  emoji: string;
  description: string;
  actions: { emoji: string; text: string }[];
  bg: string;
  border: string;
  textColor: string;
  badgeBg: string;
  svgColor: string;
}

function getVPDStatus(vpd: number): VPDStatus {
  if (vpd < 3) {
    return {
      id: "high", label: "高湿度環境", emoji: "💧",
      description: "気孔は開いていますが蒸散が行われていません。\nカビ・病害が発生しやすい状態です。",
      actions: [
        { emoji: "🌀", text: "除湿機を稼働させる" },
        { emoji: "🪟", text: "窓を開けて換気する" },
        { emoji: "🌡️", text: "暖房で温度を少し上げる" },
      ],
      bg: "bg-blue-50", border: "border-blue-400", textColor: "text-blue-800",
      badgeBg: "bg-blue-100", svgColor: "#2563eb",
    };
  }
  if (vpd <= 6) {
    return {
      id: "optimal", label: "適切な飽差", emoji: "✅",
      description: "気孔が適切に開き蒸散が活発です。\nいちごの生育に最適な状態です！",
      actions: [
        { emoji: "👍", text: "現在の環境を維持する" },
        { emoji: "📝", text: "定期的に記録を続ける" },
      ],
      bg: "bg-green-50", border: "border-green-500", textColor: "text-green-800",
      badgeBg: "bg-green-100", svgColor: "#16a34a",
    };
  }
  if (vpd <= 10) {
    return {
      id: "tolerable", label: "許容範囲の飽差", emoji: "⚠️",
      description: "許容できる範囲ですが乾燥気味です。\n適切な飽差に近づけるよう管理してください。",
      actions: [
        { emoji: "💦", text: "加湿を検討する" },
        { emoji: "🌿", text: "植物の状態をよく観察する" },
        { emoji: "🌡️", text: "急激な温度変化に注意する" },
      ],
      bg: "bg-amber-50", border: "border-amber-400", textColor: "text-amber-800",
      badgeBg: "bg-amber-100", svgColor: "#d97706",
    };
  }
  if (vpd <= 15) {
    return {
      id: "low", label: "低湿度環境（注意）", emoji: "🔸",
      description: "急激な温度上昇や湿度低下により\n気孔が閉じています。早めに対処してください。",
      actions: [
        { emoji: "💦", text: "すぐに加湿・噴霧する" },
        { emoji: "🌿", text: "遮光ネットを設置する" },
        { emoji: "🌀", text: "換気を控えめにする" },
      ],
      bg: "bg-orange-50", border: "border-orange-400", textColor: "text-orange-800",
      badgeBg: "bg-orange-100", svgColor: "#ea580c",
    };
  }
  return {
    id: "danger", label: "低湿度環境（危険）", emoji: "🚨",
    description: "気孔が完全に閉じており植物がダメージを\n受けています。今すぐ対処してください！",
    actions: [
      { emoji: "🚨", text: "今すぐ加湿・噴霧する" },
      { emoji: "🌿", text: "遮光ネットを設置する" },
      { emoji: "🌀", text: "換気を止める" },
      { emoji: "📞", text: "農業指導員に連絡する" },
    ],
    bg: "bg-red-50", border: "border-red-500", textColor: "text-red-800",
    badgeBg: "bg-red-100", svgColor: "#dc2626",
  };
}

// ============================================================
// 天気
// ============================================================
const WEATHER_OPTIONS: { value: WeatherType; label: string; emoji: string }[] = [
  { value: "sunny",  label: "晴れ", emoji: "☀️" },
  { value: "cloudy", label: "曇り", emoji: "☁️" },
  { value: "rainy",  label: "雨",   emoji: "🌧️" },
  { value: "snowy",  label: "雪",   emoji: "❄️" },
];

// ============================================================
// ユーティリティ
// ============================================================
function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function formatTimeOnly(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function formatJapaneseDate(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${"日月火水木金土"[d.getDay()]}）`;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

// 月別・日別集計（Map<day(1-31), DayStats>）
function groupByDay(data: Measurement[], year: number, month: number): Map<number, DayStats> {
  const raw = new Map<number, { vpds: number[]; temps: number[]; humidities: number[] }>();
  for (const m of data) {
    const d = new Date(m.timestamp);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const day = d.getDate();
    if (!raw.has(day)) raw.set(day, { vpds: [], temps: [], humidities: [] });
    const r = raw.get(day)!;
    r.vpds.push(m.vpd);
    r.temps.push(m.temperature);
    r.humidities.push(m.humidity);
  }
  const result = new Map<number, DayStats>();
  for (const [day, r] of raw) {
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    result.set(day, {
      avgVPD:      Math.round(avg(r.vpds) * 10) / 10,
      avgTemp:     Math.round(avg(r.temps) * 10) / 10,
      avgHumidity: Math.round(avg(r.humidities) * 10) / 10,
      count:        r.vpds.length,
      optimalCount: r.vpds.filter(v => v >= 3 && v <= 6).length,
    });
  }
  return result;
}

// 月全体の統計
function calcMonthStats(dayMap: Map<number, DayStats>) {
  if (dayMap.size === 0) return null;
  const days = Array.from(dayMap.values());
  const total = days.reduce((a, d) => a + d.count, 0);
  const optTotal = days.reduce((a, d) => a + d.optimalCount, 0);
  return {
    avgVPD:       Math.round(days.reduce((a, d) => a + d.avgVPD * d.count, 0) / total * 10) / 10,
    avgTemp:      Math.round(days.reduce((a, d) => a + d.avgTemp * d.count, 0) / total * 10) / 10,
    avgHumidity:  Math.round(days.reduce((a, d) => a + d.avgHumidity * d.count, 0) / total * 10) / 10,
    optimalRate:  Math.round((optTotal / total) * 100),
    recordCount:  total,
    dayCount:     dayMap.size,
  };
}

// ============================================================
// VPDゲージ
// ============================================================
function VPDGauge({ vpd }: { vpd: number }) {
  const MAX = 20;
  const pct = Math.min((vpd / MAX) * 100, 100);
  const status = getVPDStatus(vpd);
  return (
    <div className="w-full">
      <div className="text-center mb-4">
        <div className={`text-8xl font-black leading-none ${status.textColor} animate-fade-in`}>
          {vpd.toFixed(1)}
        </div>
        <div className={`text-2xl font-semibold ${status.textColor} mt-1 opacity-80`}>g/m³</div>
      </div>
      <div className="relative h-5 rounded-full overflow-hidden mb-1"
        style={{ background: "linear-gradient(to right,#3b82f6 0%,#22c55e 15%,#f59e0b 30%,#f97316 50%,#ef4444 75%,#ef4444 100%)" }}>
        <div className="absolute top-0 h-full w-1.5 bg-gray-900 rounded-full shadow-lg transition-all duration-500"
          style={{ left: `calc(${pct}% - 3px)` }} />
      </div>
      <div className="flex justify-between text-xs text-gray-400 px-0.5">
        {["0","3","6","10","15","20"].map(v => <span key={v}>{v}</span>)}
      </div>
    </div>
  );
}

// ============================================================
// 推移グラフ（グラフタブ用）
// ============================================================
function VPDLineChart({ data, metric }: { data: Measurement[]; metric: GraphMetric }) {
  if (data.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-gray-400">
        <div className="text-5xl mb-3">📈</div>
        <p className="text-lg">記録が2件以上になるとグラフが表示されます</p>
      </div>
    );
  }
  const recent = data.slice(-24);
  const W = 560, H = 220;
  const PAD = { top: 16, right: 24, bottom: 44, left: 48 };
  const gW = W - PAD.left - PAD.right;
  const gH = H - PAD.top - PAD.bottom;

  const cfg = {
    vpd:      { getValue: (m: Measurement) => m.vpd,         min: 0,  max: 20,  unit: "g/m³", color: "#16a34a",
                zones: [{from:0,to:3,fill:"#dbeafe"},{from:3,to:6,fill:"#dcfce7"},{from:6,to:10,fill:"#fef3c7"},{from:10,to:20,fill:"#fee2e2"}],
                gridLines: [3,6,10], yLabels: [0,3,6,10,15,20] },
    temp:     { getValue: (m: Measurement) => m.temperature, min: 0,  max: 40,  unit: "°C",   color: "#dc2626",
                zones: [], gridLines: [10,20,30], yLabels: [0,10,20,30,40] },
    humidity: { getValue: (m: Measurement) => m.humidity,    min: 0,  max: 100, unit: "%",    color: "#2563eb",
                zones: [], gridLines: [25,50,75], yLabels: [0,25,50,75,100] },
  }[metric];

  const xScale = (i: number) => gW * (i / Math.max(recent.length - 1, 1));
  const yScale = (v: number) => gH - ((v - cfg.min) / (cfg.max - cfg.min)) * gH;
  const linePath = recent.map((m, i) => `${i===0?"M":"L"}${xScale(i).toFixed(1)},${yScale(cfg.getValue(m)).toFixed(1)}`).join(" ");
  const areaPath = linePath + ` L${xScale(recent.length-1).toFixed(1)},${gH} L0,${gH} Z`;
  const xStep = Math.ceil(recent.length / 6);

  return (
    <div className="w-full overflow-x-auto -mx-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 280 }}>
        <defs>
          <linearGradient id={`ag-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={cfg.color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={cfg.color} stopOpacity="0.02" />
          </linearGradient>
          <clipPath id="clip-main"><rect x="0" y="0" width={gW} height={gH} /></clipPath>
        </defs>
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {cfg.zones.map(z => {
            const y1 = yScale(z.to), y2 = yScale(z.from);
            return <rect key={z.from} x={0} y={y1} width={gW} height={y2-y1} fill={z.fill} opacity={0.7} clipPath="url(#clip-main)" />;
          })}
          {cfg.gridLines.map(v => (
            <g key={v}>
              <line x1={0} y1={yScale(v)} x2={gW} y2={yScale(v)} stroke="#9ca3af" strokeWidth={0.8} strokeDasharray="4,4" />
              <text x={-6} y={yScale(v)+4} textAnchor="end" fontSize={10} fill="#9ca3af">{v}</text>
            </g>
          ))}
          {cfg.yLabels.filter(v => !cfg.gridLines.includes(v)).map(v => (
            <text key={v} x={-6} y={yScale(v)+4} textAnchor="end" fontSize={10} fill="#9ca3af">{v}</text>
          ))}
          <path d={areaPath} fill={`url(#ag-${metric})`} clipPath="url(#clip-main)" />
          <path d={linePath} fill="none" stroke={cfg.color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" clipPath="url(#clip-main)" />
          {recent.map((m, i) => (
            <circle key={m.id} cx={xScale(i)} cy={yScale(cfg.getValue(m))} r={4}
              fill={metric==="vpd" ? getVPDStatus(m.vpd).svgColor : cfg.color}
              stroke="white" strokeWidth={1.5} />
          ))}
          {recent.map((m, i) => {
            if (i % xStep !== 0 && i !== recent.length-1) return null;
            return <text key={m.id} x={xScale(i)} y={gH+18} textAnchor="middle" fontSize={9} fill="#6b7280">{formatTimeOnly(m.timestamp)}</text>;
          })}
          <line x1={0} y1={0} x2={0} y2={gH} stroke="#d1d5db" strokeWidth={1} />
          <line x1={0} y1={gH} x2={gW} y2={gH} stroke="#d1d5db" strokeWidth={1} />
          <text x={-36} y={gH/2} textAnchor="middle" fontSize={10} fill="#9ca3af" transform={`rotate(-90,-36,${gH/2})`}>{cfg.unit}</text>
        </g>
      </svg>
    </div>
  );
}

// ============================================================
// 前年比較グラフ
// ============================================================
function CompareChart({
  thisYear, lastYear, daysInMonth,
}: {
  thisYear: Map<number, DayStats>;
  lastYear: Map<number, DayStats>;
  daysInMonth: number;
}) {
  const W = 560, H = 230;
  const PAD = { top: 16, right: 24, bottom: 48, left: 48 };
  const gW = W - PAD.left - PAD.right;
  const gH = H - PAD.top - PAD.bottom;
  const MAX = 20;

  const xScale = (day: number) => ((day - 1) / Math.max(daysInMonth - 1, 1)) * gW;
  const yScale = (v: number) => gH - (v / MAX) * gH;

  const y3  = yScale(3);
  const y6  = yScale(6);
  const y10 = yScale(10);

  const buildPath = (map: Map<number, DayStats>) => {
    const pts = Array.from({ length: daysInMonth }, (_, i) => i + 1)
      .filter(d => map.has(d))
      .map(d => ({ x: xScale(d), y: yScale(map.get(d)!.avgVPD) }));
    if (pts.length === 0) return "";
    return pts.map((p, i) => `${i===0?"M":"L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  };

  const thisPath = buildPath(thisYear);
  const lastPath = buildPath(lastYear);
  const hasThis  = thisYear.size > 0;
  const hasLast  = lastYear.size > 0;

  // X軸ラベル：5日刻み
  const xLabels = Array.from({ length: daysInMonth }, (_, i) => i + 1)
    .filter(d => d === 1 || d % 5 === 0 || d === daysInMonth);

  return (
    <div className="w-full overflow-x-auto -mx-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 280 }}>
        <defs>
          <clipPath id="comp-clip"><rect x="0" y="0" width={gW} height={gH} /></clipPath>
        </defs>
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {/* 色帯 */}
          <rect x={0} y={0}   width={gW} height={y3}       fill="#fee2e2" opacity={0.5} />
          <rect x={0} y={y3}  width={gW} height={y6-y3}    fill="#fef3c7" opacity={0.5} />
          <rect x={0} y={y6}  width={gW} height={y10-y6}   fill="#dcfce7" opacity={0.5} />
          <rect x={0} y={y10} width={gW} height={gH-y10}   fill="#dbeafe" opacity={0.5} />

          {/* グリッド */}
          {[3,6,10].map(v => (
            <g key={v}>
              <line x1={0} y1={yScale(v)} x2={gW} y2={yScale(v)} stroke="#9ca3af" strokeWidth={0.8} strokeDasharray="4,4" />
              <text x={-6} y={yScale(v)+4} textAnchor="end" fontSize={10} fill="#9ca3af">{v}</text>
            </g>
          ))}
          {[0,15,20].map(v => (
            <text key={v} x={-6} y={yScale(v)+4} textAnchor="end" fontSize={10} fill="#9ca3af">{v}</text>
          ))}

          {/* 去年ライン（グレー破線） */}
          {hasLast && (
            <>
              <path d={lastPath} fill="none" stroke="#9ca3af" strokeWidth={2.5}
                strokeDasharray="8,5" strokeLinecap="round" clipPath="url(#comp-clip)" />
              {Array.from(lastYear.entries()).map(([day, s]) => (
                <circle key={`ly${day}`} cx={xScale(day)} cy={yScale(s.avgVPD)} r={4}
                  fill="#9ca3af" stroke="white" strokeWidth={1.5} />
              ))}
            </>
          )}

          {/* 今年ライン（緑実線） */}
          {hasThis && (
            <>
              <path d={thisPath} fill="none" stroke="#16a34a" strokeWidth={3}
                strokeLinecap="round" strokeLinejoin="round" clipPath="url(#comp-clip)" />
              {Array.from(thisYear.entries()).map(([day, s]) => (
                <circle key={`ty${day}`} cx={xScale(day)} cy={yScale(s.avgVPD)} r={5}
                  fill={getVPDStatus(s.avgVPD).svgColor} stroke="white" strokeWidth={2} />
              ))}
            </>
          )}

          {/* X軸ラベル */}
          {xLabels.map(day => (
            <text key={day} x={xScale(day)} y={gH+20} textAnchor="middle" fontSize={10} fill="#6b7280">{day}日</text>
          ))}

          {/* 軸線 */}
          <line x1={0} y1={0} x2={0} y2={gH} stroke="#d1d5db" strokeWidth={1} />
          <line x1={0} y1={gH} x2={gW} y2={gH} stroke="#d1d5db" strokeWidth={1} />
          <text x={-36} y={gH/2} textAnchor="middle" fontSize={10} fill="#9ca3af"
            transform={`rotate(-90,-36,${gH/2})`}>g/m³</text>
        </g>
      </svg>
    </div>
  );
}

// ============================================================
// 数値インプット（±ボタン付き）
// ============================================================
function NumberInput({ label, unit, value, min, max, step, onChange, color = "green" }: {
  label: string; unit: string; value: number;
  min: number; max: number; step: number;
  onChange: (v: number) => void; color?: string;
}) {
  const accent = color==="red" ? "bg-red-500" : color==="blue" ? "bg-blue-500" : "bg-green-600";
  const border = color==="red" ? "focus:border-red-400" : color==="blue" ? "focus:border-blue-400" : "focus:border-green-400";
  const ring   = color==="red" ? "#ef4444" : color==="blue" ? "#3b82f6" : "#16a34a";
  const pct = ((value - min) / (max - min)) * 100;
  const set = (v: number) => onChange(Math.round(Math.min(max, Math.max(min, v)) / step) * step);

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <label className="text-xl font-bold text-gray-700">{label}</label>
        <div className="flex items-center gap-2">
          <button onClick={() => set(value - step)}
            className={`w-10 h-10 rounded-full ${accent} text-white text-2xl font-light flex items-center justify-center shadow-sm active:scale-90 transition-transform`}>−</button>
          <input type="number" value={value} onChange={e => set(Number(e.target.value))}
            min={min} max={max} step={step}
            className={`w-24 text-center text-3xl font-black text-gray-800 border-2 border-gray-200 rounded-xl py-2 outline-none transition-colors ${border}`}
            style={{ fontVariantNumeric: "tabular-nums" }} />
          <span className="text-xl font-semibold text-gray-500 w-10">{unit}</span>
          <button onClick={() => set(value + step)}
            className={`w-10 h-10 rounded-full ${accent} text-white text-2xl font-light flex items-center justify-center shadow-sm active:scale-90 transition-transform`}>＋</button>
        </div>
      </div>
      <div className="relative">
        <div className="absolute top-0 left-0 h-full rounded-full transition-all duration-200"
          style={{ width: `${pct}%`, background: ring, opacity: 0.25, pointerEvents: "none" }} />
        <input type="range" value={value} onChange={e => set(Number(e.target.value))}
          min={min} max={max} step={step} className="w-full relative z-10"
          style={{ accentColor: ring }} />
      </div>
      <div className="flex justify-between text-sm text-gray-400 mt-1 px-1">
        <span>{min}{unit}</span><span>{Math.round((min+max)/2)}{unit}</span><span>{max}{unit}</span>
      </div>
    </div>
  );
}

// ============================================================
// 前年比較 差分バッジ
// ============================================================
function DiffBadge({ diff, unit, reverse = false }: { diff: number; unit: string; reverse?: boolean }) {
  if (diff === 0) return <span className="text-base text-gray-400 font-medium">変化なし</span>;
  // reverse=true の場合、プラスが悪い（例：VPD高い＝乾燥）
  const isGood = reverse ? diff < 0 : diff > 0;
  const sign   = diff > 0 ? "+" : "";
  const color  = isGood ? "text-green-600" : "text-red-500";
  const arrow  = diff > 0 ? "▲" : "▼";
  return (
    <span className={`text-lg font-black ${color}`}>
      {arrow} {sign}{Math.abs(diff).toFixed(1)}{unit}
    </span>
  );
}

// ============================================================
// メインアプリ
// ============================================================
export default function VPDApp() {
  const [mounted, setMounted]       = useState(false);
  const [tab, setTab]               = useState<TabType>("current");
  const [graphMetric, setGraphMetric] = useState<GraphMetric>("vpd");
  const [measurements, setMeasurements] = useState<Measurement[]>([]);

  const [temperature, setTemperature] = useState(22);
  const [humidity,    setHumidity]    = useState(70);
  const [weather,     setWeather]     = useState<WeatherType>("sunny");
  const [savedFeedback, setSavedFeedback] = useState(false);

  const now = useRef(new Date());
  const [displayNow, setDisplayNow] = useState(new Date());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 前年比較：表示中の月
  const [cmpYear,  setCmpYear]  = useState(() => new Date().getFullYear());
  const [cmpMonth, setCmpMonth] = useState(() => new Date().getMonth()); // 0-indexed

  useEffect(() => {
    try {
      const raw = localStorage.getItem("vpd-data-v2");
      if (raw) setMeasurements(JSON.parse(raw));
    } catch { setMeasurements([]); }
    setMounted(true);
    timerRef.current = setInterval(() => setDisplayNow(new Date()), 60000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    try { localStorage.setItem("vpd-data-v2", JSON.stringify(measurements)); } catch {}
  }, [measurements, mounted]);

  const vpd    = calcVPD(temperature, humidity);
  const status = getVPDStatus(vpd);

  const handleRecord = useCallback(() => {
    setMeasurements(prev => [...prev, {
      id: crypto.randomUUID(), timestamp: Date.now(),
      temperature, humidity, vpd, weather,
    }]);
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2500);
  }, [temperature, humidity, vpd, weather]);

  const handleDelete    = useCallback((id: string) => setMeasurements(prev => prev.filter(m => m.id !== id)), []);
  const handleDeleteAll = useCallback(() => {
    if (window.confirm("すべての記録を削除しますか？\nこの操作は元に戻せません。")) setMeasurements([]);
  }, []);

  // 前月 / 翌月移動
  const moveCmpMonth = (delta: number) => {
    let y = cmpYear, m = cmpMonth + delta;
    if (m < 0)  { m = 11; y--; }
    if (m > 11) { m = 0;  y++; }
    setCmpYear(y); setCmpMonth(m);
  };

  // 比較データ集計
  const thisYearDays = groupByDay(measurements, cmpYear, cmpMonth);
  const lastYearDays = groupByDay(measurements, cmpYear - 1, cmpMonth);
  const thisStats    = calcMonthStats(thisYearDays);
  const lastStats    = calcMonthStats(lastYearDays);
  const daysInCmpMonth = getDaysInMonth(cmpYear, cmpMonth);

  // 全体統計（グラフタブ用）
  const allStats = (() => {
    if (measurements.length === 0) return null;
    const vpds = measurements.map(m => m.vpd);
    const avg  = vpds.reduce((a,b) => a+b, 0) / vpds.length;
    return {
      count:   measurements.length,
      avg:     avg.toFixed(1),
      min:     Math.min(...vpds).toFixed(1),
      max:     Math.max(...vpds).toFixed(1),
      optimal: Math.round(measurements.filter(m => m.vpd>=3&&m.vpd<=6).length / measurements.length * 100),
    };
  })();

  const MONTH_NAMES = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-green-50">
        <div className="text-center"><div className="text-5xl mb-3">🍓</div>
          <p className="text-green-700 text-xl font-medium">読み込み中...</p></div>
      </div>
    );
  }

  const vpdRangeTable = [
    { range:"0〜3 g/m³",   status:"高湿度環境",     emoji:"💧", action:"除湿・換気",         bg:"bg-blue-50",   text:"text-blue-700",   isActive: vpd < 3 },
    { range:"3〜6 g/m³",   status:"適切な飽差 ✅",  emoji:"✅", action:"現状維持",           bg:"bg-green-50",  text:"text-green-700",  isActive: vpd>=3&&vpd<=6 },
    { range:"6〜10 g/m³",  status:"許容範囲",        emoji:"⚠️", action:"加湿を検討",         bg:"bg-amber-50",  text:"text-amber-700",  isActive: vpd>6&&vpd<=10 },
    { range:"10〜15 g/m³", status:"低湿度（注意）",  emoji:"🔸", action:"加湿・噴霧・遮光",   bg:"bg-orange-50", text:"text-orange-700", isActive: vpd>10&&vpd<=15 },
    { range:"15 g/m³以上", status:"低湿度（危険）",  emoji:"🚨", action:"緊急対処が必要",     bg:"bg-red-50",    text:"text-red-700",    isActive: vpd>15 },
  ];

  // タブ定義
  const TABS: { id: TabType; label: string; icon: string }[] = [
    { id: "current", label: "現在の状態", icon: "📊" },
    { id: "history", label: "記録履歴",   icon: "📋" },
    { id: "graph",   label: "グラフ",     icon: "📈" },
    { id: "compare", label: "前年比較",   icon: "📅" },
  ];

  return (
    <main className="min-h-screen bg-gray-50 select-none">
      {/* ヘッダー */}
      <header className="bg-green-700 text-white shadow-lg sticky top-0 z-20">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-3xl">🍓</span>
              <div>
                <h1 className="text-xl font-black tracking-wide leading-tight">飽差管理アプリ</h1>
                <p className="text-green-200 text-sm leading-tight">いちご栽培サポート</p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold tabular-nums">
                {String(displayNow.getHours()).padStart(2,"0")}:{String(displayNow.getMinutes()).padStart(2,"0")}
              </div>
              <div className="text-green-200 text-xs">{formatJapaneseDate(displayNow)}</div>
            </div>
          </div>
        </div>
      </header>

      {/* タブナビ */}
      <nav className="bg-white border-b-2 border-gray-100 sticky top-[72px] z-10 shadow-sm">
        <div className="max-w-2xl mx-auto flex">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 py-2.5 text-center transition-all duration-200 ${
                tab===t.id
                  ? "text-green-700 border-b-[3px] border-green-600 bg-green-50 font-bold"
                  : "text-gray-500 border-b-[3px] border-transparent hover:bg-gray-50 font-medium"
              }`}>
              <div className="text-xl leading-tight">{t.icon}</div>
              <div className="text-xs mt-0.5">{t.label}</div>
            </button>
          ))}
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 py-5 pb-10">

        {/* ====== 現在の状態 ====== */}
        {tab==="current" && (
          <div className="space-y-4 tab-content">
            {/* 天気 */}
            <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-xl font-bold text-gray-700 mb-3 flex items-center gap-2"><span>🌤</span>今日の天気</h2>
              <div className="grid grid-cols-4 gap-2">
                {WEATHER_OPTIONS.map(w => (
                  <button key={w.value} onClick={() => setWeather(w.value)}
                    className={`py-4 rounded-2xl text-center transition-all duration-150 ${
                      weather===w.value ? "bg-green-100 border-2 border-green-500 shadow-md scale-105"
                                        : "bg-gray-50 border-2 border-transparent hover:bg-gray-100 active:scale-95"}`}>
                    <div className="text-4xl leading-tight">{w.emoji}</div>
                    <div className="text-base font-medium text-gray-600 mt-1">{w.label}</div>
                  </button>
                ))}
              </div>
            </section>

            {/* 温度・湿度 */}
            <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-xl font-bold text-gray-700 mb-4 flex items-center gap-2"><span>🌡️</span>温度・湿度の入力</h2>
              <NumberInput label="温 度" unit="°C" value={temperature} min={0}   max={45}  step={0.5} onChange={setTemperature} color="red" />
              <NumberInput label="湿 度" unit="%"  value={humidity}    min={0}   max={100} step={1}   onChange={setHumidity}    color="blue" />
            </section>

            {/* 飽差表示 */}
            <section className={`rounded-2xl shadow-md border-2 p-5 transition-all duration-500 ${status.bg} ${status.border}`}>
              <h2 className="text-xl font-bold text-gray-700 mb-4 flex items-center gap-2"><span>💨</span>飽差（VPD）</h2>
              <VPDGauge vpd={vpd} />
              <div className={`flex items-center justify-center gap-3 mt-5 py-4 px-5 rounded-2xl ${status.badgeBg}`}>
                <span className="text-4xl">{status.emoji}</span>
                <span className={`text-2xl font-black ${status.textColor}`}>{status.label}</span>
              </div>
              <p className={`text-lg ${status.textColor} mt-3 text-center leading-relaxed whitespace-pre-line`}>{status.description}</p>
            </section>

            {/* 対処方法 */}
            <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-xl font-bold text-gray-700 mb-3 flex items-center gap-2"><span>👨‍🌾</span>今すぐやること</h2>
              <div className="space-y-3">
                {status.actions.map((a, i) => (
                  <div key={i} className={`flex items-center gap-4 py-4 px-5 rounded-2xl ${status.badgeBg} action-card`}>
                    <span className="text-4xl flex-shrink-0">{a.emoji}</span>
                    <span className={`text-xl font-bold ${status.textColor}`}>{a.text}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* 目安一覧 */}
            <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-xl font-bold text-gray-700 mb-3 flex items-center gap-2"><span>📋</span>飽差の目安一覧</h2>
              <div className="space-y-2">
                {vpdRangeTable.map(row => (
                  <div key={row.range}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl ${row.bg} ${row.isActive ? "ring-2 ring-green-500 ring-offset-1 shadow-sm" : ""}`}>
                    <span className="text-2xl flex-shrink-0">{row.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className={`text-base font-bold ${row.text}`}>{row.range}</div>
                      <div className={`text-sm ${row.text} opacity-80`}>{row.status}　→　{row.action}</div>
                    </div>
                    {row.isActive && <span className="text-green-700 font-black text-lg flex-shrink-0">◀ 現在</span>}
                  </div>
                ))}
              </div>
            </section>

            {/* 記録ボタン */}
            <button onClick={handleRecord}
              className={`record-btn w-full py-6 rounded-2xl text-2xl font-black shadow-lg transition-all duration-200 ${
                savedFeedback ? "bg-green-500 text-white" : "bg-green-700 text-white hover:bg-green-800 active:scale-97"}`}>
              {savedFeedback ? "✅　記録しました！" : "📝　記録する"}
            </button>
            {measurements.length > 0 && (
              <p className="text-center text-gray-400 text-base">これまでの記録：{measurements.length}件</p>
            )}
          </div>
        )}

        {/* ====== 記録履歴 ====== */}
        {tab==="history" && (
          <div className="tab-content">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-black text-gray-700">記録履歴</h2>
              <div className="flex items-center gap-3">
                <span className="text-lg text-gray-500">{measurements.length}件</span>
                {measurements.length > 0 && (
                  <button onClick={handleDeleteAll}
                    className="text-sm text-red-400 hover:text-red-600 border border-red-200 rounded-lg px-3 py-1 transition-colors">全削除</button>
                )}
              </div>
            </div>
            {measurements.length===0 ? (
              <div className="bg-white rounded-2xl p-12 text-center text-gray-400 shadow-sm">
                <div className="text-6xl mb-4">📋</div>
                <p className="text-xl font-medium">まだ記録がありません</p>
                <p className="text-lg mt-2">「現在の状態」タブで記録してください</p>
              </div>
            ) : (
              <div className="space-y-3">
                {[...measurements].reverse().map(m => {
                  const s = getVPDStatus(m.vpd);
                  const w = WEATHER_OPTIONS.find(o => o.value===m.weather);
                  return (
                    <div key={m.id} className={`bg-white rounded-2xl shadow-sm border-2 p-4 ${s.border}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-3xl">{w?.emoji}</span>
                            <span className="text-lg font-medium text-gray-500">{formatTimestamp(m.timestamp)}</span>
                          </div>
                          <div className="grid grid-cols-3 gap-2 mb-3">
                            {[
                              { label:"温度", value:m.temperature, unit:"°C", color:"text-red-700" },
                              { label:"湿度", value:m.humidity,    unit:"%",  color:"text-blue-700" },
                              { label:"飽差", value:m.vpd,         unit:"g/m³", color:s.textColor },
                            ].map(cell => (
                              <div key={cell.label} className={`text-center py-2 rounded-xl ${s.badgeBg}`}>
                                <div className="text-xs text-gray-500 mb-0.5">{cell.label}</div>
                                <div className={`text-2xl font-black ${cell.color}`}>{cell.value}</div>
                                <div className="text-sm text-gray-500">{cell.unit}</div>
                              </div>
                            ))}
                          </div>
                          <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full ${s.badgeBg}`}>
                            <span className="text-xl">{s.emoji}</span>
                            <span className={`text-base font-bold ${s.textColor}`}>{s.label}</span>
                          </div>
                        </div>
                        <button onClick={() => handleDelete(m.id)} className="text-gray-300 hover:text-red-400 transition-colors p-2 flex-shrink-0 text-2xl" aria-label="削除">🗑️</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ====== グラフ ====== */}
        {tab==="graph" && (
          <div className="tab-content space-y-4">
            <h2 className="text-2xl font-black text-gray-700">グラフ</h2>
            {allStats && (
              <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h3 className="text-lg font-bold text-gray-600 mb-3">📊 記録の統計（全{allStats.count}件）</h3>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  {[
                    { label:"平均飽差",         value:allStats.avg,     unit:"g/m³", color:"text-green-700" },
                    { label:"最小飽差",          value:allStats.min,     unit:"g/m³", color:"text-blue-700" },
                    { label:"最大飽差",          value:allStats.max,     unit:"g/m³", color:"text-red-700" },
                    { label:"適切な飽差の割合",  value:allStats.optimal, unit:"%",    color:"text-green-700" },
                  ].map(s => (
                    <div key={s.label} className="bg-gray-50 rounded-xl py-3 px-4 text-center">
                      <div className={`text-3xl font-black ${s.color} tabular-nums`}>{s.value}<span className="text-lg ml-0.5">{s.unit}</span></div>
                      <div className="text-sm text-gray-500 mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="flex justify-between text-sm text-gray-500 mb-1">
                    <span>適切な飽差（3〜6 g/m³）の割合</span>
                    <span className="font-bold text-green-700">{allStats.optimal}%</span>
                  </div>
                  <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full transition-all duration-700" style={{ width:`${allStats.optimal}%` }} />
                  </div>
                </div>
              </section>
            )}
            <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <div className="flex gap-2 mb-4">
                {([
                  { id:"vpd",      label:"飽差", color:"bg-green-100 text-green-700 border-green-300" },
                  { id:"temp",     label:"温度", color:"bg-red-100 text-red-700 border-red-300" },
                  { id:"humidity", label:"湿度", color:"bg-blue-100 text-blue-700 border-blue-300" },
                ] as { id: GraphMetric; label: string; color: string }[]).map(m => (
                  <button key={m.id} onClick={() => setGraphMetric(m.id)}
                    className={`flex-1 py-2 rounded-xl text-base font-bold border-2 transition-all ${
                      graphMetric===m.id ? m.color+" shadow-sm" : "bg-gray-50 text-gray-400 border-gray-100"}`}>
                    {m.label}
                  </button>
                ))}
              </div>
              <VPDLineChart data={measurements} metric={graphMetric} />
              {graphMetric==="vpd" && measurements.length>=2 && (
                <div className="flex flex-wrap gap-3 mt-4 justify-center">
                  {[
                    { color:"bg-red-200",   label:"低湿度（危険）" },
                    { color:"bg-amber-200", label:"許容範囲" },
                    { color:"bg-green-200", label:"✅ 適切" },
                    { color:"bg-blue-200",  label:"高湿度" },
                  ].map(item => (
                    <div key={item.label} className="flex items-center gap-1.5">
                      <div className={`w-5 h-5 rounded ${item.color}`} />
                      <span className="text-sm text-gray-600">{item.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
            {measurements.length>0 && (
              <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h3 className="text-lg font-bold text-gray-600 mb-3">🕐 最新の記録（5件）</h3>
                <div className="space-y-2">
                  {[...measurements].reverse().slice(0,5).map(m => {
                    const s = getVPDStatus(m.vpd);
                    const w = WEATHER_OPTIONS.find(o => o.value===m.weather);
                    return (
                      <div key={m.id} className="flex items-center gap-3 py-2 px-3 bg-gray-50 rounded-xl">
                        <span className="text-2xl">{w?.emoji}</span>
                        <span className="text-base text-gray-500 flex-shrink-0">{formatTimestamp(m.timestamp)}</span>
                        <div className="flex-1 text-right flex items-center justify-end gap-2">
                          <span className="text-base text-gray-600">{m.temperature}°C / {m.humidity}%</span>
                          <span className={`px-3 py-1 rounded-full text-base font-bold ${s.badgeBg} ${s.textColor}`}>{m.vpd} g/m³</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}

        {/* ====== 前年比較 ====== */}
        {tab==="compare" && (
          <div className="tab-content space-y-4">
            <h2 className="text-2xl font-black text-gray-700">前年比較</h2>

            {/* 月ナビゲーター */}
            <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center justify-between">
                <button onClick={() => moveCmpMonth(-1)}
                  className="w-14 h-14 rounded-2xl bg-gray-100 hover:bg-gray-200 active:scale-90 transition-all text-2xl font-bold text-gray-600 flex items-center justify-center">
                  ◀
                </button>
                <div className="text-center">
                  <div className="text-3xl font-black text-gray-800">{cmpYear}年 {MONTH_NAMES[cmpMonth]}</div>
                  <div className="text-sm text-gray-400 mt-0.5">vs {cmpYear-1}年 {MONTH_NAMES[cmpMonth]}</div>
                </div>
                <button onClick={() => moveCmpMonth(1)}
                  disabled={cmpYear===new Date().getFullYear() && cmpMonth===new Date().getMonth()}
                  className="w-14 h-14 rounded-2xl bg-gray-100 hover:bg-gray-200 active:scale-90 transition-all text-2xl font-bold text-gray-600 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed">
                  ▶
                </button>
              </div>
            </section>

            {/* 凡例 */}
            <div className="flex items-center justify-center gap-6">
              <div className="flex items-center gap-2">
                <svg width="32" height="12"><line x1="0" y1="6" x2="32" y2="6" stroke="#16a34a" strokeWidth="3" strokeLinecap="round"/></svg>
                <span className="text-lg font-bold text-green-700">今年（{cmpYear}年）</span>
              </div>
              <div className="flex items-center gap-2">
                <svg width="32" height="12"><line x1="0" y1="6" x2="32" y2="6" stroke="#9ca3af" strokeWidth="2.5" strokeDasharray="6,4" strokeLinecap="round"/></svg>
                <span className="text-lg font-bold text-gray-500">去年（{cmpYear-1}年）</span>
              </div>
            </div>

            {/* 比較グラフ */}
            <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h3 className="text-lg font-bold text-gray-600 mb-3">
                📈 飽差の日別平均グラフ（{MONTH_NAMES[cmpMonth]}）
              </h3>
              {thisYearDays.size===0 && lastYearDays.size===0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                  <div className="text-5xl mb-3">📅</div>
                  <p className="text-lg font-medium">この月のデータがまだありません</p>
                  <p className="text-base mt-1">記録を続けると比較できるようになります</p>
                </div>
              ) : (
                <>
                  <CompareChart thisYear={thisYearDays} lastYear={lastYearDays} daysInMonth={daysInCmpMonth} />
                  <div className="flex flex-wrap gap-3 mt-3 justify-center">
                    {[
                      { color:"bg-red-200",   label:"低湿度（危険）" },
                      { color:"bg-amber-200", label:"許容範囲" },
                      { color:"bg-green-200", label:"✅ 適切" },
                      { color:"bg-blue-200",  label:"高湿度" },
                    ].map(item => (
                      <div key={item.label} className="flex items-center gap-1.5">
                        <div className={`w-4 h-4 rounded ${item.color}`} />
                        <span className="text-sm text-gray-600">{item.label}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>

            {/* 統計比較カード */}
            {(thisStats || lastStats) && (
              <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h3 className="text-lg font-bold text-gray-600 mb-4">📊 月間統計の比較</h3>
                <div className="space-y-4">

                  {/* ヘッダー行 */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="text-base font-bold text-green-700 py-2 bg-green-50 rounded-xl">
                      今年<br/><span className="text-sm font-normal text-gray-500">{cmpYear}年{MONTH_NAMES[cmpMonth]}</span>
                    </div>
                    <div className="text-base font-bold text-gray-500 py-2 bg-gray-50 rounded-xl">
                      差
                    </div>
                    <div className="text-base font-bold text-gray-500 py-2 bg-gray-50 rounded-xl">
                      去年<br/><span className="text-sm font-normal text-gray-400">{cmpYear-1}年{MONTH_NAMES[cmpMonth]}</span>
                    </div>
                  </div>

                  {/* 平均飽差 */}
                  <CompareRow
                    label="💨 平均飽差"
                    thisVal={thisStats?.avgVPD ?? null}
                    lastVal={lastStats?.avgVPD ?? null}
                    unit="g/m³"
                    digits={1}
                    reverse
                  />
                  {/* 適切率 */}
                  <CompareRow
                    label="✅ 適切率（3〜6 g/m³）"
                    thisVal={thisStats?.optimalRate ?? null}
                    lastVal={lastStats?.optimalRate ?? null}
                    unit="%"
                    digits={0}
                  />
                  {/* 平均温度 */}
                  <CompareRow
                    label="🌡️ 平均温度"
                    thisVal={thisStats?.avgTemp ?? null}
                    lastVal={lastStats?.avgTemp ?? null}
                    unit="°C"
                    digits={1}
                  />
                  {/* 平均湿度 */}
                  <CompareRow
                    label="💧 平均湿度"
                    thisVal={thisStats?.avgHumidity ?? null}
                    lastVal={lastStats?.avgHumidity ?? null}
                    unit="%"
                    digits={1}
                  />
                  {/* 記録件数 */}
                  <CompareRow
                    label="📝 記録件数"
                    thisVal={thisStats?.recordCount ?? null}
                    lastVal={lastStats?.recordCount ?? null}
                    unit="件"
                    digits={0}
                  />
                </div>
              </section>
            )}

            {/* データなし案内 */}
            {!thisStats && !lastStats && (
              <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
                <div className="text-5xl mb-3">📅</div>
                <p className="text-xl font-bold text-gray-600 mb-2">データがまだありません</p>
                <p className="text-base text-gray-500 leading-relaxed">
                  「現在の状態」タブで毎日記録を続けると、<br />
                  来年の同じ月と比較できるようになります。
                </p>
                <div className="mt-4 text-3xl">🍓🍓🍓</div>
              </section>
            )}

            {/* 片方のみデータがある場合のメッセージ */}
            {(thisStats && !lastStats) && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3 items-start">
                <span className="text-2xl flex-shrink-0">💡</span>
                <p className="text-base text-amber-800">
                  今年（{cmpYear}年）のデータがあります。<br />
                  去年（{cmpYear-1}年）のデータは記録がないため比較グラフに去年の線は表示されません。<br />
                  記録を続けると来年から前年比較ができます！
                </p>
              </div>
            )}
            {(!thisStats && lastStats) && (
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex gap-3 items-start">
                <span className="text-2xl flex-shrink-0">💡</span>
                <p className="text-base text-blue-800">
                  去年（{cmpYear-1}年）のデータが表示されています。<br />
                  今年（{cmpYear}年）も記録すると前年比較ができます！
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

// ============================================================
// 比較行コンポーネント
// ============================================================
function CompareRow({ label, thisVal, lastVal, unit, digits, reverse = false }: {
  label: string;
  thisVal: number | null;
  lastVal: number | null;
  unit: string;
  digits: number;
  reverse?: boolean;
}) {
  const fmt = (v: number | null) =>
    v === null ? "—" : (digits === 0 ? Math.round(v).toString() : v.toFixed(digits));

  const diff = thisVal !== null && lastVal !== null ? thisVal - lastVal : null;

  return (
    <div>
      <div className="text-sm font-bold text-gray-500 mb-2">{label}</div>
      <div className="grid grid-cols-3 gap-2 text-center items-center">
        {/* 今年 */}
        <div className={`py-3 rounded-xl ${thisVal!==null ? "bg-green-50" : "bg-gray-50"}`}>
          <span className={`text-2xl font-black ${thisVal!==null ? "text-green-700" : "text-gray-300"}`}>
            {fmt(thisVal)}
          </span>
          <span className="text-sm text-gray-500 ml-0.5">{unit}</span>
        </div>
        {/* 差分 */}
        <div className="py-3 flex flex-col items-center justify-center">
          {diff !== null ? (
            <>
              {diff === 0 ? (
                <span className="text-base font-bold text-gray-400">±0</span>
              ) : (
                <>
                  <span className={`text-xl font-black ${
                    (reverse ? diff < 0 : diff > 0) ? "text-green-600" : "text-red-500"
                  }`}>
                    {diff > 0 ? "▲" : "▼"}
                  </span>
                  <span className={`text-base font-black ${
                    (reverse ? diff < 0 : diff > 0) ? "text-green-600" : "text-red-500"
                  }`}>
                    {Math.abs(diff).toFixed(digits)}{unit}
                  </span>
                </>
              )}
            </>
          ) : (
            <span className="text-base text-gray-300">—</span>
          )}
        </div>
        {/* 去年 */}
        <div className={`py-3 rounded-xl ${lastVal!==null ? "bg-gray-100" : "bg-gray-50"}`}>
          <span className={`text-2xl font-black ${lastVal!==null ? "text-gray-600" : "text-gray-300"}`}>
            {fmt(lastVal)}
          </span>
          <span className="text-sm text-gray-500 ml-0.5">{unit}</span>
        </div>
      </div>
    </div>
  );
}
