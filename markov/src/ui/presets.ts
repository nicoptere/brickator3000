import { getAssetUrl } from '../utils/url';
import { StudioModelPreset } from './types';

export const MODEL_PRESETS: Record<string, StudioModelPreset> = {
  'cars/vwbeetle.glb': { label: 'VW Beetle', url: getAssetUrl('models/clean/cars/vwbeetle.glb'), fallbackType: 'car' },
  beetle: { label: 'VW Beetle', url: getAssetUrl('models/clean/cars/vwbeetle.glb'), fallbackType: 'car' },
  vwbeetle: { label: 'VW Beetle', url: getAssetUrl('models/clean/cars/vwbeetle.glb'), fallbackType: 'car' },
  'architecture/nordstad.glb': { label: 'Nordstad', url: getAssetUrl('models/clean/architecture/nordstad.glb'), fallbackType: 'dome_creature' },
  nordstad: { label: 'Nordstad', url: getAssetUrl('models/clean/architecture/nordstad.glb'), fallbackType: 'dome_creature' },
  mini: { label: 'Mini Cooper', url: getAssetUrl('models/clean/cars/mini.glb'), fallbackType: 'car' },
  concorde: { label: 'Concorde', url: getAssetUrl('models/clean/airplanes/concord.glb'), fallbackType: 'airplane' },
  duck: { label: 'Duck', url: getAssetUrl('sample_models/duck.glb'), fallbackType: 'duck' },
  dolphin: { label: 'Dolphin', url: getAssetUrl('sample_models/dolphin.glb'), fallbackType: 'dolphin' },
  delacroix: { label: 'Delacroix', url: getAssetUrl('sample_models/delacroix_low_poly.ply'), fallbackType: 'dome_creature' },
  prison: { label: 'Castle', url: getAssetUrl('sample_models/prison_0.obj'), fallbackType: 'dome_creature' }
};

export const PHASE_LABELS: Record<string, { title: string; color: string }> = {
  SURFACE_SHELL: { title: '1. WFC Exterior Skin (N = 2)', color: '#2563eb' },
  CORE_INFILL: { title: '2. Macro Structural Core (N = 8, 4)', color: '#2563eb' },
  TILE_FINISH: { title: '3. Studless Top Finish (N = 0)', color: '#2563eb' },
  POLISH_HARMONIZATION: { title: '4. Polish & Harmonization', color: '#2563eb' },
  BUILDABILITY_VERIFY: { title: '5. Buildability BFS Check', color: '#2563eb' },
  DONE: { title: '6. Build Complete', color: '#2563eb' }
};
