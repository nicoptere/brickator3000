import React from 'react';
import { Viewport3D } from '../../components/Viewport3D';
import { LeftDrawer } from '../../components/LeftDrawer';
import { RightDrawer } from '../../components/RightDrawer';
import { ModelStatsOverlay } from '../../components/controls/ModelStatsOverlay';
import { StudioHud } from './StudioHud';
import { AutoModeOverlay } from './AutoModeOverlay';
import { StudioModals } from './StudioModals';
import { useMarkovStudio } from '../hooks/useMarkovStudio';

export type StudioLayoutProps = ReturnType<typeof useMarkovStudio>;

export const StudioLayout: React.FC<StudioLayoutProps> = (props) => {
  const {
    modelType,
    targetHeightBricks,
    sourceMeshMode,
    handleUserChangeSourceMeshMode,
    colorMode,
    setColorMode,
    selectedIslandId,
    setSelectedIslandId,
    isLeftDrawerOpen,
    setIsLeftDrawerOpen,
    isRightDrawerOpen,
    setIsRightDrawerOpen,
    themeMode,
    setThemeMode,
    speed,
    setSpeed,
    isAudioMuted,
    handleToggleAudio,
    isDatabaseOpen,
    setIsDatabaseOpen,
    isGalleryOpen,
    setIsGalleryOpen,
    isLoading,
    loadingMessage,
    preprocessState,
    sourceModel,
    grid,
    bricks,
    currentStepIndex,
    isPlaying,
    setIsPlaying,
    phase,
    currentPhaseInfo,
    options,
    stats,
    omrCategory,
    distanceMetric,
    buildabilityReport,
    harmonizationResult,
    uploadedModels,
    isAutoMode,
    tweenKey,
    handleToggleAuto,
    handleSelectModel,
    handleChangeHeight,
    handleChangeOptions,
    handleChangeOmrCategory,
    handleFileUpload,
    handleSelectUploadedModel,
    handleReloadUploadedModel,
    handleHarmonizeNeighborhoods,
    handleVerifyBuildability,
    handleEvaluateDistance,
    handleDiscretizeIsland,
    handleDiscretizeAllIndependently,
    handleSolveWfcOnIsland,
    handleRerollColors,
    handleReset,
    handleExportLDR
  } = props;

  return (
    <div
      style={{
        display: 'flex',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: '#f8fafc',
        color: '#0f172a',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        position: 'relative'
      }}
    >
      {/* 1. Left Drawer Panel: SEC 1 (Model Selector) & SEC 2 (Params & Islands) */}
      <LeftDrawer
        isOpen={isLeftDrawerOpen}
        onToggleOpen={() => setIsLeftDrawerOpen(!isLeftDrawerOpen)}
        currentModelId={modelType}
        onSelectModel={handleSelectModel}
        onFileUpload={handleFileUpload}
        uploadedModels={uploadedModels}
        onSelectUploadedModel={handleSelectUploadedModel}
        onReloadUploadedModel={handleReloadUploadedModel}
        voxelizeMode={options.voxelizeMode || 'surface'}
        onChangeVoxelizeMode={(m) => handleChangeOptions({ voxelizeMode: m })}
        sourceMeshMode={sourceMeshMode}
        onChangeSourceMeshMode={handleUserChangeSourceMeshMode}
        colorMode={colorMode}
        onChangeColorMode={setColorMode}
        islands={grid?.islands}
        selectedIslandId={selectedIslandId}
        onSelectIsland={setSelectedIslandId}
        onDiscretizeIsland={handleDiscretizeIsland}
        onDiscretizeAllIndependently={handleDiscretizeAllIndependently}
        onSolveWfcOnIsland={handleSolveWfcOnIsland}
        onRerollColors={handleRerollColors}
        isLoading={isLoading}
      />

      {/* 2. Center 3D Viewport Area */}
      <div style={{ flex: '1 1 0%', minWidth: 0, height: '100%', position: 'relative', overflow: 'hidden' }}>
        <Viewport3D
          bricks={bricks}
          grid={grid}
          currentStepIndex={currentStepIndex}
          sourceModel={sourceModel}
          sourceMeshMode={sourceMeshMode}
          colorMode={colorMode}
          selectedIslandId={selectedIslandId}
          isLoading={isLoading && !isAutoMode}
          loadingMessage={loadingMessage}
          themeMode={themeMode}
          autoRotate={isAutoMode}
          tweenKey={tweenKey}
          isAudioMuted={isAudioMuted}
          onToggleAudio={handleToggleAudio}
        />

        {/* Floating Top HUD and Drawer Toggles */}
        <StudioHud
          isLeftDrawerOpen={isLeftDrawerOpen}
          onOpenLeftDrawer={() => setIsLeftDrawerOpen(true)}
          isRightDrawerOpen={isRightDrawerOpen}
          onOpenRightDrawer={() => setIsRightDrawerOpen(true)}
          currentPhaseTitle={currentPhaseInfo.title}
          stats={stats}
        />

        {/* Bottom-Left Built Model Stats Panel */}
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: 16,
            zIndex: 25,
            pointerEvents: 'auto'
          }}
        >
          <ModelStatsOverlay
            bricks={bricks}
            grid={grid}
            buildabilityReport={buildabilityReport}
            harmonizationResult={harmonizationResult}
            distanceMetric={distanceMetric}
            phase={phase}
          />
        </div>

        {/* Bottom-Right Auto Mode Toggle Button */}
        <AutoModeOverlay isAutoMode={isAutoMode} onToggleAuto={handleToggleAuto} />
      </div>

      {/* 3. Right Drawer Panel: SEC 3 (Pipeline Stats) & SEC 4 (Playback & Rules) */}
      <RightDrawer
        isOpen={isRightDrawerOpen}
        onToggleOpen={() => setIsRightDrawerOpen(!isRightDrawerOpen)}
        targetHeightBricks={targetHeightBricks}
        onChangeHeight={handleChangeHeight}
        options={options}
        onChangeOptions={handleChangeOptions}
        isPlaying={isPlaying}
        onTogglePlay={() => {
          if (!isPlaying && phase === 'DONE') {
            handleReset();
            return;
          }
          if (!isPlaying && bricks.length === 0) {
            setColorMode('island_components');
          }
          setIsPlaying(!isPlaying);
        }}
        onReset={handleReset}
        onExportLDR={handleExportLDR}
        themeMode={themeMode}
        onToggleThemeMode={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
        speed={speed}
        onChangeSpeed={setSpeed}
        isLoading={isLoading}
        loadingMessage={loadingMessage}
        omrCategory={omrCategory}
        onChangeOmrCategory={handleChangeOmrCategory}
        onHarmonizeNeighborhoods={handleHarmonizeNeighborhoods}
        onVerifyBuildability={handleVerifyBuildability}
        onEvaluateDistance={handleEvaluateDistance}
        distanceMetric={distanceMetric}
        buildabilityReport={buildabilityReport}
        harmonizationResult={harmonizationResult}
      />

      {/* Inspectors & Popin */}
      <StudioModals
        isDatabaseOpen={isDatabaseOpen}
        onCloseDatabase={() => setIsDatabaseOpen(false)}
        isGalleryOpen={isGalleryOpen}
        onCloseGallery={() => setIsGalleryOpen(false)}
        preprocessState={preprocessState}
      />
    </div>
  );
};
