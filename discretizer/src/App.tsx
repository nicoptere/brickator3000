import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ConfigProvider, App as AntApp, message } from 'antd';
import { Viewport3D, type Viewport3DHandle } from './viewport/Viewport3D';
import {
  ModelSelectorPanel,
  SAMPLE_MODELS,
  type SampleModelItem,
  type CleanModelItem
} from './components/ModelSelectorPanel';
import type { ModelStats } from './viewport/viewportEngine';
import { getAssetUrl } from './url';

export const MainApp: React.FC = () => {
  const viewportRef = useRef<Viewport3DHandle | null>(null);
  const [modelStats, setModelStats] = useState<ModelStats | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const { message: antMessage } = AntApp.useApp();

  const handleSelectSampleModel = useCallback(async (model: SampleModelItem) => {
    if (!viewportRef.current) return;
    setIsLoading(true);
    try {
      if (model.type.startsWith('procedural')) {
        await viewportRef.current.loadModelFromUrl('', model.type, model.label);
      } else {
        const url = getAssetUrl(model.path);
        await viewportRef.current.loadModelFromUrl(url, model.type, model.label);
      }
    } catch (err: any) {
      antMessage.error(err.message || 'Failed to load sample model');
    } finally {
      setIsLoading(false);
    }
  }, [antMessage]);

  const handleSelectCleanModel = useCallback(async (model: CleanModelItem) => {
    if (!viewportRef.current) return;
    setIsLoading(true);
    try {
      const url = getAssetUrl(model.path);
      await viewportRef.current.loadModelFromUrl(url, 'glb', model.name);
    } catch (err: any) {
      antMessage.error(err.message || 'Failed to load clean model');
    } finally {
      setIsLoading(false);
    }
  }, [antMessage]);

  const handleUploadFile = useCallback(async (file: File) => {
    if (!viewportRef.current) return;
    setIsLoading(true);
    try {
      await viewportRef.current.loadModelFromFile(file);
      antMessage.success(`Loaded ${file.name}`);
    } catch (err: any) {
      antMessage.error(err.message || 'Failed to load custom file');
    } finally {
      setIsLoading(false);
    }
  }, [antMessage]);

  // Load default duck model on mount
  useEffect(() => {
    const initialModel = SAMPLE_MODELS[0];
    if (initialModel) {
      handleSelectSampleModel(initialModel);
    }
  }, [handleSelectSampleModel]);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <Viewport3D
        ref={viewportRef}
        onModelLoaded={(stats) => setModelStats(stats)}
        onError={(err) => antMessage.error(err)}
      />
      <ModelSelectorPanel
        onSelectSampleModel={handleSelectSampleModel}
        onSelectCleanModel={handleSelectCleanModel}
        onUploadFile={handleUploadFile}
        modelStats={modelStats}
        isLoading={isLoading}
      />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#2563eb',
          borderRadius: 6,
          colorBgContainer: '#ffffff',
          colorBgElevated: '#f8fafc',
          colorBorder: '#e2e8f0',
          colorText: '#0f172a',
          colorTextSecondary: '#64748b'
        }
      }}
    >
      <AntApp>
        <MainApp />
      </AntApp>
    </ConfigProvider>
  );
};

export default App;
