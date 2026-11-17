import React, { useEffect, useState } from 'react';
import { Save, ShieldCheck, FileCode2, Copy } from 'lucide-react';
import { apiFetch } from '../services/api';
import { useToast } from './ToastContext';
import type { AppSettings, AuditLog } from '../types';

export function SettingsAndSourceView() {
  const { notify } = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [pyFiles, setPyFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<{ settings: AppSettings }>('/api/academic'),
      apiFetch<{ logs: AuditLog[] }>('/api/audit-logs?limit=40'),
      apiFetch<{ files: string[] }>('/api/python-project/files'),
    ]).then(([acad, logRes, pyRes]) => {
      setSettings(acad.settings);
      setLogs(logRes.logs);
      setPyFiles(pyRes.files);
      if (pyRes.files[0]) {
        loadPyFile(pyRes.files[0]);
      }
    });
  }, []);

  const loadPyFile = async (relPath: string) => {
    setSelectedFile(relPath);
    const res = await apiFetch<{ content: string }>(
      `/api/python-project/file?path=${encodeURIComponent(relPath)}`
    );
    setFileContent(res.content);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ settings: AppSettings }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      setSettings(res.settings);
      notify('success', 'System configuration and recognition thresholds saved.');
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Unable to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopySource = async () => {
    if (!fileContent) return;
    await navigator.clipboard.writeText(fileContent);
    notify('success', `Copied ${selectedFile} to clipboard.`);
  };

  if (!settings) {
    return <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />;
  }

  return (
    <div className="space-y-6">
      {/* Settings + Audit Log */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="w-4 h-4 text-slate-700" />
            <h2 className="text-sm font-semibold text-slate-900">
              Institution &amp; AI Recognition Calibration
            </h2>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Institution Name
                </label>
                <input
                  value={settings.institution_name}
                  onChange={(e) => setSettings({ ...settings, institution_name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Academic Year
                </label>
                <input
                  value={settings.academic_year}
                  onChange={(e) => setSettings({ ...settings, academic_year: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Shortage Threshold (%)
                </label>
                <input
                  type="number"
                  step="1"
                  min={50}
                  max={95}
                  value={settings.shortage_threshold}
                  onChange={(e) =>
                    setSettings({ ...settings, shortage_threshold: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Cosine Match Threshold
                </label>
                <input
                  type="number"
                  step="0.01"
                  min={0.35}
                  max={0.95}
                  value={settings.recognition_threshold}
                  onChange={(e) =>
                    setSettings({ ...settings, recognition_threshold: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Uncertain Lower Bound
                </label>
                <input
                  type="number"
                  step="0.01"
                  min={0.25}
                  max={0.85}
                  value={settings.uncertain_threshold}
                  onChange={(e) =>
                    setSettings({ ...settings, uncertain_threshold: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono tabular-nums"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Default Face Detector
                </label>
                <select
                  value={settings.detector_backend}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      detector_backend: e.target.value as 'ssd_mobilenetv1' | 'tiny_face_detector',
                    })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="ssd_mobilenetv1">SSD MobileNet v1</option>
                  <option value="tiny_face_detector">Tiny Face Detector</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Biometric Retention (Days)
                </label>
                <input
                  type="number"
                  min={30}
                  max={1825}
                  value={settings.retention_days}
                  onChange={(e) =>
                    setSettings({ ...settings, retention_days: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono tabular-nums"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={settings.late_counts_as_attended === 1}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    late_counts_as_attended: e.target.checked ? 1 : 0,
                  })
                }
              />
              <span>Count Late arrivals toward attended percentage</span>
            </label>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 leading-relaxed">
              Threshold values should be calibrated against a separate institutional validation set.
              Deployment in India requires legal review under the Digital Personal Data Protection
              Act, 2023.
            </div>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
            </button>
          </form>
        </div>

        {/* Audit Log */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">Security &amp; Compliance Audit Log</h2>
            <p className="text-xs text-slate-500">Immutable record of logins, biometric enrollments, and corrections</p>
          </div>
          <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto flex-1">
            {logs.map((log) => (
              <div key={log.log_id} className="px-5 py-3 text-xs">
                <div className="flex items-center justify-between font-medium text-slate-900">
                  <span>
                    {log.action} · <span className="text-slate-500 font-normal">{log.user_role}</span>
                  </span>
                  <span className="font-mono text-slate-400 tabular-nums">{log.timestamp}</span>
                </div>
                <p className="text-slate-600 mt-0.5">
                  {log.user_email} — {log.details || log.resource_type}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Python/Flask Project Explorer */}
      {pyFiles.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileCode2 className="w-4 h-4 text-slate-700" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  PyAttendance-AI Python / Flask / PostgreSQL Project Files
                </h2>
                <p className="text-xs text-slate-500">
                  Complete standalone Python 3.11/3.12, Flask, SQLAlchemy, OpenCV, FaceNet &amp; Pytest source tree
                </p>
              </div>
            </div>
            {selectedFile && (
              <button
                type="button"
                onClick={handleCopySource}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy File</span>
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[380px]">
            <div className="lg:col-span-4 border-r border-slate-200 bg-slate-50 max-h-[420px] overflow-y-auto p-2 space-y-0.5">
              {pyFiles.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => loadPyFile(f)}
                  className={`w-full text-left px-3 py-1.5 text-xs font-mono rounded truncate transition-colors ${
                    selectedFile === f
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:bg-slate-200/70'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="lg:col-span-8 bg-slate-950 text-slate-100 p-4 max-h-[420px] overflow-auto">
              <pre className="text-xs font-mono leading-relaxed whitespace-pre">
                {fileContent}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
