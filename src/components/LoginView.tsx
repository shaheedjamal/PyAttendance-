import React, { useState } from 'react';
import { ShieldCheck, Lock, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { apiFetch } from '../services/api';
import type { AuthUser, UserRole } from '../types';

interface LoginViewProps {
  onLoginSuccess: (user: AuthUser) => void;
}

const DEMO_CREDENTIALS: Record<UserRole, { email: string; password: string; label: string }> = {
  admin: {
    email: 'admin@pyattendance.edu',
    password: 'Admin@123',
    label: 'Administrator (Dr. Rajeshwari Menon)',
  },
  faculty: {
    email: 'ananya.sharma@pyattendance.edu',
    password: 'Faculty@123',
    label: 'Faculty (Prof. Ananya Sharma)',
  },
  student: {
    email: 'aarav.verma@pyattendance.edu',
    password: 'Student@123',
    label: 'Student (Aarav Verma · CS2024001)',
  },
};

export function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [role, setRole] = useState<UserRole>('admin');
  const [email, setEmail] = useState(DEMO_CREDENTIALS.admin.email);
  const [password, setPassword] = useState(DEMO_CREDENTIALS.admin.password);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRoleSwitch = (nextRole: UserRole) => {
    setRole(nextRole);
    setEmail(DEMO_CREDENTIALS[nextRole].email);
    setPassword(DEMO_CREDENTIALS[nextRole].password);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ user: AuthUser }>('/api/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, role }),
      });
      onLoginSuccess(res.user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {/* Left institutional panel */}
        <div className="lg:col-span-5 bg-slate-900 text-white p-8 sm:p-10 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2.5 text-teal-400">
              <ShieldCheck className="w-6 h-6 shrink-0" />
              <span className="font-display text-lg font-bold tracking-tight text-white">
                PyAttendance AI
              </span>
            </div>

            <h1 className="mt-8 font-display text-2xl sm:text-3xl font-semibold leading-tight text-white [text-wrap:balance]">
              Classroom Attendance &amp; Biometric Governance
            </h1>
            <p className="mt-4 text-sm text-slate-300 leading-relaxed">
              Multi-face detection and cosine-similarity recognition paired with mandatory faculty
              review, non-biometric manual fallback, and AES-256-GCM encrypted templates.
            </p>

            <div className="mt-8 pt-6 border-t border-slate-800 space-y-3 text-xs text-slate-300">
              <div className="flex items-start gap-2.5">
                <span className="text-teal-400 font-mono">01</span>
                <span>Faculty verification required before AI attendance proposals finalize.</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="text-teal-400 font-mono">02</span>
                <span>Database-enforced uniqueness prevents duplicate session attendance.</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="text-teal-400 font-mono">03</span>
                <span>Institutional consent and revocation aligned with DPDP Act, 2023.</span>
              </div>
            </div>
          </div>

          <p className="mt-8 text-xs text-slate-400">
            Apex Institute of Technology · Academic Year 2026-27
          </p>
        </div>

        {/* Right sign-in panel */}
        <div className="lg:col-span-7 p-8 sm:p-10 flex flex-col justify-center">
          <div className="max-w-md w-full mx-auto">
            <h2 className="font-display text-xl font-semibold text-slate-900">
              Sign in to Portal
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Select your institutional role to access your workspace.
            </p>

            {/* Role segmented control */}
            <div
              role="tablist"
              aria-label="Account Role"
              className="mt-6 grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200"
            >
              {(['admin', 'faculty', 'student'] as UserRole[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="tab"
                  aria-selected={role === r}
                  onClick={() => handleRoleSwitch(r)}
                  className={`py-2 px-3 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap ${
                    role === r
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {error && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"
                >
                  {error}
                </div>
              )}

              <div>
                <label
                  htmlFor="login-email"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  {role === 'student' ? 'Institutional Email or Roll Number' : 'Institutional Email'}
                </label>
                <input
                  id="login-email"
                  type="text"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                  placeholder="name@pyattendance.edu"
                />
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 pr-10 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                    placeholder="Enter password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
              >
                <Lock className="w-4 h-4" />
                <span>{loading ? 'Signing in...' : 'Sign In'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            {/* Quick demo account info */}
            <div className="mt-6 pt-5 border-t border-slate-200">
              <p className="text-xs font-medium text-slate-600 mb-2">
                Development Seed Accounts (Click a role tab above to pre-fill):
              </p>
              <div className="space-y-1 text-xs text-slate-500 font-mono">
                <div>Admin: admin@pyattendance.edu / Admin@123</div>
                <div>Faculty: ananya.sharma@pyattendance.edu / Faculty@123</div>
                <div>Student: aarav.verma@pyattendance.edu / Student@123</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
