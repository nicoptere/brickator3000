/**
 * LegoGeometryFactory - Decoupled Procedural Geometry Generator for Three.js.
 *
 * Provides procedural generation & LRU caching for all authentic LEGO SYSTEM shapes:
 * - Studs (radius 6 LDU, height 4 LDU)
 * - Standard bricks and plates (1*1 to 2*8)
 * - Curved slopes (quarter-cylinder profile)
 * - Inverted slopes (concave underhang profile)
 * - 45° & 33° flat slopes and cheese slopes
 * - Macaroni curved quadrant tiles
 * - Radar dishes and domes
 * - Cones and cylinders
 */

import * as THREE from 'three';
import { PlacedBrick } from '../../engine/types';
import { LDU_STUD_PITCH, LDU_BRICK_HEIGHT } from '../../engine/connectivityDictionary';

export class LegoGeometryFactory {
  private static cache = new Map<string, THREE.BufferGeometry>();

  /**
   * Retrieves or creates reusable stud cylinder geometry.
   */
  public static getStudGeometry(): THREE.BufferGeometry {
    let geom = this.cache.get('stud');
    if (!geom) {
      geom = new THREE.CylinderGeometry(6, 6, 4, 16);
      this.cache.set('stud', geom);
    }
    return geom;
  }

  /**
   * Builds or retrieves procedural geometry for a placed brick.
   */
  public static getPieceGeometry(brick: PlacedBrick): THREE.BufferGeometry {
    const isQuarterTurn = brick.rotation === 90 || brick.rotation === 270;
    const baseWX = brick.baseSize ? brick.baseSize[0] : (isQuarterTurn ? brick.size[1] : brick.size[0]);
    const baseDZ = brick.baseSize ? brick.baseSize[1] : (isQuarterTurn ? brick.size[0] : brick.size[1]);
    const baseHY = brick.baseSize ? brick.baseSize[2] : brick.size[2];

    const widthLDU = baseWX * LDU_STUD_PITCH;
    const depthLDU = baseDZ * LDU_STUD_PITCH;
    const heightLDU = baseHY * LDU_BRICK_HEIGHT;

    const cacheKey = `${brick.partId}_${brick.profile}_${baseWX}x${baseDZ}x${baseHY}`;
    let geom = this.cache.get(cacheKey);
    if (geom) return geom;

    switch (brick.profile) {
      case 'slope_curved': {
        const shape = new THREE.Shape();
        const d = depthLDU;
        const h = heightLDU;
        const w = widthLDU;

        shape.moveTo(-d / 2, -h / 2);
        shape.lineTo(d / 2, -h / 2);
        shape.lineTo(d / 2, -h / 2 + Math.min(h * 0.33, 8));
        shape.quadraticCurveTo(0, h / 2, -d / 2 + Math.min(20, d * 0.5), h / 2);
        shape.lineTo(-d / 2, h / 2);
        shape.closePath();

        const ext = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
        ext.center();
        ext.rotateY(-Math.PI / 2);
        geom = ext;
        break;
      }

      case 'slope_inverted': {
        const shape = new THREE.Shape();
        const d = depthLDU;
        const h = heightLDU;
        const w = widthLDU;

        shape.moveTo(-d / 2, -h / 2);
        shape.lineTo(-d / 2 + Math.min(20, d * 0.5), -h / 2);
        shape.quadraticCurveTo(0, -h / 2, d / 2, h / 2);
        shape.lineTo(-d / 2, h / 2);
        shape.closePath();

        const ext = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
        ext.center();
        ext.rotateY(-Math.PI / 2);
        geom = ext;
        break;
      }

      case 'slope_45': {
        const shape = new THREE.Shape();
        const d = depthLDU;
        const h = heightLDU;
        const w = widthLDU;

        shape.moveTo(-d / 2, -h / 2);
        shape.lineTo(d / 2, -h / 2);
        shape.lineTo(-d / 2, h / 2);
        shape.closePath();

        const ext = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
        ext.center();
        ext.rotateY(-Math.PI / 2);
        geom = ext;
        break;
      }

      case 'slope_33':
      case 'cheese': {
        const shape = new THREE.Shape();
        const d = depthLDU;
        const h = heightLDU;
        const w = widthLDU;

        shape.moveTo(-d / 2, -h / 2);
        shape.lineTo(d / 2, -h / 2);
        shape.lineTo(d / 2, -h / 2 + 4);
        shape.lineTo(-d / 2, h / 2);
        shape.closePath();

        const ext = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
        ext.center();
        ext.rotateY(-Math.PI / 2);
        geom = ext;
        break;
      }

      case 'macaroni': {
        geom = new THREE.CylinderGeometry(widthLDU, widthLDU, heightLDU, 16, 1, false, 0, Math.PI / 2);
        geom.center();
        break;
      }

      case 'dish': {
        geom = new THREE.SphereGeometry(widthLDU / 2.0, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        geom.center();
        break;
      }

      case 'cone':
      case 'tooth_creature': {
        geom = new THREE.ConeGeometry(widthLDU / 2.0, heightLDU, 16);
        geom.center();
        break;
      }

      case 'tile_flat':
      case 'brick':
      case 'plate':
      default: {
        geom = new THREE.BoxGeometry(widthLDU, heightLDU, depthLDU);
        break;
      }
    }

    this.cache.set(cacheKey, geom);
    return geom;
  }

  public static clearCache(): void {
    this.cache.forEach((g) => g.dispose());
    this.cache.clear();
  }
}
