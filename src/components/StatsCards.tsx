import React from 'react';
import { SystemStats } from '../types';

interface StatsCardsProps {
  stats: SystemStats | null;
}

export const StatsCards: React.FC<StatsCardsProps> = ({ stats }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
      {/* Stat 1: Total Registered Staff */}
      <div id="stat-card-registered" className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
        <p className="text-xs font-bold text-slate-400 uppercase mb-1">Всего сотрудников</p>
        <p className="text-3xl font-light tracking-tight text-slate-900">
          {stats?.registered_users_count ?? 0}
          <span className="text-sm text-slate-400 font-normal ml-2">активных</span>
        </p>
      </div>

      {/* Stat 2: Checked IN Today */}
      <div id="stat-card-in" className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
        <p className="text-xs font-bold text-slate-400 uppercase mb-1">Отметок прихода сегодня</p>
        <p className="text-3xl font-light tracking-tight text-slate-900">
          {stats?.today_checked_in ?? 0}
          <span className="text-sm text-emerald-500 font-medium ml-2 font-mono">
            {stats?.today_checked_in ? `+${stats.today_checked_in}` : '0'} отм.
          </span>
        </p>
      </div>

      {/* Stat 3: Checked OUT Today */}
      <div id="stat-card-out" className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
        <p className="text-xs font-bold text-slate-400 uppercase mb-1">Отметок ухода сегодня</p>
        <p className="text-3xl font-light tracking-tight text-slate-900">
          {stats?.today_checked_out ?? 0}
          <span className="text-sm text-cyan-600 font-medium ml-2 font-mono">
            {stats?.today_checked_out ? `${stats.today_checked_out}` : '0'} уходов
          </span>
        </p>
      </div>

      {/* Stat 4: Total Shift Logs in DB */}
      <div id="stat-card-total" className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
        <p className="text-xs font-bold text-slate-400 uppercase mb-1">Всего записей смен</p>
        <p className="text-3xl font-light tracking-tight text-slate-900">
          {stats?.total_records ?? 0}
          <span className="text-sm text-slate-400 font-normal ml-2 font-mono">записей</span>
        </p>
      </div>
    </div>
  );
};
