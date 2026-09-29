/**
 * ModelSelector - Decoupled 3D Model & Mesh Overlay Control Component.
 */

import React, { useRef } from 'react';
import { SourceMeshMode } from '../Viewport3D';

interface ModelSelectorProps {
  modelType: string;
  onSelectModel: (type: string) => void;
  onFileUpload: (file: File) => void;
  sourceMeshMode: SourceMeshMode;
  onChangeSourceMeshMode: (m: SourceMeshMode) => void;
  isLoading: boolean;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  modelType,
  onSelectModel,
  onFileUpload,
  sourceMeshMode,
  onChangeSourceMeshMode,
  isLoading
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const modelPresets = [
    { id: 'beetle', label: '🚙 VW Beetle', badge: 'GLB' },
    { id: 'mini', label: '🚗 Mini Cooper', badge: 'GLB' },
    { id: 'concorde', label: '✈️ Concorde', badge: 'GLB' },
    { id: 'duck', label: '🦆 Duck', badge: 'GLB' },
    { id: 'dolphin', label: '🐬 Dolphin', badge: 'GLB' },
    { id: 'delacroix', label: '🗿 Delacroix', badge: 'PLY' },
    { id: 'prison', label: '🏰 Castle', badge: 'OBJ' }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#94a3b8',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            display: 'block',
            marginBottom: 8
          }}
        >
          Source 3D Model Volume
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 8 }}>
          {modelPresets.map((m) => (
            <button
              key={m.id}
              onClick={() => onSelectModel(m.id)}
              disabled={isLoading}
              style={{
                padding: '7px 8px',
                borderRadius: 6,
                border: 'none',
                fontSize: 11,
                fontWeight: 600,
                cursor: isLoading ? 'wait' : 'pointer',
                backgroundColor: modelType === m.id ? '#38bdf8' : '#1e293b',
                color: modelType === m.id ? '#0f172a' : '#cbd5e1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <span>{m.label}</span>
              <span
                style={{
                  fontSize: 9,
                  padding: '2px 4px',
                  borderRadius: 4,
                  backgroundColor: modelType === m.id ? 'rgba(15, 23, 42, 0.25)' : 'rgba(148, 163, 184, 0.15)',
                  fontWeight: 700
                }}
              >
                {m.badge}
              </span>
            </button>
          ))}
        </div>

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
          style={{
            width: '100%',
            padding: '7px 10px',
            borderRadius: 6,
            border: '1px dashed rgba(148, 163, 184, 0.3)',
            backgroundColor: 'rgba(30, 41, 59, 0.4)',
            color: '#94a3b8',
            fontSize: 11,
            cursor: 'pointer'
          }}
        >
          📁 Upload Custom Model (GLB / OBJ / PLY)
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".glb,.gltf,.obj,.ply"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files?.[0]) onFileUpload(e.target.files[0]);
          }}
        />
      </div>

      <div>
        <label
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#94a3b8',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            display: 'block',
            marginBottom: 6
          }}
        >
          3D Source Mesh Overlay
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {[
            { id: 'ghost', label: '👻 Ghost Solid' },
            { id: 'wireframe', label: '🕸️ Wireframe' },
            { id: 'none', label: '❌ Hidden' }
          ].map((sm) => (
            <button
              key={sm.id}
              onClick={() => onChangeSourceMeshMode(sm.id as SourceMeshMode)}
              style={{
                padding: '6px 4px',
                borderRadius: 6,
                border: 'none',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
                backgroundColor: sourceMeshMode === sm.id ? '#0284c7' : '#1e293b',
                color: sourceMeshMode === sm.id ? '#ffffff' : '#94a3b8'
              }}
            >
              {sm.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
