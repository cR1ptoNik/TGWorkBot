import React, { useState } from 'react';
import { RefreshCw, Trash2, Search, Terminal, Download } from 'lucide-react';
import { AuditLog } from '../types';

interface AuditLogsViewProps {
  logs: AuditLog[];
  loading: boolean;
  onRefreshLogs: () => void;
  onClearLogs: () => void;
}

export const AuditLogsView: React.FC<AuditLogsViewProps> = ({
  logs,
  loading,
  onRefreshLogs,
  onClearLogs,
}) => {
  const [levelFilter, setLevelFilter] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const filteredLogs = logs.filter((log) => {
    const matchesLevel = levelFilter === 'ALL' || log.level === levelFilter;
    const matchesSearch =
      log.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.timestamp.includes(searchTerm) ||
      log.logger.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesLevel && matchesSearch;
  });

  const downloadLogFile = () => {
    const logText = logs.map((l) => `${l.timestamp} | ${l.level.padEnd(8)} | ${l.logger} | ${l.message}`).join('\n');
    const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bot_activity_${new Date().toISOString().split('T')[0]}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div id="audit-logs-section" className="bg-[#0F172A] rounded-xl border border-slate-800 shadow-xl overflow-hidden text-slate-100">
      {/* Header */}
      <div className="p-4 bg-slate-950 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-cyan-400" />
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-100">Системные логи и Журнал аудита</h2>
            <p className="text-[10px] text-slate-400 font-mono">Журнал аудита SQLite и файл логов (`bot_activity.log`)</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-start sm:justify-end">
          <button
            id="refresh-logs-btn"
            onClick={onRefreshLogs}
            disabled={loading}
            className="p-1.5 text-slate-300 hover:text-white bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 transition-colors"
            title="Обновить логи"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>

          <button
            id="download-logs-btn"
            onClick={downloadLogFile}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase font-bold text-slate-200 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Скачать лог
          </button>

          <button
            id="clear-logs-btn"
            onClick={onClearLogs}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase font-bold text-rose-300 bg-rose-950/60 border border-rose-800/80 rounded hover:bg-rose-900/80 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Очистить
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400 text-[10px] uppercase font-bold mr-1">Уровень:</span>
          {[
            { key: 'ALL', label: 'ВСЕ' },
            { key: 'INFO', label: 'ИНФО' },
            { key: 'WARNING', label: 'ПРЕДУПРЕЖДЕНИЕ' },
            { key: 'ERROR', label: 'ОШИБКА' },
          ].map((lvl) => (
            <button
              key={lvl.key}
              id={`log-level-btn-${lvl.key}`}
              onClick={() => setLevelFilter(lvl.key)}
              className={`px-2.5 py-1 rounded font-mono text-[10px] font-bold transition-colors ${
                levelFilter === lvl.key
                  ? lvl.key === 'ERROR'
                    ? 'bg-rose-600 text-white'
                    : lvl.key === 'WARNING'
                    ? 'bg-amber-600 text-white'
                    : 'bg-cyan-500 text-slate-950'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {lvl.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            id="search-logs-input"
            type="text"
            placeholder="Поиск по логам..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 py-1 bg-slate-950 border border-slate-800 rounded text-slate-200 text-xs focus:outline-hidden focus:border-cyan-500 font-mono"
          />
        </div>
      </div>

      {/* Log Terminal Screen */}
      <div className="p-4 font-mono text-xs max-h-[480px] overflow-y-auto space-y-1.5 no-scrollbar bg-slate-950">
        {filteredLogs.length === 0 ? (
          <div className="text-center py-12 text-slate-500 uppercase text-[10px] tracking-wider font-sans">
            Записи логов не найдены по выбранному фильтру.
          </div>
        ) : (
          filteredLogs.map((log) => {
            let levelBadge = 'text-cyan-400';
            if (log.level === 'WARNING') levelBadge = 'text-amber-400 font-bold';
            if (log.level === 'ERROR') levelBadge = 'text-rose-400 font-bold';

            return (
              <div key={log.id} id={`log-item-${log.id}`} className="hover:bg-slate-900/80 p-1.5 rounded flex flex-col sm:flex-row sm:items-start gap-2 leading-relaxed border-b border-slate-900/60">
                <span className="text-slate-500 text-[10px] shrink-0">{log.timestamp}</span>
                <span className={`text-[10px] uppercase w-16 shrink-0 ${levelBadge}`}>
                  [{log.level}]
                </span>
                <span className="text-slate-300 break-all">{log.message}</span>
              </div>
            );
          })
        )}
      </div>

      <div className="p-2.5 bg-slate-950 border-t border-slate-800 text-[10px] text-slate-500 font-mono flex justify-between uppercase tracking-widest">
        <span>Отображено строк: {filteredLogs.length}</span>
        <span>Файл: bot_activity.log</span>
      </div>
    </div>
  );
};
