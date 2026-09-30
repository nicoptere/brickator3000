/**
 * ModelSelector - Source 3D Mesh Tree & Preset Picker Component.
 *
 * Implements:
 * - Clean model folder tree loaded from /models/clean_manifest.json
 * - Quick presets including Spearman GLB, VW Beetle, Mini Cooper, Concorde, etc.
 * - Live search filter across categories and model names
 * - Foldable categories with expand/collapse all
 * - Custom model file upload (GLB, GLTF, OBJ, PLY)
 * - Zero emojis, medium-sized Gluestack/Tailwind-inspired controls
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  FolderIcon,
  FolderOpenIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  SearchIcon,
  UploadIcon,
  RefreshIcon
} from '../common/Icons';

export interface CleanModelItem {
  id: string;
  name: string;
  filename: string;
  category: string;
  path: string;
  sizeBytes?: number;
  sizeFormatted?: string;
}

export interface CleanCategoryItem {
  name: string;
  title: string;
  count: number;
  models: CleanModelItem[];
}

export interface CleanManifest {
  categories: CleanCategoryItem[];
  totalModels: number;
}

interface ModelSelectorProps {
  currentModelId: string;
  onSelectModel: (modelId: string, modelUrl?: string) => void;
  onFileUpload: (file: File) => void;
  isLoading: boolean;
}

const PRESET_MODELS = [
  { id: 'spearman', label: 'Spearman', badge: 'GLB', url: '/models/spearman.glb' },
  { id: 'beetle', label: 'VW Beetle', badge: 'GLB', url: '/models/clean/cars/vwbeetle.glb' },
  { id: 'mini', label: 'Mini Cooper', badge: 'GLB', url: '/models/clean/cars/mini.glb' },
  { id: 'concorde', label: 'Concorde', badge: 'GLB', url: '/models/clean/airplanes/concord.glb' },
  { id: 'duck', label: 'Duck', badge: 'GLB', url: '/sample_models/duck.glb' },
  { id: 'dolphin', label: 'Dolphin', badge: 'GLB', url: '/sample_models/dolphin.glb' }
];

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  currentModelId,
  onSelectModel,
  onFileUpload,
  isLoading
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [manifest, setManifest] = useState<CleanManifest | null>(null);
  const [isLoadingManifest, setIsLoadingManifest] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['cars', 'airplanes']));

  // Fetch clean models manifest
  const fetchManifest = async () => {
    setIsLoadingManifest(true);
    try {
      const res = await fetch('/models/clean_manifest.json');
      if (res.ok) {
        const data: CleanManifest = await res.json();
        setManifest(data);
      }
    } catch (e) {
      console.warn('Could not load clean models manifest, using presets', e);
    } finally {
      setIsLoadingManifest(false);
    }
  };

  useEffect(() => {
    fetchManifest();
  }, []);

  const toggleFolder = (catName: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(catName)) {
        next.delete(catName);
      } else {
        next.add(catName);
      }
      return next;
    });
  };

  const expandAll = () => {
    if (!manifest) return;
    setExpandedFolders(new Set(manifest.categories.map((c) => c.name)));
  };

  const collapseAll = () => {
    setExpandedFolders(new Set());
  };

  // Filter categories based on search
  const filteredCategories = useMemo(() => {
    if (!manifest) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return manifest.categories;

    return manifest.categories
      .map((cat) => {
        const titleMatch = cat.title.toLowerCase().includes(q) || cat.name.toLowerCase().includes(q);
        const matchingModels = cat.models.filter(
          (m) => m.name.toLowerCase().includes(q) || m.filename.toLowerCase().includes(q) || titleMatch
        );
        if (matchingModels.length === 0) return null;
        return {
          ...cat,
          models: matchingModels
        };
      })
      .filter((cat): cat is CleanCategoryItem => cat !== null);
  }, [manifest, searchQuery]);

  // Auto-expand folders on search
  useEffect(() => {
    if (searchQuery.trim() && filteredCategories.length > 0) {
      setExpandedFolders(new Set(filteredCategories.map((c) => c.name)));
    }
  }, [searchQuery, filteredCategories]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        gap: 8,
        color: '#f8fafc'
      }}
    >
      {/* Search Input */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <span style={{ position: 'absolute', left: 10, display: 'flex', alignItems: 'center', pointerEvents: 'none', color: '#64748b' }}>
          <SearchIcon size={14} />
        </span>
        <input
          type="text"
          placeholder="Filter models... (e.g. beetle, f16)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            height: 32,
            paddingLeft: 30,
            paddingRight: 10,
            borderRadius: 6,
            border: '1px solid #334155',
            backgroundColor: '#0f172a',
            color: '#f8fafc',
            fontSize: 12,
            outline: 'none',
            boxSizing: 'border-box'
          }}
        />
      </div>

      {/* Quick Action Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Presets & Library
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={expandAll}
            title="Expand All"
            style={{
              padding: '2px 6px',
              borderRadius: 4,
              border: '1px solid #334155',
              backgroundColor: '#1e293b',
              color: '#94a3b8',
              fontSize: 10,
              cursor: 'pointer'
            }}
          >
            Expand
          </button>
          <button
            onClick={collapseAll}
            title="Collapse All"
            style={{
              padding: '2px 6px',
              borderRadius: 4,
              border: '1px solid #334155',
              backgroundColor: '#1e293b',
              color: '#94a3b8',
              fontSize: 10,
              cursor: 'pointer'
            }}
          >
            Collapse
          </button>
          <button
            onClick={fetchManifest}
            title="Reload library"
            style={{
              padding: '2px 6px',
              borderRadius: 4,
              border: '1px solid #334155',
              backgroundColor: '#1e293b',
              color: '#94a3b8',
              fontSize: 10,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <RefreshIcon size={11} />
          </button>
        </div>
      </div>

      {/* Presets Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
        {PRESET_MODELS.map((p) => {
          const isSelected = currentModelId === p.id;
          return (
            <button
              key={p.id}
              onClick={() => onSelectModel(p.id, p.url)}
              disabled={isLoading}
              style={{
                height: 26,
                padding: '0 6px',
                borderRadius: 5,
                border: isSelected ? '1px solid #0284c7' : '1px solid #334155',
                backgroundColor: isSelected ? '#0284c7' : '#1e293b',
                color: isSelected ? '#ffffff' : '#cbd5e1',
                fontSize: 10,
                fontWeight: 600,
                cursor: isLoading ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'background-color 0.15s ease'
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</span>
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 700,
                  padding: '1px 3px',
                  borderRadius: 3,
                  backgroundColor: isSelected ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                  color: isSelected ? '#ffffff' : '#94a3b8'
                }}
              >
                {p.badge}
              </span>
            </button>
          );
        })}
      </div>

      {/* Upload Custom Model Button */}
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={isLoading}
        style={{
          width: '100%',
          height: 30,
          padding: '0 10px',
          borderRadius: 6,
          border: '1px dashed #475569',
          backgroundColor: 'rgba(30, 41, 59, 0.4)',
          color: '#94a3b8',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6
        }}
      >
        <UploadIcon size={13} />
        <span>Upload Custom Model (GLB / OBJ / PLY)</span>
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

      {/* Folder Tree Scrollable List */}
      <div
        style={{
          flex: 1,
          minHeight: 120,
          overflowY: 'auto',
          border: '1px solid #1e293b',
          borderRadius: 6,
          backgroundColor: '#0a0f1d',
          padding: 4
        }}
      >
        {isLoadingManifest && (
          <div style={{ padding: 12, textAlign: 'center', fontSize: 11, color: '#64748b' }}>
            Loading models catalog...
          </div>
        )}

        {!isLoadingManifest && filteredCategories.map((cat) => {
          const isExpanded = expandedFolders.has(cat.name);
          return (
            <div key={cat.name} style={{ marginBottom: 2 }}>
              {/* Category Folder Row */}
              <button
                onClick={() => toggleFolder(cat.name)}
                style={{
                  width: '100%',
                  padding: '4px 6px',
                  borderRadius: 4,
                  border: 'none',
                  backgroundColor: isExpanded ? 'rgba(51, 65, 85, 0.4)' : 'transparent',
                  color: '#cbd5e1',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  textAlign: 'left'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ color: '#64748b', display: 'flex', alignItems: 'center' }}>
                    {isExpanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                  </span>
                  <span style={{ color: isExpanded ? '#38bdf8' : '#94a3b8', display: 'flex', alignItems: 'center' }}>
                    {isExpanded ? <FolderOpenIcon size={14} /> : <FolderIcon size={14} />}
                  </span>
                  <span>{cat.title}</span>
                </div>
                <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>
                  {cat.models.length}
                </span>
              </button>

              {/* Category Items */}
              {isExpanded && (
                <div style={{ paddingLeft: 18, paddingTop: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {cat.models.map((m) => {
                    const isSelected = currentModelId === m.id || currentModelId === m.filename;
                    const modelUrl = `/${m.path}`;
                    return (
                      <div
                        key={m.id}
                        onClick={() => onSelectModel(m.id, modelUrl)}
                        style={{
                          padding: '3px 6px',
                          borderRadius: 4,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          backgroundColor: isSelected ? 'rgba(2, 132, 199, 0.25)' : 'transparent',
                          border: isSelected ? '1px solid #0284c7' : '1px solid transparent',
                          color: isSelected ? '#38bdf8' : '#94a3b8',
                          fontSize: 11
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.name}
                        </span>
                        {m.sizeFormatted && (
                          <span style={{ fontSize: 9, color: '#475569', marginLeft: 6, flexShrink: 0 }}>
                            {m.sizeFormatted}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
