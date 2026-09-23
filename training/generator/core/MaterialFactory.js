import * as THREE from 'three';

/**
 * MaterialFactory: Creates physically accurate ABS plastic materials
 * with Subsurface Scattering (SSS) and manages the official LEGO color palette.
 */
export class MaterialFactory {
  /**
   * @param {THREE.Texture} [normalMap]
   */
  constructor(normalMap = null) {
    this.normalMap = normalMap;
    this.roughness = 0.68; // Set to 0.68 as requested
    this.metalness = 0.26; // Set to 0.26 as requested
    this.colorsCatalog = MaterialFactory.getDefaultColors();
  }

  /**
   * Comprehensive primary LEGO palette including Yellows and multiple shades of Blue
   */
  static getDefaultColors() {
    return [
      // Core Primary & Secondary
      { code: 4, name: 'Red', hex: '#B40000', category: 'Solid' },
      { code: 14, name: 'Yellow', hex: '#FAC80A', category: 'Solid' },
      { code: 1, name: 'Blue', hex: '#1E5AA8', category: 'Solid' },
      { code: 2, name: 'Green', hex: '#00852B', category: 'Solid' },
      { code: 25, name: 'Orange', hex: '#FE8A18', category: 'Solid' },
      { code: 15, name: 'White', hex: '#F2F3F2', category: 'Solid' },
      { code: 0, name: 'Black', hex: '#1B2A34', category: 'Solid' },

      // Shades of Blue
      { code: 272, name: 'Dark Blue', hex: '#19325A', category: 'Solid' },
      { code: 73, name: 'Medium Blue', hex: '#7396C8', category: 'Solid' },
      { code: 212, name: 'Bright Light Blue', hex: '#9DC3F7', category: 'Solid' },
      { code: 379, name: 'Sand Blue', hex: '#70819A', category: 'Solid' },
      { code: 232, name: 'Sky Blue', hex: '#77C9D8', category: 'Solid' },
      { code: 9, name: 'Light Blue', hex: '#97CBD9', category: 'Solid' },
      { code: 313, name: 'Maersk Blue', hex: '#ABD9FF', category: 'Solid' },

      // Shades of Yellow & Warm tones
      { code: 226, name: 'Bright Light Yellow', hex: '#FFEC6C', category: 'Solid' },
      { code: 18, name: 'Light Yellow', hex: '#FFD67F', category: 'Solid' },
      { code: 180, name: 'Dark Yellow', hex: '#DD982E', category: 'Solid' },
      { code: 225, name: 'Warm Yellowish Orange', hex: '#FAA964', category: 'Solid' },
      { code: 191, name: 'Bright Light Orange', hex: '#F8BB3D', category: 'Solid' },
      { code: 68, name: 'Dark Orange', hex: '#A95500', category: 'Solid' },

      // Greys & Earth tones
      { code: 71, name: 'Light Bluish Gray', hex: '#A0A5A9', category: 'Solid' },
      { code: 72, name: 'Dark Bluish Gray', hex: '#646464', category: 'Solid' },
      { code: 19, name: 'Tan', hex: '#E4CD9E', category: 'Solid' },
      { code: 28, name: 'Dark Tan', hex: '#958A73', category: 'Solid' },
      { code: 70, name: 'Reddish Brown', hex: '#583927', category: 'Solid' },
      { code: 320, name: 'Dark Red', hex: '#720E0F', category: 'Solid' },

      // Greens & Pinks/Purples
      { code: 27, name: 'Lime', hex: '#BBE90B', category: 'Solid' },
      { code: 288, name: 'Dark Green', hex: '#184632', category: 'Solid' },
      { code: 326, name: 'Yellowish Green', hex: '#E2F99A', category: 'Solid' },
      { code: 268, name: 'Dark Purple', hex: '#3F3691', category: 'Solid' },
      { code: 26, name: 'Magenta', hex: '#923978', category: 'Solid' },
      { code: 29, name: 'Bright Pink', hex: '#E4ADC8', category: 'Solid' },
      { code: 353, name: 'Coral', hex: '#FF698F', category: 'Solid' }
    ];
  }

  setColorsCatalog(colors) {
    if (Array.isArray(colors) && colors.length > 0) {
      this.colorsCatalog = colors;
    }
  }

  setModelRoughness(roughness, model = null) {
    this.roughness = Math.max(0.0, Math.min(1.0, roughness));
    if (model) {
      model.traverse(c => {
        if (c.isMesh && c.material) {
          c.material.roughness = this.roughness;
          c.material.needsUpdate = true;
        }
      });
    }
  }

  setModelMetalness(metalness, model = null) {
    this.metalness = Math.max(0.0, Math.min(1.0, metalness));
    if (model) {
      model.traverse(c => {
        if (c.isMesh && c.material) {
          c.material.metalness = this.metalness;
          c.material.needsUpdate = true;
        }
      });
    }
  }

  /**
   * Creates an ABS plastic MeshPhysicalMaterial with Subsurface Scattering
   * @param {string|number} hexOrCode
   * @returns {THREE.MeshPhysicalMaterial}
   */
  createPlasticMaterial(hexOrCode) {
    let hex = '#B40000'; // Default red

    if (typeof hexOrCode === 'number') {
      const entry = this.colorsCatalog.find(c => c.code === hexOrCode);
      if (entry) hex = entry.hex;
    } else if (typeof hexOrCode === 'string') {
      if (hexOrCode.startsWith('#')) {
        hex = hexOrCode;
      } else {
        const entry = this.colorsCatalog.find(
          c => c.name.toLowerCase() === hexOrCode.toLowerCase()
        );
        if (entry) hex = entry.hex;
      }
    }

    const baseColor = new THREE.Color(hex);
    // Attenuation color: blend base pigment towards white for warm volume scatter
    const attenuationColor = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.35);

    const mat = new THREE.MeshPhysicalMaterial({
      color: baseColor,
      roughness: this.roughness,
      metalness: this.metalness,
      ior: 1.54, // Laboratory optical refractive index for ABS polymer
      clearcoat: 0.38,
      clearcoatRoughness: 0.10,
      transmission: 0.12, // Subsurface scattering transmission
      thickness: 2.2,     // Plastic shell thickness in LDU
      attenuationColor: attenuationColor,
      attenuationDistance: 4.5,
      side: THREE.DoubleSide
    });

    if (this.normalMap) {
      mat.normalMap = this.normalMap;
      mat.normalScale = new THREE.Vector2(0.045, 0.045);
    }

    return mat;
  }

  /**
   * Applies material to all meshes in the model hierarchy and hides line segments
   * @param {THREE.Object3D} model
   * @param {THREE.Material} material
   */
  applyToModel(model, material) {
    if (!model) return;
    model.traverse(child => {
      if (child.isLineSegments) {
        child.visible = false;
      }
      if (child.isMesh) {
        child.material = material;
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }
}
