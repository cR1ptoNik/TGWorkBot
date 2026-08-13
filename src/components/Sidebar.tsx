import React from 'react';
import { Clock, Activity, ShieldCheck, Users, Bot, Database, CheckCircle2 } from 'lucide-react';
import { SystemStats } from '../types';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  stats: SystemStats | null;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  stats,
  mobileOpen,
  setMobileOpen,
}) => {
  const monitoringItems = [
    { id: 'attendance', label: 'База посещаемости', icon: Clock },
    { id: 'analytics', label: 'Индивидуальные графики', icon: Activity },
    { id: 'ocr', label: 'Симулятор OCR', icon: Activity },
    { id: 'logs', label: 'Логи и Аудит', icon: ShieldCheck },
  ];

  const managementItems = [
    { id: 'roles', label: 'Иерархия ролей', icon: Users },
    { id: 'schedule', label: 'График смен и напоминания', icon: Clock },
    { id: 'code', label: 'Код и статус бота', icon: Bot },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-slate-900/60 z-40 lg:hidden backdrop-blur-xs"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-72 flex-none bg-[#0F172A] p-6 sm:p-8 text-white flex flex-col justify-between transition-transform duration-200 border-r border-slate-800 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div>
          {/* Logo Brand */}
          <div className="mb-10 flex items-center gap-3">
            <div className="h-8 w-8 rounded bg-cyan-500 flex items-center justify-center font-bold text-slate-900 shadow-sm shadow-cyan-500/30">
              S
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-white flex items-center gap-2">
                Панель ShiftBot
              </h1>
              <p className="text-[11px] text-slate-400 font-medium">Учёт смен v2.4</p>
            </div>
          </div>

          {/* Navigation Sections */}
          <nav className="space-y-8">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-4 font-bold">
                Мониторинг
              </p>
              <ul className="space-y-2.5">
                {monitoringItems.map((item) => {
                  const isActive = activeTab === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        id={`sidebar-nav-${item.id}`}
                        onClick={() => {
                          setActiveTab(item.id);
                          setMobileOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 text-xs font-medium px-3 py-2 rounded-lg transition-all ${
                          isActive
                            ? 'text-cyan-400 bg-slate-800/90 font-semibold'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            isActive ? 'bg-cyan-400 shadow-sm shadow-cyan-400' : 'bg-slate-600'
                          }`}
                        />
                        <span>{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-4 font-bold">
                Управление
              </p>
              <ul className="space-y-2.5">
                {managementItems.map((item) => {
                  const isActive = activeTab === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        id={`sidebar-nav-${item.id}`}
                        onClick={() => {
                          setActiveTab(item.id);
                          setMobileOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 text-xs font-medium px-3 py-2 rounded-lg transition-all ${
                          isActive
                            ? 'text-cyan-400 bg-slate-800/90 font-semibold'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            isActive ? 'bg-cyan-400 shadow-sm shadow-cyan-400' : 'bg-slate-600'
                          }`}
                        />
                        <span>{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </nav>
        </div>

        {/* Bottom Engine Widget */}
        <div className="rounded-xl bg-slate-800/90 p-4 border border-slate-700/80 mt-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-cyan-400" />
              База SQLite
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full border border-emerald-500/30">
              В сети
            </span>
          </div>
          <div className="text-[10px] text-slate-400 font-mono truncate">
            БД: shift_attendance.db
          </div>
          <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            <span>Журнал аудита активен</span>
          </div>
        </div>
      </aside>
    </>
  );
};
