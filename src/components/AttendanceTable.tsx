import React, { useState } from 'react';
import { Search, Plus, Trash2, Download, LogIn, LogOut, AlertCircle, RefreshCw, CheckSquare, Square } from 'lucide-react';
import { ShiftRecord } from '../types';

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
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const filtered = records.filter((r) => {
    const matchesSearch =
      r.surname.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.time.includes(searchTerm) ||
      (r.raw_text && r.raw_text.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesAction = actionFilter === 'all' || r.action === actionFilter;

    return matchesSearch && matchesAction;
  });

  const toggleSelectAll = () => {
    if (selectedIds.length === filtered.length && filtered.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map((r) => r.id));
    }
  };

  const toggleSelectRecord = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleBatchDelete = () => {
    if (selectedIds.length === 0) return;
    if (confirm(`Вы уверены, что хотите удалить выбранные записи (${selectedIds.length} шт.)? Они будут окончательно стёрты из SQLite базы.`)) {
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
    if (confirm(`ВНИМАНИЕ: Вы действительно хотите очистить ВСЕ ${records.length} записей из базы данных? Это удалит все тестовые отметки.`)) {
      if (onClearAllRecords) {
        onClearAllRecords();
      }
      setSelectedIds([]);
    }
  };

  const exportCSV = () => {
    const headers = ['ID', 'Дата и время записи', 'Фамилия сотрудника', 'Действие', 'Время на скриншоте', 'Источник', 'Строка распознавания'];
    const rows = filtered.map((r) => [
      r.id,
      `"${r.created_at}"`,
      `"${r.surname}"`,
      r.action === 'in' ? 'ПРИХОД' : 'УХОД',
      `"${r.time}"`,
      r.source,
      `"${(r.time_line || '').replace(/"/g, '""')}"`,
    ]);

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

  return (
    <div id="attendance-section" className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
      {/* Activity Header */}
      <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="font-bold text-xs uppercase tracking-widest text-slate-600">Лента активности смен</h2>
          <p className="text-[11px] text-slate-400 mt-0.5">Журнал посещаемости и верификации в реальном времени</p>
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
            onClick={onRefresh}
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
            Экспорт CSV
          </button>

          <button
            id="add-manual-record-btn"
            onClick={onOpenAddModal}
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

        <div className="flex items-center gap-2">
          <span className="text-slate-400 font-bold uppercase text-[10px]">Фильтр:</span>
          {[
            { key: 'all', label: 'Все' },
            { key: 'in', label: 'Приход (🟢)' },
            { key: 'out', label: 'Уход (🔴)' },
          ].map((mode) => (
            <button
              key={mode.key}
              onClick={() => setActionFilter(mode.key as any)}
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
              <th className="px-4 py-3 border-b border-slate-100">Время записи</th>
              <th className="px-4 py-3 border-b border-slate-100">Фамилия / Логин</th>
              <th className="px-4 py-3 border-b border-slate-100">Действие</th>
              <th className="px-4 py-3 border-b border-slate-100">Распознанное время</th>
              <th className="px-4 py-3 border-b border-slate-100">Статус и источник</th>
              <th className="px-4 py-3 border-b border-slate-100 text-right">Удалить</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <AlertCircle className="w-8 h-8 text-slate-300" />
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Записи не найдены</p>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((record) => {
                const isIn = record.action === 'in';
                const isSelected = selectedIds.includes(record.id);
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
                      {record.time}
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

                    <td className="px-4 py-4 text-xs">
                      <span className="text-emerald-600 font-medium">✓ Распознано</span>
                      <span className="text-[10px] text-slate-400 font-mono ml-2 uppercase">
                        ({record.source.includes('telegram') ? 'Telegram OCR' : 'Веб-форма'})
                      </span>
                    </td>

                    <td className="px-4 py-4 text-right">
                      <button
                        id={`delete-record-btn-${record.id}`}
                        onClick={() => onDeleteRecord(record.id)}
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
        <span className="text-emerald-600 font-semibold">SQLite: shift_attendance.db (Синхронизировано)</span>
      </div>
    </div>
  );
};
