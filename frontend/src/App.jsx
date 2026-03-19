import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Move, Scaling, Palette } from 'lucide-react';

const GRID_SIZE = 40;
const MIN_W = 5;
const MIN_H = 4;
const LAYOUT_STORAGE_KEY = 'sysmon-layout-v1';

const THEMES = {
  green: { primary: '#5fa371', secondary: '#6ba2b0', accent: '#bda355', name: 'MATRIX_GRN' },
  amber: { primary: '#bfa256', secondary: '#b88158', accent: '#b86565', name: 'AMBER_CRT' },
  cyan: { primary: '#63a6a1', secondary: '#b57a9b', accent: '#9478ad', name: 'CYBER_CYN' },
  purple: { primary: '#8c73a6', secondary: '#67a19d', accent: '#b5737f', name: 'NEON_PURP' }
};

const DEFAULT_LAYOUT = [
  { id: 'cpu', type: 'CPU', x: 0, y: 0, w: 8, h: 7 },
  { id: 'memory', type: 'MEMORY', x: 8, y: 0, w: 7, h: 7 },
  { id: 'storage', type: 'STORAGE', x: 15, y: 0, w: 8, h: 7 },
  { id: 'network', type: 'NETWORK', x: 0, y: 7, w: 9, h: 8 },
  { id: 'docker', type: 'DOCKER', x: 9, y: 7, w: 14, h: 8 },
  { id: 'thermal', type: 'THERMAL', x: 0, y: 15, w: 11, h: 6 },
  { id: 'services', type: 'SERVICES', x: 11, y: 15, w: 12, h: 6 },
];

const hexToRgb = (hex) => {
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
};

const clampGridValue = (value, fallback, min = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.round(parsed)) : fallback;
};

const normalizeLayout = (layout) => {
  if (!Array.isArray(layout)) return DEFAULT_LAYOUT;

  const savedById = new Map(layout.map((item) => [item?.id, item]));

  return DEFAULT_LAYOUT.map((item) => {
    const saved = savedById.get(item.id);
    if (!saved) return item;

    return {
      ...item,
      x: clampGridValue(saved.x, item.x),
      y: clampGridValue(saved.y, item.y),
      w: clampGridValue(saved.w, item.w, MIN_W),
      h: clampGridValue(saved.h, item.h, MIN_H),
    };
  });
};

const loadLayout = () => {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT;

  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    return raw ? normalizeLayout(JSON.parse(raw)) : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
};

const saveLayout = (layout) => {
  if (typeof window === 'undefined') return;

  window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(normalizeLayout(layout)));
};

// --- Live Data Hook ---
const useSystemData = () => {
  const [data, setData] = useState({
    cpu: { usage: 0, temp: 0, load: [0, 0, 0] },
    memory: { used: 0, buffers: 0, cache: 0, total: 1 },
    storage: { system: 0, data: 0, total: 1, readIops: 0, writeIops: 0, health: 'OK' },
    network: { up: 0, down: 0, activeConns: 0, history: Array(20).fill(0) },
    docker: [],
    thermal: { zones: [], fans: [] },
    services: [],
    binaryNoise: '01010101',
    uptime: 0
  });

  const historyRef = useRef(Array(20).fill(0));

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/stats');
        const json = await res.json();
        historyRef.current = [...historyRef.current.slice(1), json.network?.down || 0];
        setData(prev => ({
          ...json,
          network: { ...json.network, history: [...historyRef.current] }
        }));
      } catch (e) {
        console.error('Fetch error:', e);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 1000);
    return () => clearInterval(interval);
  }, []);

  return data;
};

// --- Pixel Art ---
const PixelSprite = ({ matrix, className = "" }) => (
  <svg viewBox={`0 0 ${matrix[0].length} ${matrix.length}`} className={`w-8 h-8 ${className}`}>
    {matrix.map((row, y) => row.split('').map((cell, x) =>
      cell === 'X' ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="currentColor" /> : null
    ))}
  </svg>
);

const SPRITES = {
  hacker: ["  XXXXXX  "," X      X ","X XX  XX X","X XX  XX X","X        X"," X XXXX X ","  X    X  ","   XXXX   "],
  cpu: [" X X X X  ","XXXXXXXXX ","X       X ","XX XXX XX ","X X   X X ","XX XXX XX ","X       X ","XXXXXXXXX "," X X X X  "],
  memory: ["  XXXXXX  "," XX    XX ","X XXXXXX X"," X      X ","X XXXXXX X"," X      X ","X XXXXXX X"," XX    XX ","  XXXXXX  "],
  docker: ["       X  ","      X X ","       X  "," XXX      ","XXXXX     ","XXXXXXXXX ","X     X X ","XXXXXXXXX "," XXXXXXX  "],
  network: ["  X    X  ","   X  X   ","X  XXXX  X"," XXX  XXX ","  X XX X  ","  X XX X  "," XXX  XXX ","X  XXXX  X","   X  X   "],
  storage: ["   XXXX   ","  XX  XX  "," XX    XX ","XXXXXXXXXX","X  XXXX  X","XXXXXXXXXX","X  XXXX  X","XXXXXXXXXX"," XX    XX ","  XXXXXX  "],
  thermal: ["    XX    ","   X  X   ","   X  X   ","   XXXX   ","  XXXXXX  "," XXXXXXXX ","  XXXXXX  ","   XXXX   ","    XX    "],
  services: ["  XXXXXX  "," X  XX  X ","X   XX   X","XXXX  XXXX","XX      XX","XXXX  XXXX","X   XX   X"," X  XX  X ","  XXXXXX  "]
};

// --- UI Components ---
const AsciiProgressBar = ({ percent, width = 15, colorClass = "text-theme" }) => {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
  const empty = Math.max(0, width - filled);
  return (
    <span className={`${colorClass} font-mono tracking-widest transition-colors`}>
      [{'█'.repeat(filled)}<span className="opacity-30">{'.'.repeat(empty)}</span>] {Math.round(percent).toString().padStart(3, '0')}%
    </span>
  );
};

const WidgetHeader = ({ title, sprite, noise }) => (
  <div className="border-b-2 border-theme-dim pb-2 mb-3 flex justify-between items-center">
    <div className="flex items-center space-x-3">
      <div className="text-theme-sec animate-pixel-jump drop-shadow-theme-sec">
        <PixelSprite matrix={SPRITES[sprite]} className="w-6 h-6" />
      </div>
      <span className="font-bold text-lg tracking-wider text-theme drop-shadow-theme">{title}</span>
    </div>
    {noise && <span className="text-xs text-theme opacity-70 border border-theme-dim px-1">{noise}</span>}
  </div>
);

// --- Widgets ---
const CpuWidget = ({ data, noise }) => (
  <div className="h-full flex flex-col">
    <WidgetHeader title="CPU_CORE_SYS" sprite="cpu" noise={`TEMP:${data.temp.toFixed(1)}°C`} />
    <div className="flex-1 flex flex-col justify-between space-y-2">
      <div className="text-xs text-theme opacity-80 mb-2">
        LOAD_AVG: [{data.load.join(', ')}]
      </div>
      <div>
        <div className="text-xs text-theme opacity-80 mb-1">THREAD_001 (MAIN)</div>
        <AsciiProgressBar percent={data.usage} width={12} colorClass="text-theme" />
      </div>
      <div>
        <div className="text-xs text-theme-sec opacity-90 mb-1">THREAD_002 (WORKER)</div>
        <AsciiProgressBar percent={Math.max(0, data.usage - 15)} width={12} colorClass="text-theme-sec" />
      </div>
      <div>
        <div className="text-xs text-theme-acc opacity-90 mb-1">THREAD_003 (BG)</div>
        <AsciiProgressBar percent={Math.min(100, data.usage + 12)} width={12} colorClass="text-theme-acc" />
      </div>
    </div>
  </div>
);

const MemoryWidget = ({ data }) => {
  const percent = (data.used / data.total) * 100;
  return (
    <div className="h-full flex flex-col">
      <WidgetHeader title="MEM_ALLOCATION" sprite="memory" />
      <div className="flex-1 flex flex-col justify-between">
        <div className="text-4xl font-bold animate-pulse text-theme-sec drop-shadow-theme-sec mt-2">
          {data.used.toFixed(1)}<span className="text-lg opacity-80 text-theme">GB</span>
        </div>
        <div className="my-2">
          <div className="text-xs text-theme opacity-80 mb-1">CAPACITY: {data.total}GB</div>
          <AsciiProgressBar percent={percent} width={14} colorClass="text-theme-sec" />
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs border-t border-theme-dim pt-2 mt-auto">
          <div>CACHE: <span className="text-theme-sec opacity-90">{data.cache}GB</span></div>
          <div>BUFFERS: <span className="text-theme-acc opacity-90">{data.buffers}GB</span></div>
        </div>
      </div>
    </div>
  );
};

const StorageWidget = ({ data }) => {
  const sysPercent = data.total > 0 ? (data.system / data.total) * 100 : 0;
  const dataPercent = data.total > 0 ? (data.data / data.total) * 100 : 0;
  return (
    <div className="h-full flex flex-col">
      <WidgetHeader title="MOUNT_POINTS" sprite="storage" noise={`HLTH:${data.health}`} />
      <div className="flex-1 flex flex-col justify-around text-sm space-y-2">
        <div>
          <div className="flex justify-between mb-1 opacity-80 text-theme-sec">
            <span>/dev/sda1 (SYS)</span><span>{data.system}G</span>
          </div>
          <div className="h-4 w-full border border-theme-sec p-0.5 flex">
            <div className="h-full bg-theme-sec" style={{ width: `${sysPercent}%` }}></div>
          </div>
        </div>
        <div>
          <div className="flex justify-between mb-1 opacity-80 text-theme-acc">
            <span>/dev/sdb1 (DATA)</span><span>{data.data}G</span>
          </div>
          <div className="h-4 w-full border border-theme-acc p-0.5 flex">
            <div className="h-full bg-theme-acc" style={{ width: `${dataPercent}%` }}></div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs border-t border-theme-dim pt-2 mt-2">
          <div className="text-theme-sec">RD: {data.readIops} IOPS</div>
          <div className="text-theme-acc">WR: {data.writeIops} IOPS</div>
        </div>
      </div>
    </div>
  );
};

const NetworkWidget = ({ data }) => {
  const maxVal = Math.max(...data.history, 1);
  return (
    <div className="h-full flex flex-col">
      <WidgetHeader title="ETH0_TRAFFIC" sprite="network" noise={`${data.activeConns} CONNS`} />
      <div className="flex justify-between mb-2">
        <div>
          <div className="text-xs text-theme-sec opacity-80">RX_RATE (DOWN)</div>
          <div className="text-2xl font-bold text-theme-sec drop-shadow-theme-sec">{(data.down).toFixed(1)} <span className="text-xs font-normal">Mb/s</span></div>
        </div>
        <div className="text-right">
          <div className="text-xs text-theme-acc opacity-80">TX_RATE (UP)</div>
          <div className="text-2xl font-bold text-theme-acc drop-shadow-theme-acc">{(data.up).toFixed(1)} <span className="text-xs font-normal">Mb/s</span></div>
        </div>
      </div>
      <div className="flex-1 border border-theme-dim p-1 flex items-end space-x-[2px] mt-2 bg-theme-dim/10">
        {data.history.map((val, i) => {
          const height = `${(val / maxVal) * 100}%`;
          return (
            <div key={i} className="flex-1 bg-theme-sec opacity-80 flex flex-col justify-start" style={{ height }}>
               <div className="w-full h-[3px] bg-theme-acc"></div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const DockerWidget = ({ containers, noise }) => (
  <div className="h-full flex flex-col">
    <WidgetHeader title="DOCKER_DAEMON" sprite="docker" noise={`CTNRS:${containers.length}`} />
    <div className="text-xs flex mb-2 opacity-80 border-b border-theme-dim pb-1 font-bold text-theme">
      <div className="w-1/3">CONTAINER (IMAGE)</div>
      <div className="w-1/4">STATUS</div>
      <div className="w-1/6">RES</div>
      <div className="w-1/4 text-right">PORTS</div>
    </div>
    <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-2 text-xs">
      {containers.map((c) => (
        <div key={c.id} className="border border-theme-dim p-2 hover:bg-theme-dim transition-colors flex items-center justify-between group">
          <div className="w-1/3 pr-2 truncate">
            <div className="font-bold text-sm truncate text-theme-sec">{c.name}</div>
            <div className="opacity-60 truncate">{c.image}</div>
          </div>
          <div className="w-1/4">
            <span className={`px-1 font-bold animate-pulse ${c.status && c.status.toLowerCase().includes('up') ? 'text-theme bg-theme-dim' : 'text-theme-acc bg-theme-acc/20'}`}>
              [{(c.status || '').split(' ')[0].toUpperCase()}]
            </span>
            <div className="opacity-60 mt-1">{c.uptime}</div>
          </div>
          <div className="w-1/6 space-y-1">
             <div className="opacity-80">C:{c.cpu}%</div>
             <div className="opacity-80">M:{c.mem}</div>
          </div>
          <div className="w-1/4 text-right opacity-90 truncate text-theme-acc" title={c.ports}>
             {c.ports}
          </div>
        </div>
      ))}
    </div>
  </div>
);

// --- New Widgets ---

const ThermalWidget = ({ data }) => (
  <div className="h-full flex flex-col">
    <WidgetHeader title="THERMAL_SENSORS" sprite="thermal" noise={`ZONES:${data.zones.length}`} />
    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 text-sm">
      {data.zones.map((z, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="w-28 truncate text-xs opacity-80">{z.name}</span>
          <div className="flex-1 h-3 border border-theme-dim p-0.5 flex">
            <div className={`h-full ${z.temp > 70 ? 'bg-theme-acc' : 'bg-theme-sec'}`} style={{ width: `${Math.min(100, z.temp)}%` }}></div>
          </div>
          <span className={`text-xs font-bold w-14 text-right ${z.temp > 70 ? 'text-theme-acc' : 'text-theme-sec'}`}>{z.temp}°C</span>
        </div>
      ))}
      {data.zones.length === 0 && <div className="text-xs opacity-50">NO THERMAL ZONES DETECTED</div>}
      {data.fans.length > 0 && (
        <div className="border-t border-theme-dim pt-2 mt-2 space-y-1">
          <div className="text-xs opacity-80 font-bold text-theme mb-1">FAN_SPEED</div>
          {data.fans.map((f, i) => (
            <div key={i} className="flex justify-between text-xs">
              <span className="opacity-80">{f.name}</span>
              <span className="text-theme-sec font-bold">{f.rpm} RPM</span>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
);

const ServicesWidget = ({ services }) => (
  <div className="h-full flex flex-col">
    <WidgetHeader title="SYS_SERVICES" sprite="services" noise={`TOTAL:${services.length}`} />
    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1 text-xs">
      {services.map((s, i) => (
        <div key={i} className="flex items-center justify-between border border-theme-dim p-1.5 hover:bg-theme-dim transition-colors">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 inline-block ${s.running ? 'bg-theme-sec animate-pulse' : 'bg-theme-acc opacity-50'}`}></span>
            <span className="font-bold">{s.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-[10px] px-1 ${s.enabled ? 'text-theme border border-theme-dim' : 'opacity-40'}`}>
              {s.enabled ? 'ENABLED' : 'DISABLED'}
            </span>
            <span className={`font-bold px-1 ${s.running ? 'text-theme-sec bg-theme-dim' : 'text-theme-acc bg-theme-acc/20'}`}>
              [{s.running ? 'RUNNING' : 'STOPPED'}]
            </span>
          </div>
        </div>
      ))}
      {services.length === 0 && <div className="opacity-50">NO SERVICES DATA</div>}
    </div>
  </div>
);

// --- Main App & Grid Engine ---

export default function App() {
  const data = useSystemData();
  const [isEditing, setIsEditing] = useState(false);
  const [theme, setTheme] = useState('green');
  const [layout, setLayout] = useState(loadLayout);

  const [interaction, setInteraction] = useState(null);
  const containerRef = useRef(null);

  const getPointerPos = (e) => {
    if (e.touches && e.touches.length > 0) return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
    return { clientX: e.clientX, clientY: e.clientY };
  };

  const handlePointerDown = (e, item, type) => {
    if (!isEditing) return;
    e.stopPropagation();
    const pos = getPointerPos(e);
    setLayout(prev => {
      const filtered = prev.filter(l => l.id !== item.id);
      return [...filtered, item];
    });
    setInteraction({
      id: item.id, type,
      startX: item.x, startY: item.y, startW: item.w, startH: item.h,
      startMouseX: pos.clientX, startMouseY: pos.clientY,
    });
  };

  const handlePointerMove = useCallback((e) => {
    if (!interaction) return;
    const pos = getPointerPos(e);
    const deltaX = pos.clientX - interaction.startMouseX;
    const deltaY = pos.clientY - interaction.startMouseY;
    setLayout(prev => prev.map(item => {
      if (item.id !== interaction.id) return item;
      if (interaction.type === 'drag') {
        let newX = Math.round((interaction.startX * GRID_SIZE + deltaX) / GRID_SIZE);
        let newY = Math.round((interaction.startY * GRID_SIZE + deltaY) / GRID_SIZE);
        return { ...item, x: Math.max(0, newX), y: Math.max(0, newY) };
      }
      if (interaction.type === 'resize') {
        let newW = Math.round((interaction.startW * GRID_SIZE + deltaX) / GRID_SIZE);
        let newH = Math.round((interaction.startH * GRID_SIZE + deltaY) / GRID_SIZE);
        return { ...item, w: Math.max(MIN_W, newW), h: Math.max(MIN_H, newH) };
      }
      return item;
    }));
  }, [interaction]);

  const handlePointerUp = useCallback(() => setInteraction(null), []);

  useEffect(() => {
    if (interaction) {
      window.addEventListener('mousemove', handlePointerMove);
      window.addEventListener('mouseup', handlePointerUp);
      window.addEventListener('touchmove', handlePointerMove, { passive: false });
      window.addEventListener('touchend', handlePointerUp);
    }
    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
    };
  }, [interaction, handlePointerMove, handlePointerUp]);

  const handleEditToggle = () => {
    if (isEditing) {
      saveLayout(layout);
      setIsEditing(false);
      return;
    }

    setIsEditing(true);
  };

  const renderWidgetContent = (type) => {
    switch (type) {
      case 'CPU': return <CpuWidget data={data.cpu} noise={data.binaryNoise} />;
      case 'MEMORY': return <MemoryWidget data={data.memory} />;
      case 'STORAGE': return <StorageWidget data={data.storage} />;
      case 'NETWORK': return <NetworkWidget data={data.network} />;
      case 'DOCKER': return <DockerWidget containers={data.docker} noise={data.binaryNoise} />;
      case 'THERMAL': return <ThermalWidget data={data.thermal} />;
      case 'SERVICES': return <ServicesWidget services={data.services} />;
      default: return null;
    }
  };

  const formatUptime = (secs) => {
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return d > 0
      ? `${d}d ${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`
      : `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  };

  return (
    <div className="min-h-screen bg-[#050505] font-mono relative overflow-hidden p-4 md:p-8 text-theme">
      <style>{`
        :root {
          --theme-base: ${THEMES[theme].primary};
          --theme-rgb: ${hexToRgb(THEMES[theme].primary)};
          --theme-sec: ${THEMES[theme].secondary};
          --theme-sec-rgb: ${hexToRgb(THEMES[theme].secondary)};
          --theme-acc: ${THEMES[theme].accent};
          --theme-acc-rgb: ${hexToRgb(THEMES[theme].accent)};
        }
        .text-theme { color: var(--theme-base); }
        .text-theme-sec { color: var(--theme-sec); }
        .text-theme-acc { color: var(--theme-acc); }
        .bg-theme { background-color: var(--theme-base); }
        .bg-theme-sec { background-color: var(--theme-sec); }
        .bg-theme-acc { background-color: var(--theme-acc); }
        .bg-theme-dim { background-color: rgba(var(--theme-rgb), 0.15); }
        .border-theme { border-color: var(--theme-base); }
        .border-theme-sec { border-color: var(--theme-sec); }
        .border-theme-acc { border-color: var(--theme-acc); }
        .border-theme-dim { border-color: rgba(var(--theme-rgb), 0.3); }
        .shadow-theme { box-shadow: 4px 4px 0px 0px rgba(var(--theme-rgb), 0.8); }
        .drop-shadow-theme { filter: drop-shadow(0 0 6px rgba(var(--theme-rgb), 0.6)); }
        .drop-shadow-theme-sec { filter: drop-shadow(0 0 8px rgba(var(--theme-sec-rgb), 0.8)); }
        .drop-shadow-theme-acc { filter: drop-shadow(0 0 8px rgba(var(--theme-acc-rgb), 0.8)); }
        .glow-active { box-shadow: 0 0 25px rgba(var(--theme-sec-rgb), 0.6); border-color: var(--theme-sec); }
        @keyframes pixelJump { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        .animate-pixel-jump { animation: pixelJump 1s steps(2) infinite; }
        @keyframes flicker { 0% { opacity: 0.95; } 5% { opacity: 0.85; } 10% { opacity: 0.95; } 15% { opacity: 1; } 100% { opacity: 1; } }
        .crt-flicker { animation: flicker 4s infinite; }
        .custom-scrollbar::-webkit-scrollbar { width: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(var(--theme-rgb), 0.05); border-left: 1px solid rgba(var(--theme-rgb), 0.2); }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(var(--theme-rgb), 0.6); }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: var(--theme-sec); }
      `}</style>

      <div className="pointer-events-none fixed inset-0 z-50 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%] opacity-40"></div>

      <div
        className={`fixed inset-0 pointer-events-none transition-opacity duration-500 z-0 ${isEditing ? 'opacity-30' : 'opacity-5'}`}
        style={{
          backgroundImage: `radial-gradient(circle, var(--theme-base) 1px, transparent 1px)`,
          backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
          backgroundPosition: '0 0'
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto h-full flex flex-col crt-flicker">
        <header className="flex flex-col md:flex-row md:items-end justify-between mb-8 border-b-4 border-double border-theme pb-4">
          <div className="mb-4 md:mb-0 flex items-start gap-4">
            <div className="text-theme-sec animate-pixel-jump mt-1 hidden sm:block drop-shadow-theme-sec">
              <PixelSprite matrix={SPRITES.hacker} className="w-12 h-12" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tighter flex items-center gap-3 drop-shadow-theme">
                SYS_MONITOR_v3.0.sh
              </h1>
              <p className="text-sm mt-2 opacity-80 flex items-center gap-4">
                <span>STATUS: <span className="animate-pulse font-bold text-theme-sec drop-shadow-theme-sec">ONLINE</span></span>
                <span>UPTIME: {formatUptime(data.uptime)}</span>
                <span>ROOT: TRUE</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 bg-theme-dim px-3 py-2 border border-theme-dim">
              <Palette size={16} className="opacity-80 mr-1" />
              {Object.entries(THEMES).map(([key, config]) => (
                <button
                  key={key}
                  onClick={() => setTheme(key)}
                  className={`w-6 h-6 border-2 transition-all ${theme === key ? 'border-white scale-110 shadow-[0_0_8px_white]' : 'border-transparent opacity-50 hover:opacity-100'}`}
                  style={{ background: `linear-gradient(135deg, ${config.primary} 50%, ${config.secondary} 50%)` }}
                  title={config.name}
                />
              ))}
            </div>
            <button
              onClick={handleEditToggle}
              className={`px-6 py-2 font-bold uppercase tracking-widest border-2 transition-all duration-200 flex items-center gap-2 ${isEditing ? 'bg-theme text-black border-theme glow-active' : 'bg-black text-theme border-theme hover:bg-theme-dim'}`}
            >
              {isEditing ? '[ 保存排版 ]' : '[ 自由排版 ]'}
            </button>
          </div>
        </header>

        <div ref={containerRef} className="relative w-full flex-1 min-h-[900px]">
          {layout.map((item) => (
            <div
              key={item.id}
              className={`absolute bg-[#0a0a0a] border-2 transition-[box-shadow,border-color] duration-200 ${isEditing ? 'border-dashed border-theme-sec z-40' : 'border-solid border-theme shadow-theme'} ${interaction?.id === item.id ? 'opacity-90 z-50 glow-active' : ''}`}
              style={{
                left: item.x * GRID_SIZE, top: item.y * GRID_SIZE,
                width: item.w * GRID_SIZE, height: item.h * GRID_SIZE,
                transitionProperty: interaction?.id === item.id ? 'none' : 'left, top, width, height, box-shadow',
                transitionDuration: '200ms'
              }}
            >
              <div className="w-full h-full p-4 overflow-hidden relative">
                {renderWidgetContent(item.type)}
                {isEditing && (
                  <>
                    <div className="absolute inset-0 bg-theme-sec opacity-5 pointer-events-none" />
                    <div
                      className="absolute top-0 left-0 right-0 h-8 bg-theme-sec opacity-40 cursor-move flex items-center justify-center hover:opacity-80 transition-opacity text-black"
                      onMouseDown={(e) => handlePointerDown(e, item, 'drag')}
                      onTouchStart={(e) => handlePointerDown(e, item, 'drag')}
                    >
                      <Move size={16} />
                    </div>
                    <div
                      className="absolute bottom-0 right-0 w-8 h-8 bg-theme-sec opacity-40 cursor-se-resize flex items-center justify-center hover:opacity-80 transition-opacity rounded-tl-lg text-black"
                      onMouseDown={(e) => handlePointerDown(e, item, 'resize')}
                      onTouchStart={(e) => handlePointerDown(e, item, 'resize')}
                    >
                      <Scaling size={16} />
                    </div>
                    <div className="absolute bottom-1 left-1 text-[10px] font-bold bg-black/80 text-theme-sec px-1 pointer-events-none opacity-80">
                      P:{item.x},{item.y} S:{item.w}x{item.h}
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
