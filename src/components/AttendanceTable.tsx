import React, { useState } from 'react';
import { Search, Plus, Trash2, Download, LogIn, LogOut, AlertCircle, RefreshCw } from 'lucide-react';
import { ShiftRecord } from '../types';

interface AttendanceTableProps {
  records: ShiftRecord[];
  loading: boolean;
  onRefresh: () => void;
  onOpenAddModal: () => void;
  onDeleteRecord: (id: number) => void;
}

export const AttendanceTable: React.FC<AttendanceTableProps> = ({
  records,
  loading,
  onRefresh,
  onOpenAddModal,
  onDeleteRecord,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState<'all' | 'in' | 'out'>('all');

  const filtered = records.filter((r) => {
    const matchesSearch =
      r.surname.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.time.includes(searchTerm) ||
      (r.raw_text && r.raw_text.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesAction = actionFilter === 'all' || r.action === actionFilter;

    return matchesSearch && matchesAction;
  });

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
            { key: 'in', label: 'Приход' },
            { key: 'out', label: 'Уход' },
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
              <th className="px-6 py-3 border-b border-slate-100">Время записи</th>
              <th className="px-6 py-3 border-b border-slate-100">Фамилия</th>
              <th className="px-6 py-3 border-b border-slate-100">Действие</th>
              <th className="px-6 py-3 border-b border-slate-100">Распознанное время</th>
              <th className="px-6 py-3 border-b border-slate-100">Статус и источник</th>
              <th className="px-6 py-3 border-b border-slate-100 text-right">Удалить</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <AlertCircle className="w-8 h-8 text-slate-300" />
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Записи не найдены</p>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((record) => {
                const isIn = record.action === 'in';
                return (
                  <tr
                    key={record.id}
                    id={`record-row-${record.id}`}
                    className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="px-6 py-4 font-mono text-xs font-semibold text-slate-700">
                      {record.time}
                    </td>

                    <td className="px-6 py-4 font-semibold text-slate-900">
                      {record.surname}
                    </td>

                    <td className="px-6 py-4">
                      {isIn ? (
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold uppercase">
                          Приход
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-rose-100 text-rose-700 rounded text-[10px] font-bold uppercase">
                          Уход
                        </span>
                      )}
                    </td>

                    <td className="px-6 py-4 font-mono text-xs text-slate-600">
                      {record.time_line || record.time}
                    </td>

                    <td className="px-6 py-4 text-xs">
                      <span className="text-emerald-600 font-medium">✓ Распознано</span>
                      <span className="text-[10px] text-slate-400 font-mono ml-2 uppercase">
                        ({record.source.includes('telegram') ? 'Telegram' : 'Ручной'})
                      </span>
                    </td>

                    <td className="px-6 py-4 text-right">
                      <button
                        id={`delete-record-btn-${record.id}`}
                        onClick={() => onDeleteRecord(record.id)}
                        className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                        title="Удалить запись"
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
        <span>Отображено записей: {filtered.length}</span>
        <span>БД: shift_attendance.db (SQLite)</span>
      </div>
    </div>
  );
};
