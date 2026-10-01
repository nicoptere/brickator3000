/**
 * LeftDrawer - Decoupled Left Panel for Source 3D Mesh and Model Parameters.
 *
 * Implements:
 * - SEC 1: Model Selector Panel (folder structure from clean manifest, presets, search, ~50% height)
 * - SEC 2: Model Parameters & Topological Islands Inspector (~50% height)
 * - Collapsible accordion sections with Gluestack-inspired medium-sized styling
 * - Zero emojis
 */

import React, { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon, PanelLeftIcon } from './common/Icons';
import { ModelSelector } from './controls/ModelSelector';
import { ModelParamsInspector } from './controls/ModelParamsInspector';
import { SourceMeshMode } from './Viewport3D';
import { ColorMode } from './controls/ColorModeSelector';
import { IslandMeta } from './controls/IslandInspector';
import { UploadedModelItem } from './controls/ModelSelector';

interface LeftDrawerProps {
  isOpen: boolean;
  onToggleOpen: () => void;
  currentModelId: string;
  onSelectModel: (id: string, url?: string) => void;
  onFileUpload: (file: File) => void;
  uploadedModels?: UploadedModelItem[];
  onSelectUploadedModel?: (item: UploadedModelItem) => void;
  onReloadUploadedModel?: (item: UploadedModelItem) => void;
  voxelizeMode: 'surface' | 'solid';
  onChangeVoxelizeMode: (m: 'surface' | 'solid') => void;
  sourceMeshMode: SourceMeshMode;
  onChangeSourceMeshMode: (m: SourceMeshMode) => void;
  colorMode: ColorMode;
  onChangeColorMode: (m: ColorMode) => void;
  islands?: IslandMeta[];
  selectedIslandId: number | null;
  onSelectIsland: (id: number | null) => void;
  onDiscretizeIsland: (id: number) => void;
  onDiscretizeAllIndependently: () => void;
  onSolveWfcOnIsland: (id: number | null) => void;
  onRerollColors: () => void;
  isLoading: boolean;
}

export const LeftDrawer: React.FC<LeftDrawerProps> = ({
  isOpen,
  onToggleOpen,
  currentModelId,
  onSelectModel,
  onFileUpload,
  uploadedModels = [],
  onSelectUploadedModel,
  onReloadUploadedModel,
  voxelizeMode,
  onChangeVoxelizeMode,
  sourceMeshMode,
  onChangeSourceMeshMode,
  colorMode,
  onChangeColorMode,
  islands = [],
  selectedIslandId,
  onSelectIsland,
  onDiscretizeIsland,
  onDiscretizeAllIndependently,
  onSolveWfcOnIsland,
  onRerollColors,
  isLoading
}) => {
  const [isSec1Open, setIsSec1Open] = useState<boolean>(true);
  const [isSec2Open, setIsSec2Open] = useState<boolean>(true);

  if (!isOpen) return null;

  return (
    <div
      style={{
        width: 350,
        minWidth: 350,
        maxWidth: 350,
        flexShrink: 0,
        height: '100%',
        backgroundColor: '#ffffff',
        borderRight: '1px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 25,
        color: '#0f172a',
        boxShadow: '4px 0 24px rgba(0, 0, 0, 0.05)'
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid #e2e8f0',
          backgroundColor: '#f8fafc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PanelLeftIcon size={16} color="#2563eb" />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.01em', color: '#0f172a' }}>
            Source Mesh & Model Params
          </span>
        </div>
        <button
          onClick={onToggleOpen}
          title="Collapse Panel"
          style={{
            padding: '4px 8px',
            borderRadius: 5,
            border: '1px solid #e2e8f0',
            backgroundColor: '#f1f5f9',
            color: '#475569',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Hide
        </button>
      </div>

      {/* Drawer Body - Split into Section 1 and Section 2 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {/* SEC 1: Model Selector (Folder Structure & Presets) - Takes ~50% height */}
        <div
          style={{
            flex: isSec1Open && isSec2Open ? '1 1 50%' : isSec1Open ? '1 1 100%' : '0 0 auto',
            height: isSec1Open && isSec2Open ? '50%' : isSec1Open ? '100%' : 'auto',
            minHeight: isSec1Open ? 200 : 'auto',
            display: 'flex',
            flexDirection: 'column',
            borderBottom: '1px solid #e2e8f0',
            overflow: 'hidden'
          }}
        >
          {/* Section 1 Header */}
          <button
            onClick={() => setIsSec1Open(!isSec1Open)}
            style={{
              width: '100%',
              padding: '10px 14px',
              backgroundColor: '#f8fafc',
              border: 'none',
              borderBottom: isSec1Open ? '1px solid #e2e8f0' : 'none',
              color: '#0f172a',
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#2563eb' }}>{isSec1Open ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}</span>
              <span>1. 3D Model Selector</span>
            </div>
            <span style={{ fontSize: 10, color: '#64748b', textTransform: 'none', fontWeight: 500 }}>
              Folder Library
            </span>
          </button>

          {/* Section 1 Content */}
          {isSec1Open && (
            <div style={{ flex: 1, minHeight: 0, padding: 12, overflowY: 'hidden' }}>
              <ModelSelector
                currentModelId={currentModelId}
                onSelectModel={onSelectModel}
                onFileUpload={onFileUpload}
                uploadedModels={uploadedModels}
                onSelectUploadedModel={onSelectUploadedModel}
                onReloadUploadedModel={onReloadUploadedModel}
                isLoading={isLoading}
              />
            </div>
          )}
        </div>

        {/* SEC 2: Model Params & Topological Islands - Takes ~50% height */}
        <div
          style={{
            flex: isSec1Open && isSec2Open ? '1 1 50%' : isSec2Open ? '1 1 100%' : '0 0 auto',
            height: isSec1Open && isSec2Open ? '50%' : isSec2Open ? '100%' : 'auto',
            minHeight: isSec2Open ? 200 : 'auto',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          {/* Section 2 Header */}
          <button
            onClick={() => setIsSec2Open(!isSec2Open)}
            style={{
              width: '100%',
              padding: '10px 14px',
              backgroundColor: '#f8fafc',
              border: 'none',
              borderBottom: isSec2Open ? '1px solid #e2e8f0' : 'none',
              color: '#0f172a',
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#2563eb' }}>{isSec2Open ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}</span>
              <span>2. Shell, Overlay & Materials</span>
            </div>
            <span style={{ fontSize: 10, color: '#64748b', textTransform: 'none', fontWeight: 500 }}>
              Parameters
            </span>
          </button>

          {/* Section 2 Content */}
          {isSec2Open && (
            <div style={{ flex: 1, minHeight: 0, padding: 12, overflowY: 'auto' }}>
              <ModelParamsInspector
                voxelizeMode={voxelizeMode}
                onChangeVoxelizeMode={onChangeVoxelizeMode}
                sourceMeshMode={sourceMeshMode}
                onChangeSourceMeshMode={onChangeSourceMeshMode}
                colorMode={colorMode}
                onChangeColorMode={onChangeColorMode}
                islands={islands}
                selectedIslandId={selectedIslandId}
                onSelectIsland={onSelectIsland}
                onDiscretizeIsland={onDiscretizeIsland}
                onDiscretizeAllIndependently={onDiscretizeAllIndependently}
                onSolveWfcOnIsland={onSolveWfcOnIsland}
                onRerollColors={onRerollColors}
                isLoading={isLoading}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
