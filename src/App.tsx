import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Workflow,
  Settings,
  PanelLeft,
  Sparkles,
  Terminal,
  FileJson,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from './lib/utils';
import { Button } from './components/ui/button';
import { useAppStore } from './stores/appStore';
import Dashboard from './pages/Dashboard';
import WorkflowList from './pages/WorkflowList';
import WorkflowEditor from './pages/WorkflowEditor';
import Logs from './pages/Logs';
import FlowTester from './pages/FlowTester';
import SettingsPage from './pages/Settings';

type NavItem = {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
};

const navItems: NavItem[] = [
  { path: '/', label: '首页', icon: LayoutDashboard, end: true },
  { path: '/workflows', label: '工作流库', icon: Workflow, end: true },
  { path: '/workflows/editor', label: '流程编排', icon: Sparkles },
  { path: '/logs', label: '日志', icon: Terminal },
  { path: '/settings', label: '设置', icon: Settings },
];

function TitleBar() {
  if (window.mimic?.platform !== 'darwin') return null;
  return (
    <div className="h-10 bg-transparent relative shrink-0 [-webkit-app-region:drag] z-[60]">
      <div className="absolute left-0 top-0 w-20 h-full [-webkit-app-region:no-drag]" />
    </div>
  );
}

function Sidebar({ navItems }: { navItems: NavItem[] }) {
  const { sidebarCollapsed, toggleSidebar } = useAppStore();
  const isMac = window.mimic?.platform === 'darwin';

  return (
    <aside
      className={cn(
        'h-full bg-white/80 backdrop-blur-xl border-r border-border/50 flex flex-col transition-all duration-300 shrink-0',
        sidebarCollapsed ? 'w-20' : 'w-64'
      )}
    >
      {!isMac && (
        <div className="h-14 flex items-center px-5 border-b border-border/50">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-400 to-sky-400 flex items-center justify-center shadow-glow shrink-0">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            {!sidebarCollapsed && (
              <span className="font-semibold text-lg tracking-tight whitespace-nowrap">
                mimic-flow
              </span>
            )}
          </div>
        </div>
      )}
      {isMac && <div className="h-2" />}

      <nav className="flex-1 py-6 px-3 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group',
                isActive
                  ? 'bg-violet-50 text-violet-700 shadow-soft'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )
            }
          >
            <item.icon className="w-5 h-5 shrink-0" />
            {!sidebarCollapsed && <span className="whitespace-nowrap">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-border/50">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="w-full rounded-xl"
        >
          <PanelLeft className={cn('w-5 h-5 transition-transform', sidebarCollapsed && 'rotate-180')} />
        </Button>
      </div>
    </aside>
  );
}

function AppContent() {
  const { isLoading, init } = useAppStore();
  const location = useLocation();
  const [devMode, setDevMode] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen w-screen">
        <div className="w-10 h-10 rounded-full border-4 border-violet-100 border-t-violet-500 animate-spin" />
      </div>
    );
  }

  const isFullPage = location.pathname === '/workflows/editor';

  const navItemsWithDev = [...navItems];
  if (devMode) {
    navItemsWithDev.splice(navItemsWithDev.length - 1, 0, { path: '/flow-tester', label: 'Flow Tester', icon: FileJson });
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gradient-to-br from-slate-50/80 via-white to-violet-50/40">
      <TitleBar />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar navItems={navItemsWithDev} />
        <main
          className={isFullPage ? 'flex-1 overflow-hidden' : 'flex-1 overflow-y-auto p-8'}
        >
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/workflows" element={<WorkflowList />} />
            <Route path="/workflows/editor" element={<WorkflowEditor />} />
            <Route path="/logs" element={<Logs />} />
            {devMode && <Route path="/flow-tester" element={<FlowTester />} />}
            <Route path="/settings" element={<SettingsPage onDevModeToggle={() => setDevMode((v) => !v)} devMode={devMode} />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return <AppContent />;
}
