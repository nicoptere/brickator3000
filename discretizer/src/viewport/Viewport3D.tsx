import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { ViewportEngine, type ModelStats } from './viewportEngine';
import type { PlacedBrick } from '../core/types';
import type { PlateLattice3D } from '../core/PlateLattice3D';
import type * as THREE from 'three';

export interface Viewport3DProps {
  onModelLoaded?: (stats: ModelStats) => void;
  onLoadingProgress?: (progress: number) => void;
  onError?: (error: string) => void;
  onReady?: () => void;
}

export interface Viewport3DHandle {
  loadModelFromUrl: (url: string, fileType: string, modelName: string) => Promise<void>;
  loadModelFromFile: (file: File) => Promise<void>;
  displayDiscretizedBricks: (bricks: PlacedBrick[], lattice: PlateLattice3D) => void;
  setViewMode: (mode: 'mesh' | 'lego' | 'both') => void;
  clearBricks: () => void;
  getActiveModel: () => THREE.Object3D | null;
  getEngine: () => ViewportEngine | null;
}

export const Viewport3D = forwardRef<Viewport3DHandle, Viewport3DProps>(({
  onModelLoaded,
  onLoadingProgress,
  onError,
  onReady
}, ref) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<ViewportEngine | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Keep latest callbacks in ref to avoid re-instantiating ViewportEngine
  const callbacksRef = useRef({ onModelLoaded, onLoadingProgress, onError, onReady });
  callbacksRef.current = { onModelLoaded, onLoadingProgress, onError, onReady };

  useEffect(() => {
    if (!containerRef.current) return;

    const engine = new ViewportEngine(containerRef.current, {
      onModelLoaded: (stats) => callbacksRef.current.onModelLoaded?.(stats),
      onLoadingProgress: (pct) => callbacksRef.current.onLoadingProgress?.(pct)
    });
    engineRef.current = engine;

    const handleResize = () => {
      engine.resize();
    };
    window.addEventListener('resize', handleResize);

    // Notify parent that the 3D viewport engine is ready
    if (callbacksRef.current.onReady) {
      callbacksRef.current.onReady();
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    loadModelFromUrl: async (url: string, fileType: string, modelName: string) => {
      if (!engineRef.current) {
        // Wait up to 500ms if engine is initializing
        for (let i = 0; i < 10 && !engineRef.current; i++) {
          await new Promise(r => setTimeout(r, 50));
        }
      }
      if (!engineRef.current) {
        throw new Error('Viewport engine not initialized.');
      }
      try {
        await engineRef.current.loadModelFromUrl(url, fileType, modelName);
      } catch (err: any) {
        if (callbacksRef.current.onError) {
          callbacksRef.current.onError(err.message || 'Failed to load model from URL');
        }
        throw err;
      }
    },
    loadModelFromFile: async (file: File) => {
      if (!engineRef.current) {
        for (let i = 0; i < 10 && !engineRef.current; i++) {
          await new Promise(r => setTimeout(r, 50));
        }
      }
      if (!engineRef.current) {
        throw new Error('Viewport engine not initialized.');
      }
      try {
        await engineRef.current.loadModelFromFile(file);
      } catch (err: any) {
        if (callbacksRef.current.onError) {
          callbacksRef.current.onError(err.message || 'Failed to load model file');
        }
        throw err;
      }
    },
    displayDiscretizedBricks: (bricks: PlacedBrick[], lattice: PlateLattice3D) => {
      if (engineRef.current) {
        engineRef.current.displayDiscretizedBricks(bricks, lattice);
      }
    },
    setViewMode: (mode: 'mesh' | 'lego' | 'both') => {
      if (engineRef.current) {
        engineRef.current.setViewMode(mode);
      }
    },
    clearBricks: () => {
      if (engineRef.current) {
        engineRef.current.clearBricks();
      }
    },
    getActiveModel: () => {
      return engineRef.current ? engineRef.current.getActiveModel() : null;
    },
    getEngine: () => engineRef.current
  }));

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (engineRef.current) {
        try {
          await engineRef.current.loadModelFromFile(file);
        } catch (err: any) {
          if (onError) onError(err.message || 'Failed to load dropped file');
        }
      }
    }
  };

  return (
    <div
      ref={containerRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        backgroundColor: '#1e222b',
        outline: isDragOver ? '2px dashed #2563eb' : 'none',
        outlineOffset: '-4px'
      }}
    />
  );
});

Viewport3D.displayName = 'Viewport3D';
