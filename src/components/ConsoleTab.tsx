import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Trash2, ArrowDownToLine, Terminal, Search, Copy, Check, X } from 'lucide-react';
import { LogEntry } from '../types';

interface ConsoleTabProps {
  logs: LogEntry[];
  onClear: () => void;
}

type LevelFilter = 'all' | 'system' | 'data' | 'warn' | 'error';

export const ConsoleTab: React.FC<ConsoleTabProps> = ({ logs, onClear }) => {
  const [autoScroll, setAutoScroll] = useState(true);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (levelFilter !== 'all' && l.type !== levelFilter) return false;
      if (q && !l.text.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logs, search, levelFilter]);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'auto' });
    }
  }, [filteredLogs, autoScroll]);

  const handleCopyAll = async () => {
    if (filteredLogs.length === 0) return;
    const text = filteredLogs
      .map((l) => `[${l.timestamp}] [${l.type.toUpperCase()}] ${l.text}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const getBadge = (type: string) => {
    switch (type) {
      case 'error':
        return { label: 'HATA', cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30', textCls: 'text-rose-300' };
      case 'warn':
        return { label: 'UYARI', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30', textCls: 'text-amber-200' };
      case 'system':
        return { label: 'SİSTEM', cls: 'lx-accent-badge', textCls: 'lx-accent-text' };
      default:
        return { label: 'BİLGİ', cls: 'bg-white/[0.06] text-zinc-400 border-white/10', textCls: 'text-zinc-300' };
    }
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Terminal className="w-5 h-5 lx-accent-text" />
            <span>Canlı Konsol</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Başlatıcı ve Minecraft JVM çıktıları ({filteredLogs.length} / {logs.length} satır)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleCopyAll}
            disabled={filteredLogs.length === 0}
            className="px-3 py-2 rounded-xl lx-card hover:bg-white/[0.06] text-xs font-medium text-zinc-200 flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Kopyalandı</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Kopyala</span>
              </>
            )}
          </button>

          <button
            onClick={() => setAutoScroll((v) => !v)}
            className={`px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
              autoScroll ? 'lx-accent-badge' : 'lx-card text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
            <span>Otomatik Kaydır</span>
          </button>

          <button
            onClick={onClear}
            className="px-3 py-2 rounded-xl lx-card hover:bg-rose-500/15 hover:border-rose-500/30 text-xs font-medium text-zinc-300 hover:text-rose-300 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Temizle</span>
          </button>
        </div>
      </div>

      {/* Search & Level Filter */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Loglarda ara..."
            className="w-full h-9 pl-9 pr-8 rounded-xl lx-input text-xs text-zinc-100 placeholder-zinc-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {(
            [
              { id: 'all', label: 'Tümü' },
              { id: 'system', label: 'Sistem' },
              { id: 'data', label: 'Bilgi' },
              { id: 'warn', label: 'Uyarı' },
              { id: 'error', label: 'Hata' },
            ] as { id: LevelFilter; label: string }[]
          ).map((lvl) => (
            <button
              key={lvl.id}
              onClick={() => setLevelFilter(lvl.id)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                levelFilter === lvl.id
                  ? 'lx-accent-badge'
                  : 'lx-card text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {lvl.label}
            </button>
          ))}
        </div>
      </div>

      {/* Terminal Output */}
      <div
        style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-card)' }}
        className="flex-1 overflow-y-auto rounded-2xl border p-4 font-mono text-xs leading-relaxed select-text"
      >
        {filteredLogs.length === 0 ? (
          <div className="text-zinc-600 italic">Görüntülenecek konsol çıktısı yok...</div>
        ) : (
          filteredLogs.map((log) => {
            const badge = getBadge(log.type);
            return (
              <div key={log.id} className="py-0.5 flex items-start gap-2 break-all">
                <span className="text-zinc-600 shrink-0">[{log.timestamp}]</span>
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.2 rounded border shrink-0 mt-0.5 ${badge.cls}`}
                >
                  {badge.label}
                </span>
                <span className={badge.textCls}>{log.text}</span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
