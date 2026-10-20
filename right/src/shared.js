import * as THREE from 'three';

/** Uniforms shared by every custom shader so one update drives the whole scene. */
export const shared = {
  uTime: { value: 0 },
  uBreath: { value: 0.5 },
  uDay: { value: 0.55 },
  uSunDir: { value: new THREE.Vector3(0.45, 0.8, 0.35).normalize() },
  uSunColor: { value: new THREE.Color('#dbe8ff') },
  uSkyTint: { value: new THREE.Color('#9fc4ff') },
  uWhalePos: { value: new THREE.Vector3(0, 0.42, 0) },
};
