"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const palette = {
  paper: 0xf7f2e8,
  porcelain: 0xfffcf6,
  ink: 0x17312c,
  green: 0x17483f,
  mint: 0xb8d6c8,
  apricot: 0xefc39b,
  gold: 0xd49a55,
};

function smoothstep(min: number, max: number, value: number) {
  const x = THREE.MathUtils.clamp((value - min) / (max - min), 0, 1);
  return x * x * (3 - 2 * x);
}

function roundedShape(width: number, height: number, radius: number) {
  const x = -width / 2;
  const y = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

function roundedPanel(width: number, height: number, depth: number, radius: number, material: THREE.Material) {
  const geometry = new THREE.ExtrudeGeometry(roundedShape(width, height, radius), {
    depth,
    bevelEnabled: true,
    bevelSegments: 4,
    bevelSize: Math.min(radius * 0.26, 0.08),
    bevelThickness: Math.min(depth * 0.28, 0.06),
    curveSegments: 8,
  });
  geometry.center();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createLabel(text: string, detail: string, accent: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.Sprite();

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(255,252,246,.94)";
  context.beginPath();
  context.roundRect(12, 12, 744, 232, 34);
  context.fill();
  context.strokeStyle = "rgba(23,72,63,.2)";
  context.lineWidth = 3;
  context.stroke();
  context.fillStyle = accent;
  context.fillRect(46, 45, 10, 164);
  context.fillStyle = "#17312c";
  context.font = "700 52px 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
  context.fillText(text, 88, 112);
  context.fillStyle = "#65736e";
  context.font = "500 28px 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
  context.fillText(detail, 88, 171);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.35, 0.78, 1);
  sprite.userData.texture = texture;
  return sprite;
}

function createCheck(material: THREE.Material) {
  const group = new THREE.Group();
  const short = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.38, 0.08), material);
  short.rotation.z = -0.72;
  short.position.set(-0.13, -0.08, 0);
  const long = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.66, 0.08), material);
  long.rotation.z = 0.72;
  long.position.set(0.14, 0.04, 0);
  short.castShadow = true;
  long.castShadow = true;
  group.add(short, long);
  return group;
}

function createPerson(materials: { body: THREE.Material; skin: THREE.Material; accent: THREE.Material }) {
  const person = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.31, 0.72, 24), materials.body);
  body.position.y = 0.75;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 24, 18), materials.skin);
  head.position.y = 1.35;
  const apron = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.48, 0.08), materials.accent);
  apron.position.set(0, 0.74, 0.23);
  apron.rotation.x = -0.04;

  const leftArmPivot = new THREE.Group();
  const rightArmPivot = new THREE.Group();
  const armGeometry = new THREE.CylinderGeometry(0.075, 0.09, 0.58, 16);
  const leftArm = new THREE.Mesh(armGeometry, materials.skin);
  const rightArm = new THREE.Mesh(armGeometry, materials.skin);
  leftArm.position.y = -0.26;
  rightArm.position.y = -0.26;
  leftArmPivot.position.set(-0.31, 1.02, 0);
  rightArmPivot.position.set(0.31, 1.02, 0);
  leftArmPivot.rotation.z = -0.2;
  rightArmPivot.rotation.z = 0.2;
  leftArmPivot.add(leftArm);
  rightArmPivot.add(rightArm);

  const legGeometry = new THREE.CylinderGeometry(0.085, 0.09, 0.52, 16);
  const leftLeg = new THREE.Mesh(legGeometry, materials.body);
  const rightLeg = new THREE.Mesh(legGeometry, materials.body);
  leftLeg.position.set(-0.13, 0.2, 0);
  rightLeg.position.set(0.13, 0.2, 0);
  [body, head, apron, leftArm, rightArm, leftLeg, rightLeg].forEach((mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  person.add(body, head, apron, leftArmPivot, rightArmPivot, leftLeg, rightLeg);
  person.userData.leftArm = leftArmPivot;
  person.userData.rightArm = rightArmPivot;
  return person;
}

function createRibbon(curve: THREE.CatmullRomCurve3, halfWidth: number, material: THREE.Material) {
  const left: THREE.Vector3[] = [];
  const right: THREE.Vector3[] = [];
  const segments = 80;
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    left.push(point.clone().addScaledVector(normal, halfWidth));
    right.push(point.clone().addScaledVector(normal, -halfWidth));
  }

  const shape = new THREE.Shape();
  shape.moveTo(left[0].x, left[0].z);
  left.slice(1).forEach((point) => shape.lineTo(point.x, point.z));
  right.slice().reverse().forEach((point) => shape.lineTo(point.x, point.z));
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.26,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.08,
    bevelThickness: 0.06,
  });
  geometry.rotateX(Math.PI / 2);
  const ribbon = new THREE.Mesh(geometry, material);
  ribbon.position.y = 0.28;
  ribbon.receiveShadow = true;
  ribbon.castShadow = true;

  const leftCurve = new THREE.CatmullRomCurve3(left.map((point) => new THREE.Vector3(point.x, 0.34, point.z)));
  const rightCurve = new THREE.CatmullRomCurve3(right.map((point) => new THREE.Vector3(point.x, 0.34, point.z)));
  return { ribbon, leftCurve, rightCurve };
}

export default function ThreeRecoveryJourneyScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
    camera.position.set(0.9, 7.9, 14.5);
    camera.lookAt(0.7, 0.4, 0);

    const world = new THREE.Group();
    scene.add(world);

    const paperMaterial = new THREE.MeshPhysicalMaterial({ color: palette.paper, roughness: 0.48, metalness: 0.02, clearcoat: 0.28, clearcoatRoughness: 0.42 });
    const porcelainMaterial = new THREE.MeshPhysicalMaterial({ color: palette.porcelain, roughness: 0.32, metalness: 0.02, clearcoat: 0.4 });
    const greenMaterial = new THREE.MeshPhysicalMaterial({ color: palette.green, roughness: 0.34, metalness: 0.08, clearcoat: 0.28 });
    const mintMaterial = new THREE.MeshPhysicalMaterial({ color: palette.mint, roughness: 0.4, metalness: 0.02, clearcoat: 0.22 });
    const apricotMaterial = new THREE.MeshPhysicalMaterial({ color: palette.apricot, roughness: 0.4, metalness: 0.02, clearcoat: 0.2 });
    const goldMaterial = new THREE.MeshPhysicalMaterial({ color: palette.gold, emissive: 0x4a2811, emissiveIntensity: 0.2, roughness: 0.28, metalness: 0.22, clearcoat: 0.5 });
    const glassMaterial = new THREE.MeshPhysicalMaterial({ color: 0xe6f2eb, transparent: true, opacity: 0.56, roughness: 0.14, metalness: 0.02, transmission: 0.18, thickness: 0.6, clearcoat: 0.6, depthWrite: false });

    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-7.0, 0.38, 2.0),
      new THREE.Vector3(-4.6, 0.38, 1.25),
      new THREE.Vector3(-1.7, 0.38, -0.25),
      new THREE.Vector3(1.2, 0.38, 0.15),
      new THREE.Vector3(4.0, 0.38, -1.25),
      new THREE.Vector3(6.7, 0.38, -1.7),
    ]);
    const { ribbon, leftCurve, rightCurve } = createRibbon(curve, 1.25, paperMaterial);
    world.add(ribbon);

    const railMaterial = new THREE.MeshStandardMaterial({ color: palette.green, emissive: palette.green, emissiveIntensity: 0.12, roughness: 0.38 });
    const accentRailMaterial = new THREE.MeshStandardMaterial({ color: palette.gold, emissive: palette.gold, emissiveIntensity: 0.35, roughness: 0.3 });
    const leftRail = new THREE.Mesh(new THREE.TubeGeometry(leftCurve, 120, 0.055, 12, false), railMaterial);
    const rightRail = new THREE.Mesh(new THREE.TubeGeometry(rightCurve, 120, 0.07, 12, false), accentRailMaterial);
    world.add(leftRail, rightRail);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(34, 22), new THREE.ShadowMaterial({ color: 0x695f53, opacity: 0.12 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.12;
    floor.receiveShadow = true;
    world.add(floor);

    const interview = new THREE.Group();
    interview.position.set(-4.7, 1.74, 1.2);
    const interviewBack = roundedPanel(2.05, 2.75, 0.5, 0.28, greenMaterial);
    const interviewScreen = roundedPanel(1.55, 2.12, 0.12, 0.22, glassMaterial);
    interviewScreen.position.z = 0.33;
    const micStem = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.48, 18), goldMaterial);
    micStem.position.set(0, -0.06, 0.55);
    const micHead = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.24, 6, 16), goldMaterial);
    micHead.position.set(0, 0.28, 0.55);
    const micBase = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.045, 10, 28, Math.PI), goldMaterial);
    micBase.position.set(0, -0.22, 0.55);
    micBase.rotation.z = Math.PI;
    interview.add(interviewBack, interviewScreen, micStem, micHead, micBase);
    const interviewLabel = createLabel("AI 인터뷰", "사정과 변화를 듣습니다", "#17483f");
    interviewLabel.position.set(0, -1.95, 0.45);
    interview.add(interviewLabel);
    world.add(interview);

    const waveRings: THREE.Mesh[] = [];
    for (let index = 0; index < 3; index += 1) {
      const material = new THREE.MeshBasicMaterial({ color: palette.gold, transparent: true, opacity: 0.5, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3 + index * 0.18, 0.025, 10, 48, Math.PI * 1.25), material);
      ring.position.set(-3.65 + index * 0.08, 1.84, 0.92);
      ring.rotation.set(0.2, -0.45, -0.25);
      world.add(ring);
      waveRings.push(ring);
    }

    const goals = new THREE.Group();
    goals.position.set(-0.25, 0.74, -0.2);
    const goalTiles: THREE.Group[] = [];
    const goalLabels = ["매출 흐름", "지출 습관", "상환 준비"];
    goalLabels.forEach((label, index) => {
      const tile = new THREE.Group();
      const panel = roundedPanel(1.25, 1.55, 0.18, 0.16, index === 1 ? mintMaterial : porcelainMaterial);
      panel.rotation.x = -0.12;
      const check = createCheck(index === 2 ? goldMaterial : greenMaterial);
      check.position.set(0, 0.08, 0.2);
      check.scale.setScalar(0.001);
      const sprite = createLabel(label, `${index + 1}번째 실행 목표`, index === 2 ? "#d49a55" : "#17483f");
      sprite.scale.multiplyScalar(0.58);
      sprite.position.set(0, -1.22, 0.2);
      tile.position.set((index - 1) * 1.1, index * 0.16, (index - 1) * -0.28);
      tile.rotation.y = (index - 1) * -0.12;
      tile.add(panel, check, sprite);
      tile.userData.check = check;
      goals.add(tile);
      goalTiles.push(tile);
    });
    world.add(goals);

    const shop = new THREE.Group();
    shop.position.set(4.35, 1.08, -1.25);
    const shopBody = roundedPanel(2.55, 2.35, 0.62, 0.18, porcelainMaterial);
    const roof = roundedPanel(2.9, 0.34, 0.78, 0.14, greenMaterial);
    roof.position.y = 1.27;
    const sign = roundedPanel(1.35, 0.42, 0.12, 0.12, apricotMaterial);
    sign.position.set(0, 0.72, 0.4);
    const windowLeft = roundedPanel(0.58, 0.72, 0.08, 0.08, glassMaterial);
    const windowRight = roundedPanel(0.58, 0.72, 0.08, 0.08, glassMaterial);
    windowLeft.position.set(-0.72, -0.1, 0.39);
    windowRight.position.set(0.72, -0.1, 0.39);
    const doorPivot = new THREE.Group();
    doorPivot.position.set(-0.38, -0.38, 0.41);
    const door = roundedPanel(0.76, 1.28, 0.09, 0.08, greenMaterial);
    door.position.x = 0.38;
    doorPivot.add(door);
    shop.add(shopBody, roof, sign, windowLeft, windowRight, doorPivot);
    const shopLabel = createLabel("대출 상담 준비", "은행이 검토할 근거를 만듭니다", "#d49a55");
    shopLabel.position.set(0, -1.9, 0.45);
    shop.add(shopLabel);
    shop.userData.doorPivot = doorPivot;
    world.add(shop);

    const person = createPerson({ body: greenMaterial, skin: apricotMaterial, accent: goldMaterial });
    person.scale.setScalar(0.88);
    world.add(person);

    const travelOrbMaterial = new THREE.MeshPhysicalMaterial({ color: palette.gold, emissive: palette.gold, emissiveIntensity: 0.45, roughness: 0.18, metalness: 0.12, clearcoat: 0.8, transparent: true, opacity: 0.9 });
    const travelOrbs = Array.from({ length: 4 }, (_, index) => {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.1 + index * 0.018, 20, 16), travelOrbMaterial.clone());
      world.add(orb);
      return orb;
    });

    const hemi = new THREE.HemisphereLight(0xfff8ec, 0x8fa99d, 2.7);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff1d8, 4.4);
    key.position.set(-3, 10, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -12;
    key.shadow.camera.right = 12;
    key.shadow.camera.top = 10;
    key.shadow.camera.bottom = -8;
    scene.add(key);
    const shopLight = new THREE.PointLight(0xffb96e, 0, 8, 2);
    shopLight.position.set(4.2, 2.2, 0.6);
    scene.add(shopLight);

    const clock = new THREE.Clock();
    const pointer = new THREE.Vector2();
    const pointerTarget = new THREE.Vector2();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let inView = true;
    let disposed = false;
    let isExiting = false;
    let exitStartedAt = 0;

    const startExit = () => {
      if (isExiting) return;
      if (reduceMotion) {
        window.dispatchEvent(new CustomEvent("withus:transition-complete"));
        return;
      }
      isExiting = true;
      exitStartedAt = clock.getElapsedTime();
      canvas.style.pointerEvents = "none";
    };

    const onPointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointerTarget.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
    };
    const onPointerLeave = () => pointerTarget.set(0, 0);

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const width = Math.max(1, parent.clientWidth);
      const height = Math.max(1, parent.clientHeight);
      const aspect = width / height;
      camera.aspect = aspect;
      camera.fov = aspect < 0.82 ? 46 : 34;
      camera.position.set(aspect < 0.82 ? 0.3 : 0.9, aspect < 0.82 ? 9.5 : 7.9, aspect < 0.82 ? 17.5 : 14.5);
      world.scale.setScalar(aspect < 0.82 ? 0.76 : 1);
      world.position.set(aspect < 0.82 ? 0.4 : 0, aspect < 0.82 ? -1.8 : 0, 0);
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.45));
      renderer.setSize(width, height, false);
    };

    const render = () => {
      if (disposed) return;
      frame = window.requestAnimationFrame(render);
      if (!inView) return;

      const elapsed = clock.getElapsedTime();
      const exitElapsed = isExiting ? elapsed - exitStartedAt : 0;
      const cycle = (elapsed % 12.8) / 12.8;
      const sequence = isExiting ? THREE.MathUtils.lerp(0.72, 0.92, smoothstep(0, 1.8, exitElapsed)) : cycle;

      let travel = 0.07;
      if (sequence < 0.26) travel = THREE.MathUtils.lerp(0.07, 0.43, smoothstep(0.03, 0.24, sequence));
      else if (sequence < 0.52) travel = 0.43;
      else if (sequence < 0.82) travel = THREE.MathUtils.lerp(0.43, 0.86, smoothstep(0.54, 0.8, sequence));
      else travel = 0.86;

      const personPoint = curve.getPointAt(travel);
      const personTangent = curve.getTangentAt(travel);
      person.position.set(personPoint.x, personPoint.y + 0.22 + Math.sin(elapsed * 2.4) * 0.025, personPoint.z);
      person.rotation.y = Math.atan2(personTangent.x, personTangent.z) + Math.PI;
      const resetFade = 1 - smoothstep(0.94, 1, sequence);
      const enterFade = smoothstep(0, 0.045, sequence);
      person.scale.setScalar(0.88 * Math.max(0.001, resetFade * enterFade));

      const goalWindow = 1 - smoothstep(0.91, 0.99, sequence);
      goalTiles.forEach((tile, index) => {
        const checked = smoothstep(0.28 + index * 0.065, 0.36 + index * 0.065, sequence) * goalWindow;
        const check = tile.userData.check as THREE.Group;
        const pop = checked > 0 ? 1 + Math.sin(Math.min(1, checked) * Math.PI) * 0.16 : 0.001;
        check.scale.setScalar(Math.max(0.001, checked * pop));
        tile.position.y = index * 0.16 + Math.sin(elapsed * 0.55 + index) * 0.035;
      });

      const success = smoothstep(0.76, 0.86, sequence) * (1 - smoothstep(0.94, 1, sequence));
      shopLight.intensity = 8.5 * success;
      (shop.userData.doorPivot as THREE.Group).rotation.y = -0.9 * success;
      const leftArm = person.userData.leftArm as THREE.Group;
      const rightArm = person.userData.rightArm as THREE.Group;
      leftArm.rotation.z = THREE.MathUtils.lerp(-0.2, 2.15, success);
      rightArm.rotation.z = THREE.MathUtils.lerp(0.2, -2.15, success);

      waveRings.forEach((ring, index) => {
        const pulse = (elapsed * 0.42 + index / 3) % 1;
        const scale = 0.72 + pulse * 0.75;
        ring.scale.setScalar(scale);
        (ring.material as THREE.MeshBasicMaterial).opacity = (1 - pulse) * 0.5 * (1 - success);
      });

      travelOrbs.forEach((orb, index) => {
        const orbT = (elapsed * 0.055 + index * 0.11) % 1;
        const point = curve.getPointAt(orbT);
        orb.position.set(point.x, point.y + 0.25 + Math.sin(elapsed * 1.2 + index) * 0.08, point.z);
        (orb.material as THREE.MeshPhysicalMaterial).opacity = 0.18 + Math.sin(orbT * Math.PI) * 0.65;
      });

      pointer.lerp(pointerTarget, 0.035);
      const cameraX = (window.innerWidth < 820 ? 0.3 : 0.9) + pointer.x * 0.42;
      const cameraY = (window.innerWidth < 820 ? 9.5 : 7.9) + pointer.y * 0.24;
      camera.position.x += (cameraX - camera.position.x) * 0.035;
      camera.position.y += (cameraY - camera.position.y) * 0.035;
      camera.lookAt(0.7, 0.35, 0);
      interview.rotation.y = Math.sin(elapsed * 0.42) * 0.035;
      shop.rotation.y = Math.sin(elapsed * 0.36 + 1) * -0.025;
      goals.rotation.y = Math.sin(elapsed * 0.28) * 0.025;

      renderer.render(scene, camera);
      if (isExiting && exitElapsed >= 2.35) {
        disposed = true;
        window.dispatchEvent(new CustomEvent("withus:transition-complete"));
      }
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas.parentElement ?? canvas);
    const visibilityObserver = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; }, { threshold: 0.02 });
    visibilityObserver.observe(canvas);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("withus:start-demo", startExit);
    resize();
    sceneRef.current?.classList.add("is-ready");
    if (reduceMotion) renderer.render(scene, camera);
    else render();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("withus:start-demo", startExit);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
          object.geometry?.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => {
            if (material instanceof THREE.SpriteMaterial && material.map) material.map.dispose();
            material.dispose();
          });
        }
      });
      renderer.dispose();
    };
  }, []);

  return (
    <div className="three-recovery-journey" ref={sceneRef} aria-hidden="true">
      <canvas ref={canvasRef} />
      <span className="three-scene-status">회복 여정을 준비하고 있습니다</span>
    </div>
  );
}
