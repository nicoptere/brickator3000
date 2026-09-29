import * as THREE from 'three';

/**
 * Universal Gaussian Splat and Point Cloud Parser for .splat and .ply formats.
 * Extracts 3D positions, colors, and scales into a standard Three.js BufferGeometry.
 */
export class SplatLoader {
  /**
   * Parses raw ArrayBuffer of a .splat file (32 bytes per splat)
   */
  public static parseSplat(buffer: ArrayBuffer): THREE.BufferGeometry {
    const totalBytes = buffer.byteLength;
    const numSplats = Math.floor(totalBytes / 32);

    const positions = new Float32Array(numSplats * 3);
    const colors = new Float32Array(numSplats * 3);

    const dataView = new DataView(buffer);

    for (let i = 0; i < numSplats; i++) {
      const offset = i * 32;

      // Position: 3 x float32 (little endian)
      const x = dataView.getFloat32(offset + 0, true);
      const y = dataView.getFloat32(offset + 4, true);
      const z = dataView.getFloat32(offset + 8, true);

      // Color: 4 x uint8 (r, g, b, a) at offset + 24
      const r = dataView.getUint8(offset + 24) / 255.0;
      const g = dataView.getUint8(offset + 25) / 255.0;
      const b = dataView.getUint8(offset + 26) / 255.0;

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      colors[i * 3 + 0] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingBox();

    return geometry;
  }

  /**
   * Parses a Gaussian Splat PLY file (handling spherical harmonics f_dc_0..2 or vertex colors)
   */
  public static parseGaussianPly(buffer: ArrayBuffer): THREE.BufferGeometry {
    const textDecoder = new TextDecoder('ascii');
    // Read header up to "end_header\n"
    const headerBytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4096));
    const headerText = textDecoder.decode(headerBytes);
    const endHeaderIdx = headerText.indexOf('end_header');

    if (endHeaderIdx === -1) {
      throw new Error('Invalid PLY file: could not find end_header marker.');
    }

    const header = headerText.substring(0, endHeaderIdx);
    const lines = header.split('\n');

    let vertexCount = 0;
    const properties: { name: string; type: string }[] = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] === 'element' && parts[1] === 'vertex') {
        vertexCount = parseInt(parts[2], 10);
      } else if (parts[0] === 'property') {
        properties.push({ type: parts[1], name: parts[2] });
      }
    }

    // Binary data begins after "end_header\n"
    const headerEndOffset = endHeaderIdx + 'end_header\n'.length;
    const dataView = new DataView(buffer, headerEndOffset);

    // Compute bytes per vertex
    let bytesPerVertex = 0;
    for (const prop of properties) {
      if (prop.type === 'float' || prop.type === 'float32') bytesPerVertex += 4;
      else if (prop.type === 'uchar' || prop.type === 'uint8') bytesPerVertex += 1;
      else if (prop.type === 'double' || prop.type === 'float64') bytesPerVertex += 8;
      else if (prop.type === 'int' || prop.type === 'int32') bytesPerVertex += 4;
      else bytesPerVertex += 4; // default
    }

    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);

    const SH_C0 = 0.28209479177387814;

    let offset = 0;
    for (let i = 0; i < vertexCount; i++) {
      let curOffset = offset;
      let x = 0, y = 0, z = 0;
      let r = 0.8, g = 0.8, b = 0.8;

      for (const prop of properties) {
        if (prop.name === 'x') {
          x = dataView.getFloat32(curOffset, true);
        } else if (prop.name === 'y') {
          y = dataView.getFloat32(curOffset, true);
        } else if (prop.name === 'z') {
          z = dataView.getFloat32(curOffset, true);
        } else if (prop.name === 'red' || prop.name === 'diffuse_red') {
          r = dataView.getUint8(curOffset) / 255.0;
        } else if (prop.name === 'green' || prop.name === 'diffuse_green') {
          g = dataView.getUint8(curOffset) / 255.0;
        } else if (prop.name === 'blue' || prop.name === 'diffuse_blue') {
          b = dataView.getUint8(curOffset) / 255.0;
        } else if (prop.name === 'f_dc_0') {
          const sh = dataView.getFloat32(curOffset, true);
          r = Math.max(0, Math.min(1, 0.5 + SH_C0 * sh));
        } else if (prop.name === 'f_dc_1') {
          const sh = dataView.getFloat32(curOffset, true);
          g = Math.max(0, Math.min(1, 0.5 + SH_C0 * sh));
        } else if (prop.name === 'f_dc_2') {
          const sh = dataView.getFloat32(curOffset, true);
          b = Math.max(0, Math.min(1, 0.5 + SH_C0 * sh));
        }

        if (prop.type === 'float' || prop.type === 'float32' || prop.type === 'int' || prop.type === 'int32') {
          curOffset += 4;
        } else if (prop.type === 'uchar' || prop.type === 'uint8') {
          curOffset += 1;
        } else if (prop.type === 'double' || prop.type === 'float64') {
          curOffset += 8;
        } else {
          curOffset += 4;
        }
      }

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      colors[i * 3 + 0] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;

      offset += bytesPerVertex;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingBox();

    return geometry;
  }
}
