import { fork, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLASSES_FILE = path.resolve(__dirname, '../config/class_indices.json');
const DATASET_BASE = path.resolve(__dirname, '../dataset');
const SINGLE_OUT_DIR = path.join(DATASET_BASE, 'single');
const YOLO_IMAGES_DIR = path.join(DATASET_BASE, 'yolo', 'images', 'train');
const YOLO_LABELS_DIR = path.join(DATASET_BASE, 'yolo', 'labels', 'train');
const CROPS_OUT_DIR = path.join(DATASET_BASE, 'crops');
const REPORT_FILE = path.join(DATASET_BASE, 'generation_report.json');
const WORKER_SCRIPT = path.resolve(__dirname, 'worker.js');
const SERVER_SCRIPT = path.resolve(__dirname, 'server.js');

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const found = args.find(a => a.startsWith(`--${name}=`));
  return found ? found.split('=')[1] : def;
};

const CONCURRENCY = parseInt(getArg('concurrency', '4'), 10);
const SHOTS_PER_PART = parseInt(getArg('shots', '16'), 10);
const CLUSTER_SCENES = parseInt(getArg('scenes', '100'), 10);
const SAMPLES = parseInt(getArg('samples', '64'), 10);
const RESOLUTION = parseInt(getArg('resolution', '256'), 10);
const PORT = parseInt(getArg('port', '3005'), 10);

async function main() {
  console.log('================================================================');
  console.log(' ★ BRICKATOR 3000: HEADLESS 3D SYNTHETIC DATASET GENERATOR');
  console.log('================================================================');
  console.log(`  Concurrency        : ${CONCURRENCY} parallel workers`);
  console.log(`  Single-Part Target : 936 classes x ${SHOTS_PER_PART} views`);
  console.log(`  Multi-Part Target  : ${CLUSTER_SCENES} multi-brick cluster scenes`);
  console.log(`  Resolution & SPP   : ${RESOLUTION}x${RESOLUTION} @ ${SAMPLES} SPP`);
  console.log(`  Dataset Dir        : ${DATASET_BASE}`);
  console.log('================================================================\n');

  [SINGLE_OUT_DIR, YOLO_IMAGES_DIR, YOLO_LABELS_DIR, CROPS_OUT_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  // Start background LDraw static HTTP server
  console.log(`[*] Starting background LDraw server on port ${PORT}...`);
  const serverProc = spawn('node', [SERVER_SCRIPT], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
    detached: true
  });
  serverProc.unref();

  // Wait 1s for server to bind
  await new Promise(r => setTimeout(r, 1000));

  const classesMeta = JSON.parse(fs.readFileSync(CLASSES_FILE, 'utf8'));
  const classes = classesMeta.classes; // 936 classes

  // 1. Build Single-Part Job Queue
  const singleJobs = classes.map((partId) => ({
    partId,
    shotCount: SHOTS_PER_PART
  }));

  // 2. Build Multi-Part Cluster Job Queue
  const clusterJobs = [];
  for (let s = 0; s < CLUSTER_SCENES; s++) {
    const partCount = 3 + Math.floor(((s * 7) % 4)); // 3 to 6 parts
    const sceneParts = [];
    for (let p = 0; p < partCount; p++) {
      const pIdx = (s * 13 + p * 37) % classes.length;
      sceneParts.push(classes[pIdx]);
    }
    clusterJobs.push({ sceneId: s, partIds: sceneParts });
  }

  const totalSingleParts = singleJobs.length;
  let singleCompleted = 0, singleRenderedFrames = 0, singleSkipped = 0;
  let clusterCompleted = 0, clusterInstances = 0, clusterSkipped = 0;
  let singleJobIdx = 0, clusterJobIdx = 0;

  const tStart = Date.now();

  return new Promise((resolve) => {
    const workers = [];
    let activeWorkers = 0;

    function dispatchJob(w) {
      if (singleJobIdx < singleJobs.length) {
        const job = singleJobs[singleJobIdx++];
        w.send({ type: 'render_single', job });
      } else if (clusterJobIdx < clusterJobs.length) {
        const job = clusterJobs[clusterJobIdx++];
        w.send({ type: 'render_cluster', job });
      } else {
        w.send({ type: 'exit' });
      }
    }

    for (let i = 0; i < CONCURRENCY; i++) {
      const workerArgs = [
        `--workerId=${i}`,
        `--width=${RESOLUTION}`,
        `--height=${RESOLUTION}`,
        `--samples=${SAMPLES}`,
        `--singleOutDir=${SINGLE_OUT_DIR}`,
        `--yoloImagesDir=${YOLO_IMAGES_DIR}`,
        `--yoloLabelsDir=${YOLO_LABELS_DIR}`,
        `--cropsOutDir=${CROPS_OUT_DIR}`,
        `--ldrawPath=http://localhost:${PORT}/ldraw/`
      ];

      const w = fork(WORKER_SCRIPT, workerArgs);
      activeWorkers++;

      w.on('message', (msg) => {
        if (msg.type === 'ready') {
          dispatchJob(w);
        } else if (msg.type === 'single_done') {
          singleCompleted++;
          if (msg.result.skipped) singleSkipped++;
          else singleRenderedFrames += (msg.result.rendered || 0);

          if (singleCompleted % 20 === 0 || singleCompleted === totalSingleParts) {
            const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
            console.log(`[Single] Progress: ${singleCompleted}/${totalSingleParts} parts (${singleRenderedFrames} frames, ${singleSkipped} skipped) [${elapsed}s]`);
          }
          dispatchJob(w);
        } else if (msg.type === 'cluster_done') {
          clusterCompleted++;
          if (msg.result.skipped) clusterSkipped++;
          else clusterInstances += (msg.result.instances || 0);

          if (clusterCompleted % 25 === 0 || clusterCompleted === CLUSTER_SCENES) {
            const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
            console.log(`[Cluster] Progress: ${clusterCompleted}/${CLUSTER_SCENES} scenes (${clusterInstances} instances) [${elapsed}s]`);
          }
          dispatchJob(w);
        }
      });

      w.on('exit', () => {
        activeWorkers--;
        if (activeWorkers === 0) {
          const totalSec = ((Date.now() - tStart) / 1000).toFixed(1);
          console.log('\n================================================================');
          console.log(' ★ DATASET GENERATION COMPLETE ★');
          console.log(`  Wall-Clock Time    : ${totalSec}s`);
          console.log(`  Single Frames      : ${singleRenderedFrames}`);
          console.log(`  Cluster Scenes     : ${clusterCompleted} (${clusterInstances} instances)`);
          console.log('================================================================\n');

          fs.writeFileSync(REPORT_FILE, JSON.stringify({
            timestamp: new Date().toISOString(),
            wallClockSec: totalSec,
            singleFramesRendered: singleRenderedFrames,
            clusterScenesGenerated: clusterCompleted,
            clusterInstances
          }, null, 2));

          try { process.kill(-serverProc.pid); } catch (_) {}
          resolve();
        }
      });

      workers.push(w);
    }
  });
}

main().catch(err => {
  console.error('[!] Fatal error in generator supervisor:', err);
  process.exit(1);
});
