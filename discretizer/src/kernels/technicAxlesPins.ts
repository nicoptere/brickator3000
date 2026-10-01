import type { BaseKernelDefinition } from './types';
import { createSolidMask, createAxleConnectors, createPinConnectors, createRoundMask } from './kernelHelpers';

/**
 * LEGO Technic Axles, Pins, Bushes, and Joiner Connectors
 */
export const TECHNIC_AXLES_PINS: BaseKernelDefinition[] = [
  // ==========================================
  // Axles (Cross-section axle profile)
  // ==========================================
  {
    partId: '3704',
    name: 'Technic Axle 2',
    system: 'TECHNIC',
    category: 'TECHNIC_AXLE',
    baseSize: [1, 2, 1],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 2.0,
    connectors: createAxleConnectors(2),
    occupancyMask: createSolidMask(1, 2, 1)
  },
  {
    partId: '4519',
    name: 'Technic Axle 3',
    system: 'TECHNIC',
    category: 'TECHNIC_AXLE',
    baseSize: [1, 3, 1],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 3.0,
    connectors: createAxleConnectors(3),
    occupancyMask: createSolidMask(1, 3, 1)
  },
  {
    partId: '3705',
    name: 'Technic Axle 4',
    system: 'TECHNIC',
    category: 'TECHNIC_AXLE',
    baseSize: [1, 4, 1],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 4.0,
    connectors: createAxleConnectors(4),
    occupancyMask: createSolidMask(1, 4, 1)
  },
  {
    partId: '32073',
    name: 'Technic Axle 5',
    system: 'TECHNIC',
    category: 'TECHNIC_AXLE',
    baseSize: [1, 5, 1],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 5.0,
    connectors: createAxleConnectors(5),
    occupancyMask: createSolidMask(1, 5, 1)
  },
  {
    partId: '3706',
    name: 'Technic Axle 6',
    system: 'TECHNIC',
    category: 'TECHNIC_AXLE',
    baseSize: [1, 6, 1],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 6.0,
    connectors: createAxleConnectors(6),
    occupancyMask: createSolidMask(1, 6, 1)
  },
  {
    partId: '44294',
    name: 'Technic Axle 7',
    system: 'TECHNIC',
    category: 'TECHNIC_AXLE',
    baseSize: [1, 7, 1],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 7.0,
    connectors: createAxleConnectors(7),
    occupancyMask: createSolidMask(1, 7, 1)
  },
  {
    partId: '3707',
    name: 'Technic Axle 8',
    system: 'TECHNIC',
    category: 'TECHNIC_AXLE',
    baseSize: [1, 8, 1],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 8.0,
    connectors: createAxleConnectors(8),
    occupancyMask: createSolidMask(1, 8, 1)
  },
  {
    partId: '3737',
    name: 'Technic Axle 10',
    system: 'TECHNIC',
    category: 'TECHNIC_AXLE',
    baseSize: [1, 10, 1],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 9.5,
    connectors: createAxleConnectors(10),
    occupancyMask: createSolidMask(1, 10, 1)
  },
  {
    partId: '3708',
    name: 'Technic Axle 12',
    system: 'TECHNIC',
    category: 'TECHNIC_AXLE',
    baseSize: [1, 12, 1],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 10.5,
    connectors: createAxleConnectors(12),
    occupancyMask: createSolidMask(1, 12, 1)
  },

  // ==========================================
  // Pins & Bushes
  // ==========================================
  {
    partId: '4274',
    name: 'Technic Pin 1/2',
    system: 'TECHNIC',
    category: 'TECHNIC_PIN',
    baseSize: [1, 1, 1],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 1.5,
    connectors: createPinConnectors(1),
    occupancyMask: createRoundMask(1, 1, 1)
  },
  {
    partId: '2780',
    name: 'Technic Pin with Friction',
    system: 'TECHNIC',
    category: 'TECHNIC_PIN',
    baseSize: [1, 2, 1],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 3.0,
    connectors: createPinConnectors(2),
    occupancyMask: createRoundMask(1, 2, 1)
  },
  {
    partId: '3673',
    name: 'Technic Pin without Friction',
    system: 'TECHNIC',
    category: 'TECHNIC_PIN',
    baseSize: [1, 2, 1],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 2.8,
    connectors: createPinConnectors(2),
    occupancyMask: createRoundMask(1, 2, 1)
  },
  {
    partId: '6558',
    name: 'Technic Pin Long with Friction 3L',
    system: 'TECHNIC',
    category: 'TECHNIC_PIN',
    baseSize: [1, 3, 1],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 4.0,
    connectors: createPinConnectors(3),
    occupancyMask: createRoundMask(1, 3, 1)
  },
  {
    partId: '43093',
    name: 'Technic Pin with Axle',
    system: 'TECHNIC',
    category: 'TECHNIC_PIN',
    baseSize: [1, 2, 1],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 3.2,
    connectors: createPinConnectors(2),
    occupancyMask: createRoundMask(1, 2, 1)
  },
  {
    partId: '32123b',
    name: 'Technic Bush 1/2 Smooth',
    system: 'TECHNIC',
    category: 'TECHNIC_PIN',
    baseSize: [1, 1, 1],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 1.5,
    connectors: createPinConnectors(1),
    occupancyMask: createRoundMask(1, 1, 1)
  },
  {
    partId: '6590',
    name: 'Technic Bush',
    system: 'TECHNIC',
    category: 'TECHNIC_PIN',
    baseSize: [1, 1, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 2.5,
    connectors: createPinConnectors(1),
    occupancyMask: createRoundMask(1, 1, 3)
  },

  // ==========================================
  // Connectors & Joiners
  // ==========================================
  {
    partId: '6536',
    name: 'Technic Axle and Pin Connector Perpendicular',
    system: 'TECHNIC',
    category: 'TECHNIC_CONNECTOR',
    baseSize: [1, 2, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 4.5,
    connectors: createPinConnectors(2),
    occupancyMask: createSolidMask(1, 2, 3)
  },
  {
    partId: '32013',
    name: 'Technic Angle Connector #1',
    system: 'TECHNIC',
    category: 'TECHNIC_CONNECTOR',
    baseSize: [1, 2, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 4.5,
    connectors: createPinConnectors(2),
    occupancyMask: createSolidMask(1, 2, 3)
  },
  {
    partId: '32034',
    name: 'Technic Angle Connector #2',
    system: 'TECHNIC',
    category: 'TECHNIC_CONNECTOR',
    baseSize: [1, 2, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 4.5,
    connectors: createPinConnectors(2),
    occupancyMask: createSolidMask(1, 2, 3)
  },
  {
    partId: '32014',
    name: 'Technic Angle Connector #6 (90°)',
    system: 'TECHNIC',
    category: 'TECHNIC_CONNECTOR',
    baseSize: [2, 2, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 5.0,
    connectors: createPinConnectors(2),
    occupancyMask: createSolidMask(2, 2, 3)
  }
];
