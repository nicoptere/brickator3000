import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, installDOM } from '@onirenaud/node-webgl';

installDOM();
if (typeof globalThis.ProgressEvent === 'undefined') {
  globalThis.ProgressEvent = class ProgressEvent extends Event {
    constructor(type, initDict = {}) {
      super(type, initDict);
      this.loaded = initDict.loaded || 0;
      this.total = initDict.total || 0;
      this.lengthComputable = !!initDict.lengthComputable;
    }
  };
}
if (typeof globalThis.length === 'undefined') {
  globalThis.length = 0;
}

import * as THREE from 'three';
import { WebGLPathTracer } from 'three-gpu-pathtracer';
import {
  StudioScene,
  MaterialFactory,
  LDrawModelLoader,
  ProceduralTextures,
  ContactGrounding,
  MultiPartClusterRenderer,
  LEGO_PALETTE
} from './core/index.js';

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const found = args.find(a => a.startsWith(`--${name}=`));
  return found ? found.split('=')[1] : def;
};

const workerId = parseInt(getArg('workerId', '0'), 10);
const width = parseInt(getArg('width', '256'), 10);
const height = parseInt(getArg('height', '256'), 10);
const samples = parseInt(getArg('samples', '64'), 10);
const singleOutDir = getArg('singleOutDir', './dataset/single');
const yoloImagesDir = getArg('yoloImagesDir', './dataset/yolo/images/train');
const yoloLabelsDir = getArg('yoloLabelsDir', './dataset/yolo/labels/train');
const cropsOutDir = getArg('cropsOutDir', './dataset/crops');
const ldrawPath = getArg('ldrawPath', 'http://localhost:3005/ldraw/');

// 1. Initialize Single-Part Engine
const canvas = createCanvas(width, height);
const gl = canvas.getContext('webgl2');
const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false, powerPreference: 'high-performance' });
renderer.setSize(width, height, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;

const pathTracer = new WebGLPathTracer(renderer);
pathTracer.bounces = 4;
pathTracer.renderDelay = 0;
pathTracer.fadeDuration = 0;
pathTracer.minSamples = 1;

const normalNoiseTex = ProceduralTextures.generateNormalNoiseTexture(256, 1.4);
const matFactory = new MaterialFactory(normalNoiseTex);
const studioScene = new StudioScene(3000);
const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 5000);
const modelLoader = new LDrawModelLoader(ldrawPath);

const FLOOR_TYPES = ['wood', 'stone', 'plastic', 'felt', 'tile'];
const CACHED_FLOOR_TEXTURES = [];
for (let fIdx = 0; fIdx < FLOOR_TYPES.length; fIdx++) {
  for (let seedOffset = 0; seedOffset < 3; seedOffset++) {
    const fType = FLOOR_TYPES[fIdx];
    const tex = ProceduralTextures.generateBackgroundTexture(fType, 1000 + fIdx * 100 + seedOffset * 37, 512, '#3a3e45');
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(24, 24);
    tex.needsUpdate = true;
    CACHED_FLOOR_TEXTURES.push(tex);
  }
}

const STABLE_ORIENTATIONS = [
  { name: 'Studs Up (Flat Base)', rot: [0, 0, 0] },
  { name: 'Studs Down (Inverted)', rot: [Math.PI, 0, 0] },
  { name: 'Long Side Flat', rot: [Math.PI / 2, 0, 0] },
  { name: 'Opposite Long Side', rot: [-Math.PI / 2, 0, 0] },
  { name: 'Short End Side', rot: [0, 0, Math.PI / 2] },
  { name: 'Opposite Short End', rot: [0, 0, -Math.PI / 2] }
];

const BASE_16_ANGLES = [
  { elev: 35, azim: 45 }, { elev: 65, azim: 45 }, { elev: 35, azim: 135 }, { elev: 25, azim: 90 },
  { elev: 35, azim: 225 }, { elev: 75, azim: 0 }, { elev: 35, azim: 315 }, { elev: 22, azim: 0 },
  { elev: 45, azim: 30 }, { elev: 55, azim: 120 }, { elev: 40, azim: 210 }, { elev: 30, azim: 300 },
  { elev: 50, azim: 60 }, { elev: 40, azim: 150 }, { elev: 60, azim: 240 }, { elev: 35, azim: 330 }
];

const EXTRA_48_ANGLES = [];
const ELEVATION_TIERS = [24, 42, 62, 80];
for (let t = 0; t < ELEVATION_TIERS.length; t++) {
  const elev = ELEVATION_TIERS[t];
  const azimOffset = (t * 15) % 360;
  for (let a = 0; a < 12; a++) {
    const azim = Math.round((azimOffset + a * 30) % 360);
    EXTRA_48_ANGLES.push({ elev, azim });
  }
}
const SHOT_ANGLES_64 = [...BASE_16_ANGLES, ...EXTRA_48_ANGLES];

let isCompilingFirst = true;

// 2. Initialize Cluster Engine
const clusterCanvas = createCanvas(width, height);
const clusterRenderer = new MultiPartClusterRenderer({
  canvas: clusterCanvas,
  width,
  height,
  samples,
  ldrawPath
});

async function renderSinglePart(job) {
  const { partId, shotCount = 16 } = job;
  const partDir = path.join(singleOutDir, partId);
  if (!fs.existsSync(partDir)) {
    fs.mkdirSync(partDir, { recursive: true });
  }

  const existing = fs.readdirSync(partDir).filter(f => f.endsWith('.png'));
  if (existing.length >= shotCount) {
    return { partId, rendered: 0, skipped: true };
  }

  let modelData;
  try {
    modelData = await modelLoader.load(partId);
  } catch (err) {
    return { partId, rendered: 0, error: err.message };
  }

  let renderedCount = 0;

  for (let shotIdx = 0; shotIdx < shotCount; shotIdx++) {
    const outImgPath = path.join(partDir, `view_${String(shotIdx).padStart(2, '0')}.png`);
    if (fs.existsSync(outImgPath)) continue;

    // Independent random color from 15-color palette
    const colorObj = LEGO_PALETTE[(parseInt(partId, 10) * 7 + shotIdx) % LEGO_PALETTE.length] || LEGO_PALETTE[shotIdx % LEGO_PALETTE.length];
    const plasticMat = matFactory.createPlasticMaterial(colorObj.hex);
    matFactory.applyToModel(modelData.model, plasticMat);
    studioScene.setModel(modelData.model);

    // Stable face orientation
    const face = STABLE_ORIENTATIONS[shotIdx % STABLE_ORIENTATIONS.length];
    const yaw = ((shotIdx * 73) % 360) * (Math.PI / 180);
    const perturbX = ((shotIdx % 5) - 2) * 0.025;
    const perturbZ = (((shotIdx * 3) % 5) - 2) * 0.025;
    const rx = face.rot[0] + perturbX;
    const ry = face.rot[1] + yaw;
    const rz = face.rot[2] + perturbZ;

    const bounds = ContactGrounding.alignLowestSegmentToGround(modelData.model, rx, ry, rz, { settleToFace: true });

    // Proper framing
    const fovRad = (camera.fov * Math.PI) / 180;
    const fitDist = (bounds.sphere.radius * 1.35) / Math.sin(fovRad / 2);
    const cfg = SHOT_ANGLES_64[shotIdx % SHOT_ANGLES_64.length];
    const elevRad = (cfg.elev * Math.PI) / 180;
    const azimRad = (cfg.azim * Math.PI) / 180;

    const cx = fitDist * Math.cos(elevRad) * Math.sin(azimRad);
    const cy = Math.max(bounds.sphere.radius * 0.4, fitDist * Math.sin(elevRad));
    const cz = fitDist * Math.cos(elevRad) * Math.cos(azimRad);
    camera.position.set(cx, cy, cz);
    camera.lookAt(0, bounds.sphere.radius * 0.35, 0);
    camera.updateMatrixWorld(true);

    // Soft lighting
    studioScene.randomizeLighting(bounds.sphere.radius, () => 0.5, shotIdx % 4);
    studioScene.keyLight.intensity = Math.max(3.5, studioScene.keyLight.intensity * 0.85);
    studioScene.rimLight.intensity = Math.max(1.8, studioScene.rimLight.intensity * 0.85);

    // Repeating floor texture from cached pool
    const floorTex = CACHED_FLOOR_TEXTURES[shotIdx % CACHED_FLOOR_TEXTURES.length];
    studioScene.setFloorMaterial(floorTex);
    studioScene.setFloorRoughness(0.55);
    studioScene.setFloorMetalness(0.15);

    pathTracer.setScene(studioScene.scene, camera);
    pathTracer.reset();

    if (isCompilingFirst) {
      pathTracer.renderSample();
      if (pathTracer._pathTracer && pathTracer._pathTracer._compilePromise) {
        await pathTracer._pathTracer._compilePromise;
      }
      pathTracer.reset();
      isCompilingFirst = false;
    }

    while (pathTracer.samples < samples) {
      pathTracer.renderSample();
    }

    const pngBuf = canvas.toBuffer('image/png');
    fs.writeFileSync(outImgPath, pngBuf);
    renderedCount++;
  }

  return { partId, rendered: renderedCount, skipped: false };
}

async function renderClusterJob(job) {
  const { sceneId, partIds } = job;
  const imgName = `scene_${String(sceneId).padStart(4, '0')}`;
  const outImgPath = path.join(yoloImagesDir, `${imgName}.png`);
  const outLblPath = path.join(yoloLabelsDir, `${imgName}.txt`);

  if (fs.existsSync(outImgPath) && fs.existsSync(outLblPath)) {
    return { sceneId, instances: 0, skipped: true };
  }

  const configs = partIds.map((pid, idx) => ({
    partId: pid,
    colorHex: LEGO_PALETTE[(sceneId * 5 + idx) % LEGO_PALETTE.length].hex
  }));

  const res = await clusterRenderer.renderClusterScene(configs, sceneId);

  // 1. Save scene image
  fs.writeFileSync(outImgPath, res.beautyPng);

  // 2. Save YOLO polygon labels (class 0: lego_brick)
  const labelLines = [];
  for (const inst of res.instances) {
    const coordsStr = inst.polygonNorm.map(v => v.toFixed(5)).join(' ');
    labelLines.push(`0 ${coordsStr}`);

    // Save crop for BrickNet
    if (inst.visiblePixels >= 50) {
      const partCropDir = path.join(cropsOutDir, inst.partId);
      if (!fs.existsSync(partCropDir)) fs.mkdirSync(partCropDir, { recursive: true });
      const cropMetaPath = path.join(partCropDir, `crop_${imgName}_inst${inst.instanceId}.json`);
      fs.writeFileSync(cropMetaPath, JSON.stringify({
        sceneId,
        partId: inst.partId,
        colorHex: inst.colorHex,
        visiblePixels: inst.visiblePixels,
        bbox: inst.bbox,
        yoloBbox: inst.yoloBbox
      }));
    }
  }

  fs.writeFileSync(outLblPath, labelLines.join('\n'));
  return { sceneId, instances: res.instances.length, skipped: false };
}

// IPC Message handling
process.on('message', async (msg) => {
  if (msg.type === 'render_single') {
    try {
      const res = await renderSinglePart(msg.job);
      process.send({ type: 'single_done', result: res });
    } catch (err) {
      process.send({ type: 'single_done', result: { partId: msg.job.partId, error: err.message } });
    }
  } else if (msg.type === 'render_cluster') {
    try {
      const res = await renderClusterJob(msg.job);
      process.send({ type: 'cluster_done', result: res });
    } catch (err) {
      process.send({ type: 'cluster_done', result: { sceneId: msg.job.sceneId, error: err.message } });
    }
  } else if (msg.type === 'exit') {
    process.exit(0);
  }
});

process.send({ type: 'ready', workerId });
