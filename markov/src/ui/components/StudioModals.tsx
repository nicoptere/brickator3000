import React from 'react';
import { ConnectorDatabaseInspector } from '../../components/ConnectorDatabaseInspector';
import { OMRGalleryInspector } from '../../components/OMRGalleryInspector';
import { MeshPreprocessModal } from '../../components/common/MeshPreprocessModal';
import { PreprocessState } from '../types';

interface StudioModalsProps {
  isDatabaseOpen: boolean;
  onCloseDatabase: () => void;
  isGalleryOpen: boolean;
  onCloseGallery: () => void;
  preprocessState: PreprocessState;
}

export const StudioModals: React.FC<StudioModalsProps> = ({
  isDatabaseOpen,
  onCloseDatabase,
  isGalleryOpen,
  onCloseGallery,
  preprocessState
}) => {
  return (
    <>
      <ConnectorDatabaseInspector isOpen={isDatabaseOpen} onClose={onCloseDatabase} />
      <OMRGalleryInspector isOpen={isGalleryOpen} onClose={onCloseGallery} />
      <MeshPreprocessModal
        isOpen={preprocessState.isOpen}
        modelName={preprocessState.modelName}
        progressPercent={preprocessState.progressPercent}
        stageTitle={preprocessState.stageTitle}
        stageDetail={preprocessState.stageDetail}
        currentStageIndex={preprocessState.currentStageIndex}
        detectedIslands={preprocessState.detectedIslands}
      />
    </>
  );
};
