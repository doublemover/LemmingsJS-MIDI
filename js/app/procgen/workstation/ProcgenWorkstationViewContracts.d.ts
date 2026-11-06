import type { createProcgenWorkstation } from './ProcgenWorkstation.js';

type Workstation = ReturnType<typeof createProcgenWorkstation>;
export interface WorkstationUiState {
  laneId: string; slot: number; step: number; tab: string; tool: string; layout: 'strip' | 'overlay';
  inspectorWidth: number; firstLane: number; minimumRow: number; hazardSpacing: number;
  observerMode: string; observerLane: string | null; observerHold: number;
  outputId?: string | null; scoreTimeDomain?: string; grooveOpen?: boolean; physicalSearch?: string; beat?: number;
  inputId: string | null; clockOutputId: string | null; thru: boolean; recording: boolean; lastMidi: string;
  dockVersion?: number; dockHeight?: number; workspaceMode?: 'perform' | 'inspect' | 'overview';
  laneQuery?: string; laneNavigation?: unknown; motionMode?: 'system' | 'reduce' | 'freeze';
  presentationTransition?: boolean; takeNameDraft?: string; takeMarkerDraft?: string; branchSequenceDraft?: string;
}
export interface WorkstationWindow extends Window {
  ResizeObserver?: typeof ResizeObserver;
  showSaveFilePicker?: (options?: { suggestedName?: string; types?: readonly { description?: string; accept: Readonly<Record<string, readonly string[]>> }[] }) => Promise<FileSystemFileHandle>;
}
export interface WorkstationViewOptions {
  document: Document;
  window: WorkstationWindow;
  resourceBudget?: Parameters<typeof createProcgenWorkstation>[0]['resourceBudget'];
  getProject: Workstation['getProject'];
  getRuntime: Parameters<typeof createProcgenWorkstation>[0]['getRuntime'];
  getDocumentIdentity?: () => string | number | null;
  getDocumentStatus?: Workstation['getDocumentStatus'];
  getArmedLaneIds?: () => readonly string[];
  dispatch: Workstation['dispatch'];
  handlers?: Partial<Workstation['handlers']>;
  canCommand?: (name: string) => boolean;
  state?: Partial<WorkstationUiState>;
}

export interface WorkstationViewCommand {
  id: string; label: string; contexts: readonly string[]; bindings?: readonly string[]; repeat?: boolean;
  enabled: () => boolean; execute: () => unknown;
}
