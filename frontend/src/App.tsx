import React, { useState, useEffect } from 'react';
import { SessionSummary } from './types';
import { api } from './services/api';
import { Navbar, NavTabId } from './components/Navbar';
import { TraitAuditModal } from './components/TraitAuditModal';
import {
  DashboardView,
  UploadDataView,
  QualityControlView,
} from './components/DashboardAndUploadView';
import {
  CompositionAnalysisView,
  CompositionTraitsView,
  StructureTraitsView,
} from './components/CompositionAndTraitsView';
import {
  TraitComparisonView,
  VisualizationView,
} from './components/ComparisonAndVisualizationView';
import {
  ReportsView,
  ExportResultsView,
  MethodologyAndDocsView,
} from './components/ReportsExportDocsView';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTabId>('dashboard');
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Interactive Trait Contribution Audit Modal State
  const [auditModal, setAuditModal] = useState<{
    traitId: string | null;
    sampleId?: string;
  }>({
    traitId: null,
  });

  const handleLoadReference = async (
    withStructure = false,
    datasetId = session?.active_demo_id || 'serum_igg_crc_raw_areas'
  ) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.loadDemo(withStructure, datasetId);
      setSession(data);
    } catch (err: any) {
      setError(
        err?.message ||
          'Could not connect to the Analytical Engine. Please ensure the Python backend server is running (python app.py).'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    handleLoadReference(false, 'serum_igg_crc_raw_areas');
  }, []);

  const handleResetSession = async () => {
    if (session) {
      try {
        await api.deleteSession(session.session_id);
      } catch {
        // Ignore cleanup errors
      }
    }
    setSession(null);
    setActiveTab('dashboard');
  };

  const handleInspectTrait = (traitId: string, sampleId?: string) => {
    setAuditModal({
      traitId,
      sampleId,
    });
  };

  const sampleIds =
    session?.composition_results?.sample_results?.map((r) => r.sample_id) || [];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        filename={session?.filename}
        totalSamples={session?.dashboard_metrics?.total_samples}
        totalGlycans={session?.dashboard_metrics?.identified_glycan_compositions}
        onResetSession={handleResetSession}
      />

      <main className="gareg-main" style={{ flex: 1 }}>
        {loading && !session && (
          <div className="gareg-card" style={{ textAlign: 'center', padding: '56px 24px' }}>
            <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#0f2b46', marginBottom: '8px' }}>
              Initializing Glycan Trait Calculator Engine...
            </div>
            <div style={{ fontSize: '0.88rem', color: '#64748b' }}>
              Loading and validating the GAREG reference glycomic dataset (41 samples, 37 glycan compositions, 28 baseline composition traits, and 8 structural traits).
            </div>
          </div>
        )}

        {error && !session && (
          <div className="gareg-card">
            <div className="alert-banner alert-error" style={{ marginBottom: '12px' }}>
              <div>
                <strong>Backend Connection Error:</strong> {error}
              </div>
            </div>
            <button className="btn btn-primary" onClick={() => handleLoadReference(false)}>
              Retry Connection
            </button>
          </div>
        )}

        {activeTab === 'dashboard' && (
          <DashboardView
            session={session}
            classificationTable={session?.classification_table || []}
            onNavigate={setActiveTab}
            onLoadDemo={(withStruct, datasetId) => handleLoadReference(withStruct, datasetId)}
            loading={loading}
          />
        )}

        {activeTab === 'upload' && (
          <UploadDataView
            session={session}
            loading={loading}
            onSessionUpdated={(s) => setSession(s)}
            onNavigate={setActiveTab}
          />
        )}

        {activeTab === 'qc' && (
          <QualityControlView
            session={session}
            onSessionUpdated={(s) => setSession(s)}
            onNavigate={setActiveTab}
          />
        )}

        {activeTab === 'composition' && (
          <CompositionAnalysisView
            session={session}
            onSessionUpdated={(s) => setSession(s)}
          />
        )}

        {activeTab === 'comp_traits' && (
          <CompositionTraitsView
            session={session}
            onSessionUpdated={(s) => setSession(s)}
            onInspectTrait={handleInspectTrait}
          />
        )}

        {activeTab === 'struct_traits' && (
          <StructureTraitsView
            session={session}
            onSessionUpdated={(s) => setSession(s)}
            onLoadStructuralDemo={() => handleLoadReference(true)}
          />
        )}

        {session && activeTab === 'comparison' && (
          <TraitComparisonView
            session={session}
            onInspectTrait={handleInspectTrait}
          />
        )}

        {session && activeTab === 'visualization' && (
          <VisualizationView
            session={session}
            onInspectTrait={handleInspectTrait}
          />
        )}

        {session && activeTab === 'reports' && (
          <ReportsView
            session={session}
            onInspectTrait={handleInspectTrait}
          />
        )}

        {session && activeTab === 'export' && (
          <ExportResultsView
            session={session}
            onInspectTrait={handleInspectTrait}
          />
        )}

        {session && activeTab === 'methodology' && (
          <MethodologyAndDocsView
            session={session}
            onInspectTrait={handleInspectTrait}
          />
        )}
      </main>

      {/* Footer matching GAREG Website Branding */}
      <footer
        style={{
          background: '#0f2b46',
          color: '#94a3b8',
          padding: '20px 24px',
          fontSize: '0.8rem',
          borderTop: '2px solid #0284c7',
          marginTop: '40px',
        }}
      >
        <div
          style={{
            maxWidth: '1540px',
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <strong style={{ color: '#ffffff' }}>GAREG Glycomic Trait Analyzer v1.0.0</strong> — Glycomic &amp; Glycoproteomic Composition and Structural Trait Analysis Platform
          </div>
          <div>
            Integrated with{' '}
            <a
              href="https://www.gareg.com.tr"
              target="_blank"
              rel="noreferrer"
              style={{ color: '#38bdf8', textDecoration: 'none', fontWeight: 600 }}
            >
              www.gareg.com.tr
            </a>{' '}
            | Strict Separation of Composition-Derived (Category A) and Structure-Derived (Category B) Glycan Traits
          </div>
        </div>
      </footer>

      {/* Interactive Trait Contribution Audit Trail Modal */}
      {session && auditModal.traitId && (
        <TraitAuditModal
          onClose={() => setAuditModal({ traitId: null })}
          sessionId={session.session_id}
          traitId={auditModal.traitId}
          initialSampleId={auditModal.sampleId || sampleIds[0]}
          sampleIds={sampleIds}
        />
      )}
    </div>
  );
};

export default App;
