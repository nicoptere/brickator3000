/**
 * LDraw File Exporter (.ldr) with Direct 24-bit RGB Sampling ("Cheat Mode").
 *
 * Adheres strictly to GEMINI.md:
 * - 0x2RRGGBB direct hex sampling: `1 0x2RRGGBB X Y Z a b c d e f g h i <partId>.dat`
 * - Three.js Y-up to LDraw Y-down mapping
 * - Groups by growth phases with `0 STEP` annotations
 */

import { PlacedBrick } from './types';

export class LDrawExporter {
  public static exportToLDraw(
    bricks: PlacedBrick[],
    modelTitle: string = 'Brickator3000_Markov_Build',
    directRGB: boolean = true
  ): string {
    const lines: string[] = [
      `0 FILE ${modelTitle}.ldr`,
      `0 ${modelTitle}`,
      `0 Author: Brickator3000 Markov Growing Core Engine`,
      `0 !LDRAW_ORG Model`,
      `0 BFC CERTIFY CCW`,
      `0 // Total Elements: ${bricks.length}`,
      `0`
    ];

    let currentPhase = '';

    for (const brick of bricks) {
      if (brick.growthPhase !== currentPhase) {
        currentPhase = brick.growthPhase;
        lines.push(`0 // Phase: ${currentPhase}`);
        lines.push(`0 STEP`);
      }

      // Color specifier
      let colorToken: string;
      if (directRGB && brick.colorHex) {
        const hex = brick.colorHex.replace('#', '').toUpperCase().padStart(6, '0');
        colorToken = `0x2${hex}`;
      } else {
        colorToken = brick.colorCode.toString();
      }

      // Coordinates: Three.js Y-up maps to LDraw Y-down
      const [x, y, z] = brick.ldrawPos;
      const m = brick.matrix;

      // Line format: 1 <color> X Y Z a b c d e f g h i <partId>.dat
      lines.push(
        `1 ${colorToken} ${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)} ` +
        `${m[0]} ${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]} ${m[6]} ${m[7]} ${m[8]} ${brick.partId}.dat`
      );
    }

    lines.push(`0 NOFILE`);
    return lines.join('\n');
  }

  public static downloadLDrawFile(content: string, filename: string = 'markov_model.ldr'): void {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
