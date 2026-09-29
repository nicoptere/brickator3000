/**
 * LegoMaterialFactory - Decoupled Material Generator for Three.js.
 *
 * Provides authentic ABS plastic PBR materials:
 * - Direct RGB hex materials with accurate roughness and specularity
 * - Highlight materials for newly placed bricks during animation
 * - Reusable material pooling
 */

import * as THREE from 'three';

export class LegoMaterialFactory {
  private static cache = new Map<string, THREE.MeshStandardMaterial>();

  public static getMaterial(colorHex: string, isHighlighted: boolean = false): THREE.MeshStandardMaterial {
    const key = `${colorHex.toLowerCase()}_${isHighlighted ? 'glow' : 'norm'}`;
    let mat = this.cache.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex),
        roughness: 0.28,
        metalness: 0.04,
        emissive: isHighlighted ? new THREE.Color(0x38bdf8) : new THREE.Color(0x000000),
        emissiveIntensity: isHighlighted ? 0.35 : 0
      });
      this.cache.set(key, mat);
    }
    return mat;
  }

  public static clearCache(): void {
    this.cache.forEach((m) => m.dispose());
    this.cache.clear();
  }
}
