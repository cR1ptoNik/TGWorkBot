import React, { useState } from 'react';
import { Upload, Sparkles, CheckCircle2, AlertTriangle, Image as ImageIcon, ArrowRight, ShieldCheck } from 'lucide-react';
import { OcrResult } from '../types';
import { apiFetch } from '../lib/api';

interface OcrSimulatorProps {
  onAddRecordFromOcr: (record: { surname: string; time: string; action: 'in' | 'out'; time_line: string; raw_text: string }) => void;
}

export const OcrSimulator: React.FC<OcrSimulatorProps> = ({ onAddRecordFromOcr }) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<'in' | 'out'>('in');
  const [analyzing, setAnalyzing] = useState(false);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sampleScreenshots = [
    {
      name: 'RMAS Mobile - Приход (eremin.n)',
      action: 'in' as const,
      preview: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&auto=format&fit=crop&q=80',
      dataUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600" fill="%23f8fafc"><rect width="400" height="600" fill="%23f8fafc"/><rect width="400" height="30" fill="%23000000"/><text x="15" y="20" fill="%23ffffff" font-size="13" font-family="sans-serif" font-weight="bold">11:28  WiFi 4G 100%</text><rect y="30" width="400" height="60" fill="%233b5998"/><text x="15" y="58" fill="%23ffffff" font-size="18" font-family="sans-serif" font-weight="bold">RMAS Mobile 437s</text><text x="15" y="78" fill="%23cbd5e1" font-size="14" font-family="sans-serif">eremin.n  C941s</text><text x="200" y="115" text-anchor="middle" fill="%230f172a" font-size="13" font-family="sans-serif" font-weight="bold">M.Video, Ekaterinburg, Str.Khalturina, d.55</text><text x="200" y="132" text-anchor="middle" fill="%23334155" font-size="12" font-family="sans-serif">Grade IM: A</text><text x="80" y="160" text-anchor="middle" fill="%2316a34a" font-size="17" font-family="sans-serif" font-weight="bold">11:28:53</text><text x="80" y="178" text-anchor="middle" fill="%2316a34a" font-size="13" font-family="sans-serif">96 m</text><rect x="15" y="190" width="115" height="36" rx="4" fill="%233b82f6"/><text x="72" y="213" text-anchor="middle" fill="%23ffffff" font-size="13" font-family="sans-serif" font-weight="bold">Check Out</text><rect x="142" y="190" width="115" height="36" rx="4" fill="%2364748b"/><text x="200" y="213" text-anchor="middle" fill="%23ffffff" font-size="13" font-family="sans-serif">Check In</text><rect x="270" y="190" width="115" height="36" rx="4" fill="%2364748b"/><text x="327" y="213" text-anchor="middle" fill="%23ffffff" font-size="13" font-family="sans-serif">Check In</text></svg>',
    },
    {
      name: 'RMAS Mobile - Уход (eremin.n)',
      action: 'out' as const,
      preview: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=400&auto=format&fit=crop&q=80',
      dataUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600" fill="%23f8fafc"><rect width="400" height="600" fill="%23f8fafc"/><rect width="400" height="30" fill="%23000000"/><text x="15" y="20" fill="%23ffffff" font-size="13" font-family="sans-serif" font-weight="bold">20:34  WiFi 5G 54%</text><rect y="30" width="400" height="60" fill="%233b5998"/><text x="15" y="58" fill="%23ffffff" font-size="18" font-family="sans-serif" font-weight="bold">RMAS Mobile 437s</text><text x="15" y="78" fill="%23cbd5e1" font-size="14" font-family="sans-serif">eremin.n  C941s</text><text x="200" y="115" text-anchor="middle" fill="%230f172a" font-size="13" font-family="sans-serif" font-weight="bold">M.Video, Ekaterinburg, Str.Khalturina, d.55</text><text x="200" y="132" text-anchor="middle" fill="%23334155" font-size="12" font-family="sans-serif">Grade IM: A</text><text x="80" y="160" text-anchor="middle" fill="%2316a34a" font-size="17" font-family="sans-serif" font-weight="bold">11:28:53</text><text x="80" y="178" text-anchor="middle" fill="%2316a34a" font-size="13" font-family="sans-serif">96 m</text><rect x="15" y="190" width="115" height="36" rx="4" fill="%2364748b"/><text x="72" y="213" text-anchor="middle" fill="%23ffffff" font-size="13" font-family="sans-serif">Check Out</text><rect x="142" y="190" width="115" height="36" rx="4" fill="%233b82f6"/><text x="200" y="213" text-anchor="middle" fill="%23ffffff" font-size="13" font-family="sans-serif" font-weight="bold">Check In</text><rect x="270" y="190" width="115" height="36" rx="4" fill="%2364748b"/><text x="327" y="213" text-anchor="middle" fill="%23ffffff" font-size="13" font-family="sans-serif">Check In</text><text x="80" y="245" text-anchor="middle" fill="%23dc2626" font-size="17" font-family="sans-serif" font-weight="bold">20:34:25</text><text x="80" y="263" text-anchor="middle" fill="%23dc2626" font-size="13" font-family="sans-serif">7 m</text></svg>',
    },
  ];

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
        setOcrResult(null);
        setError(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const runOcrAnalysis = async () => {
    if (!selectedImage) return;

    setAnalyzing(true);
    setError(null);

    try {
      const res = await apiFetch('/api/ocr/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: selectedImage,
          action: selectedAction,
        }),
      });

      const data = await res.json();
      if (data.ocr_data) {
        setOcrResult(data.ocr_data);
      } else {
        setError('Failed to extract OCR data.');
      }
    } catch (err: any) {
      setError(err.message || 'Error executing Gemini OCR vision.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSaveToDatabase = () => {
    if (!ocrResult) return;

    onAddRecordFromOcr({
      surname: ocrResult.surname,
      time: ocrResult.time,
      action: ocrResult.detected_action,
      time_line: ocrResult.time_line,
      raw_text: ocrResult.raw_text,
    });
  };

  return (
    <div id="ocr-section" className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Upload & Sample Selector */}
      <div className="lg:col-span-5 space-y-4">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 bg-cyan-100 text-cyan-700 rounded font-bold text-xs">AI</span>
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Симулятор OCR Верификации
            </h2>
          </div>
          <p className="text-xs text-slate-500 mb-5">
            Проверка автоматического извлечения времени со скриншота рабочего приложения.
          </p>

          {/* Action Choice */}
          <div className="mb-4">
            <label className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-2">Действие отметки</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                id="ocr-action-in-btn"
                onClick={() => setSelectedAction('in')}
                className={`py-2 px-3 text-xs font-bold uppercase rounded border transition-all ${
                  selectedAction === 'in'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                Приход
              </button>
              <button
                type="button"
                id="ocr-action-out-btn"
                onClick={() => setSelectedAction('out')}
                className={`py-2 px-3 text-xs font-bold uppercase rounded border transition-all ${
                  selectedAction === 'out'
                    ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                Уход
              </button>
            </div>
          </div>

          {/* Sample Screenshots */}
          <div className="mb-5">
            <label className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-2">Готовые образцы скриншотов</label>
            <div className="space-y-2">
              {sampleScreenshots.map((sample, idx) => (
                <button
                  key={idx}
                  id={`preset-sample-btn-${idx}`}
                  onClick={() => {
                    setSelectedImage(sample.dataUrl);
                    setSelectedAction(sample.action);
                    setOcrResult(null);
                  }}
                  className={`w-full text-left p-3 rounded border text-xs font-medium flex items-center justify-between transition-colors ${
                    selectedImage === sample.dataUrl
                      ? 'border-cyan-500 bg-cyan-50/40 text-slate-900 font-semibold'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-slate-400" />
                    {sample.name}
                  </span>
                  <span className="text-[10px] uppercase font-bold text-cyan-600">Загрузить</span>
                </button>
              ))}
            </div>
          </div>

          {/* File Drag and Drop / Upload */}
          <div className="border-2 border-dashed border-slate-200 rounded-xl p-5 text-center hover:bg-slate-50 transition-colors">
            <input
              type="file"
              id="screenshot-upload-input"
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
            />
            <label htmlFor="screenshot-upload-input" className="cursor-pointer block">
              <Upload className="w-6 h-6 mx-auto text-slate-400 mb-2" />
              <p className="text-xs font-bold text-slate-700">Загрузить свой скриншот</p>
              <p className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wider">PNG, JPG, WebP до 10MB</p>
            </label>
          </div>

          {/* Run Button */}
          <button
            id="run-ocr-btn"
            onClick={runOcrAnalysis}
            disabled={!selectedImage || analyzing}
            className={`w-full mt-5 py-2.5 px-4 rounded text-xs font-bold uppercase tracking-wider text-white flex items-center justify-center gap-2 shadow-xs transition-all ${
              !selectedImage || analyzing
                ? 'bg-slate-300 cursor-not-allowed'
                : 'bg-cyan-500 hover:bg-cyan-600 active:scale-[0.99]'
            }`}
          >
            <Sparkles className={`w-4 h-4 ${analyzing ? 'animate-spin' : ''}`} />
            {analyzing ? 'Анализ скриншота...' : 'Запустить OCR распознавание'}
          </button>
        </div>
      </div>

      {/* Screenshot Preview & OCR Results */}
      <div className="lg:col-span-7 space-y-4">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs h-full flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold text-slate-600 uppercase tracking-widest">
                Результаты распознавания OCR
              </h3>
              {ocrResult && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Распознано ({(ocrResult.confidence * 100).toFixed(0)}%)
                </span>
              )}
            </div>

            {/* Display Image Preview */}
            {selectedImage ? (
              <div className="mb-5 relative rounded-xl overflow-hidden border border-slate-200 bg-[#0F172A] flex items-center justify-center max-h-56 p-2">
                <img src={selectedImage} alt="Скриншот смены" className="max-h-52 object-contain" />
              </div>
            ) : (
              <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 py-12 text-center">
                <ImageIcon className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-xs text-slate-500 font-medium">Выберите или загрузите скриншот для OCR анализа.</p>
              </div>
            )}

            {error && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700 flex items-center gap-2 mb-4 font-mono">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {ocrResult && (
              <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white p-3 rounded border border-slate-200">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Фамилия / Пользователь</p>
                    <p className="text-sm font-bold text-slate-900 mt-0.5">{ocrResult.surname || 'Не найдено'}</p>
                    <div className="mt-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                        ocrResult.is_registered ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {ocrResult.is_registered ? 'Сотрудник зарегистрирован' : 'Не зарегистрирован'}
                      </span>
                    </div>
                  </div>

                  <div className="bg-white p-3 rounded border border-slate-200">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Извлечённое время</p>
                    <p className="text-base font-bold font-mono text-cyan-600 mt-0.5">{ocrResult.time}</p>
                    <p className="text-[10px] text-slate-400 font-mono mt-1 uppercase">Действие: {ocrResult.detected_action === 'in' ? 'Приход' : 'Уход'}</p>
                  </div>
                </div>

                <div className="bg-white p-3 rounded border border-slate-200 font-mono text-xs text-slate-700">
                  <span className="text-[10px] text-slate-400 uppercase block font-sans font-bold mb-1">Распознанная строка:</span>
                  {ocrResult.time_line}
                </div>

                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <ShieldCheck className="w-4 h-4 text-cyan-600 shrink-0" />
                  <span>Фильтр строки состояния: <strong>{ocrResult.status_bar_detected ? 'Активен (Очищен)' : 'Отключён'}</strong></span>
                </div>
              </div>
            )}
          </div>

          {ocrResult && (
            <div className="pt-4 border-t border-slate-200 mt-5">
              <button
                id="save-ocr-to-db-btn"
                onClick={handleSaveToDatabase}
                className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-xs transition-colors"
              >
                <span>Сохранить запись в базу SQLite</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
