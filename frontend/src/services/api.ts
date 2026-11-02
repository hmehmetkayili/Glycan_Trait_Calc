import { SessionSummary, TraitContributionAudit } from '../types';
import { clientEngine } from './clientEngine';

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || '/api';

let useClientEngineOnly = false;

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errText = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      errText = data.detail || JSON.stringify(data);
    } catch {
      errText = await res.text();
    }
    throw new Error(errText);
  }
  return res.json() as Promise<T>;
}

function isValidSessionSummary(obj: any): obj is SessionSummary {
  return Boolean(
    obj &&
      typeof obj === 'object' &&
      typeof obj.session_id === 'string' &&
      obj.dashboard_metrics &&
      obj.composition_results &&
      obj.structure_results
  );
}

export const api = {
  async loadDemo(
    includeStructuralDemo = false,
    datasetId = 'serum_igg_crc_raw_areas'
  ): Promise<SessionSummary> {
    if (useClientEngineOnly || datasetId !== 'gareg_formula_reference') {
      useClientEngineOnly = true;
      return clientEngine.loadDemo(includeStructuralDemo, datasetId);
    }
    try {
      const res = await fetch(
        `${API_BASE}/data/demo?include_structural_demo=${includeStructuralDemo}`,
        { method: 'POST' }
      );
      const data = await handleResponse<SessionSummary>(res);
      if (isValidSessionSummary(data) && data.normalized_preview_rows) {
        return data;
      }
      useClientEngineOnly = true;
      return clientEngine.loadDemo(includeStructuralDemo, datasetId);
    } catch {
      useClientEngineOnly = true;
      return clientEngine.loadDemo(includeStructuralDemo, datasetId);
    }
  },

  async uploadData(file: File, sheetName?: string): Promise<SessionSummary> {
    if (useClientEngineOnly) {
      return clientEngine.uploadData(file, sheetName);
    }
    try {
      const form = new FormData();
      form.append('file', file);
      if (sheetName) form.append('sheet_name', sheetName);
      const res = await fetch(`${API_BASE}/data/upload`, {
        method: 'POST',
        body: form,
      });
      const data = await handleResponse<SessionSummary>(res);
      if (isValidSessionSummary(data)) return data;
      useClientEngineOnly = true;
      return clientEngine.uploadData(file, sheetName);
    } catch {
      useClientEngineOnly = true;
      return clientEngine.uploadData(file, sheetName);
    }
  },

  async uploadMetadata(
    sessionId: string,
    file: File,
    newGroupCol?: string
  ): Promise<SessionSummary> {
    if (useClientEngineOnly) {
      return clientEngine.uploadMetadata(sessionId, file, newGroupCol);
    }
    try {
      const form = new FormData();
      form.append('session_id', sessionId);
      form.append('file', file);
      if (newGroupCol) form.append('new_group_col', newGroupCol);
      const res = await fetch(`${API_BASE}/data/metadata`, {
        method: 'POST',
        body: form,
      });
      const data = await handleResponse<SessionSummary>(res);
      if (isValidSessionSummary(data)) return data;
      return clientEngine.uploadMetadata(sessionId, file, newGroupCol);
    } catch {
      return clientEngine.uploadMetadata(sessionId, file, newGroupCol);
    }
  },

  async validateAndUpdateConfig(
    payload: Record<string, any>
  ): Promise<SessionSummary> {
    if (useClientEngineOnly) {
      return clientEngine.validateAndUpdateConfig(payload);
    }
    try {
      const res = await fetch(`${API_BASE}/data/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await handleResponse<SessionSummary>(res);
      if (isValidSessionSummary(data)) return data;
      return clientEngine.validateAndUpdateConfig(payload);
    } catch {
      return clientEngine.validateAndUpdateConfig(payload);
    }
  },

  async parseCompositions(payload: {
    labels: string[];
    treat_f_as_fucose?: boolean;
    treat_dhex_as_fucose?: boolean;
    assume_s_is_neuac?: boolean;
    manual_overrides?: Record<string, Record<string, number>>;
    custom_components?: Record<string, string>;
    explain_glycan?: string;
    explain_abundance_pct?: number;
  }): Promise<any> {
    if (useClientEngineOnly) {
      return clientEngine.parseCompositions(payload);
    }
    try {
      const res = await fetch(`${API_BASE}/composition/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await handleResponse<any>(res);
      if (data && Array.isArray(data.parsed_table)) {
        return data;
      }
      return clientEngine.parseCompositions(payload);
    } catch {
      return clientEngine.parseCompositions(payload);
    }
  },

  async getTraitContributionAudit(
    sessionId: string,
    traitId: string,
    sampleId?: string
  ): Promise<TraitContributionAudit> {
    if (useClientEngineOnly) {
      return clientEngine.getTraitContributionAudit(sessionId, traitId, sampleId);
    }
    try {
      const qs = new URLSearchParams({
        session_id: sessionId,
        trait_id: traitId,
      });
      if (sampleId) qs.set('sample_id', sampleId);
      const res = await fetch(`${API_BASE}/traits/contributions?${qs.toString()}`);
      const data = await handleResponse<TraitContributionAudit>(res);
      if (data && data.trait && Array.isArray(data.contributions)) return data;
      return clientEngine.getTraitContributionAudit(sessionId, traitId, sampleId);
    } catch {
      return clientEngine.getTraitContributionAudit(sessionId, traitId, sampleId);
    }
  },

  async createOrPreviewCustomTrait(payload: Record<string, any>): Promise<any> {
    if (useClientEngineOnly) {
      return clientEngine.createOrPreviewCustomTrait(payload);
    }
    try {
      const res = await fetch(`${API_BASE}/traits/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return await handleResponse<any>(res);
    } catch (err: any) {
      if (err?.message?.includes('cannot claim')) throw err;
      return clientEngine.createOrPreviewCustomTrait(payload);
    }
  },

  async calculateStructureTraits(payload: {
    session_id: string;
    annotations?: any[];
    clear_annotations?: boolean;
  }): Promise<SessionSummary> {
    if (useClientEngineOnly) {
      return clientEngine.calculateStructureTraits(payload);
    }
    try {
      const res = await fetch(`${API_BASE}/traits/structure/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await handleResponse<SessionSummary>(res);
      if (isValidSessionSummary(data)) return data;
      return clientEngine.calculateStructureTraits(payload);
    } catch {
      return clientEngine.calculateStructureTraits(payload);
    }
  },

  async uploadStructureAnnotationFile(
    sessionId: string,
    file: File
  ): Promise<SessionSummary> {
    if (useClientEngineOnly) {
      return clientEngine.uploadStructureAnnotationFile(sessionId, file);
    }
    try {
      const form = new FormData();
      form.append('session_id', sessionId);
      form.append('file', file);
      const res = await fetch(`${API_BASE}/traits/structure/upload`, {
        method: 'POST',
        body: form,
      });
      const data = await handleResponse<SessionSummary>(res);
      if (isValidSessionSummary(data)) return data;
      return clientEngine.uploadStructureAnnotationFile(sessionId, file);
    } catch {
      return clientEngine.uploadStructureAnnotationFile(sessionId, file);
    }
  },

  async downloadExport(
    endpoint: 'excel' | 'csv' | 'report',
    sessionId: string,
    format = 'html'
  ): Promise<Blob> {
    if (useClientEngineOnly) {
      return clientEngine.downloadExport(endpoint, sessionId, format);
    }
    try {
      const res = await fetch(`${API_BASE}/export/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, format }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.blob();
    } catch {
      return clientEngine.downloadExport(endpoint, sessionId, format);
    }
  },

  async fetchReportHtml(sessionId: string): Promise<string> {
    if (useClientEngineOnly) {
      return clientEngine.generateReportHtml(sessionId);
    }
    try {
      const res = await fetch(`${API_BASE}/export/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, format: 'html' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.includes('GAREG Glycomic Trait Analysis Report')) return text;
      return clientEngine.generateReportHtml(sessionId);
    } catch {
      return clientEngine.generateReportHtml(sessionId);
    }
  },

  async deleteSession(sessionId: string): Promise<void> {
    if (useClientEngineOnly) {
      clientEngine.deleteSession(sessionId);
      return;
    }
    try {
      await fetch(`${API_BASE}/session/${sessionId}`, { method: 'DELETE' });
    } catch {
      clientEngine.deleteSession(sessionId);
    }
  },

  async downloadNormalizedMatrix(
    sessionId: string,
    format: 'xlsx' | 'csv' = 'xlsx',
    includeTraits = false
  ): Promise<void> {
    clientEngine.downloadNormalizedMatrix(sessionId, format, includeTraits);
  },

  async downloadDataTemplate(
    templateType:
      | 'raw_area_template'
      | 'relative_pct_template'
      | 'metadata_template'
      | 'structural_template'
      | 'active_dataset',
    format: 'xlsx' | 'csv' = 'xlsx',
    sessionId?: string
  ): Promise<void> {
    clientEngine.downloadDataTemplate(templateType, format, sessionId);
  },
};
