"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import * as THREE from "three";

const palette = {
  asphalt: 0xb8b6b0,
  curb: 0x8f8b82,
  paving: 0xc3c1b9,
  ink: 0x173a32,
  green: 0x285c4d,
  cream: 0xfff8e8,
  amber: 0xe5a94f,
  brick: 0x7b5549,
  concrete: 0xa9a79f,
  fog: 0xd9d7cf,
};

type ProgressDetail = {
  progress: number;
  mission: number;
};

type ShopConfig = {
  name: string;
  wall: number;
  accent: number;
  width: number;
  height: number;
  depth: number;
};

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function createSurfaceTexture(kind: "asphalt" | "paver" | "wall") {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  const random = seededRandom(kind === "asphalt" ? 117 : kind === "paver" ? 261 : 409);

  context.fillStyle = kind === "asphalt" ? "#4a4d49" : kind === "paver" ? "#7f8179" : "#8a6658";
  context.fillRect(0, 0, size, size);

  const image = context.getImageData(0, 0, size, size);
  for (let index = 0; index < image.data.length; index += 4) {
    const grain = Math.floor((random() - 0.5) * (kind === "asphalt" ? 34 : 20));
    image.data[index] = Math.max(0, Math.min(255, image.data[index] + grain));
    image.data[index + 1] = Math.max(0, Math.min(255, image.data[index + 1] + grain));
    image.data[index + 2] = Math.max(0, Math.min(255, image.data[index + 2] + grain));
  }
  context.putImageData(image, 0, 0);

  if (kind === "asphalt") {
    for (let index = 0; index < 1400; index += 1) {
      const tone = 75 + Math.floor(random() * 70);
      context.fillStyle = `rgba(${tone},${tone},${tone - 3},${0.18 + random() * 0.28})`;
      const radius = 0.35 + random() * 1.4;
      context.beginPath();
      context.arc(random() * size, random() * size, radius, 0, Math.PI * 2);
      context.fill();
    }
    context.strokeStyle = "rgba(24,27,25,.32)";
    context.lineWidth = 1.2;
    for (let index = 0; index < 7; index += 1) {
      let x = random() * size;
      let y = random() * size;
      context.beginPath();
      context.moveTo(x, y);
      for (let point = 0; point < 5; point += 1) {
        x += (random() - 0.5) * 42;
        y += 18 + random() * 35;
        context.lineTo(x, y);
      }
      context.stroke();
    }
  } else if (kind === "paver") {
    context.strokeStyle = "rgba(47,50,47,.4)";
    context.lineWidth = 2;
    const cell = 64;
    for (let y = 0; y <= size; y += cell) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(size, y);
      context.stroke();
      const offset = (y / cell) % 2 === 0 ? 0 : cell / 2;
      for (let x = -cell + offset; x <= size; x += cell) {
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x, y + cell);
        context.stroke();
      }
    }
  } else {
    context.strokeStyle = "rgba(224,214,199,.55)";
    context.lineWidth = 4;
    const row = 54;
    for (let y = 0; y <= size; y += row) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(size, y);
      context.stroke();
      const offset = (y / row) % 2 === 0 ? 0 : 63;
      for (let x = offset; x <= size; x += 126) {
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x, y + row);
        context.stroke();
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function makeSignTexture(text: string, foreground: string, background: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 224;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(255,255,255,.28)";
  context.lineWidth = 8;
  context.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  context.fillStyle = foreground;
  context.font = "700 86px 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function makeRoadDecalTexture(title: string, detail: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 300;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(229,169,79,.92)";
  context.roundRect(8, 8, 1008, 284, 28);
  context.fill();
  context.fillStyle = "#173a32";
  context.font = "800 74px 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
  context.fillText(title, 58, 119);
  context.font = "600 42px 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
  context.fillText(detail, 58, 207);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function sideAt(curve: THREE.CatmullRomCurve3, t: number, distance: number) {
  const point = curve.getPointAt(t);
  const tangent = curve.getTangentAt(t).normalize();
  const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  return point.addScaledVector(side, distance);
}

function createStrip(
  curve: THREE.CatmullRomCurve3,
  leftOffset: number,
  rightOffset: number,
  material: THREE.Material,
  y = 0,
) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const segments = 260;
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const left = point.clone().addScaledVector(side, leftOffset);
    const right = point.clone().addScaledVector(side, rightOffset);
    positions.push(left.x, y, left.z, right.x, y, right.z);
    uvs.push(0, t * 24, Math.abs(leftOffset - rightOffset) / 2.4, t * 24);
    if (index < segments) {
      const base = index * 2;
      indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function curveFromOffset(curve: THREE.CatmullRomCurve3, distance: number, y: number) {
  return new THREE.CatmullRomCurve3(
    Array.from({ length: 96 }, (_, index) => sideAt(curve, index / 95, distance).setY(y)),
  );
}

function createStorefront(
  config: ShopConfig,
  materials: { glass: THREE.Material; dark: THREE.Material; facade?: THREE.Texture; wallMap?: THREE.Texture },
) {
  const group = new THREE.Group();
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: config.wall,
    map: materials.wallMap,
    bumpMap: materials.wallMap,
    bumpScale: materials.wallMap ? 0.035 : 0,
    roughness: 0.84,
  });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: config.accent, roughness: 0.6 });
  const warmInterior = new THREE.MeshStandardMaterial({
    color: 0xf1c98d,
    emissive: 0x8d5425,
    emissiveIntensity: 0.5,
    roughness: 0.72,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(config.width, config.height, config.depth), wallMaterial);
  body.position.set(0, config.height / 2, -config.depth / 2);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const frontWidth = config.width * 0.76;
  if (materials.facade) {
    const facade = new THREE.Mesh(
      new THREE.PlaneGeometry(config.width * 0.94, Math.min(config.height * 0.91, config.width * 0.98)),
      new THREE.MeshStandardMaterial({ map: materials.facade, roughness: 0.72, metalness: 0.01 }),
    );
    facade.position.set(0, Math.min(config.height * 0.91, config.width * 0.98) / 2, 0.035);
    group.add(facade);
  } else {
    const interior = new THREE.Mesh(new THREE.PlaneGeometry(frontWidth, 1.65), warmInterior);
    interior.position.set(0, 1.32, 0.018);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(frontWidth, 1.65), materials.glass);
    glass.position.set(0, 1.32, 0.045);
    group.add(interior, glass);

    const door = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.9, 0.08), materials.dark);
    door.position.set(frontWidth / 2 - 0.38, 1.01, 0.08);
    door.castShadow = true;
    group.add(door);

    const frameWidth = new THREE.Mesh(new THREE.BoxGeometry(frontWidth + 0.12, 0.08, 0.12), materials.dark);
    const frameMid = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.7, 0.12), materials.dark);
    frameWidth.position.set(0, 2.16, 0.07);
    frameMid.position.set(-0.22, 1.32, 0.07);
    group.add(frameWidth, frameMid);
  }

  const awning = new THREE.Mesh(new THREE.BoxGeometry(config.width * 0.9, 0.12, 0.88), accentMaterial);
  awning.position.set(0, 2.68, 0.34);
  awning.rotation.x = 0.13;
  awning.castShadow = true;
  group.add(awning);

  const signTexture = makeSignTexture(config.name, "#fff8e8", `#${config.accent.toString(16).padStart(6, "0")}`);
  const signMaterial = new THREE.MeshBasicMaterial({ map: signTexture, toneMapped: false });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(config.width * 0.72, 0.66), signMaterial);
  sign.position.set(0, 3.18, 0.025);
  group.add(sign);

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.35, 10), accentMaterial);
  handle.position.set(frontWidth / 2 - 0.58, 1.02, 0.15);
  group.add(handle);

  const potMaterial = new THREE.MeshStandardMaterial({ color: 0x6d493b, roughness: 0.88 });
  const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x315b43, roughness: 0.9 });
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.35, 14), potMaterial);
  const plant = new THREE.Mesh(new THREE.SphereGeometry(0.31, 14, 10), leafMaterial);
  pot.position.set(-frontWidth / 2 - 0.24, 0.18, 0.22);
  plant.position.set(-frontWidth / 2 - 0.24, 0.58, 0.22);
  plant.scale.set(0.78, 1.2, 0.7);
  pot.castShadow = true;
  plant.castShadow = true;
  group.add(pot, plant);

  group.userData.textures = [signTexture];
  return group;
}

function createUtilityPole(material: THREE.Material) {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 6.4, 14), material);
  pole.position.y = 3.2;
  pole.castShadow = true;
  const crossbar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.12), material);
  crossbar.position.y = 5.75;
  crossbar.castShadow = true;
  group.add(pole, crossbar);
  for (const x of [-0.52, 0, 0.52]) {
    const insulator = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 0.24, 10),
      new THREE.MeshStandardMaterial({ color: 0xd8d4c9, roughness: 0.54 }),
    );
    insulator.position.set(x, 5.93, 0);
    group.add(insulator);
  }
  return group;
}

function createCable(points: THREE.Vector3[], material: THREE.Material) {
  const curve = new THREE.CatmullRomCurve3(points);
  const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 36, 0.018, 6, false), material);
  cable.castShadow = true;
  return cable;
}

export default function ThreeMissionRoadScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    const page = document.querySelector<HTMLElement>(".mission-road-home");
    if (!canvas || !root || !page) return;

    gsap.registerPlugin(ScrollTrigger);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      root.classList.add("is-fallback");
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(palette.fog, 0.0075);
    const camera = new THREE.PerspectiveCamera(58, 1, 0.08, 110);
    camera.rotation.order = "YXZ";
    const world = new THREE.Group();
    scene.add(world);

    const asphaltTexture = createSurfaceTexture("asphalt");
    asphaltTexture.repeat.set(2.6, 18);
    const paverTexture = createSurfaceTexture("paver");
    paverTexture.repeat.set(2.4, 24);
    const brickTexture = createSurfaceTexture("wall");
    brickTexture.repeat.set(2, 2.5);
    const textureLoader = new THREE.TextureLoader();
    const storefrontAtlas = textureLoader.load("/korean-storefront-atlas.jpg");
    storefrontAtlas.colorSpace = THREE.SRGBColorSpace;
    storefrontAtlas.wrapS = THREE.ClampToEdgeWrapping;
    storefrontAtlas.wrapT = THREE.ClampToEdgeWrapping;
    storefrontAtlas.anisotropy = 8;
    const recoveredCafeTexture = textureLoader.load("/morning-cafe-recovered.png");
    recoveredCafeTexture.colorSpace = THREE.SRGBColorSpace;
    recoveredCafeTexture.anisotropy = 8;
    const facadeTexture = (index: number) => {
      const texture = storefrontAtlas.clone();
      const quadrant = index % 4;
      texture.repeat.set(0.5, 0.5);
      texture.offset.set(quadrant % 2 === 0 ? 0 : 0.5, quadrant < 2 ? 0.5 : 0);
      texture.needsUpdate = true;
      return texture;
    };

    const asphalt = new THREE.MeshStandardMaterial({
      color: palette.asphalt,
      map: asphaltTexture,
      bumpMap: asphaltTexture,
      bumpScale: 0.075,
      roughness: 0.97,
      metalness: 0.01,
      transparent: true,
      opacity: 0.16,
    });
    const paving = new THREE.MeshStandardMaterial({
      color: palette.paving,
      map: paverTexture,
      bumpMap: paverTexture,
      bumpScale: 0.06,
      roughness: 0.93,
      transparent: true,
      opacity: 0.1,
    });
    const curb = new THREE.MeshStandardMaterial({ color: palette.curb, roughness: 0.86 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x222a27, metalness: 0.36, roughness: 0.44 });
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x62645f, metalness: 0.44, roughness: 0.58 });
    const cableMaterial = new THREE.MeshStandardMaterial({ color: 0x1d211f, roughness: 0.68 });
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xb9cbc5,
      transparent: true,
      opacity: 0.38,
      roughness: 0.1,
      metalness: 0.05,
      transmission: 0.15,
      clearcoat: 0.5,
      depthWrite: false,
    });

    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 14),
      new THREE.Vector3(-0.08, 0, 4),
      new THREE.Vector3(0.22, 0, -7),
      new THREE.Vector3(-0.26, 0, -19),
      new THREE.Vector3(0.12, 0, -32),
      new THREE.Vector3(-0.08, 0, -46),
      new THREE.Vector3(0, 0, -61),
    ]);
    curve.curveType = "catmullrom";
    curve.tension = 0.52;

    world.add(
      createStrip(curve, 3.05, -3.05, asphalt, 0),
      createStrip(curve, 5.45, 3.08, paving, 0.13),
      createStrip(curve, -3.08, -5.45, paving, 0.13),
    );

    for (const offset of [3.05, -3.05, 5.45, -5.45]) {
      const edge = new THREE.Mesh(
        new THREE.TubeGeometry(
          curveFromOffset(curve, offset, Math.abs(offset) === 3.05 ? 0.18 : 0.14),
          220,
          Math.abs(offset) === 3.05 ? 0.058 : 0.034,
          8,
          false,
        ),
        curb,
      );
      edge.receiveShadow = true;
      world.add(edge);
    }

    const patchMaterial = new THREE.MeshStandardMaterial({ color: 0x2d312f, roughness: 0.99 });
    [0.11, 0.29, 0.47, 0.67, 0.84].forEach((t, index) => {
      const point = curve.getPointAt(t);
      const patch = new THREE.Mesh(new THREE.PlaneGeometry(1.1 + (index % 2) * 0.55, 2.4), patchMaterial);
      patch.rotation.x = -Math.PI / 2;
      patch.rotation.z = (index - 2) * 0.07;
      patch.position.set(point.x + (index % 2 ? 0.7 : -0.55), 0.012, point.z);
      patch.receiveShadow = true;
      world.add(patch);
    });

    const drainMaterial = new THREE.MeshStandardMaterial({ color: 0x3b403d, metalness: 0.62, roughness: 0.48 });
    [0.19, 0.43, 0.72].forEach((t, index) => {
      const drain = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.035, 0.72), drainMaterial);
      drain.position.copy(sideAt(curve, t, index % 2 === 0 ? 2.72 : -2.72)).setY(0.04);
      drain.rotation.y = Math.atan2(curve.getTangentAt(t).x, curve.getTangentAt(t).z);
      world.add(drain);
      for (let slot = -2; slot <= 2; slot += 1) {
        const groove = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.015, 0.58), darkMetal);
        groove.position.set(drain.position.x + slot * 0.06, 0.064, drain.position.z);
        groove.rotation.y = drain.rotation.y;
        world.add(groove);
      }
    });

    const shops: ShopConfig[] = [
      { name: "아침카페", wall: 0x5d5149, accent: 0x285c4d, width: 4.8, height: 4.2, depth: 3.6 },
      { name: "우리상회", wall: 0x8a6658, accent: 0x8b3f32, width: 4.3, height: 4.6, depth: 3.2 },
      { name: "온기식당", wall: 0x9a978d, accent: 0x315a4b, width: 5.1, height: 4.1, depth: 3.8 },
      { name: "동네세탁", wall: 0x6f7779, accent: 0x365a68, width: 4.5, height: 4.5, depth: 3.4 },
      { name: "한결공방", wall: 0x7d5c50, accent: 0x704336, width: 4.8, height: 4.4, depth: 3.7 },
      { name: "마을서점", wall: 0x8d8b82, accent: 0x355443, width: 4.6, height: 4.2, depth: 3.5 },
      { name: "새봄반찬", wall: 0x7f695d, accent: 0x8c493a, width: 4.5, height: 4.3, depth: 3.4 },
      { name: "한마음약국", wall: 0x8d938b, accent: 0x2f6655, width: 4.9, height: 4.7, depth: 3.8 },
    ];
    const shopTs = [0.22, 0.31, 0.4, 0.49, 0.58, 0.68, 0.78, 0.87];
    shopTs.forEach((t, index) => {
      const side = index % 2 === 0 ? 1 : -1;
      const shop = createStorefront(shops[index], {
        glass,
        dark: darkMetal,
        facade: facadeTexture(index),
        wallMap: brickTexture,
      });
      shop.position.copy(sideAt(curve, t, side * (5.8 + shops[index].depth * 0.25)));
      const roadPoint = curve.getPointAt(t);
      shop.lookAt(roadPoint.x, shop.position.y, roadPoint.z);
      world.add(shop);
    });

    const brickWallMaterial = new THREE.MeshStandardMaterial({
      color: palette.brick,
      map: brickTexture,
      bumpMap: brickTexture,
      bumpScale: 0.05,
      roughness: 0.92,
    });
    const sideWall = new THREE.Mesh(new THREE.BoxGeometry(8.4, 3.2, 0.5), brickWallMaterial);
    sideWall.position.copy(sideAt(curve, 0.9, 6.15)).setY(1.6);
    const sideWallTarget = curve.getPointAt(0.9);
    sideWall.lookAt(sideWallTarget.x, sideWall.position.y, sideWallTarget.z);
    sideWall.castShadow = true;
    sideWall.receiveShadow = true;
    world.add(sideWall);

    const poleEntries: { left: THREE.Group; right: THREE.Group }[] = [];
    [0.13, 0.35, 0.57, 0.79].forEach((t) => {
      const left = createUtilityPole(poleMaterial);
      const right = createUtilityPole(poleMaterial);
      left.position.copy(sideAt(curve, t, 5.08));
      right.position.copy(sideAt(curve, t, -5.08));
      world.add(left, right);
      poleEntries.push({ left, right });
    });
    for (let index = 0; index < poleEntries.length - 1; index += 1) {
      for (const side of ["left", "right"] as const) {
        const start = poleEntries[index][side].position.clone().add(new THREE.Vector3(0, 5.9, 0));
        const end = poleEntries[index + 1][side].position.clone().add(new THREE.Vector3(0, 5.9, 0));
        const middle = start.clone().lerp(end, 0.5);
        middle.y -= 0.42;
        world.add(createCable([start, middle, end], cableMaterial));
      }
      const acrossLeft = poleEntries[index].left.position.clone().add(new THREE.Vector3(0, 5.75, 0));
      const acrossRight = poleEntries[index].right.position.clone().add(new THREE.Vector3(0, 5.75, 0));
      const acrossMiddle = acrossLeft.clone().lerp(acrossRight, 0.5);
      acrossMiddle.y -= 0.2;
      world.add(createCable([acrossLeft, acrossMiddle, acrossRight], cableMaterial));
    }

    const missionTs = [0.25, 0.52, 0.77];
    const missionCopy = [
      ["사정 듣기", "변화의 이유를 말합니다"],
      ["습관 만들기", "작은 행동을 기록합니다"],
      ["상담 준비", "검토할 근거를 모읍니다"],
    ];
    const missionMarkers: THREE.Group[] = [];
    missionTs.forEach((t, index) => {
      const marker = new THREE.Group();
      const point = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t);
      marker.position.copy(point).setY(0.035);
      marker.rotation.y = Math.atan2(tangent.x, tangent.z);

      const texture = makeRoadDecalTexture(missionCopy[index][0], missionCopy[index][1]);
      const decal = new THREE.Mesh(
        new THREE.PlaneGeometry(2.7, 0.79),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }),
      );
      decal.rotation.x = -Math.PI / 2;
      decal.rotation.z = Math.PI;
      marker.add(decal);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.78, 0.84, 48),
        new THREE.MeshBasicMaterial({ color: palette.amber, transparent: true, opacity: 0.48, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(0, 0.014, 0.82);
      marker.add(ring);
      marker.userData.ring = ring;
      world.add(marker);
      missionMarkers.push(marker);
    });

    const destination = new THREE.Group();
    const cafeWallMaterial = new THREE.MeshStandardMaterial({
      color: 0x4e514d,
      map: brickTexture,
      bumpMap: brickTexture,
      bumpScale: 0.045,
      roughness: 0.86,
    });
    const cafeTrimMaterial = new THREE.MeshStandardMaterial({
      color: 0x21493f,
      roughness: 0.42,
      metalness: 0.08,
    });
    const cafeBody = new THREE.Mesh(new THREE.BoxGeometry(8.9, 6.2, 5), cafeWallMaterial);
    cafeBody.position.set(0, 3.1, -2.5);
    cafeBody.castShadow = true;
    cafeBody.receiveShadow = true;
    destination.add(cafeBody);

    const portalMaterial = new THREE.MeshBasicMaterial({
      map: recoveredCafeTexture,
      transparent: true,
      opacity: 0.02,
      toneMapped: false,
    });
    const portal = new THREE.Mesh(new THREE.PlaneGeometry(7.72, 4.34), portalMaterial);
    portal.position.set(0, 2.48, 0.065);
    destination.add(portal);

    const shutterMaterial = new THREE.MeshStandardMaterial({
      color: 0x66645f,
      roughness: 0.8,
      metalness: 0.32,
      transparent: true,
    });
    const shutterGrooveMaterial = new THREE.MeshStandardMaterial({
      color: 0x2f3331,
      roughness: 0.7,
      transparent: true,
    });
    const shutter = new THREE.Mesh(new THREE.BoxGeometry(7.84, 4.42, 0.11), shutterMaterial);
    shutter.position.set(0, 2.48, 0.13);
    shutter.castShadow = true;
    destination.add(shutter);
    for (let index = 0; index < 14; index += 1) {
      const groove = new THREE.Mesh(new THREE.BoxGeometry(7.76, 0.022, 0.035), shutterGrooveMaterial);
      groove.position.set(0, 0.34 + index * 0.3, 0.2);
      destination.add(groove);
      groove.userData.isShutterGroove = true;
      groove.userData.baseY = groove.position.y;
    }

    const renewalGroup = new THREE.Group();
    renewalGroup.scale.setScalar(0.001);
    const cafeSignTexture = makeSignTexture("아침카페", "#fff8e8", "#21493f");
    const cafeSign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.8, 0.82),
      new THREE.MeshBasicMaterial({ map: cafeSignTexture, toneMapped: false }),
    );
    cafeSign.position.set(0, 5.55, 0.08);
    renewalGroup.add(cafeSign);
    const cafeAwning = new THREE.Mesh(new THREE.BoxGeometry(8.18, 0.16, 1.02), cafeTrimMaterial);
    cafeAwning.position.set(0, 4.92, 0.43);
    cafeAwning.rotation.x = 0.12;
    cafeAwning.castShadow = true;
    renewalGroup.add(cafeAwning);
    const frameTop = new THREE.Mesh(new THREE.BoxGeometry(7.92, 0.13, 0.18), cafeTrimMaterial);
    frameTop.position.set(0, 4.7, 0.12);
    renewalGroup.add(frameTop);
    for (const x of [-3.88, 3.88]) {
      const frameSide = new THREE.Mesh(new THREE.BoxGeometry(0.14, 4.5, 0.18), cafeTrimMaterial);
      frameSide.position.set(x, 2.46, 0.12);
      renewalGroup.add(frameSide);
    }
    destination.add(renewalGroup);

    const oldCrates = new THREE.Group();
    const crateMaterial = new THREE.MeshStandardMaterial({ color: 0x5f554a, roughness: 0.96 });
    for (let index = 0; index < 4; index += 1) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.5, 0.68), crateMaterial);
      crate.position.set(-2.8 + index * 0.88, 0.3 + (index % 2) * 0.08, 0.62 + (index % 2) * 0.18);
      crate.rotation.y = (index - 1.5) * 0.08;
      crate.castShadow = true;
      oldCrates.add(crate);
    }
    destination.add(oldCrates);

    destination.position.copy(sideAt(curve, 0.975, 0));
    destination.position.z -= 3.4;
    destination.lookAt(curve.getPointAt(0.91));
    world.add(destination);

    destination.updateMatrixWorld(true);
    const cafeGlow = new THREE.PointLight(0xffd596, 0, 30, 1.55);
    cafeGlow.position.copy(destination.localToWorld(new THREE.Vector3(0, 3.1, 1.2)));
    scene.add(cafeGlow);

    const dustPositions: number[] = [];
    const random = seededRandom(933);
    for (let index = 0; index < 90; index += 1) {
      dustPositions.push((random() - 0.5) * 8.2, random() * 5.4, (random() - 0.5) * 2.2);
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute("position", new THREE.Float32BufferAttribute(dustPositions, 3));
    const dustMaterial = new THREE.PointsMaterial({
      color: 0xffe4ad,
      size: 0.055,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const cafeDust = new THREE.Points(dustGeometry, dustMaterial);
    cafeDust.position.copy(destination.position).add(new THREE.Vector3(0, 0.3, 1));
    cafeDust.rotation.copy(destination.rotation);
    world.add(cafeDust);

    const bollardMaterial = new THREE.MeshStandardMaterial({ color: palette.green, roughness: 0.52, metalness: 0.22 });
    [0.24, 0.5, 0.75, 0.88].forEach((t, index) => {
      for (const side of [-1, 1]) {
        const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.72, 14), bollardMaterial);
        bollard.position.copy(sideAt(curve, t + index * 0.006, side * 3.55)).setY(0.5);
        bollard.castShadow = true;
        world.add(bollard);
      }
    });

    const hemisphere = new THREE.HemisphereLight(0xfff4dc, 0x4d564f, 1.85);
    scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xffd7a3, 3.25);
    sun.position.set(-14, 19, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 20;
    sun.shadow.camera.bottom = -12;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 68;
    sun.shadow.bias = -0.00018;
    scene.add(sun);
    const warmFill = new THREE.PointLight(0xffc98a, 1.1, 18, 2);
    warmFill.position.set(-4, 3, -4);
    scene.add(warmFill);

    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = reducedMotionQuery.matches;
    let targetProgress = 0;
    let smoothProgress = 0;
    let previousProgress = 0;
    let walkingAmount = 0;
    let stepPhase = 0;
    let pointerX = 0;
    let pointerY = 0;
    let frame = 0;
    let disposed = false;
    let lastSentProgress = -1;
    let lastMission = -1;
    let enterDispatched = false;
    const clock = new THREE.Clock();
    const fogStart = new THREE.Color(0x777a75);
    const fogFinish = new THREE.Color(0xf4dfbf);
    const wallStart = new THREE.Color(0x4e514d);
    const wallFinish = new THREE.Color(0xc7b69c);

    const scrollTrigger = ScrollTrigger.create({
      trigger: page,
      start: "top top",
      end: "bottom bottom",
      scrub: true,
      onUpdate: (self) => {
        targetProgress = self.progress;
      },
    });

    const onPointerMove = (event: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      pointerX = THREE.MathUtils.clamp(((event.clientX - rect.left) / rect.width - 0.5) * 2, -1, 1);
      pointerY = THREE.MathUtils.clamp(((event.clientY - rect.top) / rect.height - 0.5) * 2, -1, 1);
    };
    const onPointerLeave = () => {
      pointerX = 0;
      pointerY = 0;
    };
    const onMotionPreferenceChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
    };

    root.addEventListener("pointermove", onPointerMove, { passive: true });
    root.addEventListener("pointerleave", onPointerLeave);
    reducedMotionQuery.addEventListener("change", onMotionPreferenceChange);

    const resize = () => {
      const width = Math.max(1, root.clientWidth);
      const height = Math.max(1, root.clientHeight);
      camera.aspect = width / height;
      camera.fov = width / height < 0.72 ? 68 : 58;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, width < 760 ? 1.2 : 1.5));
      renderer.setSize(width, height, false);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(root);

    const render = () => {
      if (disposed) return;
      frame = window.requestAnimationFrame(render);
      const delta = Math.min(clock.getDelta(), 0.05);
      previousProgress = smoothProgress;
      if (reducedMotion) {
        smoothProgress = targetProgress < 0.18 ? 0 : targetProgress < 0.5 ? 0.35 : targetProgress < 0.82 ? 0.67 : 0.92;
      } else {
        smoothProgress = THREE.MathUtils.damp(smoothProgress, targetProgress, 5.8, delta);
      }

      const progressVelocity = delta > 0 ? Math.abs(smoothProgress - previousProgress) / delta : 0;
      const motionTarget = THREE.MathUtils.clamp(progressVelocity * 2.9, 0, 1);
      walkingAmount = THREE.MathUtils.damp(walkingAmount, motionTarget, motionTarget > walkingAmount ? 8 : 4.2, delta);
      stepPhase += delta * (5.8 + walkingAmount * 2.5) * walkingAmount;

      const restoration = THREE.MathUtils.smoothstep(smoothProgress, 0.18, 0.84);
      const reveal = THREE.MathUtils.smoothstep(smoothProgress, 0.56, 0.88);
      const arrival = THREE.MathUtils.smoothstep(smoothProgress, 0.86, 0.992);
      renderer.toneMappingExposure = 0.76 + restoration * 0.62 + arrival * 0.22;
      scene.fog?.color.lerpColors(fogStart, fogFinish, restoration);
      hemisphere.intensity = 1.15 + restoration * 1.18;
      sun.intensity = 1.45 + restoration * 3.2;
      warmFill.intensity = 0.28 + restoration * 1.45;
      cafeGlow.intensity = reveal * 5.4 + arrival * 10.5;
      cafeWallMaterial.color.lerpColors(wallStart, wallFinish, restoration);
      portalMaterial.opacity = 0.02 + reveal * 0.96;
      portal.scale.setScalar(0.975 + reveal * 0.025);
      const shutterLift = reveal * 5.15;
      shutter.position.y = 2.48 + shutterLift;
      shutterMaterial.opacity = 1 - THREE.MathUtils.smoothstep(smoothProgress, 0.63, 0.8);
      shutterGrooveMaterial.opacity = shutterMaterial.opacity;
      destination.children.forEach((child) => {
        if (child.userData.isShutterGroove) child.position.y = Number(child.userData.baseY) + shutterLift;
      });
      const renewalScale = Math.max(0.001, THREE.MathUtils.smoothstep(smoothProgress, 0.52, 0.8));
      renewalGroup.scale.setScalar(renewalScale);
      oldCrates.scale.setScalar(Math.max(0.001, 1 - THREE.MathUtils.smoothstep(smoothProgress, 0.29, 0.55)));
      dustMaterial.opacity = THREE.MathUtils.smoothstep(smoothProgress, 0.72, 0.94) * 0.72;
      cafeDust.position.y = destination.position.y + 0.3 + Math.sin(clock.elapsedTime * 0.34) * 0.11;

      const roadProgress = Math.min(smoothProgress / 0.9, 1);
      const t = THREE.MathUtils.clamp(0.018 + roadProgress * 0.89, 0.018, 0.908);
      const point = curve.getPointAt(t);
      const ahead = curve.getPointAt(Math.min(0.98, t + 0.026));
      const bob = reducedMotion ? 0 : Math.abs(Math.sin(stepPhase)) * 0.042 * walkingAmount;
      const sway = reducedMotion ? 0 : Math.sin(stepPhase) * 0.022 * walkingAmount;
      const impact = reducedMotion ? 0 : Math.sin(stepPhase * 2) * 0.008 * walkingAmount;
      const lookX = reducedMotion ? 0 : pointerX * 0.19;
      const lookY = reducedMotion ? 0 : pointerY * 0.075;

      const cafeEntry = destination.localToWorld(new THREE.Vector3(0, 1.66, 0.92));
      const cafeFocus = destination.localToWorld(new THREE.Vector3(0, 2.48, -0.48));
      const cameraPoint = new THREE.Vector3(point.x + sway, 1.66 + bob, point.z).lerp(cafeEntry, arrival);
      const focusPoint = new THREE.Vector3(ahead.x + lookX * (1 - arrival), 1.57 - lookY * (1 - arrival) + bob * 0.18, ahead.z).lerp(cafeFocus, arrival);
      camera.position.copy(cameraPoint);
      camera.lookAt(focusPoint);
      camera.rotation.z = reducedMotion ? 0 : -sway * 0.12 + impact;
      const roadFov = (root.clientWidth / root.clientHeight < 0.72 ? 68 : 58) + walkingAmount * 1.6;
      camera.fov = THREE.MathUtils.damp(camera.fov, THREE.MathUtils.lerp(roadFov, 44, arrival), 5, delta);
      camera.updateProjectionMatrix();

      missionMarkers.forEach((marker, index) => {
        const proximity = THREE.MathUtils.clamp(1 - Math.abs(smoothProgress - missionTs[index]) * 12, 0, 1);
        const ring = marker.userData.ring as THREE.Mesh;
        ring.scale.setScalar(1 + proximity * 0.12);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.34 + proximity * 0.5;
      });

      const mission = smoothProgress < 0.36 ? 0 : smoothProgress < 0.67 ? 1 : 2;
      if (Math.abs(smoothProgress - lastSentProgress) > 0.0025 || mission !== lastMission) {
        window.dispatchEvent(
          new CustomEvent<ProgressDetail>("donghaeng:progress", {
            detail: { progress: smoothProgress, mission },
          }),
        );
        root.style.setProperty("--scene-progress", smoothProgress.toFixed(4));
        page.style.setProperty("--scene-progress", smoothProgress.toFixed(4));
        lastSentProgress = smoothProgress;
        lastMission = mission;
      }

      if (!enterDispatched && targetProgress > 0.997 && smoothProgress > 0.982) {
        enterDispatched = true;
        root.classList.add("is-entering-cafe");
        window.dispatchEvent(new CustomEvent("donghaeng:enter-demo"));
      }

      renderer.render(scene, camera);
    };

    resize();
    ScrollTrigger.refresh();
    root.classList.add("is-ready");
    render();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      scrollTrigger.kill();
      resizeObserver.disconnect();
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerleave", onPointerLeave);
      reducedMotionQuery.removeEventListener("change", onMotionPreferenceChange);
      page.style.removeProperty("--scene-progress");
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
          object.geometry?.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => {
            for (const key of ["map", "bumpMap", "normalMap", "roughnessMap"] as const) {
              const texture = (material as THREE.MeshStandardMaterial)[key];
              texture?.dispose();
            }
            material.dispose();
          });
        }
      });
      asphaltTexture.dispose();
      paverTexture.dispose();
      brickTexture.dispose();
      storefrontAtlas.dispose();
      recoveredCafeTexture.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div className="three-mission-road" ref={rootRef} aria-hidden="true">
      <div className="three-mission-road-backdrop" />
      <canvas ref={canvasRef} />
      <div className="three-mission-road-finish" />
      <span className="three-mission-road-error">3D 장면을 표시할 수 없어 거리 사진으로 안내합니다.</span>
    </div>
  );
}
