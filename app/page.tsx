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
  photoBase64?: string; // 圧縮済みJPEG（base64）
}

interface DayStats {
  avgVPD: number;
  avgTemp: number;
  avgHumidity: number;
  count: number;
  optimalCount: number;
}

// ============================================================
// 画像圧縮（Canvas API）
// ============================================================
async function compressImage(file: File, maxWidth = 640, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("canvas error")); return; }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// localStorage使用量の簡易推定（KB）
function estimateStorageKB(measurements: Measurement[]): number {
  try {
    const str = JSON.stringify(measurements);
    return Math.round(str.length / 1024);
  } catch { return 0; }
}

// ============================================================
// 飽差計算（日本農業標準：g/m³）
// ============================================================
function calcVPD(temp: number, humidity: number): number {
  const es = 6.1078 * Math.pow(10, (7.5 * temp) / (237.3 + temp));
  const rhoMax = (217 * es) / (temp + 273.15);
  return Math.max(0, Math.round(rhoMax * (1 - humidity / 100) * 10) / 10);
}

// ============================================================
// 飽差ステータス
// ============================================================
interface VPDStatus {
  id: string; label: string; emoji: string; description: string;
  actions: { emoji: string; text: string }[];
  bg: string; border: string; textColor: string; badgeBg: string; svgColor: string;
}

function getVPDStatus(vpd: number): VPDStatus {
  if (vpd < 3) return {
    id: "high", label: "高湿度環境", emoji: "💧",
    description: "気孔は開いていますが蒸散が行われていません。\nカビ・病害が発生しやすい状態です。",
    actions: [{ emoji:"🌀", text:"除湿機を稼働させる" },{ emoji:"🪟", text:"窓を開けて換気する" },{ emoji:"🌡️", text:"暖房で温度を少し上げる" }],
    bg:"bg-blue-50", border:"border-blue-400", textColor:"text-blue-800", badgeBg:"bg-blue-100", svgColor:"#2563eb",
  };
  if (vpd <= 6) return {
    id: "optimal", label: "適切な飽差", emoji: "✅",
    description: "気孔が適切に開き蒸散が活発です。\nいちごの生育に最適な状態です！",
    actions: [{ emoji:"👍", text:"現在の環境を維持する" },{ emoji:"📝", text:"定期的に記録を続ける" }],
    bg:"bg-green-50", border:"border-green-500", textColor:"text-green-800", badgeBg:"bg-green-100", svgColor:"#16a34a",
  };
  if (vpd <= 10) return {
    id: "tolerable", label: "許容範囲の飽差", emoji: "⚠️",
    description: "許容できる範囲ですが乾燥気味です。\n適切な飽差に近づけるよう管理してください。",
    actions: [{ emoji:"💦", text:"加湿を検討する" },{ emoji:"🌿", text:"植物の状態をよく観察する" },{ emoji:"🌡️", text:"急激な温度変化に注意する" }],
    bg:"bg-amber-50", border:"border-amber-400", textColor:"text-amber-800", badgeBg:"bg-amber-100", svgColor:"#d97706",
  };
  if (vpd <= 15) return {
    id: "low", label: "低湿度環境（注意）", emoji: "🔸",
    description: "急激な温度上昇や湿度低下により\n気孔が閉じています。早めに対処してください。",
    actions: [{ emoji:"💦", text:"すぐに加湿・噴霧する" },{ emoji:"🌿", text:"遮光ネットを設置する" },{ emoji:"🌀", text:"換気を控えめにする" }],
    bg:"bg-orange-50", border:"border-orange-400", textColor:"text-orange-800", badgeBg:"bg-orange-100", svgColor:"#ea580c",
  };
  return {
    id: "danger", label: "低湿度環境（危険）", emoji: "🚨",
    description: "気孔が完全に閉じており植物がダメージを\n受けています。今すぐ対処してください！",
    actions: [{ emoji:"🚨", text:"今すぐ加湿・噴霧する" },{ emoji:"🌿", text:"遮光ネットを設置する" },{ emoji:"🌀", text:"換気を止める" },{ emoji:"📞", text:"農業指導員に連絡する" }],
    bg:"bg-red-50", border:"border-red-500", textColor:"text-red-800", badgeBg:"bg-red-100", svgColor:"#dc2626",
  };
}

// ============================================================
// 天気
// ============================================================
const WEATHER_OPTIONS: { value: WeatherType; label: string; emoji: string }[] = [
  { value:"sunny",  label:"晴れ", emoji:"☀️" },
  { value:"cloudy", label:"曇り", emoji:"☁️" },
  { value:"rainy",  label:"雨",   emoji:"🌧️" },
  { value:"snowy",  label:"雪",   emoji:"❄️" },
];

// ============================================================
// ユーティリティ
// ============================================================
function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth()+1}月${d.getDate()}日 ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
function formatTimeOnly(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
function formatJapaneseDate(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${"日月火水木金土"[d.getDay()]}）`;
}
function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month+1, 0).getDate();
}
function groupByDay(data: Measurement[], year: number, month: number): Map<number, DayStats> {
  const raw = new Map<number, { vpds: number[]; temps: number[]; hums: number[] }>();
  for (const m of data) {
    const d = new Date(m.timestamp);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const day = d.getDate();
    if (!raw.has(day)) raw.set(day, { vpds:[], temps:[], hums:[] });
    const r = raw.get(day)!;
    r.vpds.push(m.vpd); r.temps.push(m.temperature); r.hums.push(m.humidity);
  }
  const result = new Map<number, DayStats>();
  for (const [day, r] of raw) {
    const avg = (a: number[]) => a.reduce((x,y)=>x+y,0)/a.length;
    result.set(day, {
      avgVPD: Math.round(avg(r.vpds)*10)/10,
      avgTemp: Math.round(avg(r.temps)*10)/10,
      avgHumidity: Math.round(avg(r.hums)*10)/10,
      count: r.vpds.length,
      optimalCount: r.vpds.filter(v=>v>=3&&v<=6).length,
    });
  }
  return result;
}
function calcMonthStats(m: Map<number, DayStats>) {
  if (m.size===0) return null;
  const days = Array.from(m.values());
  const total = days.reduce((a,d)=>a+d.count,0);
  const optT  = days.reduce((a,d)=>a+d.optimalCount,0);
  return {
    avgVPD:      Math.round(days.reduce((a,d)=>a+d.avgVPD*d.count,0)/total*10)/10,
    avgTemp:     Math.round(days.reduce((a,d)=>a+d.avgTemp*d.count,0)/total*10)/10,
    avgHumidity: Math.round(days.reduce((a,d)=>a+d.avgHumidity*d.count,0)/total*10)/10,
    optimalRate: Math.round(optT/total*100),
    recordCount: total,
  };
}

// ============================================================
// VPDゲージ
// ============================================================
function VPDGauge({ vpd }: { vpd: number }) {
  const pct = Math.min((vpd/20)*100, 100);
  const s = getVPDStatus(vpd);
  return (
    <div className="w-full">
      <div className="text-center mb-4">
        <div className={`text-8xl font-black leading-none ${s.textColor} animate-fade-in`}>{vpd.toFixed(1)}</div>
        <div className={`text-2xl font-semibold ${s.textColor} mt-1 opacity-80`}>g/m³</div>
      </div>
      <div className="relative h-5 rounded-full overflow-hidden mb-1"
        style={{background:"linear-gradient(to right,#3b82f6 0%,#22c55e 15%,#f59e0b 30%,#f97316 50%,#ef4444 75%)"}}>
        <div className="absolute top-0 h-full w-1.5 bg-gray-900 rounded-full shadow-lg transition-all duration-500"
          style={{left:`calc(${pct}% - 3px)`}} />
      </div>
      <div className="flex justify-between text-xs text-gray-400 px-0.5">
        {["0","3","6","10","15","20"].map(v=><span key={v}>{v}</span>)}
      </div>
    </div>
  );
}

// ============================================================
// 推移グラフ
// ============================================================
function VPDLineChart({ data, metric }: { data: Measurement[]; metric: GraphMetric }) {
  if (data.length < 2) return (
    <div className="flex flex-col items-center justify-center h-48 text-gray-400">
      <div className="text-5xl mb-3">📈</div>
      <p className="text-lg">記録が2件以上になるとグラフが表示されます</p>
    </div>
  );
  const recent = data.slice(-24);
  const W=560, H=220, PAD={top:16,right:24,bottom:44,left:48};
  const gW=W-PAD.left-PAD.right, gH=H-PAD.top-PAD.bottom;
  const cfg = {
    vpd:      { val:(m:Measurement)=>m.vpd,         min:0, max:20,  unit:"g/m³", color:"#16a34a",
                zones:[{f:0,t:3,fill:"#dbeafe"},{f:3,t:6,fill:"#dcfce7"},{f:6,t:10,fill:"#fef3c7"},{f:10,t:20,fill:"#fee2e2"}],
                grid:[3,6,10], ylbl:[0,3,6,10,15,20] },
    temp:     { val:(m:Measurement)=>m.temperature, min:0, max:40,  unit:"°C",   color:"#dc2626",
                zones:[], grid:[10,20,30], ylbl:[0,10,20,30,40] },
    humidity: { val:(m:Measurement)=>m.humidity,    min:0, max:100, unit:"%",    color:"#2563eb",
                zones:[], grid:[25,50,75], ylbl:[0,25,50,75,100] },
  }[metric];
  const xs=(i:number)=>gW*(i/Math.max(recent.length-1,1));
  const ys=(v:number)=>gH-((v-cfg.min)/(cfg.max-cfg.min))*gH;
  const lp=recent.map((m,i)=>`${i===0?"M":"L"}${xs(i).toFixed(1)},${ys(cfg.val(m)).toFixed(1)}`).join(" ");
  const ap=lp+` L${xs(recent.length-1).toFixed(1)},${gH} L0,${gH} Z`;
  const step=Math.ceil(recent.length/6);
  return (
    <div className="w-full overflow-x-auto -mx-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{minWidth:280}}>
        <defs>
          <linearGradient id={`ag-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={cfg.color} stopOpacity="0.18"/>
            <stop offset="100%" stopColor={cfg.color} stopOpacity="0.02"/>
          </linearGradient>
          <clipPath id="clip-main"><rect x="0" y="0" width={gW} height={gH}/></clipPath>
        </defs>
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {"zones" in cfg && cfg.zones.map((z:{f:number,t:number,fill:string})=>{
            const y1=ys(z.t),y2=ys(z.f);
            return <rect key={z.f} x={0} y={y1} width={gW} height={y2-y1} fill={z.fill} opacity={0.7} clipPath="url(#clip-main)"/>;
          })}
          {cfg.grid.map(v=>(
            <g key={v}><line x1={0} y1={ys(v)} x2={gW} y2={ys(v)} stroke="#9ca3af" strokeWidth={0.8} strokeDasharray="4,4"/>
              <text x={-6} y={ys(v)+4} textAnchor="end" fontSize={10} fill="#9ca3af">{v}</text></g>
          ))}
          {cfg.ylbl.filter((v:number)=>!cfg.grid.includes(v)).map((v:number)=>(
            <text key={v} x={-6} y={ys(v)+4} textAnchor="end" fontSize={10} fill="#9ca3af">{v}</text>
          ))}
          <path d={ap} fill={`url(#ag-${metric})`} clipPath="url(#clip-main)"/>
          <path d={lp} fill="none" stroke={cfg.color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" clipPath="url(#clip-main)"/>
          {recent.map((m,i)=>(
            <circle key={m.id} cx={xs(i)} cy={ys(cfg.val(m))} r={4}
              fill={metric==="vpd"?getVPDStatus(m.vpd).svgColor:cfg.color} stroke="white" strokeWidth={1.5}/>
          ))}
          {recent.map((m,i)=>{
            if(i%step!==0&&i!==recent.length-1) return null;
            return <text key={m.id} x={xs(i)} y={gH+18} textAnchor="middle" fontSize={9} fill="#6b7280">{formatTimeOnly(m.timestamp)}</text>;
          })}
          <line x1={0} y1={0} x2={0} y2={gH} stroke="#d1d5db" strokeWidth={1}/>
          <line x1={0} y1={gH} x2={gW} y2={gH} stroke="#d1d5db" strokeWidth={1}/>
          <text x={-36} y={gH/2} textAnchor="middle" fontSize={10} fill="#9ca3af" transform={`rotate(-90,-36,${gH/2})`}>{cfg.unit}</text>
        </g>
      </svg>
    </div>
  );
}

// ============================================================
// 前年比較グラフ
// ============================================================
function CompareChart({ thisYear, lastYear, daysInMonth }: {
  thisYear: Map<number,DayStats>; lastYear: Map<number,DayStats>; daysInMonth: number;
}) {
  const W=560,H=230,PAD={top:16,right:24,bottom:48,left:48};
  const gW=W-PAD.left-PAD.right,gH=H-PAD.top-PAD.bottom,MAX=20;
  const xs=(day:number)=>((day-1)/Math.max(daysInMonth-1,1))*gW;
  const ys=(v:number)=>gH-(v/MAX)*gH;
  const y3=ys(3),y6=ys(6),y10=ys(10);
  const buildPath=(map:Map<number,DayStats>)=>{
    const pts=Array.from({length:daysInMonth},(_,i)=>i+1)
      .filter(d=>map.has(d)).map(d=>({x:xs(d),y:ys(map.get(d)!.avgVPD)}));
    if(!pts.length) return "";
    return pts.map((p,i)=>`${i===0?"M":"L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  };
  const xLabels=Array.from({length:daysInMonth},(_,i)=>i+1).filter(d=>d===1||d%5===0||d===daysInMonth);
  return (
    <div className="w-full overflow-x-auto -mx-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{minWidth:280}}>
        <defs><clipPath id="comp-clip"><rect x="0" y="0" width={gW} height={gH}/></clipPath></defs>
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          <rect x={0} y={0}   width={gW} height={y3}     fill="#fee2e2" opacity={0.5}/>
          <rect x={0} y={y3}  width={gW} height={y6-y3}  fill="#fef3c7" opacity={0.5}/>
          <rect x={0} y={y6}  width={gW} height={y10-y6} fill="#dcfce7" opacity={0.5}/>
          <rect x={0} y={y10} width={gW} height={gH-y10} fill="#dbeafe" opacity={0.5}/>
          {[3,6,10].map(v=>(
            <g key={v}><line x1={0} y1={ys(v)} x2={gW} y2={ys(v)} stroke="#9ca3af" strokeWidth={0.8} strokeDasharray="4,4"/>
              <text x={-6} y={ys(v)+4} textAnchor="end" fontSize={10} fill="#9ca3af">{v}</text></g>
          ))}
          {[0,15,20].map(v=>(<text key={v} x={-6} y={ys(v)+4} textAnchor="end" fontSize={10} fill="#9ca3af">{v}</text>))}
          {lastYear.size>0&&<>
            <path d={buildPath(lastYear)} fill="none" stroke="#9ca3af" strokeWidth={2.5} strokeDasharray="8,5" strokeLinecap="round" clipPath="url(#comp-clip)"/>
            {Array.from(lastYear.entries()).map(([d,s])=>(
              <circle key={`ly${d}`} cx={xs(d)} cy={ys(s.avgVPD)} r={4} fill="#9ca3af" stroke="white" strokeWidth={1.5}/>
            ))}
          </>}
          {thisYear.size>0&&<>
            <path d={buildPath(thisYear)} fill="none" stroke="#16a34a" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" clipPath="url(#comp-clip)"/>
            {Array.from(thisYear.entries()).map(([d,s])=>(
              <circle key={`ty${d}`} cx={xs(d)} cy={ys(s.avgVPD)} r={5} fill={getVPDStatus(s.avgVPD).svgColor} stroke="white" strokeWidth={2}/>
            ))}
          </>}
          {xLabels.map(d=>(<text key={d} x={xs(d)} y={gH+20} textAnchor="middle" fontSize={10} fill="#6b7280">{d}日</text>))}
          <line x1={0} y1={0} x2={0} y2={gH} stroke="#d1d5db" strokeWidth={1}/>
          <line x1={0} y1={gH} x2={gW} y2={gH} stroke="#d1d5db" strokeWidth={1}/>
          <text x={-36} y={gH/2} textAnchor="middle" fontSize={10} fill="#9ca3af" transform={`rotate(-90,-36,${gH/2})`}>g/m³</text>
        </g>
      </svg>
    </div>
  );
}

// ============================================================
// 数値インプット
// ============================================================
function NumberInput({ label, unit, value, min, max, step, onChange, color="green" }: {
  label:string; unit:string; value:number; min:number; max:number; step:number;
  onChange:(v:number)=>void; color?:string;
}) {
  const acc=color==="red"?"bg-red-500":color==="blue"?"bg-blue-500":"bg-green-600";
  const bdr=color==="red"?"focus:border-red-400":color==="blue"?"focus:border-blue-400":"focus:border-green-400";
  const rng=color==="red"?"#ef4444":color==="blue"?"#3b82f6":"#16a34a";
  const pct=((value-min)/(max-min))*100;
  const set=(v:number)=>onChange(Math.round(Math.min(max,Math.max(min,v))/step)*step);
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <label className="text-xl font-bold text-gray-700">{label}</label>
        <div className="flex items-center gap-2">
          <button onClick={()=>set(value-step)} className={`w-10 h-10 rounded-full ${acc} text-white text-2xl font-light flex items-center justify-center shadow-sm active:scale-90 transition-transform`}>−</button>
          <input type="number" value={value} onChange={e=>set(Number(e.target.value))} min={min} max={max} step={step}
            className={`w-24 text-center text-3xl font-black text-gray-800 border-2 border-gray-200 rounded-xl py-2 outline-none transition-colors ${bdr}`}
            style={{fontVariantNumeric:"tabular-nums"}}/>
          <span className="text-xl font-semibold text-gray-500 w-10">{unit}</span>
          <button onClick={()=>set(value+step)} className={`w-10 h-10 rounded-full ${acc} text-white text-2xl font-light flex items-center justify-center shadow-sm active:scale-90 transition-transform`}>＋</button>
        </div>
      </div>
      <div className="relative">
        <div className="absolute top-0 left-0 h-full rounded-full transition-all duration-200"
          style={{width:`${pct}%`,background:rng,opacity:0.25,pointerEvents:"none"}}/>
        <input type="range" value={value} onChange={e=>set(Number(e.target.value))} min={min} max={max} step={step}
          className="w-full relative z-10" style={{accentColor:rng}}/>
      </div>
      <div className="flex justify-between text-sm text-gray-400 mt-1 px-1">
        <span>{min}{unit}</span><span>{Math.round((min+max)/2)}{unit}</span><span>{max}{unit}</span>
      </div>
    </div>
  );
}

// ============================================================
// 比較行
// ============================================================
function CompareRow({ label, thisVal, lastVal, unit, digits, reverse=false }: {
  label:string; thisVal:number|null; lastVal:number|null; unit:string; digits:number; reverse?:boolean;
}) {
  const fmt=(v:number|null)=>v===null?"—":(digits===0?Math.round(v).toString():v.toFixed(digits));
  const diff=thisVal!==null&&lastVal!==null?thisVal-lastVal:null;
  return (
    <div>
      <div className="text-sm font-bold text-gray-500 mb-2">{label}</div>
      <div className="grid grid-cols-3 gap-2 text-center items-center">
        <div className={`py-3 rounded-xl ${thisVal!==null?"bg-green-50":"bg-gray-50"}`}>
          <span className={`text-2xl font-black ${thisVal!==null?"text-green-700":"text-gray-300"}`}>{fmt(thisVal)}</span>
          <span className="text-sm text-gray-500 ml-0.5">{unit}</span>
        </div>
        <div className="py-3 flex flex-col items-center justify-center">
          {diff!==null ? (diff===0
            ? <span className="text-base font-bold text-gray-400">±0</span>
            : <><span className={`text-xl font-black ${(reverse?diff<0:diff>0)?"text-green-600":"text-red-500"}`}>{diff>0?"▲":"▼"}</span>
               <span className={`text-base font-black ${(reverse?diff<0:diff>0)?"text-green-600":"text-red-500"}`}>{Math.abs(diff).toFixed(digits)}{unit}</span></>
          ) : <span className="text-base text-gray-300">—</span>}
        </div>
        <div className={`py-3 rounded-xl ${lastVal!==null?"bg-gray-100":"bg-gray-50"}`}>
          <span className={`text-2xl font-black ${lastVal!==null?"text-gray-600":"text-gray-300"}`}>{fmt(lastVal)}</span>
          <span className="text-sm text-gray-500 ml-0.5">{unit}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ライトボックス（写真拡大表示）
// ============================================================
function Lightbox({ photo, caption, onClose }: { photo: string; caption: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div className="fixed inset-0 bg-black bg-opacity-95 z-50 flex flex-col items-center justify-center"
      onClick={onClose}>
      <div className="w-full max-w-lg px-4" onClick={e => e.stopPropagation()}>
        <img src={photo} alt="植物の写真" className="w-full rounded-2xl shadow-2xl object-contain max-h-[70vh]"/>
        <div className="text-center mt-3 text-white text-lg font-medium">{caption}</div>
        <button onClick={onClose}
          className="mt-4 w-full py-3 bg-white bg-opacity-20 hover:bg-opacity-30 text-white text-xl font-bold rounded-2xl transition-all">
          ✕　閉じる
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 写真カード（前年比較用）
// ============================================================
function PhotoCard({ m, onTap }: { m: Measurement; onTap: () => void }) {
  const s = getVPDStatus(m.vpd);
  const w = WEATHER_OPTIONS.find(o => o.value === m.weather);
  return (
    <button onClick={onTap} className={`text-left w-full rounded-2xl overflow-hidden border-2 ${s.border} shadow-sm active:scale-95 transition-transform`}>
      {m.photoBase64
        ? <img src={m.photoBase64} alt="植物の写真" className="w-full aspect-square object-cover"/>
        : <div className="w-full aspect-square bg-gray-100 flex items-center justify-center text-4xl">🌿</div>
      }
      <div className={`p-2 ${s.bg}`}>
        <div className="flex items-center gap-1 mb-1">
          <span>{w?.emoji}</span>
          <span className="text-xs text-gray-500">{formatTimestamp(m.timestamp)}</span>
        </div>
        <div className={`text-base font-black ${s.textColor}`}>{m.vpd} g/m³</div>
        <div className={`text-xs font-medium ${s.textColor}`}>{s.label}</div>
      </div>
    </button>
  );
}

// ============================================================
// メインアプリ
// ============================================================
export default function VPDApp() {
  const [mounted, setMounted]         = useState(false);
  const [tab, setTab]                 = useState<TabType>("current");
  const [graphMetric, setGraphMetric] = useState<GraphMetric>("vpd");
  const [measurements, setMeasurements] = useState<Measurement[]>([]);

  // 現在の入力
  const [temperature, setTemperature] = useState(22);
  const [humidity,    setHumidity]    = useState(70);
  const [weather,     setWeather]     = useState<WeatherType>("sunny");
  const [savedFeedback, setSavedFeedback] = useState(false);

  // 写真
  const [pendingPhoto, setPendingPhoto]   = useState<string | null>(null);
  const [lightboxData, setLightboxData]   = useState<{ photo: string; caption: string } | null>(null);
  const [photoLoading, setPhotoLoading]   = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // 前年比較
  const [cmpYear,  setCmpYear]  = useState(() => new Date().getFullYear());
  const [cmpMonth, setCmpMonth] = useState(() => new Date().getMonth());
  const [cmpShowPhoto, setCmpShowPhoto] = useState(true);

  // 時計
  const [displayNow, setDisplayNow] = useState(new Date());

  useEffect(() => {
    try {
      const raw = localStorage.getItem("vpd-data-v2");
      if (raw) setMeasurements(JSON.parse(raw));
    } catch { setMeasurements([]); }
    setMounted(true);
    const t = setInterval(() => setDisplayNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    try { localStorage.setItem("vpd-data-v2", JSON.stringify(measurements)); } catch {
      alert("保存容量が不足しています。古い記録を削除してください。");
    }
  }, [measurements, mounted]);

  const vpd    = calcVPD(temperature, humidity);
  const status = getVPDStatus(vpd);

  // 写真選択
  const handlePhotoCapture = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoLoading(true);
    try {
      const compressed = await compressImage(file, 640, 0.72);
      setPendingPhoto(compressed);
    } catch { alert("写真の読み込みに失敗しました。"); }
    finally {
      setPhotoLoading(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }, []);

  // 記録
  const handleRecord = useCallback(() => {
    setMeasurements(prev => [...prev, {
      id: crypto.randomUUID(), timestamp: Date.now(),
      temperature, humidity, vpd, weather,
      photoBase64: pendingPhoto ?? undefined,
    }]);
    setPendingPhoto(null);
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2500);
  }, [temperature, humidity, vpd, weather, pendingPhoto]);

  const handleDelete = useCallback((id: string) =>
    setMeasurements(prev => prev.filter(m => m.id !== id)), []);

  const handleDeleteAll = useCallback(() => {
    if (window.confirm("すべての記録を削除しますか？\nこの操作は元に戻せません。"))
      setMeasurements([]);
  }, []);

  const moveCmpMonth = (delta: number) => {
    let y = cmpYear, m = cmpMonth + delta;
    if (m < 0)  { m = 11; y--; }
    if (m > 11) { m = 0;  y++; }
    setCmpYear(y); setCmpMonth(m);
  };

  const thisYearDays  = groupByDay(measurements, cmpYear,   cmpMonth);
  const lastYearDays  = groupByDay(measurements, cmpYear-1, cmpMonth);
  const thisStats     = calcMonthStats(thisYearDays);
  const lastStats     = calcMonthStats(lastYearDays);
  const daysInCmpMonth = getDaysInMonth(cmpYear, cmpMonth);

  // 前年比較：写真付き記録
  const thisYearPhotos = measurements.filter(m => {
    const d = new Date(m.timestamp);
    return d.getFullYear()===cmpYear && d.getMonth()===cmpMonth;
  }).sort((a,b)=>a.timestamp-b.timestamp);
  const lastYearPhotos = measurements.filter(m => {
    const d = new Date(m.timestamp);
    return d.getFullYear()===cmpYear-1 && d.getMonth()===cmpMonth;
  }).sort((a,b)=>a.timestamp-b.timestamp);

  const storageKB = estimateStorageKB(measurements);
  const MONTH_NAMES = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];

  const allStats = (() => {
    if (!measurements.length) return null;
    const vpds = measurements.map(m=>m.vpd);
    return {
      count:   measurements.length,
      avg:     (vpds.reduce((a,b)=>a+b,0)/vpds.length).toFixed(1),
      min:     Math.min(...vpds).toFixed(1),
      max:     Math.max(...vpds).toFixed(1),
      optimal: Math.round(measurements.filter(m=>m.vpd>=3&&m.vpd<=6).length/vpds.length*100),
    };
  })();

  const vpdRangeTable = [
    { range:"0〜3 g/m³",   status:"高湿度環境",    emoji:"💧", action:"除湿・換気",       bg:"bg-blue-50",   text:"text-blue-700",   isActive:vpd<3 },
    { range:"3〜6 g/m³",   status:"適切な飽差 ✅", emoji:"✅", action:"現状維持",         bg:"bg-green-50",  text:"text-green-700",  isActive:vpd>=3&&vpd<=6 },
    { range:"6〜10 g/m³",  status:"許容範囲",       emoji:"⚠️", action:"加湿を検討",       bg:"bg-amber-50",  text:"text-amber-700",  isActive:vpd>6&&vpd<=10 },
    { range:"10〜15 g/m³", status:"低湿度（注意）", emoji:"🔸", action:"加湿・噴霧・遮光", bg:"bg-orange-50", text:"text-orange-700", isActive:vpd>10&&vpd<=15 },
    { range:"15 g/m³以上", status:"低湿度（危険）", emoji:"🚨", action:"緊急対処が必要",   bg:"bg-red-50",    text:"text-red-700",    isActive:vpd>15 },
  ];

  const TABS: { id:TabType; label:string; icon:string }[] = [
    { id:"current", label:"現在の状態", icon:"📊" },
    { id:"history", label:"記録履歴",   icon:"📋" },
    { id:"graph",   label:"グラフ",     icon:"📈" },
    { id:"compare", label:"前年比較",   icon:"📅" },
  ];

  if (!mounted) return (
    <div className="min-h-screen flex items-center justify-center bg-green-50">
      <div className="text-center"><div className="text-5xl mb-3">🍓</div>
        <p className="text-green-700 text-xl font-medium">読み込み中...</p></div>
    </div>
  );

  return (
    <main className="min-h-screen bg-gray-50 select-none">
      {/* ライトボックス */}
      {lightboxData && (
        <Lightbox photo={lightboxData.photo} caption={lightboxData.caption}
          onClose={() => setLightboxData(null)} />
      )}

      {/* 非表示のファイル入力 */}
      <input ref={photoInputRef} type="file" accept="image/*"
        className="hidden" onChange={handlePhotoCapture} />

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
                tab===t.id ? "text-green-700 border-b-[3px] border-green-600 bg-green-50 font-bold"
                           : "text-gray-500 border-b-[3px] border-transparent hover:bg-gray-50 font-medium"}`}>
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
                  <button key={w.value} onClick={()=>setWeather(w.value)}
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
              <NumberInput label="温 度" unit="°C" value={temperature} min={0}  max={45}  step={0.5} onChange={setTemperature} color="red"/>
              <NumberInput label="湿 度" unit="%"  value={humidity}    min={0}  max={100} step={1}   onChange={setHumidity}    color="blue"/>
            </section>

            {/* 飽差表示 */}
            <section className={`rounded-2xl shadow-md border-2 p-5 transition-all duration-500 ${status.bg} ${status.border}`}>
              <h2 className="text-xl font-bold text-gray-700 mb-4 flex items-center gap-2"><span>💨</span>飽差（VPD）</h2>
              <VPDGauge vpd={vpd}/>
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
                {status.actions.map((a,i) => (
                  <div key={i} className={`flex items-center gap-4 py-4 px-5 rounded-2xl ${status.badgeBg}`}>
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
                  <div key={row.range} className={`flex items-center gap-3 px-4 py-3 rounded-xl ${row.bg} ${row.isActive?"ring-2 ring-green-500 ring-offset-1 shadow-sm":""}`}>
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

            {/* 📸 写真添付 */}
            <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-xl font-bold text-gray-700 mb-3 flex items-center gap-2">
                <span>📸</span>植物の写真（任意）
              </h2>

              {pendingPhoto ? (
                <div className="relative">
                  <img src={pendingPhoto} alt="撮影した写真" className="w-full max-h-64 object-cover rounded-2xl shadow-sm"/>
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => setLightboxData({ photo: pendingPhoto, caption: "撮影した写真" })}
                      className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 text-lg font-bold rounded-xl transition-all">
                      🔍 拡大して見る
                    </button>
                    <button onClick={() => setPendingPhoto(null)}
                      className="flex-1 py-3 bg-red-50 hover:bg-red-100 text-red-600 text-lg font-bold rounded-xl transition-all border-2 border-red-200">
                      🗑️ 写真を削除
                    </button>
                  </div>
                  <p className="text-center text-green-600 text-base mt-2 font-medium">✅ 記録するとこの写真が保存されます</p>
                </div>
              ) : (
                <button onClick={() => photoInputRef.current?.click()}
                  disabled={photoLoading}
                  className="w-full py-6 border-2 border-dashed border-gray-300 rounded-2xl text-center hover:border-green-400 hover:bg-green-50 active:scale-98 transition-all">
                  {photoLoading ? (
                    <><div className="text-4xl mb-2">⏳</div>
                      <div className="text-lg font-medium text-gray-500">写真を読み込み中...</div></>
                  ) : (
                    <><div className="text-5xl mb-2">📷</div>
                      <div className="text-xl font-bold text-gray-600">写真を撮る・選ぶ</div>
                      <div className="text-base text-gray-400 mt-1">タップするとカメラまたは写真ライブラリが開きます</div></>
                  )}
                </button>
              )}

              {/* 保存容量 */}
              {storageKB > 1000 && (
                <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-amber-50 rounded-xl border border-amber-200">
                  <span className="text-xl">⚠️</span>
                  <span className="text-sm text-amber-700">保存容量が多くなっています（約{storageKB}KB使用）。古い記録の削除をご検討ください。</span>
                </div>
              )}
            </section>

            {/* 記録ボタン */}
            <button onClick={handleRecord}
              className={`record-btn w-full py-6 rounded-2xl text-2xl font-black shadow-lg transition-all duration-200 ${
                savedFeedback ? "bg-green-500 text-white" : "bg-green-700 text-white hover:bg-green-800 active:scale-97"}`}>
              {savedFeedback ? "✅　記録しました！" : `📝　記録する${pendingPhoto ? "（写真あり📸）" : ""}`}
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
                {measurements.length>0&&(
                  <button onClick={handleDeleteAll} className="text-sm text-red-400 hover:text-red-600 border border-red-200 rounded-lg px-3 py-1 transition-colors">全削除</button>
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
                  const w = WEATHER_OPTIONS.find(o=>o.value===m.weather);
                  return (
                    <div key={m.id} className={`bg-white rounded-2xl shadow-sm border-2 p-4 ${s.border}`}>
                      <div className="flex items-start gap-3">
                        {/* サムネイル */}
                        {m.photoBase64 ? (
                          <button onClick={()=>setLightboxData({photo:m.photoBase64!,caption:formatTimestamp(m.timestamp)})}
                            className="flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden shadow-sm active:scale-95 transition-transform">
                            <img src={m.photoBase64} alt="植物" className="w-full h-full object-cover"/>
                          </button>
                        ) : (
                          <div className="flex-shrink-0 w-20 h-20 rounded-xl bg-gray-100 flex items-center justify-center text-3xl">🌿</div>
                        )}

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-2xl">{w?.emoji}</span>
                            <span className="text-base font-medium text-gray-500">{formatTimestamp(m.timestamp)}</span>
                            <button onClick={()=>handleDelete(m.id)} className="ml-auto text-gray-300 hover:text-red-400 transition-colors text-xl" aria-label="削除">🗑️</button>
                          </div>
                          <div className="grid grid-cols-3 gap-1.5 mb-2">
                            {[
                              {label:"温度", value:m.temperature, unit:"°C", color:"text-red-700"},
                              {label:"湿度", value:m.humidity,    unit:"%",  color:"text-blue-700"},
                              {label:"飽差", value:m.vpd,         unit:"g/m³", color:s.textColor},
                            ].map(cell=>(
                              <div key={cell.label} className={`text-center py-1.5 rounded-xl ${s.badgeBg}`}>
                                <div className="text-xs text-gray-500">{cell.label}</div>
                                <div className={`text-xl font-black ${cell.color}`}>{cell.value}</div>
                                <div className="text-xs text-gray-400">{cell.unit}</div>
                              </div>
                            ))}
                          </div>
                          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${s.badgeBg}`}>
                            <span className="text-lg">{s.emoji}</span>
                            <span className={`text-sm font-bold ${s.textColor}`}>{s.label}</span>
                          </div>
                        </div>
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
            {allStats&&(
              <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h3 className="text-lg font-bold text-gray-600 mb-3">📊 記録の統計（全{allStats.count}件）</h3>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  {[
                    {label:"平均飽差",        value:allStats.avg,     unit:"g/m³", color:"text-green-700"},
                    {label:"最小飽差",         value:allStats.min,     unit:"g/m³", color:"text-blue-700"},
                    {label:"最大飽差",         value:allStats.max,     unit:"g/m³", color:"text-red-700"},
                    {label:"適切な飽差の割合", value:allStats.optimal, unit:"%",    color:"text-green-700"},
                  ].map(s=>(
                    <div key={s.label} className="bg-gray-50 rounded-xl py-3 px-4 text-center">
                      <div className={`text-3xl font-black ${s.color} tabular-nums`}>{s.value}<span className="text-lg ml-0.5">{s.unit}</span></div>
                      <div className="text-sm text-gray-500 mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>
                <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full transition-all duration-700" style={{width:`${allStats.optimal}%`}}/>
                </div>
              </section>
            )}
            <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <div className="flex gap-2 mb-4">
                {([
                  {id:"vpd",label:"飽差",color:"bg-green-100 text-green-700 border-green-300"},
                  {id:"temp",label:"温度",color:"bg-red-100 text-red-700 border-red-300"},
                  {id:"humidity",label:"湿度",color:"bg-blue-100 text-blue-700 border-blue-300"},
                ] as {id:GraphMetric;label:string;color:string}[]).map(m=>(
                  <button key={m.id} onClick={()=>setGraphMetric(m.id)}
                    className={`flex-1 py-2 rounded-xl text-base font-bold border-2 transition-all ${graphMetric===m.id?m.color+" shadow-sm":"bg-gray-50 text-gray-400 border-gray-100"}`}>
                    {m.label}
                  </button>
                ))}
              </div>
              <VPDLineChart data={measurements} metric={graphMetric}/>
              {graphMetric==="vpd"&&measurements.length>=2&&(
                <div className="flex flex-wrap gap-3 mt-4 justify-center">
                  {[{color:"bg-red-200",label:"低湿度"},{color:"bg-amber-200",label:"許容範囲"},{color:"bg-green-200",label:"✅ 適切"},{color:"bg-blue-200",label:"高湿度"}].map(i=>(
                    <div key={i.label} className="flex items-center gap-1.5">
                      <div className={`w-5 h-5 rounded ${i.color}`}/><span className="text-sm text-gray-600">{i.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {/* ====== 前年比較 ====== */}
        {tab==="compare" && (
          <div className="tab-content space-y-4">
            <h2 className="text-2xl font-black text-gray-700">前年比較</h2>

            {/* 月ナビゲーター */}
            <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center justify-between">
                <button onClick={()=>moveCmpMonth(-1)}
                  className="w-14 h-14 rounded-2xl bg-gray-100 hover:bg-gray-200 active:scale-90 transition-all text-2xl font-bold text-gray-600 flex items-center justify-center">◀</button>
                <div className="text-center">
                  <div className="text-3xl font-black text-gray-800">{cmpYear}年 {MONTH_NAMES[cmpMonth]}</div>
                  <div className="text-sm text-gray-400 mt-0.5">vs {cmpYear-1}年 {MONTH_NAMES[cmpMonth]}</div>
                </div>
                <button onClick={()=>moveCmpMonth(1)}
                  disabled={cmpYear===new Date().getFullYear()&&cmpMonth===new Date().getMonth()}
                  className="w-14 h-14 rounded-2xl bg-gray-100 hover:bg-gray-200 active:scale-90 transition-all text-2xl font-bold text-gray-600 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed">▶</button>
              </div>
            </section>

            {/* 表示切り替え */}
            <div className="flex gap-2">
              {[{on:!cmpShowPhoto,label:"📈 グラフ・統計",action:()=>setCmpShowPhoto(false)},
                {on:cmpShowPhoto, label:"📸 写真で比較",  action:()=>setCmpShowPhoto(true)}].map(btn=>(
                <button key={btn.label} onClick={btn.action}
                  className={`flex-1 py-3 rounded-2xl text-lg font-bold border-2 transition-all ${
                    btn.on ? "bg-green-600 text-white border-green-600 shadow-md" : "bg-white text-gray-500 border-gray-200"}`}>
                  {btn.label}
                </button>
              ))}
            </div>

            {/* ===== 写真比較ビュー ===== */}
            {cmpShowPhoto && (
              <div className="space-y-4">
                {thisYearPhotos.length===0 && lastYearPhotos.length===0 ? (
                  <div className="bg-white rounded-2xl p-10 text-center text-gray-400 shadow-sm">
                    <div className="text-5xl mb-3">📸</div>
                    <p className="text-xl font-medium">この月の記録がありません</p>
                    <p className="text-base mt-2 leading-relaxed">「現在の状態」タブで写真付きで記録すると<br/>ここで前年の写真と比較できます</p>
                  </div>
                ) : (
                  <>
                    {/* 凡例 */}
                    <div className="flex items-center justify-center gap-6">
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-green-500"/>
                        <span className="text-lg font-bold text-green-700">今年（{cmpYear}年）</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-gray-400"/>
                        <span className="text-lg font-bold text-gray-500">去年（{cmpYear-1}年）</span>
                      </div>
                    </div>

                    {/* 2列比較グリッド */}
                    <div className="grid grid-cols-2 gap-3">
                      {/* 今年 */}
                      <div>
                        <div className="text-center py-2 mb-2 bg-green-100 rounded-xl">
                          <span className="text-base font-black text-green-700">今年 {MONTH_NAMES[cmpMonth]}</span>
                          <span className="block text-sm text-green-600">{thisYearPhotos.length}件</span>
                        </div>
                        {thisYearPhotos.length===0 ? (
                          <div className="aspect-square bg-gray-50 rounded-2xl flex flex-col items-center justify-center text-gray-300 border-2 border-dashed border-gray-200">
                            <div className="text-4xl mb-2">📷</div>
                            <div className="text-sm">記録なし</div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {thisYearPhotos.map(m=>(
                              <PhotoCard key={m.id} m={m}
                                onTap={()=>m.photoBase64&&setLightboxData({photo:m.photoBase64,caption:`今年 ${formatTimestamp(m.timestamp)}　飽差 ${m.vpd} g/m³`})}/>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* 去年 */}
                      <div>
                        <div className="text-center py-2 mb-2 bg-gray-100 rounded-xl">
                          <span className="text-base font-black text-gray-600">去年 {MONTH_NAMES[cmpMonth]}</span>
                          <span className="block text-sm text-gray-500">{lastYearPhotos.length}件</span>
                        </div>
                        {lastYearPhotos.length===0 ? (
                          <div className="aspect-square bg-gray-50 rounded-2xl flex flex-col items-center justify-center text-gray-300 border-2 border-dashed border-gray-200">
                            <div className="text-4xl mb-2">📷</div>
                            <div className="text-sm">記録なし</div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {lastYearPhotos.map(m=>(
                              <PhotoCard key={m.id} m={m}
                                onTap={()=>m.photoBase64&&setLightboxData({photo:m.photoBase64,caption:`去年 ${formatTimestamp(m.timestamp)}　飽差 ${m.vpd} g/m³`})}/>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ===== グラフ・統計ビュー ===== */}
            {!cmpShowPhoto && (
              <div className="space-y-4">
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

                {/* 飽差グラフ */}
                <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                  <h3 className="text-lg font-bold text-gray-600 mb-3">📈 飽差の日別平均（{MONTH_NAMES[cmpMonth]}）</h3>
                  {thisYearDays.size===0&&lastYearDays.size===0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-gray-400">
                      <div className="text-5xl mb-3">📅</div>
                      <p className="text-lg">この月のデータがありません</p>
                    </div>
                  ) : (
                    <>
                      <CompareChart thisYear={thisYearDays} lastYear={lastYearDays} daysInMonth={daysInCmpMonth}/>
                      <div className="flex flex-wrap gap-3 mt-3 justify-center">
                        {[{color:"bg-red-200",label:"低湿度"},{color:"bg-amber-200",label:"許容範囲"},{color:"bg-green-200",label:"✅ 適切"},{color:"bg-blue-200",label:"高湿度"}].map(i=>(
                          <div key={i.label} className="flex items-center gap-1.5">
                            <div className={`w-4 h-4 rounded ${i.color}`}/><span className="text-sm text-gray-600">{i.label}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </section>

                {/* 統計比較 */}
                {(thisStats||lastStats)&&(
                  <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                    <h3 className="text-lg font-bold text-gray-600 mb-4">📊 月間統計の比較</h3>
                    <div className="grid grid-cols-3 gap-2 text-center mb-4">
                      <div className="text-base font-bold text-green-700 py-2 bg-green-50 rounded-xl">今年<br/><span className="text-sm font-normal text-gray-500">{cmpYear}年{MONTH_NAMES[cmpMonth]}</span></div>
                      <div className="text-base font-bold text-gray-500 py-2 bg-gray-50 rounded-xl">差</div>
                      <div className="text-base font-bold text-gray-500 py-2 bg-gray-50 rounded-xl">去年<br/><span className="text-sm font-normal text-gray-400">{cmpYear-1}年{MONTH_NAMES[cmpMonth]}</span></div>
                    </div>
                    <div className="space-y-4">
                      <CompareRow label="💨 平均飽差"           thisVal={thisStats?.avgVPD??null}      lastVal={lastStats?.avgVPD??null}      unit="g/m³" digits={1} reverse/>
                      <CompareRow label="✅ 適切率（3〜6 g/m³）" thisVal={thisStats?.optimalRate??null}  lastVal={lastStats?.optimalRate??null}  unit="%" digits={0}/>
                      <CompareRow label="🌡️ 平均温度"           thisVal={thisStats?.avgTemp??null}      lastVal={lastStats?.avgTemp??null}      unit="°C" digits={1}/>
                      <CompareRow label="💧 平均湿度"           thisVal={thisStats?.avgHumidity??null}  lastVal={lastStats?.avgHumidity??null}  unit="%" digits={1}/>
                      <CompareRow label="📝 記録件数"           thisVal={thisStats?.recordCount??null}  lastVal={lastStats?.recordCount??null}  unit="件" digits={0}/>
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
