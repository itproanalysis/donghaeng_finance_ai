"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

type DocumentSpec = {
  eyebrow: string;
  title: string;
  note: string;
  accent: string;
  background: string;
  progress: number;
  adviceTitle: string;
  advice: [string, string];
};

const documents: DocumentSpec[] = [
  { eyebrow: "매출 기록", title: "최근 3개월\n매출 회복", note: "지난달 대비 +18%", accent: "#78936f", background: "#f7f8ef", progress: 0.78, adviceTitle: "매출 회복을\n보여주세요", advice: ["최근 3개월의 상승 추세를 정리", "카드 매출·입금 내역으로 증명"] },
  { eyebrow: "인터뷰 01", title: "사업 공백의\n이유", note: "리뉴얼 기간 3개월", accent: "#9b785f", background: "#f5eee8", progress: 0.62, adviceTitle: "공백을 설명 가능한\n사건으로", advice: ["공백 원인과 기간을 한 문장으로", "재개 시점과 정상화 증빙을 연결"] },
  { eyebrow: "현금흐름", title: "월별 고정비\n점검", note: "임대료 · 인건비 · 원재료", accent: "#7d8795", background: "#eef1f5", progress: 0.56, adviceTitle: "고정비를 먼저\n낮춰보세요", advice: ["필수·조정 가능 비용을 구분", "절감 뒤 손익분기점을 다시 계산"] },
  { eyebrow: "상환 계획", title: "매월 가능한\n상환 금액", note: "현금흐름 기준 산정", accent: "#758e86", background: "#edf3ef", progress: 0.68, adviceTitle: "무리 없는 상환선을\n정하세요", advice: ["최저 매출 기준 여유자금으로 산정", "월 상환액은 현금흐름 안에서"] },
  { eyebrow: "동행금융", title: "회복 검토\n파일", note: "다음 상담을 위한 한 장의 근거", accent: "#4d433c", background: "#fbfaf6", progress: 0.9, adviceTitle: "회복 근거를\n한 장으로", advice: ["변화·증빙·계획을 함께 정리", "은행이 다시 볼 이유를 명확하게"] },
  { eyebrow: "준비 자료", title: "확인 가능한\n증빙 목록", note: "카드 매출 · 계좌 흐름", accent: "#a28765", background: "#f4efe6", progress: 0.72, adviceTitle: "말보다 증빙을\n먼저 모으세요", advice: ["카드 매출과 계좌 흐름을 연결", "계약서·세금계산서도 함께 준비"] },
  { eyebrow: "인터뷰 02", title: "지금 달라진\n사업 상황", note: "신규 납품 계약 반영", accent: "#7d8e73", background: "#f0f3ea", progress: 0.82, adviceTitle: "달라진 점을\n숫자로 바꾸세요", advice: ["신규 계약의 예상 매출을 반영", "일회성과 지속 변화를 구분"] },
  { eyebrow: "검토 메모", title: "회복 가능성\n요약", note: "사람이 확인할 수 있도록", accent: "#8b6e82", background: "#f4eef3", progress: 0.64, adviceTitle: "가능성과 위험을\n함께 쓰세요", advice: ["좋아진 신호만 과장하지 않기", "남은 위험과 대응 계획도 제시"] },
  { eyebrow: "다음 단계", title: "금융 상담\n준비 완료", note: "자료와 설명을 한곳에", accent: "#6b7d93", background: "#edf1f5", progress: 1, adviceTitle: "상담 전에 질문을\n준비하세요", advice: ["필요 금액과 사용 목적을 명확히", "상환 계획과 증빙을 한 번에 제출"] },
];

const positions = [
  [-4.3, 2.65, -1.6, -0.08],
  [0.25, 2.75, -0.45, 0.055],
  [4.9, 2.45, -1.4, 0.11],
  [-4.15, -0.05, -0.5, 0.07],
  [0.45, 0.1, 1.2, -0.035],
  [5.1, -0.2, -1, -0.07],
  [-4.35, -2.75, -1.5, -0.1],
  [0.1, -2.65, -0.35, 0.05],
  [4.7, -2.9, -1.45, 0.09],
] as const;

const mosaicVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const mosaicFragmentShader = `
  uniform sampler2D uFront;
  uniform sampler2D uAdvice;
  uniform float uProgress;
  varying vec2 vUv;

  float randomCell(vec2 cell) {
    return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 grid = vec2(20.0, 12.0);
    vec2 cell = floor(vUv * grid);
    vec2 tileUv = fract(vUv * grid);
    float sweep = (cell.x / grid.x) * 0.18 + (1.0 - cell.y / grid.y) * 0.12;
    float delay = randomCell(cell) * 0.48 + sweep;
    float growth = smoothstep(delay, delay + 0.20, uProgress);
    float edge = max(abs(tileUv.x - 0.5), abs(tileUv.y - 0.5));
    float tile = 1.0 - smoothstep(growth * 0.54 - 0.035, growth * 0.54, edge);
    vec4 front = texture2D(uFront, vUv);
    vec4 advice = texture2D(uAdvice, vUv);
    gl_FragColor = mix(front, advice, tile);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function createTexture(spec: DocumentSpec, renderer: THREE.WebGLRenderer) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 620;
  const context = canvas.getContext("2d");

  if (!context) return null;

  context.fillStyle = spec.background;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = spec.accent;
  context.fillRect(0, 0, 18, canvas.height);

  context.fillStyle = "rgba(53, 48, 44, .12)";
  context.fillRect(70, 82, 884, 2);

  context.font = "600 25px 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
  context.fillStyle = spec.accent;
  context.fillText(spec.eyebrow, 72, 55);

  context.font = "700 64px 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
  context.fillStyle = "#302a26";
  spec.title.split("\n").forEach((line, index) => context.fillText(line, 72, 184 + index * 72));

  context.font = "400 25px 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
  context.fillStyle = "#766b63";
  context.fillText(spec.note, 72, 374);

  context.fillStyle = "rgba(48, 42, 38, .1)";
  context.fillRect(72, 432, 760, 12);
  context.fillStyle = spec.accent;
  context.fillRect(72, 432, 760 * spec.progress, 12);

  context.font = "500 20px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.fillStyle = "#8b8179";
  context.fillText(`${String(Math.round(spec.progress * 100)).padStart(2, "0")}% REVIEWED`, 72, 493);

  for (let index = 0; index < 3; index += 1) {
    context.fillStyle = index < 2 ? spec.accent : "rgba(48, 42, 38, .18)";
    context.beginPath();
    context.arc(77 + index * 35, 550, 8, 0, Math.PI * 2);
    context.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;
  return texture;
}

function createAdviceTexture(spec: DocumentSpec, renderer: THREE.WebGLRenderer) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 620;
  const context = canvas.getContext("2d");

  if (!context) return null;

  context.fillStyle = spec.accent;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(255, 255, 255, .12)";
  context.fillRect(0, 0, canvas.width, 14);

  context.font = "600 24px 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
  context.fillStyle = "rgba(255, 255, 255, .72)";
  context.fillText("신용 회복 조언 · 요약", 72, 66);

  context.font = "700 61px 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
  context.fillStyle = "#fffdf8";
  spec.adviceTitle.split("\n").forEach((line, index) => context.fillText(line, 72, 172 + index * 68));

  spec.advice.forEach((line, index) => {
    const y = 386 + index * 72;
    context.fillStyle = "rgba(255, 255, 255, .38)";
    context.beginPath();
    context.arc(80, y - 8, 7, 0, Math.PI * 2);
    context.fill();
    context.font = "500 26px 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
    context.fillStyle = "rgba(255, 255, 255, .9)";
    context.fillText(line, 110, y);
  });

  context.font = "500 19px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.fillStyle = "rgba(255, 255, 255, .55)";
  context.fillText("DONGHAENG · NEXT ACTION", 72, 566);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;
  return texture;
}

export default function ThreeDocumentScene() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch {
      sceneRef.current?.classList.add("has-failed");
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-5, 5, 4, -4, 0.1, 40);
    camera.position.set(0, 0, 12);
    const wall = new THREE.Group();
    wall.rotation.z = -0.045;
    scene.add(wall);

    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const geometry = new THREE.PlaneGeometry(4.25, 2.55);
    const hitGeometry = new THREE.PlaneGeometry(4.34, 2.64);
    const shadowGeometry = new THREE.PlaneGeometry(4.32, 2.62);
    const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x6f6259, transparent: true, opacity: 0.13, depthWrite: false });
    const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
    const cardGroups: THREE.Group[] = [];
    const cardMeshes: THREE.Mesh[] = [];
    const textures: THREE.Texture[] = [];
    const materials: THREE.Material[] = [shadowMaterial, hitMaterial];

    documents.forEach((spec, index) => {
      const texture = createTexture(spec, renderer);
      const adviceTexture = createAdviceTexture(spec, renderer);
      if (!texture || !adviceTexture) return;
      textures.push(texture, adviceTexture);

      const material = new THREE.ShaderMaterial({
        uniforms: {
          uFront: { value: texture },
          uAdvice: { value: adviceTexture },
          uProgress: { value: 0 },
        },
        vertexShader: mosaicVertexShader,
        fragmentShader: mosaicFragmentShader,
        side: THREE.FrontSide,
      });
      materials.push(material);

      const card = new THREE.Group();
      const [x, y, z, rotation] = positions[index];
      card.position.set(x, y, z);
      card.rotation.z = rotation;
      card.userData.baseX = x;
      card.userData.baseY = y;
      card.userData.baseZ = z;
      card.userData.baseRotation = rotation;
      const distance = Math.hypot(x, y);
      card.userData.exitDelay = Math.max(0, 0.24 - Math.min(1, distance / 5.5) * 0.24);
      card.userData.stackX = (index - 4) * 0.055;
      card.userData.stackY = (index - 4) * -0.032;
      card.userData.stackRotation = (index - 4) * 0.008;
      card.userData.index = index;

      const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
      shadow.position.set(0.14, -0.16, -0.08);
      card.add(shadow);

      const face = new THREE.Mesh(geometry, material);
      face.userData.index = index;
      face.renderOrder = index === 4 ? 10 : index;
      card.userData.transitionMaterial = material;
      card.add(face);

      const hitArea = new THREE.Mesh(hitGeometry, hitMaterial);
      hitArea.userData.index = index;
      hitArea.position.z = 0.08;
      card.add(hitArea);

      wall.add(card);
      cardGroups.push(card);
      cardMeshes.push(hitArea);
    });

    const pointer = new THREE.Vector2(0, 0);
    const pointerTarget = new THREE.Vector2(0, 0);
    const raycaster = new THREE.Raycaster();
    const clock = new THREE.Clock();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let hoveredIndex = -1;
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
      hoveredIndex = -1;
      cardGroups.forEach((card) => {
        const transitionMaterial = card.userData.transitionMaterial as THREE.ShaderMaterial;
        transitionMaterial.uniforms.uProgress.value = 0;
      });
      pointerTarget.set(0, 0);
      canvas.style.pointerEvents = "none";
      canvas.style.cursor = "default";
      sceneRef.current?.classList.add("is-exiting");
    };

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const width = Math.max(1, parent.clientWidth);
      const height = Math.max(1, parent.clientHeight);
      const aspect = width / height;
      // Bring the document wall closer while keeping the outer cards inside the viewport.
      const viewHeight = Math.max(9.3, 14.7 / aspect);
      camera.left = (-viewHeight * aspect) / 2;
      camera.right = (viewHeight * aspect) / 2;
      camera.top = viewHeight / 2;
      camera.bottom = -viewHeight / 2;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.setSize(width, height, false);
      renderer.render(scene, camera);
    };

    const updateHover = () => {
      raycaster.setFromCamera(pointerTarget, camera);
      const hit = raycaster.intersectObjects(cardMeshes, false)[0];
      hoveredIndex = hit ? Number(hit.object.userData.index) : -1;
      canvas.style.cursor = hoveredIndex >= 0 ? "pointer" : "grab";
      if (reduceMotion) {
        cardGroups.forEach((card, index) => {
          const transitionMaterial = card.userData.transitionMaterial as THREE.ShaderMaterial;
          transitionMaterial.uniforms.uProgress.value = index === hoveredIndex ? 1 : 0;
        });
        renderer.render(scene, camera);
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointerTarget.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      updateHover();
    };

    const onPointerLeave = () => {
      pointerTarget.set(0, 0);
      hoveredIndex = -1;
      canvas.style.cursor = "grab";
    };

    const onClick = () => {
      if (hoveredIndex >= 0) window.dispatchEvent(new CustomEvent("withus:start-demo"));
    };

    const render = () => {
      if (disposed) return;
      frame = window.requestAnimationFrame(render);
      if (!inView) return;

      const elapsed = clock.getElapsedTime();
      const exitElapsed = isExiting ? elapsed - exitStartedAt : 0;
      const exitProgress = isExiting ? Math.min(1, exitElapsed / 1.45) : 0;
      pointer.lerp(pointerTarget, 0.055);
      wall.rotation.x = pointer.y * -0.055;
      wall.rotation.y = pointer.x * 0.085;
      wall.rotation.z = -0.045 + pointer.x * 0.018;
      wall.position.x = Math.sin(elapsed * 0.24) * 0.12;
      wall.position.y = Math.sin(elapsed * 0.34) * 0.14;

      cardGroups.forEach((card, index) => {
        const isHovered = index === hoveredIndex;
        const transitionMaterial = card.userData.transitionMaterial as THREE.ShaderMaterial;
        const cardExitDelay = Number(card.userData.exitDelay);
        const cardExitProgress = Math.max(0, Math.min(1, (exitProgress - cardExitDelay) / (1 - cardExitDelay)));
        const exitEase = cardExitProgress * cardExitProgress * (3 - 2 * cardExitProgress);
        const targetScale = isExiting ? 1 - cardExitProgress * 0.06 : isHovered ? 1.055 : index === 4 ? 1.02 : 1;
        const targetZ = isExiting
          ? THREE.MathUtils.lerp(Number(card.userData.baseZ), 1.35 + index * 0.035, exitEase)
          : Number(card.userData.baseZ) + (isHovered ? 1.1 : 0);
        const drift = Math.sin(elapsed * 0.48 + index * 0.74) * 0.065;
        transitionMaterial.uniforms.uProgress.value += ((isHovered ? 1 : 0) - transitionMaterial.uniforms.uProgress.value) * 0.022;
        card.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.09);
        card.position.x = THREE.MathUtils.lerp(Number(card.userData.baseX), Number(card.userData.stackX), exitEase);
        const targetY = THREE.MathUtils.lerp(Number(card.userData.baseY) + drift, Number(card.userData.stackY), exitEase);
        if (isExiting) card.position.y = targetY;
        else card.position.y += (targetY - card.position.y) * 0.05;
        card.position.z += (targetZ - card.position.z) * 0.09;
        card.rotation.z = THREE.MathUtils.lerp(Number(card.userData.baseRotation), Number(card.userData.stackRotation), exitEase);
      });

      shadowMaterial.opacity = THREE.MathUtils.lerp(0.13, 0.08, exitProgress);
      renderer.render(scene, camera);

      if (isExiting && exitElapsed >= 2.45) {
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
    canvas.addEventListener("click", onClick);
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
      canvas.removeEventListener("click", onClick);
      window.removeEventListener("withus:start-demo", startExit);
      geometry.dispose();
      hitGeometry.dispose();
      shadowGeometry.dispose();
      textures.forEach((texture) => texture.dispose());
      materials.forEach((material) => material.dispose());
      renderer.dispose();
    };
  }, []);

  return (
    <div ref={sceneRef} className="three-document-scene">
      <canvas
        ref={canvasRef}
        role="link"
        tabIndex={0}
        aria-label="3D 회복 검토 자료. 선택하면 AI 인터뷰 데모로 이동합니다."
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            window.dispatchEvent(new CustomEvent("withus:start-demo"));
          }
        }}
      />
      <span className="three-scene-status">자료를 정리하고 있습니다</span>
      <div className="three-scene-fallback"><span>회복 검토 파일</span><strong>다음 상담을 위한<br />한 장의 근거</strong></div>
      <div className="three-scene-label" aria-hidden="true"><span>RECOVERY FILES</span><b>커서를 움직여 자료를 살펴보세요</b></div>
    </div>
  );
}
