import type { PlacedBrick } from '../core/types';

/**
 * Generates standard LDraw format model text file (.ldr)
 * Format: 1 <color> <x> <y> <z> <a> <b> <c> <d> <e> <f> <g> <h> <i> <part>.dat
 * Adheres strictly to Direct 24-bit RGB 'Cheat Mode' format: 0x2RRGGBB.
 */
export function generateLDrawScript(bricks: PlacedBrick[], modelName: string = 'model.ldr'): string {
  const lines: string[] = [
    '0 Brickator3000 Discretizer V2 Model',
    `0 Name: ${modelName}`,
    '0 Author: Brickator Surface-Growing Discretizer Engine',
    ''
  ];

  for (const b of bricks) {
    const [x, y, z] = b.ldrawPos;
    const [a, c, e, d, f, g, h, i, j] = b.ldrawMatrix;
    // Direct 24-bit RGB format: 0x2RRGGBB
    const ldrawColor = '0x2' + b.colorHex.replace('#', '').toUpperCase();
    lines.push(
      `1 ${ldrawColor} ${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)} ` +
      `${a} ${c} ${e} ${d} ${f} ${g} ${h} ${i} ${j} ${b.partId}.dat`
    );
  }

  return lines.join('\n');
}
