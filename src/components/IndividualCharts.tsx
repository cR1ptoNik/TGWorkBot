import React, { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  LineChart,
  Line,
  Cell,
} from 'recharts';
import { Clock, TrendingUp, AlertTriangle, CheckCircle2, UserCheck, Calendar, Filter } from 'lucide-react';
import { apiFetch } from '../lib/api';

interface IndividualStatsResponse {
  surname: string;
  summary: {
    totalShiftsRecorded: number;
    completedShifts: number;
    totalHoursWorked: number;
    avgHoursPerShift: number;
    onTimeCount: number;
    lateCount: number;
    punctualityRate: number;
  };
  dailyHistory: Array<{
    date: string;
    inTime: string;
    outTime: string;
    workedHours: number;
    status: string;
    isLate: boolean;
    lateMinutes: number;
  }>;
}

interface Props {
  initialSurname?: string;
  telegramId?: number | null;
  allowUserSelect?: boolean;
}

export const IndividualCharts: React.FC<Props> = ({
  initialSurname,
  telegramId,
  allowUserSelect = true,
}) => {
  const [selectedSurname, setSelectedSurname] = useState<string>(initialSurname || '');
  const [availableUsers, setAvailableUsers] = useState<string[]>([]);
  const [data, setData] = useState<IndividualStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch list of registered users for dropdown
  useEffect(() => {
    apiFetch('/api/roles')
      .then((res) => res.json())
      .then((roles) => {
        const usersList: string[] = [];
        if (roles.admin) usersList.push(...Object.keys(roles.admin));
        if (roles.user) usersList.push(...Object.keys(roles.user));
        setAvailableUsers(usersList);
        if (!selectedSurname && usersList.length > 0) {
          setSelectedSurname(usersList[0]);
        }
      })
      .catch((err) => console.error('Failed to load users for charts:', err));
  }, []);

  // Fetch individual statistics when selectedSurname or telegramId changes
  useEffect(() => {
    setLoading(true);
    let url = '/api/individual-stats';
    if (selectedSurname) {
      url += `?surname=${encodeURIComponent(selectedSurname)}`;
    } else if (telegramId) {
      url += `?tg_id=${telegramId}`;
    }

    apiFetch(url)
      .then((res) => res.json())
      .then((resData) => {
        if (resData && resData.surname) {
          setData(resData);
          if (!selectedSurname) setSelectedSurname(resData.surname);
        } else {
          setData(null);
        }
      })
      .catch((err) => console.error('Failed loading individual stats:', err))
      .finally(() => setLoading(false));
  }, [selectedSurname, telegramId]);

  if (loading) {
    return (
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs flex items-center justify-center min-h-[220px]">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
          <Clock className="w-4 h-4 animate-spin text-cyan-600" />
          Загрузка индивидуальной аналитики сотрудника...
        </div>
      </div>
    );
  }

  const summary = data?.summary || {
    totalShiftsRecorded: 0,
    completedShifts: 0,
    totalHoursWorked: 0,
    avgHoursPerShift: 0,
    onTimeCount: 0,
    lateCount: 0,
    punctualityRate: 100,
  };

  const chartData = (data?.dailyHistory || []).map((item) => ({
    date: item.date.slice(5), // e.g. "08-10"
    fullDate: item.date,
    workedHours: item.workedHours,
    inTime: item.inTime,
    outTime: item.outTime,
    isLate: item.isLate,
    lateMinutes: item.lateMinutes,
    status: item.status,
  }));

  return (
    <div id="individual-analytics-section" className="space-y-6">
      {/* Header & Employee Selector */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
            <TrendingUp className="w-5 h-5 text-cyan-600" />
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider break-words whitespace-normal">
              Индивидуальные графики и аналитика
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1 break-words whitespace-normal">
            Персональная статистика отработанных часов, точности прихода и динамики смен.
          </p>
        </div>

        {allowUserSelect && availableUsers.length > 0 && (
          <div className="flex items-center gap-2 w-full md:w-auto">
            <Filter className="w-4 h-4 text-slate-400 shrink-0" />
            <select
              value={selectedSurname}
              onChange={(e) => setSelectedSurname(e.target.value)}
              className="px-3 py-2 text-xs font-bold bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-hidden focus:border-cyan-500 w-full md:w-56"
            >
              {availableUsers.map((usr) => (
                <option key={usr} value={usr}>
                  👤 {usr}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* KPI Cards for Selected Employee */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
            <span>Отработано часов</span>
            <Clock className="w-4 h-4 text-cyan-600" />
          </div>
          <div className="text-xl font-extrabold text-slate-900 mt-2 font-mono">
            {summary.totalHoursWorked} ч
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            В среднем {summary.avgHoursPerShift} ч / смена
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
            <span>Пунктуальность</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-xl font-extrabold text-slate-900 mt-2 font-mono flex items-center gap-1.5">
            <span className={summary.punctualityRate >= 90 ? 'text-emerald-600' : 'text-amber-600'}>
              {summary.punctualityRate}%
            </span>
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            {summary.onTimeCount} вовремя, {summary.lateCount} с опозданием
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
            <span>Завершено смен</span>
            <UserCheck className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-xl font-extrabold text-slate-900 mt-2 font-mono">
            {summary.completedShifts} / {summary.totalShiftsRecorded}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            {summary.totalShiftsRecorded - summary.completedShifts} без ухода
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
            <span>Опозданий всего</span>
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-xl font-extrabold text-slate-900 mt-2 font-mono text-amber-600">
            {summary.lateCount}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            {summary.lateCount === 0 ? 'Без нарушений 🎉' : 'Требует внимания'}
          </div>
        </div>
      </div>

      {/* Chart 1: Daily Working Hours Bar Chart */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Calendar className="w-4 h-4 text-cyan-600" />
              График отработанных часов по дням ({data?.surname || selectedSurname})
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Зеленым отмечены смены вовремя, оранжевым — с задержкой или опозданием.
            </p>
          </div>
        </div>

        {chartData.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg">
            Нет сохраненных смен для данного сотрудника.
          </div>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} unit="ч" />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const d = payload[0].payload;
                      return (
                        <div className="bg-slate-900 text-white p-3 rounded-lg shadow-lg text-xs space-y-1">
                          <div className="font-bold border-b border-slate-700 pb-1">{d.fullDate}</div>
                          <div>Приход: <span className="font-mono text-cyan-400">{d.inTime}</span></div>
                          <div>Уход: <span className="font-mono text-cyan-400">{d.outTime}</span></div>
                          <div>Часы: <span className="font-mono text-emerald-400">{d.workedHours} ч</span></div>
                          {d.isLate && (
                            <div className="text-amber-400 font-semibold">⚠️ Опоздание на {d.lateMinutes} мин</div>
                          )}
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <ReferenceLine y={8} stroke="#0284c7" strokeDasharray="3 3" label={{ value: 'Норма 8ч', fill: '#0284c7', fontSize: 10 }} />
                <Bar dataKey="workedHours" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.isLate ? '#f59e0b' : '#06b6d4'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Detailed Attendance Table for Selected Employee */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            История смен ({data?.surname || selectedSurname})
          </h3>
          <span className="text-[10px] font-bold text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
            Записей: {data?.dailyHistory.length || 0}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200 text-[10px] uppercase tracking-wider">
                <th className="p-3">Дата</th>
                <th className="p-3">🟢 Приход</th>
                <th className="p-3">🔴 Уход</th>
                <th className="p-3">Отработано</th>
                <th className="p-3">Пунктуальность</th>
                <th className="p-3">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data?.dailyHistory.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-400 text-xs">
                    Записи отсутствуют
                  </td>
                </tr>
              ) : (
                data?.dailyHistory.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-semibold text-slate-900 font-mono">{row.date}</td>
                    <td className="p-3 font-mono text-emerald-700 font-bold">{row.inTime}</td>
                    <td className="p-3 font-mono text-rose-700 font-bold">{row.outTime}</td>
                    <td className="p-3 font-mono text-slate-800 font-bold">{row.workedHours} ч</td>
                    <td className="p-3">
                      {row.isLate ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                          ⚠️ Опоздание ({row.lateMinutes} мин)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                          Вовремя
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          row.status === 'Completed'
                            ? 'bg-slate-100 text-slate-800'
                            : 'bg-cyan-100 text-cyan-800'
                        }`}
                      >
                        {row.status === 'Completed' ? 'Смена закрыта' : 'На смене'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
