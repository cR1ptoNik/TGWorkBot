import React, { useState } from 'react';
import { Search, Plus, Trash2, Download, LogIn, LogOut, AlertCircle, RefreshCw, CheckSquare, Square, Calendar, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ShiftRecord } from '../types';
import { triggerHaptic } from '../lib/api';

interface AttendanceTableProps {
  records: ShiftRecord[];
  loading: boolean;
  onRefresh: () => void;
  onOpenAddModal: () => void;
  onDeleteRecord: (id: number) => void;
  onBatchDeleteRecords?: (ids: number[]) => void;
  onClearAllRecords?: () => void;
}

export const AttendanceTable: React.FC<AttendanceTableProps> = ({
  records,
  loading,
  onRefresh,
  onOpenAddModal,
  onDeleteRecord,
  onBatchDeleteRecords,
  onClearAllRecords,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState<'all' | 'in' | 'out'>('all');
  const [dateRangeMode, setDateRangeMode] = useState<'all' | 'today' | 'week' | 'month' | 'custom'>('all');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const todayStr = new Date().toISOString().split('T')[0];

  const filtered = records.filter((r) => {
    // 1. Text Search
    const matchesSearch =
      r.surname.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.time.includes(searchTerm) ||
      (r.raw_text && r.raw_text.toLowerCase().includes(searchTerm.toLowerCase()));

    // 2. Action Filter
    const matchesAction = actionFilter === 'all' || r.action === actionFilter;

    // 3. Date Range Filter
    let matchesDate = true;
    const recordDate = r.created_at ? r.created_at.substring(0, 10) : '';

    if (dateRangeMode === 'today') {
      matchesDate = recordDate === todayStr;
    } else if (dateRangeMode === 'week') {
      const now = new Date();
      const past7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      matchesDate = recordDate >= past7 && recordDate <= todayStr;
    } else if (dateRangeMode === 'month') {
      const currentMonth = todayStr.substring(0, 7);
      matchesDate = recordDate.startsWith(currentMonth);
    } else if (dateRangeMode === 'custom') {
      if (customDateFrom && recordDate < customDateFrom) matchesDate = false;
      if (customDateTo && recordDate > customDateTo) matchesDate = false;
    }

    return matchesSearch && matchesAction && matchesDate;
  });

  const toggleSelectAll = () => {
    triggerHaptic('light');
    if (selectedIds.length === filtered.length && filtered.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map((r) => r.id));
    }
  };

  const toggleSelectRecord = (id: number) => {
    triggerHaptic('light');
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleBatchDelete = () => {
    if (selectedIds.length === 0) return;
    if (confirm(`Вы уверены, что хотите удалить выбранные записи (${selectedIds.length} шт.)? Они будут окончательно стёрты из SQLite базы.`)) {
      triggerHaptic('warning');
      if (onBatchDeleteRecords) {
        onBatchDeleteRecords(selectedIds);
      } else {
        selectedIds.forEach((id) => onDeleteRecord(id));
      }
      setSelectedIds([]);
    }
  };

  const handleClearAll = () => {
    if (records.length === 0) return;
    if (confirm(`ВНИМАНИЕ: Вы действительно хотите очистить ВСЕ ${records.length} записей из базы данных? Это удалит все отметки.`)) {
      triggerHaptic('warning');
      if (onClearAllRecords) {
        onClearAllRecords();
      }
      setSelectedIds([]);
    }
  };

  const exportCSV = () => {
    triggerHaptic('success');
    const headers = ['ID', 'Дата и время записи', 'Фамилия сотрудника', 'Действие', 'Время на скриншоте', 'Статус смены', 'Источник', 'Строка распознавания'];
    const rows = filtered.map((r) => {
      const isLate = r.action === 'in' && isLateCheckIn(r.time);
      const statusLabel = r.action === 'in' ? (isLate ? 'ОПОЗДАНИЕ' : 'ВОВРЕМЯ') : 'УХОД';
      return [
        r.id,
        `"${r.created_at}"`,
        `"${r.surname}"`,
        r.action === 'in' ? 'ПРИХОД' : 'УХОД',
        `"${r.time}"`,
        statusLabel,
        r.source,
        `"${(r.time_line || '').replace(/"/g, '""')}"`,
      ];
    });

    // UTF-8 BOM + Разделитель точка с запятой (;) для корректного открытия в Excel (русская локаль)
    const BOM = '\uFEFF';
    const csvContent = BOM + [headers.join(';'), ...rows.map((e) => e.join(';'))].join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `shift_attendance_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Helper to detect late check-in (e.g. after 09:05)
  function isLateCheckIn(timeStr: string): boolean {
    if (!timeStr) return false;
    const parts = timeStr.split(':');
    if (parts.length >= 2) {
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      if (!isNaN(h) && !isNaN(m)) {
        const totalMinutes = h * 60 + m;
        // 09:05 = 545 minutes
        return totalMinutes > 545;
      }
    }
    return false;
  }

  return (
    <div id="attendance-section" className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
      {/* Activity Header */}
      <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="font-bold text-xs uppercase tracking-widest text-slate-600">Лента активности смен</h2>
          <p className="text-[11px] text-slate-400 mt-0.5">Журнал посещаемости и верификации в реальном времени (SQLite)</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-start sm:justify-end">
          {selectedIds.length > 0 && (
            <button
              id="batch-delete-btn"
              onClick={handleBatchDelete}
              className="px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-bold uppercase tracking-tighter transition-colors shadow-xs flex items-center gap-1.5 animate-pulse"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Удалить ({selectedIds.length})
            </button>
          )}

          {records.length > 0 && (
            <button
              id="clear-all-records-btn"
              onClick={handleClearAll}
              className="px-3 py-2 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 rounded text-xs font-bold uppercase tracking-tighter transition-colors flex items-center gap-1.5"
              title="Очистить все записи из базы данных"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Очистить все
            </button>
          )}

          <button
            id="refresh-db-btn"
            onClick={() => {
              triggerHaptic('light');
              onRefresh();
            }}
            disabled={loading}
            className="p-2 text-slate-500 hover:text-slate-900 bg-white border border-slate-200 rounded text-xs font-bold uppercase transition-colors"
            title="Обновить записи"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-cyan-600' : ''}`} />
          </button>

          <button
            id="export-csv-btn"
            onClick={exportCSV}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded text-xs font-bold text-slate-600 uppercase tracking-tighter transition-colors flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            Экспорт Excel/CSV
          </button>

          <button
            id="add-manual-record-btn"
            onClick={() => {
              triggerHaptic('light');
              onOpenAddModal();
            }}
            className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 rounded text-xs font-bold text-white uppercase tracking-tighter transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Добавить отметку
          </button>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="px-6 py-3 border-b border-slate-200 bg-slate-50/50 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            id="search-surname-input"
            type="text"
            placeholder="Поиск по фамилии, времени или распознаванию..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-800 focus:outline-hidden focus:border-cyan-500"
          />
        </div>

        {/* Action Type Filter */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-400 font-bold uppercase text-[10px]">Тип:</span>
          {[
            { key: 'all', label: 'Все' },
            { key: 'in', label: 'Приход (🟢)' },
            { key: 'out', label: 'Уход (🔴)' },
          ].map((mode) => (
            <button
              key={mode.key}
              onClick={() => {
                triggerHaptic('light');
                setActionFilter(mode.key as any);
              }}
              className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-colors ${
                actionFilter === mode.key
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {/* Date Range Selector */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-400 font-bold uppercase text-[10px] flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Период:
          </span>
          {[
            { key: 'all', label: 'Все' },
            { key: 'today', label: 'Сегодня' },
            { key: 'week', label: '7 дней' },
            { key: 'month', label: 'Этот месяц' },
            { key: 'custom', label: 'Диапазон' },
          ].map((m) => (
            <button
              key={m.key}
              onClick={() => {
                triggerHaptic('light');
                setDateRangeMode(m.key as any);
              }}
              className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase transition-colors ${
                dateRangeMode === m.key
                  ? 'bg-cyan-600 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              {m.label}
            </button>
          ))}

          {dateRangeMode === 'custom' && (
            <div className="flex items-center gap-1.5 ml-1">
              <input
                type="date"
                value={customDateFrom}
                onChange={(e) => setCustomDateFrom(e.target.value)}
                className="px-2 py-0.5 bg-white border border-slate-200 rounded text-[11px] text-slate-700"
                placeholder="С"
              />
              <span className="text-slate-400 text-xs">—</span>
              <input
                type="date"
                value={customDateTo}
                onChange={(e) => setCustomDateTo(e.target.value)}
                className="px-2 py-0.5 bg-white border border-slate-200 rounded text-[11px] text-slate-700"
                placeholder="По"
              />
            </div>
          )}
        </div>
      </div>

      {/* Geometric Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50/50 text-[10px] uppercase text-slate-400 font-bold tracking-wider">
              <th className="px-4 py-3 border-b border-slate-100 w-10 text-center">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="text-slate-400 hover:text-slate-700"
                  title="Выбрать все"
                >
                  {filtered.length > 0 && selectedIds.length === filtered.length ? (
                    <CheckSquare className="w-4 h-4 text-cyan-600" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                </button>
              </th>
              <th className="px-4 py-3 border-b border-slate-100">Дата и время записи</th>
              <th className="px-4 py-3 border-b border-slate-100">Фамилия / Логин</th>
              <th className="px-4 py-3 border-b border-slate-100">Действие</th>
              <th className="px-4 py-3 border-b border-slate-100">Распознанное время</th>
              <th className="px-4 py-3 border-b border-slate-100">Статус смены</th>
              <th className="px-4 py-3 border-b border-slate-100">Источник</th>
              <th className="px-4 py-3 border-b border-slate-100 text-right">Удалить</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <AlertCircle className="w-8 h-8 text-slate-300" />
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Записи не найдены за выбранный период</p>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((record) => {
                const isIn = record.action === 'in';
                const isSelected = selectedIds.includes(record.id);
                const isLate = isIn && isLateCheckIn(record.time);

                return (
                  <tr
                    key={record.id}
                    id={`record-row-${record.id}`}
                    className={`border-b border-slate-100 hover:bg-slate-50/80 transition-colors ${
                      isSelected ? 'bg-cyan-50/40' : ''
                    }`}
                  >
                    <td className="px-4 py-4 text-center">
                      <button
                        type="button"
                        onClick={() => toggleSelectRecord(record.id)}
                        className="text-slate-400 hover:text-slate-700"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-cyan-600" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </td>

                    <td className="px-4 py-4 font-mono text-xs font-semibold text-slate-700">
                      {record.created_at || record.time}
                    </td>

                    <td className="px-4 py-4 font-semibold text-slate-900">
                      {record.surname}
                    </td>

                    <td className="px-4 py-4">
                      {isIn ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[11px] font-bold uppercase tracking-wide border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          Приход
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-rose-100 text-rose-800 rounded text-[11px] font-bold uppercase tracking-wide border border-rose-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                          Уход
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-4 font-mono text-xs text-slate-700 font-bold">
                      {record.time_line || record.time}
                    </td>

                    {/* Status Badge */}
                    <td className="px-4 py-4 text-xs">
                      {isIn ? (
                        isLate ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            <AlertTriangle className="w-3 h-3 text-amber-500" />
                            Опоздание (&gt; 09:05)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                            Вовремя
                          </span>
                        )
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                          <Clock className="w-3 h-3 text-slate-400" />
                          Смена завершена
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-4 text-xs">
                      <span className="text-slate-600 font-medium">
                        {record.source?.includes('telegram') ? '📱 Telegram Bot' : '💻 Веб-форма'}
                      </span>
                    </td>

                    <td className="px-4 py-4 text-right">
                      <button
                        id={`delete-record-btn-${record.id}`}
                        onClick={() => {
                          triggerHaptic('light');
                          onDeleteRecord(record.id);
                        }}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                        title="Удалить запись окончательно"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Table Footer */}
      <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 text-[10px] text-slate-400 font-medium uppercase tracking-widest flex justify-between items-center">
        <span>Отображено записей: {filtered.length} (Всего в базе: {records.length})</span>
        <span className="text-emerald-600 font-semibold">SQLite: shift_attendance.db (WAL Active)</span>
      </div>
    </div>
  );
};

