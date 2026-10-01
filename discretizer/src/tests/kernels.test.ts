import { KERNEL_CATALOG } from '../kernels/kernelCatalog';
import { generateKernelVariants } from '../kernels/kernelRotator';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`PASSED: ${msg}`);
}

async function runKernelTests() {
  console.log('--- Phase 2: Modern & Weird Parts Kernel Bank Tests ---\n');

  assert(KERNEL_CATALOG.length >= 18, `Kernel catalog contains ${KERNEL_CATALOG.length} base parts (>= 18)`);

  const variants = generateKernelVariants(KERNEL_CATALOG);
  console.log(`Generated ${variants.length} total rotated kernel variants.`);

  // Test 1: Isotropic 1x1 round cylinder (3062b) should have 1 rotation
  const v3062 = variants.filter(v => v.partId === '3062b');
  assert(v3062.length === 1, `Isotropic 1x1 cylinder (3062b) has 1 rotation (got ${v3062.length})`);

  // Test 2: Inverted Radar Dish 2x2 (4740) should have 1 rotation
  const v4740 = variants.filter(v => v.partId === '4740');
  assert(v4740.length === 1, `Isotropic Radar Dish 2x2 (4740) has 1 rotation (got ${v4740.length})`);

  // Test 3: Standard Rectangular Brick 2x4 (3001) should have 2 rotations (0, 90)
  const v3001 = variants.filter(v => v.partId === '3001');
  assert(v3001.length === 2, `2-fold symmetric Brick 2x4 (3001) has 2 rotations (got ${v3001.length})`);

  // Test 4: Directional Curved Slope 2x1 (11477) should have all 4 rotations
  const v11477 = variants.filter(v => v.partId === '11477');
  assert(v11477.length === 4, `Directional Curved Slope 2x1 (11477) has 4 rotations (got ${v11477.length})`);

  // Test 5: Verify 90 degree rotation bounding box swap
  const v11477_0 = v11477.find(v => v.rotation === 0)!;
  const v11477_90 = v11477.find(v => v.rotation === 90)!;
  assert(v11477_0.size[0] === 1 && v11477_0.size[1] === 2, 'Unrotated 11477 size is [1, 2, 3]');
  assert(v11477_90.size[0] === 2 && v11477_90.size[1] === 1, '90-deg rotated 11477 size is [2, 1, 3]');

  // Test 6: Verify rotated target normals
  // Unrotated: [0, 0.707, 0.707] (facing +Z and +Y)
  // At 90 deg: [-0.707, 0.707, 0] (facing -X and +Y)
  assert(Math.abs(v11477_90.targetNormal[0] - (-0.707)) < 0.01, 'Rotated normal points along -X at 90 deg');
  assert(Math.abs(v11477_90.targetNormal[2] - 0) < 0.01, 'Rotated normal Z component is 0 at 90 deg');

  // Test 7: Verify connector rotation counts
  assert(v11477_0.connectors.length === v11477_90.connectors.length, 'Connector counts preserved across rotations');

  console.log('\nALL PHASE 2 KERNEL BANK TESTS PASSED SUCCESSFULLY!');
}

runKernelTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
