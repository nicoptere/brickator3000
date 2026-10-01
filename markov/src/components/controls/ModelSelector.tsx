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

import React, { useState, useEffect, useRef } from 'react';
import {
  FolderIcon,
  FolderOpenIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  UploadIcon,
  RefreshIcon,
  SpinnerIcon
} from '../common/Icons';
import { getAssetUrl } from '../../utils/url';


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

export interface UploadedModelItem {
  id: string;
  name: string;
  file: File;
  sizeFormatted: string;
  timestamp: number;
}

interface ModelSelectorProps {
  currentModelId: string;
  onSelectModel: (modelId: string, modelUrl?: string) => void;
  onFileUpload: (file: File) => void;
  uploadedModels?: UploadedModelItem[];
  onSelectUploadedModel?: (item: UploadedModelItem) => void;
  onReloadUploadedModel?: (item: UploadedModelItem) => void;
  isLoading: boolean;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  currentModelId,
  onSelectModel,
  onFileUpload,
  uploadedModels = [],
  onSelectUploadedModel,
  onReloadUploadedModel,
  isLoading
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [manifest, setManifest] = useState<CleanManifest | null>(null);
  const [isLoadingManifest, setIsLoadingManifest] = useState<boolean>(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['cars', 'airplanes']));

  // Fetch clean models manifest
  const fetchManifest = async () => {
    setIsLoadingManifest(true);
    try {
      const res = await fetch(getAssetUrl('models/clean_manifest.json'));
      if (res.ok) {
        const data: CleanManifest = await res.json();
        setManifest(data);
      }
    } catch (e) {
      console.warn('Could not load clean models manifest', e);
    } finally {
      setIsLoadingManifest(false);
    }
  };

  useEffect(() => {
    fetchManifest();
  }, []);

  // Whenever currentModelId or manifest changes:
  // Automatically expand ONLY the category containing the active model, and collapse all others
  useEffect(() => {
    if (!manifest || !currentModelId) return;

    for (const cat of manifest.categories) {
      const hasModel = cat.models.some(
        (m) =>
          currentModelId === m.id ||
          currentModelId === m.path ||
          currentModelId === m.filename ||
          currentModelId.endsWith('/' + m.filename) ||
          (m.path && currentModelId.endsWith(m.path)) ||
          (currentModelId.toLowerCase().includes('beetle') && m.id.toLowerCase().includes('beetle'))
      );
      if (hasModel) {
        setExpandedFolders(new Set([cat.name]));
        break;
      }
    }
  }, [currentModelId, manifest]);

  // Auto-scroll highlighted model into view when tree opens or selection changes
  useEffect(() => {
    const timer = setTimeout(() => {
      const el = document.getElementById('selected-model-tree-node');
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [currentModelId, expandedFolders]);

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

  const handleSelectModelItem = (catName: string, modelId: string, modelUrl: string) => {
    // Collapse other tree folders and expand selected category
    setExpandedFolders(new Set([catName]));
    onSelectModel(modelId, modelUrl);
  };

  const expandAll = () => {
    if (!manifest) return;
    setExpandedFolders(new Set(manifest.categories.map((c) => c.name)));
  };

  const collapseAll = () => {
    setExpandedFolders(new Set());
  };

  const categories = manifest ? manifest.categories : [];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        gap: 8,
        color: '#0f172a'
      }}
    >
      {/* Quick Action Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Models Library
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={expandAll}
            title="Expand All"
            style={{
              padding: '2px 6px',
              borderRadius: 4,
              border: '1px solid #e2e8f0',
              backgroundColor: '#f1f5f9',
              color: '#475569',
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
              border: '1px solid #e2e8f0',
              backgroundColor: '#f1f5f9',
              color: '#475569',
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
              border: '1px solid #e2e8f0',
              backgroundColor: '#f1f5f9',
              color: '#475569',
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

      {/* Upload Custom Model Button */}
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={isLoading}
        style={{
          width: '100%',
          height: 30,
          padding: '0 10px',
          borderRadius: 6,
          border: '1px dashed #bfdbfe',
          backgroundColor: '#eff6ff',
          color: '#2563eb',
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

      {/* Uploaded Models in Memory */}
      {uploadedModels.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: '6px 8px',
            borderRadius: 6,
            backgroundColor: '#ffffff',
            border: '1px solid #bfdbfe'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Uploaded Models ({uploadedModels.length})
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 110, overflowY: 'auto' }}>
            {uploadedModels.map((item) => {
              const isSelected = currentModelId === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() => onSelectUploadedModel?.(item)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '4px 6px',
                    borderRadius: 5,
                    cursor: 'pointer',
                    backgroundColor: isSelected ? '#eff6ff' : '#f8fafc',
                    border: isSelected ? '1px solid #bfdbfe' : '1px solid #e2e8f0',
                    transition: 'all 0.12s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        backgroundColor: isSelected ? '#2563eb' : '#94a3b8',
                        flexShrink: 0
                      }}
                    />
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: isSelected ? 700 : 500,
                        color: isSelected ? '#2563eb' : '#0f172a',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 160
                      }}
                      title={item.name}
                    >
                      {item.name}
                    </span>
                    <span style={{ fontSize: 9, color: '#64748b', flexShrink: 0 }}>
                      {item.sizeFormatted}
                    </span>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onReloadUploadedModel?.(item);
                    }}
                    title="Reload model"
                    style={{
                      padding: '2px 6px',
                      borderRadius: 4,
                      border: isSelected ? '1px solid #2563eb' : '1px solid #cbd5e1',
                      backgroundColor: isSelected ? '#2563eb' : '#ffffff',
                      color: isSelected ? '#ffffff' : '#2563eb',
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                      flexShrink: 0
                    }}
                  >
                    <RefreshIcon size={10} color={isSelected ? '#ffffff' : '#2563eb'} />
                    <span>Reload</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Folder Tree Scrollable List */}
      <div
        style={{
          flex: 1,
          minHeight: 120,
          overflowY: 'auto',
          border: '1px solid #e2e8f0',
          borderRadius: 6,
          backgroundColor: '#f8fafc',
          padding: 4
        }}
      >
        {isLoadingManifest && (
          <div style={{ padding: 12, textAlign: 'center', fontSize: 11, color: '#64748b' }}>
            Loading models catalog...
          </div>
        )}

        {!isLoadingManifest && categories.map((cat) => {
          const isExpanded = expandedFolders.has(cat.name);
          const containsSelected = cat.models.some(
            (m) =>
              currentModelId === m.id ||
              currentModelId === m.path ||
              currentModelId === m.filename ||
              currentModelId.endsWith('/' + m.filename) ||
              (m.path && currentModelId.endsWith(m.path)) ||
              (currentModelId.toLowerCase().includes('beetle') && m.id.toLowerCase().includes('beetle'))
          );
          return (
            <div key={cat.name} style={{ marginBottom: 2 }}>
              {/* Category Folder Row */}
              <button
                onClick={() => toggleFolder(cat.name)}
                style={{
                  width: '100%',
                  padding: '5px 6px',
                  borderRadius: 4,
                  border: containsSelected ? '1px solid #bfdbfe' : '1px solid transparent',
                  backgroundColor: isExpanded ? '#eff6ff' : (containsSelected ? '#f8fafc' : 'transparent'),
                  color: isExpanded || containsSelected ? '#2563eb' : '#475569',
                  fontSize: 11,
                  fontWeight: containsSelected ? 700 : 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  textAlign: 'left',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ color: '#64748b', display: 'flex', alignItems: 'center' }}>
                    {isExpanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                  </span>
                  <span style={{ color: '#2563eb', display: 'flex', alignItems: 'center' }}>
                    {isExpanded ? <FolderOpenIcon size={14} /> : <FolderIcon size={14} />}
                  </span>
                  <span>{cat.title}</span>
                </div>
                <span style={{ fontSize: 10, color: containsSelected ? '#2563eb' : '#64748b', fontFamily: 'monospace', fontWeight: containsSelected ? 700 : 500 }}>
                  {cat.models.length}
                </span>
              </button>

              {/* Category Items */}
              {isExpanded && (
                <div style={{ paddingLeft: 18, paddingTop: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {cat.models.map((m) => {
                    const isSelected =
                      currentModelId === m.id ||
                      currentModelId === m.path ||
                      currentModelId === m.filename ||
                      currentModelId.endsWith('/' + m.filename) ||
                      (m.path && currentModelId.endsWith(m.path)) ||
                      (currentModelId.toLowerCase().includes('beetle') && m.id.toLowerCase().includes('beetle'));
                    const modelUrl = getAssetUrl(m.path);
                    return (
                      <div
                        key={m.id}
                        id={isSelected ? 'selected-model-tree-node' : undefined}
                        onClick={() => handleSelectModelItem(cat.name, m.id, modelUrl)}
                        style={{
                          padding: '5px 8px',
                          borderRadius: 4,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          backgroundColor: isSelected ? '#2563eb' : 'transparent',
                          color: isSelected ? '#ffffff' : '#0f172a',
                          fontSize: 11,
                          fontWeight: isSelected ? 700 : 400,
                          boxShadow: isSelected ? '0 1px 4px rgba(37, 99, 235, 0.35)' : 'none',
                          border: isSelected ? '1px solid #1d4ed8' : '1px solid transparent',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          {isSelected && isLoading && (
                            <SpinnerIcon size={12} color="#ffffff" />
                          )}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {m.name}
                          </span>
                        </div>
                        {m.sizeFormatted && (
                          <span style={{ fontSize: 9, color: isSelected ? 'rgba(255, 255, 255, 0.85)' : '#64748b', marginLeft: 6, flexShrink: 0 }}>
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
