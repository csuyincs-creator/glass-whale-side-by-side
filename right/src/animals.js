import * as THREE from 'three';
import { mulberry32, clamp, smoothstep } from './util.js';

/** Tiny clay animals. Each returns { group, update(t, dt) }. */
export function buildAnimals(terrain) {
  const group = new THREE.Group();
  const animals = [];
  const rng = mulberry32(3131);

  const mat = (hex, rough = 0.62) => new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex), roughness: rough, metalness: 0.0, envMapIntensity: 0.7,
  });
  const ivory = mat('#e8e6f2');
  const dark = mat('#3c3630', 0.7);
  const wood = mat('#76563c', 0.8);
  const fawn = mat('#b9a6b8');

  // ---------- deer ----------
  const deer = new THREE.Group();
  {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.0135, 0.024, 4, 8), fawn);
    body.rotation.z = Math.PI / 2;
    body.position.y = 0.030;
    deer.add(body);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.028, 6), fawn);
    neck.position.set(0.020, 0.046, 0);
    neck.rotation.z = -0.35;
    deer.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.0095, 10, 8), fawn);
    head.position.set(0.029, 0.058, 0);
    head.scale.set(1.25, 0.95, 0.9);
    deer.add(head);

    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.005, 8, 6), mat('#ded2e0'));
    muzzle.position.set(0.037, 0.055, 0);
    muzzle.scale.set(1.3, 0.8, 0.9);
    deer.add(muzzle);

    [-1, 1].forEach((s) => {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.010, 5), fawn);
      ear.position.set(0.024, 0.066, s * 0.008);
      ear.rotation.set(s * 0.4, 0, -0.3);
      deer.add(ear);

      const antler = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0018, 0.020, 4), mat('#e0d8ec', 0.7));
      antler.position.set(0.027, 0.074, s * 0.004);
      antler.rotation.set(s * 0.35, 0, 0.25);
      deer.add(antler);

      const antler2 = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 0.0014, 0.012, 4), mat('#e0d8ec', 0.7));
      antler2.position.set(0.031, 0.084, s * 0.010);
      antler2.rotation.set(s * 0.9, 0, 0.35);
      deer.add(antler2);
    });

    [[0.014, 0.008], [0.014, -0.008], [-0.014, 0.008], [-0.014, -0.008]].forEach(([x, z]) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.002, 0.026, 4), fawn);
      leg.position.set(x, 0.012, z);
      deer.add(leg);
    });

    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.005, 6, 5), mat('#f0ecf8'));
    tail.position.set(-0.021, 0.036, 0);
    deer.add(tail);
  }
  deer.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  animals.push({ obj: deer, kind: 'deer' });
  group.add(deer);

  // ---------- rabbits ----------
  const rabbits = [];
  for (let i = 0; i < 3; i++) {
    const rb = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 10, 8), ivory);
    body.scale.set(1.25, 0.95, 1.0);
    body.position.y = 0.0085;
    rb.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.0062, 9, 7), ivory);
    head.position.set(0.0095, 0.0145, 0);
    rb.add(head);
    [-1, 1].forEach((s) => {
      const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.0018, 0.011, 3, 5), ivory);
      ear.position.set(0.0075, 0.0255, s * 0.0028);
      ear.rotation.set(s * 0.18, 0, -0.10);
      rb.add(ear);
    });
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.0032, 6, 5), mat('#ffffff'));
    tail.position.set(-0.0105, 0.010, 0);
    rb.add(tail);
    rb.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    rabbits.push({ obj: rb, phase: rng() * 10 });
    group.add(rb);
  }

  // ---------- ducks on the lake ----------
  const ducks = [];
  for (let i = 0; i < 2; i++) {
    const dg = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 9, 7), mat('#eeecf8'));
    body.scale.set(1.5, 0.85, 1.0);
    body.position.y = 0.004;
    dg.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 8, 6), mat('#f4f2ff'));
    head.position.set(0.0085, 0.0105, 0);
    dg.add(head);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.0018, 0.005, 5), mat('#cdb0e8'));
    beak.rotation.z = -Math.PI / 2;
    beak.position.set(0.0135, 0.010, 0);
    dg.add(beak);
    dg.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    ducks.push({ obj: dg, phase: i * 3.4, rad: 0.055 + i * 0.028, spd: 0.16 - i * 0.03 });
    group.add(dg);
  }

  // ---------- birds circling above ----------
  const birds = [];
  for (let i = 0; i < 4; i++) {
    const bg = new THREE.Group();
    const wingMat = mat('#eae6f6', 0.55);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 7, 5), wingMat);
    body.scale.set(1.6, 0.8, 0.8);
    bg.add(body);
    const wings = [];
    [-1, 1].forEach((s) => {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.013, 0.0055), new THREE.MeshStandardMaterial({
        color: new THREE.Color('#ece8fa'), roughness: 0.6, side: THREE.DoubleSide,
      }));
      w.position.set(0, 0.001, s * 0.0075);
      w.rotation.x = -Math.PI / 2;
      bg.add(w);
      wings.push(w);
    });
    bg.userData.wings = wings;
    birds.push({ obj: bg, phase: rng() * 10, rad: 0.16 + rng() * 0.12, h: 0.20 + rng() * 0.13, spd: 0.18 + rng() * 0.09 });
    group.add(bg);
  }

  // place deer in a meadow near the lake
  const deerHome = { x: -0.055, z: 0.235 };
  const deerRoad = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.115, 0, 0.145),
    new THREE.Vector3(-0.075, 0, 0.215),
    new THREE.Vector3(-0.010, 0, 0.250),
    new THREE.Vector3(-0.048, 0, 0.286),
    new THREE.Vector3(-0.115, 0, 0.300),
    new THREE.Vector3(-0.170, 0, 0.245),
    new THREE.Vector3(-0.178, 0, 0.180),
  ], true, 'catmullrom', 0.4);

  const rabbitHome = [
    { x: -0.02, z: 0.16 }, { x: 0.16, z: 0.16 }, { x: 0.02, z: 0.42 },
  ];
  const rabbitSpeed = [0.25, 0.18, 0.14];

  return {
    group,
    update(dt, t, day) {
      // deer walks the loop, pauses to graze
      const p = (t * 0.014) % 1;
      const pos = deerRoad.getPointAt(p);
      const tan = deerRoad.getTangentAt(p);
      deer.position.set(pos.x, terrain.heightAt(pos.x, pos.z), pos.z);
      const yaw = Math.atan2(tan.x, tan.z);
      deer.rotation.y = yaw - Math.PI / 2;
      const graze = smoothstep(0.35, 0.55, Math.sin(t * 0.23) * 0.5 + 0.5);
      deer.children[2].rotation.x = graze * 0.55;
      deer.position.y += Math.sin(t * 2.2) * 0.0012;

      // rabbits hop
      rabbits.forEach((r, i) => {
        const home = rabbitHome[i];
        const a = t * rabbitSpeed[i] + r.phase;
        const rad = 0.035 + 0.018 * Math.sin(t * 0.6 + r.phase);
        const x = home.x + Math.cos(a) * rad;
        const z = home.z + Math.sin(a) * rad * 0.7;
        const hop = Math.abs(Math.sin(t * 3.1 + r.phase)) * 0.010;
        r.obj.position.set(x, terrain.heightAt(x, z) + hop * 0.7, z);
        r.obj.rotation.y = -a + Math.PI / 2;
        r.obj.rotation.z = Math.sin(t * 3.1 + r.phase) * 0.10;
      });

      // ducks drift on the lake
      ducks.forEach((d) => {
        const a = t * d.spd + d.phase;
        const x = terrain.lake.x + Math.cos(a) * d.rad;
        const z = terrain.lake.z + Math.sin(a) * d.rad * 0.85;
        d.obj.position.set(x, terrain.lake.y + 0.002 + Math.sin(t * 1.6 + d.phase) * 0.0016, z);
        d.obj.rotation.y = -a + Math.PI / 2;
        d.obj.rotation.z = Math.sin(t * 1.3 + d.phase) * 0.05;
      });

      // birds
      birds.forEach((b) => {
        const a = t * b.spd + b.phase;
        const x = Math.cos(a) * b.rad;
        const z = Math.sin(a) * b.rad * 0.7;
        const y = b.h + Math.sin(t * 0.9 + b.phase) * 0.012;
        b.obj.position.set(x, y, z);
        b.obj.rotation.y = -a;
        b.obj.rotation.z = Math.sin(a) * 0.12;
        const flap = Math.sin(t * 9 + b.phase) * 0.55;
        b.obj.userData.wings[0].rotation.x = -Math.PI / 2 + flap;
        b.obj.userData.wings[1].rotation.x = -Math.PI / 2 - flap;
      });
    },
  };
}
