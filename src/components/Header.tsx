import React from 'react';
import { Menu, Plus, RefreshCw, Smartphone, User, Shield, Sparkles, ArrowLeft } from 'lucide-react';
import { SystemStats } from '../types';

interface HeaderProps {
  stats: SystemStats | null;
  onOpenAddModal: () => void;
  onRefresh: () => void;
  setMobileOpen: (open: boolean) => void;
  activeTab: string;
  userRole: string;
  userSurname: string | null;
  viewMode: 'admin' | 'employee';
  setViewMode: (mode: 'admin' | 'employee') => void;
  isWebApp: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  stats,
  onOpenAddModal,
  onRefresh,
  setMobileOpen,
  activeTab,
  userRole,
  userSurname,
  viewMode,
  setViewMode,
  isWebApp,
}) => {
  const handleCloseWebApp = () => {
    // @ts-ignore
    if (window.Telegram?.WebApp?.close) {
      // @ts-ignore
      window.Telegram.WebApp.close();
    }
  };

  return (
    <header className="h-auto min-h-[5rem] flex-none w-full border-b border-slate-200 bg-white flex flex-col lg:flex-row lg:items-center justify-between px-4 sm:px-8 py-3 gap-4 sticky top-0 z-20 shadow-xs">
      {/* Left Title & Mobile Menu Button */}
      <div className="flex flex-wrap items-center justify-between lg:justify-start gap-4 w-full lg:w-auto">
        {isWebApp && (
          <button
            onClick={handleCloseWebApp}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs transition-colors flex items-center gap-1"
            title="Закрыть WebApp и вернуться в Telegram"
          >
            <ArrowLeft className="w-4 h-4 text-cyan-600" />
            <span className="hidden sm:inline">Назад в ТГ</span>
          </button>
        )}

        <button
          id="mobile-sidebar-toggle-btn"
          onClick={() => setMobileOpen(true)}
          className="p-2 text-slate-600 hover:text-slate-900 lg:hidden rounded-lg hover:bg-slate-100"
          title="Открыть меню"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex flex-wrap gap-4 sm:gap-6 items-center">
          <div>
            <p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              {isWebApp ? 'Telegram WebApp' : 'Статус'}
            </p>
            <p className="text-xs sm:text-sm font-semibold text-slate-900 flex items-center gap-1">
              {isWebApp ? (
                <span className="inline-flex items-center gap-1 text-cyan-600 font-bold">
                  <Smartphone className="w-3.5 h-3.5" /> WebApp активен
                </span>
              ) : (
                'Бот активен'
              )}
            </p>
          </div>

          <div className="border-l border-slate-200 pl-4 sm:pl-6">
            <p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Отметок сегодня</p>
            <p className="text-xs sm:text-sm font-semibold text-slate-900 font-mono">
              {stats?.today_total_marks ?? 0}
            </p>
          </div>
        </div>
      </div>

      {/* View Mode Switcher (Admin vs Employee WebApp View) */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 justify-between lg:justify-end w-full lg:w-auto">
        <div className="flex flex-wrap items-center bg-slate-100 p-1 rounded-lg border border-slate-200">
          <button
            onClick={() => setViewMode('admin')}
            className={`px-3 py-1 text-[11px] font-bold rounded-md transition-all flex items-center gap-1 ${
              viewMode === 'admin'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Shield className="w-3 h-3 text-cyan-400" />
            Админка
          </button>
          <button
            onClick={() => setViewMode('employee')}
            className={`px-3 py-1 text-[11px] font-bold rounded-md transition-all flex items-center gap-1 ${
              viewMode === 'employee'
                ? 'bg-cyan-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <User className="w-3 h-3" />
            <span className="truncate max-w-[100px] sm:max-w-[150px]">{userSurname ? `Сотрудник: ${userSurname}` : 'Сотрудник WebApp'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="header-refresh-btn"
            onClick={onRefresh}
            className="p-2 bg-slate-100 text-slate-600 hover:text-slate-900 rounded-lg text-xs font-bold uppercase hover:bg-slate-200 transition-colors"
            title="Обновить данные"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <button
            id="header-add-record-btn"
            onClick={onOpenAddModal}
            className="px-3 py-2 bg-slate-900 hover:bg-slate-800 rounded-lg text-xs font-bold text-white uppercase tracking-wider transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4 text-cyan-400" />
            <span className="hidden sm:inline">Ручная отметка</span>
          </button>
        </div>
      </div>
    </header>
  );
};

