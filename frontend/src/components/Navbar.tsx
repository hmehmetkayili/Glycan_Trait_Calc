import React from 'react';
import {
  LayoutDashboard,
  Upload,
  ShieldCheck,
  Dna,
  Calculator,
  GitBranch,
  Scale,
  BarChart3,
  FileText,
  Download,
  BookOpen,
  Trash2,
  ExternalLink,
  FileSpreadsheet,
} from 'lucide-react';

export type NavTabId =
  | 'dashboard'
  | 'upload'
  | 'qc'
  | 'composition'
  | 'comp_traits'
  | 'struct_traits'
  | 'comparison'
  | 'visualization'
  | 'reports'
  | 'export'
  | 'methodology';

interface NavbarProps {
  activeTab: NavTabId;
  setActiveTab: (tab: NavTabId) => void;
  filename?: string;
  totalSamples?: number;
  totalGlycans?: number;
  onResetSession: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  filename,
  totalSamples,
  totalGlycans,
  onResetSession,
}) => {
  const navItems: Array<{ id: NavTabId; label: string; icon: any }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'upload', label: 'Upload Data', icon: Upload },
    { id: 'qc', label: 'Data Quality Control', icon: ShieldCheck },
    { id: 'composition', label: 'Glycan Composition Analysis', icon: Dna },
    { id: 'comp_traits', label: 'Composition-Derived Traits', icon: Calculator },
    { id: 'struct_traits', label: 'Structure-Derived Traits', icon: GitBranch },
    { id: 'comparison', label: 'Trait Comparison', icon: Scale },
    { id: 'visualization', label: 'Visualization', icon: BarChart3 },
    { id: 'reports', label: 'Reports', icon: FileText },
    { id: 'export', label: 'Export Results', icon: Download },
    { id: 'methodology', label: 'Methodology & Documentation', icon: BookOpen },
  ];

  return (
    <header style={{ background: '#0f2b46', color: '#ffffff', borderBottom: '1px solid #1e3a5f', position: 'sticky', top: 0, zIndex: 100 }}>
      {/* Top Banner Bar */}
      <div
        style={{
          background: '#081726',
          padding: '6px 24px',
          fontSize: '0.74rem',
          color: '#94a3b8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#38bdf8', fontWeight: 700 }}>
            Glycan Trait Calculator
          </span>
          <span>&bull;</span>
          <span style={{ color: '#cbd5e1' }}>
            Open-Source Glycomic Composition &amp; Structural Trait Analysis Platform
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span>Python &bull; FastAPI &bull; React &bull; Plotly</span>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            style={{
              color: '#38bdf8',
              textDecoration: 'none',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            GitHub Repository <ExternalLink size={11} />
          </a>
        </div>
      </div>

      {/* Main Brand Banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 24px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              background: 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
              width: '42px',
              height: '42px',
              borderRadius: '11px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(2, 132, 199, 0.35)',
            }}
          >
            <Dna size={24} color="#ffffff" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ fontSize: '1.22rem', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>
                Glycan <span style={{ color: '#38bdf8' }}>Trait Calculator</span>
              </h1>
              <span
                style={{
                  background: 'rgba(56, 189, 248, 0.16)',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  color: '#7dd3fc',
                  padding: '2px 8px',
                  borderRadius: '6px',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                }}
              >
                v1.0 &bull; OPEN-SOURCE SCIENTIFIC SUITE
              </span>
            </div>
            <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '2px 0 0' }}>
              Comprehensive Glycomic Composition-Derived &amp; Structure-Derived Trait Analysis Platform
            </p>
          </div>
        </div>

        {/* Active Dataset Status & Session Privacy Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {filename && (
            <div
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.16)',
                borderRadius: '8px',
                padding: '6px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: '9px',
                fontSize: '0.78rem',
              }}
            >
              <FileSpreadsheet size={16} color="#38bdf8" />
              <div>
                <span style={{ fontWeight: 600, color: '#f8fafc' }}>{filename}</span>
                <span style={{ color: '#cbd5e1', marginLeft: '8px' }}>
                  ({totalSamples} samples &bull; {totalGlycans} glycans)
                </span>
              </div>
            </div>
          )}

          {filename && (
            <button
              onClick={onResetSession}
              style={{
                background: 'rgba(239, 68, 68, 0.18)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                borderRadius: '7px',
                padding: '6px 11px',
                color: '#fca5a5',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
              title="Delete session dataset from memory immediately"
            >
              <Trash2 size={14} />
              <span>Delete Session Data</span>
            </button>
          )}
        </div>
      </div>

      {/* 11-Module Navigation Bar (Section 3) */}
      <nav
        style={{
          display: 'flex',
          overflowX: 'auto',
          padding: '0 16px',
          background: '#0a1d30',
          whiteSpace: 'nowrap',
        }}
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '7px',
                padding: '10px 14px',
                border: 'none',
                background: isActive ? 'rgba(56, 189, 248, 0.09)' : 'transparent',
                color: isActive ? '#38bdf8' : '#cbd5e1',
                fontSize: '0.78rem',
                fontWeight: isActive ? 700 : 500,
                cursor: 'pointer',
                borderBottom: isActive ? '3px solid #38bdf8' : '3px solid transparent',
                transition: 'all 0.15s ease',
              }}
            >
              <Icon size={15} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </header>
  );
};
