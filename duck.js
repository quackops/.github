import * as tree from 'three';

const SIDES = [1, -1];

const SEGMENTS = { sphere: [48, 36], smallSphere: [36, 26], eye: [24, 18] };

function createMaterials() {
  return {
    duckYellow: new tree.MeshStandardMaterial({ name: 'duckYellow', color: 0xf7c531, roughness: 0.42, metalness: 0.0 }),
    billOrange: new tree.MeshStandardMaterial({ name: 'billOrange', color: 0xe8722a, roughness: 0.38, metalness: 0.0 }),
    eyeBlack:   new tree.MeshStandardMaterial({ name: 'eyeBlack',   color: 0x14110f, roughness: 0.18, metalness: 0.0 }),
    brass:      new tree.MeshStandardMaterial({ name: 'brass',      color: 0xd7b25a, roughness: 0.34, metalness: 0.38 }),
    gearBlack:  new tree.MeshStandardMaterial({ name: 'gearBlack',  color: 0x24262a, roughness: 0.52, metalness: 0.12 }),
    gearFoam:   new tree.MeshStandardMaterial({ name: 'gearFoam',   color: 0x121316, roughness: 0.95, metalness: 0.0 }),
    gearOlive:  new tree.MeshStandardMaterial({ name: 'gearOlive',  color: 0x4b4f3a, roughness: 0.8,  metalness: 0.05 }),
  };
}

function createMesh(name, geometry, material, { position, rotation, scale } = {}) {
  const mesh = new tree.Mesh(geometry, material);
  mesh.name = name;
  if (position) mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  if (scale) mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createGroup(name, position) {
  const group = new tree.Group();
  group.name = name;
  if (position) group.position.set(...position);
  return group;
}

function sideName(base, side) {
  return `${base}${side > 0 ? 'Right' : 'Left'}`;
}

function buildTorso(materials, unitSphere) {
  const torso = createGroup('torso');

  torso.add(createMesh('body', unitSphere, materials.duckYellow, {
    position: [0, 0.044, 0],
    rotation: [0.06, 0, 0],
    scale: [0.056, 0.044, 0.076],
  }));

  torso.add(createMesh('keel', new tree.CylinderGeometry(0.034, 0.030, 0.010, 40), materials.duckYellow, {
    position: [0, 0.005, -0.002],
  }));

  torso.add(createMesh('breast', unitSphere, materials.duckYellow, {
    position: [0, 0.062, 0.030],
    scale: [0.040, 0.036, 0.042],
  }));

  torso.add(createMesh('tail', new tree.SphereGeometry(0.024, ...SEGMENTS.smallSphere), materials.duckYellow, {
    position: [0, 0.062, -0.062],
    rotation: [-0.80, 0, 0],
    scale: [0.85, 1.30, 0.55],
  }));

  for (const side of SIDES) {
    torso.add(createMesh(sideName('wing', side), unitSphere, materials.duckYellow, {
      position: [side * 0.049, 0.046, 0.004],
      rotation: [0, side * 0.18, side * -0.12],
      scale: [0.010, 0.023, 0.038],
    }));
  }

  return torso;
}

function buildHead(materials, unitSphere) {
  const head = createGroup('headAssembly');

  head.add(createMesh('neck', new tree.CylinderGeometry(0.030, 0.040, 0.032, 32), materials.duckYellow, {
    position: [0, 0.082, 0.024],
    rotation: [0.10, 0, 0],
  }));
  head.add(createMesh('head', new tree.SphereGeometry(0.037, ...SEGMENTS.sphere), materials.duckYellow, {
    position: [0, 0.108, 0.026],
  }));

  head.add(createMesh('billUpper', unitSphere, materials.billOrange, {
    position: [0, 0.104, 0.056],
    rotation: [-0.10, 0, 0],
    scale: [0.026, 0.009, 0.030],
  }));
  head.add(createMesh('billLower', unitSphere, materials.billOrange, {
    position: [0, 0.0965, 0.052],
    rotation: [-0.06, 0, 0],
    scale: [0.020, 0.006, 0.022],
  }));

  const eyeGeo = new tree.SphereGeometry(0.0055, ...SEGMENTS.eye);
  for (const side of SIDES) {
    head.add(createMesh(sideName('eye', side), eyeGeo, materials.eyeBlack, {
      position: [side * 0.020, 0.119, 0.049],
    }));
  }

  return head;
}

function buildEarCup(materials, side) {
  const cup = createGroup(sideName('earCup', side), [side * 0.0455, -0.004, 0]);
  const acrossHead = [0, 0, Math.PI / 2];

  cup.add(createMesh(sideName('cupYoke', side), new tree.CylinderGeometry(0.0042, 0.0048, 0.016, 20), materials.gearBlack, {
    position: [side * 0.001, 0.014, 0],
  }));
  cup.add(createMesh(sideName('cupShell', side), new tree.CylinderGeometry(0.0215, 0.0215, 0.016, 40), materials.gearBlack, {
    rotation: acrossHead,
  }));
  cup.add(createMesh(sideName('cupPlate', side), new tree.CylinderGeometry(
    side > 0 ? 0.018 : 0.016,
    side > 0 ? 0.016 : 0.018,
    0.004,
    40
  ), materials.gearOlive, {
    position: [side * 0.0095, 0, 0],
    rotation: acrossHead,
  }));
  cup.add(createMesh(sideName('cupVent', side), new tree.CylinderGeometry(0.005, 0.005, 0.005, 24), materials.brass, {
    position: [side * 0.012, 0, 0],
    rotation: acrossHead,
  }));
  cup.add(createMesh(sideName('cupCushion', side), new tree.TorusGeometry(0.0175, 0.0062, 18, 44), materials.gearFoam, {
    position: [-side * 0.009, 0, 0],
    rotation: [0, Math.PI / 2, 0],
  }));

  return cup;
}

function tube(points, segments, radius, radialSegments) {
  const curve = new tree.CatmullRomCurve3(points.map((p) => new tree.Vector3(...p)));
  return new tree.TubeGeometry(curve, segments, radius, radialSegments, false);
}

function buildHeadset(materials) {
  const headset = createGroup('headset', [0, 0.108, 0.018]);

  const bandArc = Math.PI * 0.94;
  headset.add(createMesh('headbandArc', new tree.TorusGeometry(0.0475, 0.0058, 16, 64, bandArc), materials.gearBlack, {
    rotation: [0, 0, (Math.PI - bandArc) / 2],
  }));
  headset.add(createMesh('headbandPad', new tree.CapsuleGeometry(0.008, 0.030, 12, 22), materials.gearFoam, {
    position: [0, 0.0465, 0],
    rotation: [0, 0, Math.PI / 2],
    scale: [1, 1, 0.7],
  }));

  for (const side of SIDES) headset.add(buildEarCup(materials, side));

  headset.add(createMesh('boomArm', tube([
    [0.044, -0.012, 0.014],
    [0.042, -0.026, 0.036],
    [0.030, -0.030, 0.054],
    [0.015, -0.026, 0.062],
  ], 40, 0.0026, 14), materials.gearBlack));
  headset.add(createMesh('micCapsule', new tree.CapsuleGeometry(0.0055, 0.006, 10, 24), materials.gearFoam, {
    position: [0.011, -0.025, 0.064],
    rotation: [0, 0, Math.PI / 2 - 0.4],
  }));

  headset.add(createMesh('cable', tube([
    [-0.047, -0.020, -0.008],
    [-0.054, -0.040, -0.024],
    [-0.050, -0.062, -0.044],
    [-0.036, -0.078, -0.058],
  ], 48, 0.0022, 12), materials.gearBlack));

  return headset;
}

export function buildDuck() {
  const materials = createMaterials();
  const unitSphere = new tree.SphereGeometry(1, ...SEGMENTS.sphere);

  const duck = createGroup('tacticalRubberDuck');
  duck.add(buildTorso(materials, unitSphere));
  duck.add(buildHead(materials, unitSphere));
  duck.add(buildHeadset(materials));
  return duck;
}
