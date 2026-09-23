import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/**
 * DensePileSimulator:
 * Simulates high-density rigid-body physics for 100-300 LEGO bricks tumbling into a realistic heap.
 * Uses Cannon-es with Sweep-and-Prune (SAP) broadphase and box colliders.
 */
export class DensePileSimulator {
  constructor(options = {}) {
    this.scale = options.scale || 0.05; // 1 LDU = 0.05 physics units (8mm per stud)
    this.gravity = options.gravity || -35.0; // Fast realistic drop gravity
    this.floorFriction = options.floorFriction || 0.60;
    this.partFriction = options.partFriction || 0.50;
    this.restitution = options.restitution || 0.12;
  }

  /**
   * Drops an array of instances and simulates them until they settle into a stable pile.
   * @param {Array<{ model: THREE.Object3D, partId: string }>} instances
   * @param {object} simConfig { dropRadius: 14, steps: 280, rng: () => number }
   * @returns {Array<{ model: THREE.Object3D, partId: string, position: THREE.Vector3, quaternion: THREE.Quaternion }>}
   */
  simulatePile(instances, simConfig = {}) {
    const rng = simConfig.rng || Math.random;
    const n = instances.length;
    const defaultDropRadius = Math.max(14.0, 10.0 + Math.sqrt(n / 100) * 5.0);
    const dropRadius = simConfig.dropRadius || defaultDropRadius;
    const maxSteps = simConfig.steps || Math.max(280, Math.min(420, 240 + Math.floor(n * 0.25)));
    const boundaryRadius = simConfig.boundaryRadius || (dropRadius + 10.0);

    // 1. Initialize Cannon World
    const world = new CANNON.World({
      gravity: new CANNON.Vec3(0, this.gravity, 0)
    });
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.solver.iterations = 10;
    world.defaultContactMaterial.friction = this.partFriction;
    world.defaultContactMaterial.restitution = this.restitution;

    // Ground plane at Y = 0
    const groundMat = new CANNON.Material('ground');
    const groundBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Plane(),
      material: groundMat
    });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(groundBody);

    // Friction contact between parts and floor
    const contactMat = new CANNON.ContactMaterial(groundMat, world.defaultMaterial, {
      friction: this.floorFriction,
      restitution: this.restitution
    });
    world.addContactMaterial(contactMat);

    // Subtle containment walls (gentle inward bevel to keep pile clustered on tabletop)
    const wallHeight = 80.0;
    const wallThickness = 10.0;
    const wallHalf = boundaryRadius + wallThickness;

    const createWall = (x, z, rotY) => {
      const wallShape = new CANNON.Box(new CANNON.Vec3(wallHalf, wallHeight, wallThickness));
      const wallBody = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: wallShape
      });
      wallBody.position.set(x, wallHeight, z);
      wallBody.quaternion.setFromEuler(0, rotY, 0);
      world.addBody(wallBody);
    };

    createWall(0, boundaryRadius + wallThickness, 0);
    createWall(0, -(boundaryRadius + wallThickness), 0);
    createWall(boundaryRadius + wallThickness, 0, Math.PI / 2);
    createWall(-(boundaryRadius + wallThickness), 0, Math.PI / 2);

    // 2. Prepare physical bodies for each instance
    const bodies = [];
    const SCALE = this.scale;

    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      const model = inst.model;

      // Compute bounding box and center geometry
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      // Center model via pivot container without mutating shared geometry
      const container = new THREE.Group();
      model.position.sub(center);
      container.add(model);
      container.updateMatrixWorld(true);
      inst.model = container;

      const physW = Math.max(0.3, size.x * SCALE);
      const physH = Math.max(0.3, size.y * SCALE);
      const physD = Math.max(0.3, size.z * SCALE);

      const halfExtents = new CANNON.Vec3(physW / 2, physH / 2, physD / 2);
      const volume = physW * physH * physD;
      const mass = Math.max(0.1, volume * 0.25);

      // Distribute in a cylinder above the floor
      const r = Math.sqrt(rng()) * (dropRadius * 0.9);
      const theta = rng() * Math.PI * 2;
      const posX = r * Math.cos(theta);
      const posZ = r * Math.sin(theta);
      // Stagger drop heights compactly so pieces cascade naturally without flying out
      const stagger = Math.min(0.12, 32.0 / Math.max(1, instances.length));
      const posY = 2.0 + (i * stagger) + (rng() * 1.5);

      const body = new CANNON.Body({
        mass,
        shape: new CANNON.Box(halfExtents)
      });
      body.position.set(posX, posY, posZ);

      // Random 3D tumbling rotation
      body.quaternion.setFromEuler(
        rng() * Math.PI * 2,
        rng() * Math.PI * 2,
        rng() * Math.PI * 2
      );

      // Subtle initial velocity to disperse
      body.velocity.set(
        (rng() - 0.5) * 1.5,
        -rng() * 2.0,
        (rng() - 0.5) * 1.5
      );
      body.angularVelocity.set(
        (rng() - 0.5) * 3.0,
        (rng() - 0.5) * 3.0,
        (rng() - 0.5) * 3.0
      );

      world.addBody(body);
      bodies.push({ body, inst, halfExtents });
    }

    // 3. Step simulation to equilibrium with perimeter containment
    const dt = 1 / 60;
    const maxR = boundaryRadius * 1.05;
    const maxRSq = maxR * maxR;

    for (let step = 0; step < maxSteps; step++) {
      world.step(dt);

      // Enforce boundary containment during simulation
      for (let b = 0; b < bodies.length; b++) {
        const body = bodies[b].body;
        const rSq = body.position.x * body.position.x + body.position.z * body.position.z;
        if (rSq > maxRSq) {
          const dist = Math.sqrt(rSq);
          body.position.x = (body.position.x / dist) * maxR;
          body.position.z = (body.position.z / dist) * maxR;
          body.velocity.x *= -0.1;
          body.velocity.z *= -0.1;
        }
        if (body.position.y < 0.1) {
          body.position.y = 0.2;
          body.velocity.y = 0;
        }
      }
    }

    // 4. Update Three.js models with final settled transforms
    const settledInstances = [];
    const maxAllowedThreeR = (boundaryRadius * 1.05) / SCALE;

    for (let i = 0; i < bodies.length; i++) {
      const { body, inst } = bodies[i];
      const model = inst.model;

      // Position in Three.js LDraw units
      let wx = body.position.x / SCALE;
      const wy = Math.max(0, body.position.y / SCALE); // Never penetrate below Y=0
      let wz = body.position.z / SCALE;

      // Ensure strict boundary containment
      const distThree = Math.sqrt(wx * wx + wz * wz);
      if (distThree > maxAllowedThreeR) {
        wx = (wx / distThree) * maxAllowedThreeR;
        wz = (wz / distThree) * maxAllowedThreeR;
      }

      model.position.set(wx, wy, wz);
      model.quaternion.set(
        body.quaternion.x,
        body.quaternion.y,
        body.quaternion.z,
        body.quaternion.w
      );
      model.updateMatrixWorld(true);

      settledInstances.push({
        instanceId: i + 1,
        partId: inst.partId,
        colorHex: inst.colorHex,
        model,
        position: new THREE.Vector3(wx, wy, wz),
        quaternion: new THREE.Quaternion(
          body.quaternion.x,
          body.quaternion.y,
          body.quaternion.z,
          body.quaternion.w
        )
      });
    }

    return settledInstances;
  }
}
