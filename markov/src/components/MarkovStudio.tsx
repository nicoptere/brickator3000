import React from 'react';
import { useMarkovStudio, StudioLayout } from '../ui';

export const MarkovStudio: React.FC = () => {
  const studio = useMarkovStudio();
  return <StudioLayout {...studio} />;
};

export default MarkovStudio;
