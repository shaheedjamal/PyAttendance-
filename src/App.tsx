import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  ScanFace,
  Camera,
  ClipboardList,
  FileBarChart,
  Settings,
  LogOut,
  Menu,
  X,
  ShieldCheck,
} from 'lucide-react';
import { apiFetch } from './services/api';
import type { AuthUser } from './types';
import { ToastProvider, useToast } from './components/ToastContext';
import { LoginView } from './components/LoginView';
import { AdminDashboard } from './components/AdminDashboard';
import { FacultyDashboard } from './components/FacultyDashboard';
import { StudentDashboard } from './components/StudentDashboard';
import { StudentsManager } from './components/StudentsManager';
import { FacultyAcademicManager } from './components/FacultyAcademicManager';
import { FaceEnrollmentView } from './components/FaceEnrollmentView';
import { LiveAttendanceCamera } from './components/LiveAttendanceCamera';
import { AttendanceRecordsView } from './components/AttendanceRecordsView';
import { ReportsView } from './components/ReportsView';
import { SettingsAndSourceView } from './components/SettingsAndSourceView';

interface NavItem {
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: Array<'admin' | 'faculty' | 'student'>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'faculty', 'student'] },
  { id: 'live-camera', label: 'Live Attendance', icon: Camera, roles: ['admin', 'faculty'] },
  { id: 'face-enrollment', label: 'Face Enrollment', icon: ScanFace, roles: ['admin', 'faculty'] },
  { id: 'students', label: 'Students', icon: GraduationCap, roles: ['admin', 'faculty'] },
  { id: 'faculty', label: 'Faculty & Subjects', icon: Users, roles: ['admin'] },
  { id: 'records', label: 'Attendance Records', icon: ClipboardList, roles: ['admin', 'faculty'] },
  { id: 'reports', label: 'Reports', icon: FileBarChart, roles: ['admin', 'faculty', 'student'] },
  { id: 'settings', label: 'Settings & Source', icon: Settings, roles: ['admin'] },
];

function WorkspaceApp() {
  const { notify } = useToast();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [enrollStudentId, setEnrollStudentId] = useState<number | null>(null);
  const [cameraSubjectId, setCameraSubjectId] = useState<number | null>(null);

  useEffect(() => {
    apiFetch<{ user: AuthUser }>('/api/profile')
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true));
  }, []);

  const handleLogout = async () => {
    await apiFetch('/api/logout', { method: 'POST' });
    setUser(null);
    setActiveTab('dashboard');
    notify('info', 'Signed out cleanly.');
  };

  const handleNavigate = (tab: string, payload?: { subjectId?: number; studentId?: number }) => {
    if (payload?.subjectId) setCameraSubjectId(payload.subjectId);
    if (payload?.studentId) setEnrollStudentId(payload.studentId);
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-500">
        Initializing PyAttendance AI workspace...
      </div>
    );
  }

  if (!user) {
    return (
      <LoginView
        onLoginSuccess={(u) => {
          setUser(u);
          setActiveTab('dashboard');
          notify('success', `Signed in as ${u.name} (${u.role}).`);
        }}
      />
    );
  }

  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(user.role));
  const currentTitle = visibleNav.find((n) => n.id === activeTab)?.label || 'Dashboard';

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-slate-900 text-slate-200 border-r border-slate-800">
        <div className="h-16 px-5 flex items-center gap-2.5 border-b border-slate-800">
          <ShieldCheck className="w-5 h-5 text-teal-400 shrink-0" />
          <span className="font-display text-base font-bold text-white tracking-tight whitespace-nowrap">
            PyAttendance AI
          </span>
        </div>

        <nav aria-label="Primary Navigation" className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-teal-400' : 'text-slate-400'}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800 text-xs">
          <div className="font-medium text-white truncate">{user.name}</div>
          <div className="text-slate-400 capitalize mt-0.5 truncate">
            {user.role} · {user.email}
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/60"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-64 max-w-full bg-slate-900 text-slate-200 flex flex-col z-10">
            <div className="h-16 px-5 flex items-center justify-between border-b border-slate-800">
              <span className="font-display text-base font-bold text-white">PyAttendance AI</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1">
              {visibleNav.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavigate(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg ${
                      active ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/60'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb left, 1 primary sign-out action right */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between gap-8 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 text-slate-600 hover:text-slate-900 rounded-lg"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-slate-400 capitalize hidden sm:inline">{user.role}</span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <h1 className="font-display font-semibold text-slate-900 truncate">
                {currentTitle}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {activeTab === 'dashboard' && user.role === 'admin' && (
            <AdminDashboard onNavigate={handleNavigate} />
          )}
          {activeTab === 'dashboard' && user.role === 'faculty' && (
            <FacultyDashboard user={user} onNavigate={handleNavigate} />
          )}
          {activeTab === 'dashboard' && user.role === 'student' && (
            <StudentDashboard user={user} />
          )}

          {activeTab === 'live-camera' && (user.role === 'admin' || user.role === 'faculty') && (
            <LiveAttendanceCamera user={user} initialSubjectId={cameraSubjectId} />
          )}

          {activeTab === 'face-enrollment' && (user.role === 'admin' || user.role === 'faculty') && (
            <FaceEnrollmentView initialStudentId={enrollStudentId} />
          )}

          {activeTab === 'students' && (user.role === 'admin' || user.role === 'faculty') && (
            <StudentsManager
              role={user.role}
              onGoToEnroll={(sid) => handleNavigate('face-enrollment', { studentId: sid })}
            />
          )}

          {activeTab === 'faculty' && user.role === 'admin' && <FacultyAcademicManager />}

          {activeTab === 'records' && (user.role === 'admin' || user.role === 'faculty') && (
            <AttendanceRecordsView />
          )}

          {activeTab === 'reports' && <ReportsView role={user.role} />}

          {activeTab === 'settings' && user.role === 'admin' && <SettingsAndSourceView />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <WorkspaceApp />
    </ToastProvider>
  );
}
