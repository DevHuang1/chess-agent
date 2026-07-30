"use client";

import { Chess, Square } from "chess.js";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import GameInfo from "@/components/GameInfo";
import * as tf from "@tensorflow/tfjs";
import * as handpose from "@tensorflow-models/handpose";

type HandLandmark = [number, number, number];
type Gesture = "none" | "fist" | "palm" | "two";

const BOARD_SIZE = 8;
const SQUARE_SIZE = 1;
const BOARD_OFFSET = (BOARD_SIZE - 1) * SQUARE_SIZE / 2;
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

function squareToPosition(square: string): THREE.Vector3 {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1]) - 1;
  return new THREE.Vector3(file - BOARD_OFFSET, 0.15, rank - BOARD_OFFSET);
}

function positionToSquare(x: number, z: number): string | null {
  const f = Math.round(x + BOARD_OFFSET);
  const r = Math.round(z + BOARD_OFFSET);
  if (f < 0 || f > 7 || r < 0 || r > 7) return null;
  return `${FILES[f]}${r + 1}`;
}

function createPieceGeometry(type: string, color: string): THREE.Group {
  const group = new THREE.Group();

  const isWhite = color === "w";
  const baseMat = new THREE.MeshPhysicalMaterial({
    color: isWhite ? 0xf0e8d8 : 0x1a1a1a,
    roughness: isWhite ? 0.35 : 0.25,
    metalness: isWhite ? 0.05 : 0.15,
    clearcoat: isWhite ? 0.1 : 0.3,
    clearcoatRoughness: 0.3,
  });

  const accentMat = new THREE.MeshPhysicalMaterial({
    color: isWhite ? 0xe8dcc8 : 0x222222,
    roughness: isWhite ? 0.4 : 0.3,
    metalness: isWhite ? 0.05 : 0.1,
    clearcoat: 0.1,
    clearcoatRoughness: 0.4,
  });

  function lathe(points: [number, number][], segments = 28): THREE.Mesh {
    const vec2 = points.map(([x, y]) => new THREE.Vector2(x, y));
    return new THREE.Mesh(new THREE.LatheGeometry(vec2, segments), baseMat);
  }

  // All pieces: shared base profile (wide foot, tapered stem)
  function base(yOffset: number, scale = 1): THREE.Mesh {
    const b = lathe([
      [0, 0],
      [0.34 * scale, 0],
      [0.36 * scale, 0.02],
      [0.36 * scale, 0.04],
      [0.28 * scale, 0.06],
      [0.22 * scale, 0.10],
      [0.20 * scale, 0.16],
    ]);
    b.position.y = yOffset;
    return b;
  }

  switch (type) {
    case "p": {
      // Pawn: base + tapered body + collar + round head
      const b = base(0);
      const body = lathe([
        [0.18, 0.16],
        [0.18, 0.22],
        [0.22, 0.28],
        [0.20, 0.34],
        [0.16, 0.38],
        [0.14, 0.40],
        [0.16, 0.42],
        [0.14, 0.46],
      ]);
      body.position.y = 0;
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 20, 16),
        baseMat,
      );
      head.position.y = 0.52;
      head.scale.y = 0.8;
      const collar = new THREE.Mesh(
        new THREE.TorusGeometry(0.14, 0.025, 8, 20),
        accentMat,
      );
      collar.position.y = 0.42;
      collar.rotation.x = Math.PI / 2;
      group.add(b, body, head, collar);
      break;
    }
    case "n": {
      // Knight: base + body + horse head
      const b = base(0, 0.95);
      const bodyMesh = lathe([
        [0.17, 0.16],
        [0.17, 0.22],
        [0.20, 0.26],
        [0.16, 0.30],
        [0.14, 0.34],
      ]);
      bodyMesh.position.y = 0;
      const neck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.12, 0.16, 10),
        baseMat,
      );
      neck.position.set(0, 0.42, 0.06);
      neck.rotation.z = 0.15;
      const headMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.10, 10, 8),
        baseMat,
      );
      headMesh.position.set(0.12, 0.52, 0.06);
      headMesh.scale.set(0.9, 0.7, 1.0);
      const ear = new THREE.Mesh(
        new THREE.ConeGeometry(0.03, 0.08, 6),
        accentMat,
      );
      ear.position.set(-0.02, 0.56, 0.06);
      ear.rotation.x = 0.2;
      const snout = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 8, 6),
        accentMat,
      );
      snout.position.set(0.20, 0.48, 0.06);
      snout.scale.set(1.2, 0.6, 0.8);
      group.add(b, bodyMesh, neck, headMesh, ear, snout);
      break;
    }
    case "b": {
      // Bishop: base + tall body + cleft mitre
      const b = base(0);
      const bodyMesh = lathe([
        [0.18, 0.16],
        [0.18, 0.24],
        [0.16, 0.32],
        [0.14, 0.40],
        [0.16, 0.44],
        [0.14, 0.48],
        [0.12, 0.52],
        [0.10, 0.56],
      ]);
      bodyMesh.position.y = 0;
      const collarRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.12, 0.025, 8, 18),
        accentMat,
      );
      collarRing.position.y = 0.58;
      collarRing.rotation.x = Math.PI / 2;
      // Mitre cleft: two small spheres
      const cleftL = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 8, 6),
        accentMat,
      );
      cleftL.position.set(-0.04, 0.64, 0);
      const cleftR = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 8, 6),
        accentMat,
      );
      cleftR.position.set(0.04, 0.64, 0);
      group.add(b, bodyMesh, collarRing, cleftL, cleftR);
      break;
    }
    case "r": {
      // Rook: base + column + battlements
      const b = base(0, 0.95);
      const column = lathe([
        [0.16, 0.16],
        [0.16, 0.20],
        [0.18, 0.24],
        [0.16, 0.32],
        [0.16, 0.40],
        [0.18, 0.44],
        [0.20, 0.46],
        [0.22, 0.48],
      ]);
      column.position.y = 0;
      const topRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.22, 0.025, 8, 20),
        accentMat,
      );
      topRing.position.y = 0.50;
      topRing.rotation.x = Math.PI / 2;
      // Battlements: 4 small blocks
      const merlonPositions = [
        [-0.18, 0.54, 0],
        [0.18, 0.54, 0],
        [0, 0.54, 0.18],
        [0, 0.54, -0.18],
      ];
      for (const [mx, my, mz] of merlonPositions) {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 0.06, 0.06),
          accentMat,
        );
        m.position.set(mx, my, mz);
        group.add(m);
      }
      group.add(b, column, topRing);
      break;
    }
    case "q": {
      // Queen: base + body + crown with points
      const b = base(0);
      const bodyMesh = lathe([
        [0.18, 0.16],
        [0.18, 0.22],
        [0.20, 0.28],
        [0.18, 0.32],
        [0.16, 0.36],
        [0.18, 0.40],
        [0.16, 0.44],
        [0.14, 0.46],
        [0.12, 0.48],
      ]);
      bodyMesh.position.y = 0;
      const crownRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.14, 0.025, 8, 18),
        accentMat,
      );
      crownRing.position.y = 0.50;
      crownRing.rotation.x = Math.PI / 2;
      // Crown spikes
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const spike = new THREE.Mesh(
          new THREE.ConeGeometry(0.025, 0.08, 6),
          accentMat,
        );
        spike.position.set(Math.cos(angle) * 0.13, 0.56, Math.sin(angle) * 0.13);
        group.add(spike);
      }
      const topBall = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 8, 6),
        accentMat,
      );
      topBall.position.y = 0.52;
      group.add(b, bodyMesh, crownRing, topBall);
      break;
    }
    case "k": {
      // King: tallest piece, base + body + cross
      const b = base(0);
      const bodyMesh = lathe([
        [0.18, 0.16],
        [0.18, 0.24],
        [0.16, 0.30],
        [0.18, 0.36],
        [0.16, 0.42],
        [0.18, 0.46],
        [0.16, 0.50],
        [0.14, 0.54],
        [0.12, 0.56],
      ]);
      bodyMesh.position.y = 0;
      const crownBand = new THREE.Mesh(
        new THREE.TorusGeometry(0.14, 0.025, 8, 18),
        accentMat,
      );
      crownBand.position.y = 0.58;
      crownBand.rotation.x = Math.PI / 2;
      // Cross
      const crossV = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.14, 0.04),
        accentMat,
      );
      crossV.position.y = 0.68;
      const crossH = new THREE.Mesh(
        new THREE.BoxGeometry(0.10, 0.03, 0.04),
        accentMat,
      );
      crossH.position.y = 0.74;
      group.add(b, bodyMesh, crownBand, crossV, crossH);
      break;
    }
  }

  return group;
}

type Simulation3DProps = {
  chessRef: React.MutableRefObject<Chess>;
  gameOutcome: string;
  isBotThinking: boolean;
  onMoveExecuted: () => void;
  setStatusMessage: (msg: string) => void;
  onExit: () => void;
};

export default function Simulation3D({
  chessRef,
  gameOutcome,
  isBotThinking,
  onMoveExecuted,
  setStatusMessage,
  onExit,
}: Simulation3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    pieces: Map<string, THREE.Group>;
    selectionRing: THREE.Mesh;
    tileMeshes: THREE.Mesh[];
    destHighlight: THREE.Mesh;
  } | null>(null);
  const animRef = useRef<number>(0);
  const camOrbit = useRef({ theta: Math.PI / 4, phi: Math.PI / 4, radius: 13 });
  const finger3dRef = useRef<{ x: number; z: number } | null>(null);
  const selectedRef = useRef<string | null>(null);
  const legalRef = useRef<string[]>([]);
  const hoveredRef = useRef<string | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalSquares, setLegalSquares] = useState<string[]>([]);
  const [handActive, setHandActive] = useState(false);
  const [gestureLabel, setGestureLabel] = useState("");
  const [hoveredSquare, setHoveredSquare] = useState<string | null>(null);
  const [, forceUpdate] = useState(0);
  const smoothHitRef = useRef({ x: 0, z: 0, y: 0 });

  const triggerRerender = useCallback(() => forceUpdate((n) => n + 1), []);

  // Sync refs during render so the detect loop closure has up-to-date values
  // eslint-disable-next-line react-hooks/refs
  selectedRef.current = selectedSquare;
  // eslint-disable-next-line react-hooks/refs
  legalRef.current = legalSquares;
  // eslint-disable-next-line react-hooks/refs
  hoveredRef.current = hoveredSquare;

  const rebuildPieces = useCallback((chess: Chess, scene: THREE.Scene, pieces: Map<string, THREE.Group>) => {
    for (const [, mesh] of pieces) scene.remove(mesh);
    pieces.clear();
    const board = chess.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const piece = board[r][f];
        if (!piece) continue;
        const sq = `${FILES[f]}${r + 1}` as Square;
        const pos = squareToPosition(sq);
        const color = piece.color;
        const group = createPieceGeometry(piece.type, color);
        group.position.copy(pos);
        group.userData = { square: sq, type: piece.type, color: piece.color };
        scene.add(group);
        pieces.set(sq, group);
      }
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const w = container.clientWidth;
    const h = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 50);
    camera.position.set(7, 7, 7);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.prepend(renderer.domElement);

    const ambient = new THREE.AmbientLight(0x404060, 0.5);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffeedd, 2);
    dirLight.position.set(5, 12, 8);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    scene.add(dirLight);
    const fill = new THREE.DirectionalLight(0x4488ff, 0.6);
    fill.position.set(-4, 3, -5);
    scene.add(fill);

    const boardPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.9, transparent: true, opacity: 0.2 }),
    );
    boardPlane.rotation.x = -Math.PI / 2;
    boardPlane.position.y = -0.01;
    boardPlane.receiveShadow = true;
    scene.add(boardPlane);

    const tileMeshes: THREE.Mesh[] = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let f = 0; f < BOARD_SIZE; f++) {
        const isLight = (r + f) % 2 === 0;
        const tile = new THREE.Mesh(
          new THREE.BoxGeometry(SQUARE_SIZE * 0.92, 0.04, SQUARE_SIZE * 0.92),
          new THREE.MeshStandardMaterial({
            color: isLight ? 0xf0d9b5 : 0xb58863,
            roughness: 0.5,
            metalness: 0.05,
            transparent: true,
            opacity: 0.85,
          }),
        );
        tile.position.set(f - BOARD_OFFSET, 0, r - BOARD_OFFSET);
        tile.receiveShadow = true;
        tile.userData = { square: `${FILES[f]}${r + 1}`, rank: r, file: f };
        scene.add(tile);
        tileMeshes.push(tile);
      }
    }

    const pieces = new Map<string, THREE.Group>();
    rebuildPieces(chessRef.current, scene, pieces);

    const selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.38, 0.48, 32),
      new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
    );
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.position.y = 0.05;
    selectionRing.visible = false;
    scene.add(selectionRing);

    const destHighlight = new THREE.Mesh(
      new THREE.PlaneGeometry(SQUARE_SIZE * 0.85, SQUARE_SIZE * 0.85),
      new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.3, side: THREE.DoubleSide }),
    );
    destHighlight.rotation.x = -Math.PI / 2;
    destHighlight.position.y = 0.03;
    destHighlight.visible = false;
    scene.add(destHighlight);

    const legalDots: THREE.Mesh[] = [];
    function updateLegalDots(squares: string[]) {
      for (const d of legalDots) scene.remove(d);
      legalDots.length = 0;
      for (const sq of squares) {
        const pos = squareToPosition(sq);
        const dot = new THREE.Mesh(
          new THREE.CircleGeometry(0.1, 16),
          new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
        );
        dot.rotation.x = -Math.PI / 2;
        dot.position.set(pos.x, 0.04, pos.z);
        scene.add(dot);
        legalDots.push(dot);
      }
    }

    sceneRef.current = { scene, camera, renderer, pieces, selectionRing, tileMeshes, destHighlight };

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    let videoStream: MediaStream | null = null;
    let mediapipeActive = false;
    let grabbedPieceGroup: THREE.Group | null = null;
    let detectRaf = 0;

    // Pointer interaction state
    let isPointerDragging = false;
    let pointerGrabbedSquare: string | null = null;
    let pointerGrabbedGroup: THREE.Group | null = null;
    const pointerTarget = new THREE.Vector3();
    let releaseAnim: { piece: THREE.Group; from: THREE.Vector3; to: THREE.Vector3; progress: number } | null = null;
    let isOrbiting = false;
    let prevPointerX = 0;
    let prevPointerY = 0;

    // Smooth tracking targets (interpolated in animate loop)
    const fingerFollowTarget = new THREE.Vector3();
    let gestureAnim: {
      piece: THREE.Group;
      from: THREE.Vector3;
      to: THREE.Vector3;
      progress: number;
      done: () => void;
    } | null = null;
    // Orbit target for smooth camera interpolation
    const smoothOrbit = { theta: Math.PI / 4, phi: Math.PI / 4, radius: 13 };

    // Two-finger orbit tracking (separate from palm tracking)
    let prevTwoMidX = 0;
    let prevTwoMidY = 0;

    navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" } })
      .then((stream) => {
        videoStream = stream;
        const vid = videoRef.current;
        if (!vid) { stream.getTracks().forEach(t => t.stop()); return; }
        vid.srcObject = stream;
        vid.playsInline = true;
        vid.muted = true;
        vid.play().catch(() => {});

        const tex = new THREE.VideoTexture(vid);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        scene.background = tex;

        initHandpose(vid);
      })
      .catch(() => {});

    async function initHandpose(video: HTMLVideoElement) {
      try {
        await tf.ready();
        const model = await handpose.load({ maxContinuousChecks: 5, detectionConfidence: 0.8 });
        mediapipeActive = true;

        async function detect() {
          if (!mediapipeActive) return;
          if (video.readyState >= 2) {
            const predictions = await model.estimateHands(video);
            if (predictions.length > 0) {
              const lm = predictions[0].landmarks as unknown as HandLandmark[];
              processHand(lm);
            } else {
              handActiveRef.current = false;
              setHandActive(false);
              setGestureLabel("");
              destHighlight.visible = false;
            }
          }
          detectRaf = requestAnimationFrame(detect);
        }
        detect();
      } catch {
        setStatusMessage("Hand tracking model failed to load");
      }
    }

    const handActiveRef = { current: false };
    let grabbedPieceSquare: string | null = null;
    const gestureBuffer: Gesture[] = [];

    function processHand(lm: HandLandmark[]) {
      handActiveRef.current = true;
      setHandActive(true);

      const vw = 640;
      const vh = 480;
      const wrist = lm[0];
      const tips = [4, 8, 12, 16, 20];
      const curlDists = tips.map((t) => {
        const tip = lm[t];
        return Math.sqrt((tip[0] - wrist[0])**2 + (tip[1] - wrist[1])**2);
      });
      const thumbCurled = curlDists[0] < 80;
      const indexCurl = curlDists[1];
      const middleCurl = curlDists[2];
      const ringCurl = curlDists[3];
      const pinkyCurl = curlDists[4];

      const curledCount = curlDists.filter(d => d < 70).length;
      const extendedCount = curlDists.filter(d => d > 100).length;

      const isFist = curledCount >= 4 && thumbCurled;
      const isFlatPalm = extendedCount >= 4;
      const isTwoFingers = indexCurl > 100 && middleCurl > 100 && ringCurl < 70 && pinkyCurl < 70;

      const handX = lm[9][0] / vw;
      const handY = lm[9][1] / vh;

      gestureBuffer.push(isFist ? "fist" : isFlatPalm ? "palm" : isTwoFingers ? "two" : "none");
      if (gestureBuffer.length > 6) gestureBuffer.shift();
      const counts = { fist: 0, palm: 0, two: 0, none: 0 };
      for (const g of gestureBuffer) counts[g]++;
      const majority = (Object.entries(counts) as [Gesture, number][]).sort((a, b) => b[1] - a[1])[0][0];
      const gesture: Gesture = counts[majority] >= 4 ? majority : "none";

      const ndcX = handX * 2 - 1;
      const ndcY = 1 - handY * 2;
      pointer.set(ndcX, ndcY);
      raycaster.setFromCamera(pointer, camera);

      const planeY = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hitPoint = new THREE.Vector3();
      const ray = raycaster.ray;
      const hit = ray.intersectPlane(planeY, hitPoint);
      const overBoard = hit && hitPoint.x > -BOARD_OFFSET - 0.5 && hitPoint.x < BOARD_OFFSET + 0.5 &&
        hitPoint.z > -BOARD_OFFSET - 0.5 && hitPoint.z < BOARD_OFFSET + 0.5;

      // Smooth finger position with EMA
      if (hit) {
        const smooth = smoothHitRef.current;
        smooth.x += (hitPoint.x - smooth.x) * 0.4;
        smooth.z += (hitPoint.z - smooth.z) * 0.4;
        smooth.y = hitPoint.y;
        finger3dRef.current = { x: smooth.x, z: smooth.z };
      } else {
        finger3dRef.current = null;
      }

      if (gesture === "fist") {
        setGestureLabel("Fist");

        if (overBoard && hit && isFist) {
          const sq = positionToSquare(hitPoint.x, hitPoint.z);
          if (sq) {
            if (!grabbedPieceSquare && !isPointerDragging) {
              const chess = chessRef.current;
              const piece = chess.get(sq as Square);
              if (piece && piece.color === "w") {
                grabbedPieceSquare = sq;
                setSelectedSquare(sq);
                const moves = chess.moves({ square: sq as Square, verbose: true });
                setLegalSquares(moves.map((m) => m.to));
                updateLegalDots(moves.map((m) => m.to));
                const pos = squareToPosition(sq);
                selectionRing.position.set(pos.x, 0.05, pos.z);
                selectionRing.visible = true;
                setStatusMessage(`Holding ${sq}`);

                const pieceGroup = pieces.get(sq);
                if (pieceGroup) {
                  grabbedPieceGroup = pieceGroup;
                  gestureAnim = null;
                }
              }
            }

            const grabbed = grabbedPieceGroup;
            if (grabbed && !isPointerDragging) {
              // Smoothly follow finger position on the board plane
              fingerFollowTarget.set(hitPoint.x, 1.2, hitPoint.z);

              // Show dest highlight if over a legal square
              const hoverSq = positionToSquare(hitPoint.x, hitPoint.z);
              if (hoverSq && legalRef.current.includes(hoverSq)) {
                const snap = squareToPosition(hoverSq);
                destHighlight.position.set(snap.x, 0.03, snap.z);
                destHighlight.visible = true;
              } else {
                destHighlight.visible = false;
              }
            }
          }
        }
      } else if (gesture === "palm") {
        setGestureLabel("Palm");

        if (overBoard && hit) {
          const sq = positionToSquare(hitPoint.x, hitPoint.z);
          if (sq) {
            setHoveredSquare(sq);
            const pos = squareToPosition(sq);
            destHighlight.position.set(pos.x, 0.03, pos.z);
            destHighlight.visible = true;
          } else {
            destHighlight.visible = false;
            setHoveredSquare(null);
          }
        } else {
          destHighlight.visible = false;
          setHoveredSquare(null);
        }
      } else if (gesture === "two") {
        setGestureLabel("Two");

        destHighlight.visible = false;
        setHoveredSquare(null);

        // Use midpoint of index tip (lm[8]) and middle tip (lm[12]) for more stable tracking
        const idxTip = lm[8];
        const midTip = lm[12];
        const twoMidX = ((idxTip[0] + midTip[0]) / 2) / vw;
        const twoMidY = ((idxTip[1] + midTip[1]) / 2) / vh;

        if (prevTwoMidX !== 0) {
          const deltaX = (twoMidX - prevTwoMidX) * 3;
          const deltaY = (twoMidY - prevTwoMidY) * 3;
          smoothOrbit.theta -= deltaX;
          smoothOrbit.phi = Math.max(0.2, Math.min(1.3, smoothOrbit.phi + deltaY));
        }
        prevTwoMidX = twoMidX;
        prevTwoMidY = twoMidY;
      } else {
        setGestureLabel("");
        prevTwoMidX = 0;
        prevTwoMidY = 0;
      }



      if (!isFist && grabbedPieceSquare && !isPointerDragging) {
        const grabbed = grabbedPieceGroup;
        if (grabbed) {
          const fromSq = grabbedPieceSquare;
          const toSq = finger3dRef.current
            ? positionToSquare(finger3dRef.current.x, finger3dRef.current.z)
            : null;

          let moveSuccess = false;
          if (toSq && legalRef.current.includes(toSq)) {
            try {
              const move = chessRef.current.move({ from: fromSq as Square, to: toSq as Square, promotion: "q" });
              if (move) {
                const targetPos = squareToPosition(toSq);
                gestureAnim = {
                  piece: grabbed,
                  from: grabbed.position.clone(),
                  to: targetPos,
                  progress: 0,
                  done: () => {
                    setStatusMessage(`3D Move: ${move.san}`);
                    rebuildPieces(chessRef.current, scene, pieces);
                    onMoveExecuted();
                    triggerRerender();
                  },
                };
                moveSuccess = true;
              }
            } catch {
              // Board state changed (bot moved, etc.) — animate back
            }
          }

          if (!moveSuccess) {
            const origPos = squareToPosition(fromSq);
            gestureAnim = {
              piece: grabbed,
              from: grabbed.position.clone(),
              to: origPos,
              progress: 0,
              done: () => {},
            };
          }
        }
        grabbedPieceSquare = null;
        grabbedPieceGroup = null;
        setSelectedSquare(null);
        setLegalSquares([]);
        updateLegalDots([]);
        selectionRing.visible = false;
        destHighlight.visible = false;
        setHoveredSquare(null);
        hoveredRef.current = null;
      }
    }

    // Pointer (mouse/touch) interaction
    const canvas = renderer.domElement;
    canvas.style.touchAction = "none";

    canvas.addEventListener("pointerdown", (e) => {
      if (e.button === 2) {
        isOrbiting = true;
        prevPointerX = e.clientX;
        prevPointerY = e.clientY;
        return;
      }
      if (e.button !== 0) return;

      pointer.set(
        (e.clientX / container.clientWidth) * 2 - 1,
        -(e.clientY / container.clientHeight) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);

      const pieceList: THREE.Object3D[] = [];
      for (const [, p] of pieces) pieceList.push(p);
      const intersects = raycaster.intersectObjects(pieceList, true);

      if (intersects.length > 0) {
        let obj: THREE.Object3D = intersects[0].object;
        while (obj.parent && !(obj.parent instanceof THREE.Scene)) {
          obj = obj.parent;
        }
        if (obj.userData?.color === "w") {
          const sq = obj.userData.square as string;
          isPointerDragging = true;
          pointerGrabbedSquare = sq;
          pointerGrabbedGroup = pieces.get(sq) ?? null;

          const pos = squareToPosition(sq);
          if (pointerGrabbedGroup) {
            pointerGrabbedGroup.position.y = 1.2;
            pointerTarget.set(pos.x, 1.2, pos.z);
          }

          setSelectedSquare(sq);
          const moves = chessRef.current.moves({ square: sq as Square, verbose: true });
          setLegalSquares(moves.map((m) => m.to));
          updateLegalDots(moves.map((m) => m.to));
          selectionRing.position.set(pos.x, 0.05, pos.z);
          selectionRing.visible = true;
          setStatusMessage(`Holding ${sq}`);
        }
      }
    });

    canvas.addEventListener("pointermove", (e) => {
      if (isOrbiting) {
        const deltaX = (e.clientX - prevPointerX) / container.clientWidth;
        const deltaY = (e.clientY - prevPointerY) / container.clientHeight;
        const orbit = camOrbit.current;
        orbit.theta -= deltaX * 3;
        orbit.phi = Math.max(0.2, Math.min(1.3, orbit.phi + deltaY * 3));
        // Sync smooth orbit target
        smoothOrbit.theta = orbit.theta;
        smoothOrbit.phi = orbit.phi;
        smoothOrbit.radius = orbit.radius;
        const x = orbit.radius * Math.sin(orbit.phi) * Math.cos(orbit.theta);
        const y = orbit.radius * Math.cos(orbit.phi);
        const z = orbit.radius * Math.sin(orbit.phi) * Math.sin(orbit.theta);
        camera.position.set(x, y, z);
        camera.lookAt(0, 0, 0);
        prevPointerX = e.clientX;
        prevPointerY = e.clientY;
        return;
      }

      if (!isPointerDragging || !pointerGrabbedGroup) return;

      pointer.set(
        (e.clientX / container.clientWidth) * 2 - 1,
        -(e.clientY / container.clientHeight) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const planeY = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hitPoint = new THREE.Vector3();
      raycaster.ray.intersectPlane(planeY, hitPoint);

      pointerTarget.set(hitPoint.x, 1.2, hitPoint.z);

      const sq = positionToSquare(hitPoint.x, hitPoint.z);
      if (sq && legalRef.current.includes(sq)) {
        destHighlight.position.set(squareToPosition(sq).x, 0.03, squareToPosition(sq).z);
        destHighlight.visible = true;
      } else {
        destHighlight.visible = false;
      }
    });

    canvas.addEventListener("pointerup", (e) => {
      if (e.button === 2) {
        isOrbiting = false;
        return;
      }
      if (!isPointerDragging) return;
      isPointerDragging = false;

      const fromSq = pointerGrabbedSquare;
      const grabbed = pointerGrabbedGroup;
      const toSq = positionToSquare(pointerTarget.x, pointerTarget.z);

      if (fromSq && toSq && legalRef.current.includes(toSq)) {
        const chess = chessRef.current;
        const move = chess.move({ from: fromSq as Square, to: toSq as Square, promotion: "q" });
        if (move) {
          setStatusMessage(`3D Move: ${move.san}`);
          rebuildPieces(chess, scene, pieces);
          onMoveExecuted();
          triggerRerender();
        } else if (grabbed) {
          const origPos = squareToPosition(fromSq);
          releaseAnim = { piece: grabbed, from: grabbed.position.clone(), to: origPos, progress: 0 };
        }
      } else if (grabbed && fromSq) {
        const origPos = squareToPosition(fromSq);
        releaseAnim = { piece: grabbed, from: grabbed.position.clone(), to: origPos, progress: 0 };
      }

      pointerGrabbedSquare = null;
      pointerGrabbedGroup = null;
      setSelectedSquare(null);
      setLegalSquares([]);
      updateLegalDots([]);
      selectionRing.visible = false;
      destHighlight.visible = false;
    });

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    canvas.addEventListener("wheel", (e) => {
      const orbit = camOrbit.current;
      orbit.radius = Math.max(5, Math.min(25, orbit.radius + e.deltaY * 0.01));
      smoothOrbit.radius = orbit.radius;
      const x = orbit.radius * Math.sin(orbit.phi) * Math.cos(orbit.theta);
      const y = orbit.radius * Math.cos(orbit.phi);
      const z = orbit.radius * Math.sin(orbit.phi) * Math.sin(orbit.theta);
      camera.position.set(x, y, z);
      camera.lookAt(0, 0, 0);
    }, { passive: true });

    const handleResize = () => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
      renderer.setSize(cw, ch);
    };
    window.addEventListener("resize", handleResize);

    function animate() {
      animRef.current = requestAnimationFrame(animate);

      // Smooth camera orbit interpolation (for two-finger gesture)
      const orbit = camOrbit.current;
      orbit.theta += (smoothOrbit.theta - orbit.theta) * 0.08;
      orbit.phi += (smoothOrbit.phi - orbit.phi) * 0.08;
      orbit.radius += (smoothOrbit.radius - orbit.radius) * 0.08;
      const cx = orbit.radius * Math.sin(orbit.phi) * Math.cos(orbit.theta);
      const cy = orbit.radius * Math.cos(orbit.phi);
      const cz = orbit.radius * Math.sin(orbit.phi) * Math.sin(orbit.theta);
      camera.position.set(cx, cy, cz);
      camera.lookAt(0, 0, 0);

      // Smooth piece follow for pointer drag
      if (isPointerDragging && pointerGrabbedGroup) {
        pointerGrabbedGroup.position.lerp(pointerTarget, 0.3);
      }

      // Smooth piece follow for fist grab
      if (!isPointerDragging && grabbedPieceGroup && grabbedPieceSquare) {
        grabbedPieceGroup.position.lerp(fingerFollowTarget, 0.25);
      }

      // Release animation (pointer)
      if (releaseAnim) {
        releaseAnim.progress += 0.04;
        if (releaseAnim.progress >= 1) {
          releaseAnim.piece.position.copy(releaseAnim.to);
          releaseAnim = null;
        } else {
          releaseAnim.piece.position.lerpVectors(releaseAnim.from, releaseAnim.to, releaseAnim.progress);
        }
      }

      // Gesture release animation
      if (gestureAnim) {
        gestureAnim.progress += 0.04;
        if (gestureAnim.progress >= 1) {
          gestureAnim.piece.position.copy(gestureAnim.to);
          const done = gestureAnim.done;
          gestureAnim = null;
          done();
        } else {
          gestureAnim.piece.position.lerpVectors(gestureAnim.from, gestureAnim.to, gestureAnim.progress);
        }
      }

      renderer.render(scene, camera);
    }
    animate();

    const cleanupVid = videoRef.current;
    return () => {
      cancelAnimationFrame(animRef.current);
      cancelAnimationFrame(detectRaf);
      mediapipeActive = false;
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      if (cleanupVid) {
        cleanupVid.pause();
        cleanupVid.srcObject = null;
      }
      if (videoStream) videoStream.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOutcome, isBotThinking]);

  return (
    <div className="flex h-screen w-screen bg-black">
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        <div className="absolute top-4 left-4 z-20 flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={onExit}
            className="rounded bg-black/60 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 border border-zinc-700 backdrop-blur-sm"
          >
            ← Exit 3D
          </button>
          <span className="rounded bg-black/40 px-3 py-1.5 text-sm text-zinc-300 border border-zinc-700/50 backdrop-blur-sm">
            {selectedSquare ? `Holding ${selectedSquare}` : handActive ? gestureLabel || "Hand detected" : "Click & drag to move pieces · Right-click to orbit · Scroll to zoom"}
          </span>
          {gestureLabel === "Palm" && (
            <span className="rounded bg-emerald-800/40 px-3 py-1.5 text-xs text-emerald-300 border border-emerald-700/30 backdrop-blur-sm">
              Open palm — release piece
            </span>
          )}
          {gestureLabel === "Two" && (
            <span className="rounded bg-sky-800/40 px-3 py-1.5 text-xs text-sky-300 border border-sky-700/30 backdrop-blur-sm">
              Two fingers — drag to orbit
            </span>
          )}
          {gestureLabel === "Fist" && (
            <span className="rounded bg-amber-800/40 px-3 py-1.5 text-xs text-amber-300 border border-amber-700/30 backdrop-blur-sm">
              Fist — piece follows hand
            </span>
          )}
        </div>
        <div className="absolute top-20 left-4 z-20 w-96">
          {/* eslint-disable-next-line react-hooks/refs */}
          <GameInfo fen={chessRef.current.fen()} />
        </div>
        <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2 rounded-lg bg-black/50 px-3 py-2 border border-zinc-700/50 backdrop-blur-sm">
          <span className={`h-2 w-2 rounded-full ${handActive ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"}`} />
          <span className="text-xs text-zinc-300">{handActive ? `Hand · ${gestureLabel || "tracking"}` : "No hand"}</span>
        </div>
        <video ref={videoRef} muted playsInline className="hidden" />
      </div>
    </div>
  );
}
