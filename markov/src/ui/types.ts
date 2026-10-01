import * as THREE from 'three';
import { PlacedBrick, VoxelGrid, MarkovEngineOptions } from '../engine/types';
import { MarkovCoreGrowingEngine } from '../engine/markovCoreGrowingEngine';
import { OMRCategory } from '../engine/wfcRefinerEngine';
import { HarmonizationResult, BuildabilityReport } from '../engine/polishHarmonizer';
import { MeshDistanceResult } from '../engine/meshDistanceMetric';

export type SourceMeshMode = 'ghost' | 'wireframe' | 'none';
export type ColorMode = 'island_components' | 'wfc_hierarchy' | 'actual';
export type ThemeMode = 'dark' | 'light';

export interface IslandSummary {
  id: number;
  name: string;
  triangleCount: number;
  colorHex: string;
}

export interface PreprocessState {
  isOpen: boolean;
  modelName: string;
  progressPercent: number;
  stageTitle: string;
  stageDetail: string;
  currentStageIndex: number;
  detectedIslands: IslandSummary[];
}

export interface UploadedModelItem {
  id: string;
  name: string;
  file: File;
  sizeFormatted: string;
  timestamp: number;
}

export interface StudioModelPreset {
  label: string;
  url: string;
  fallbackType: 'duck' | 'car' | 'dolphin' | 'airplane' | 'dome_creature';
}
