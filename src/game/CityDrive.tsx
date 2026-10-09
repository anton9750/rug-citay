import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Moon,
  RotateCcw,
  Sun,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  createSim,
  findSpawn,
  inputFromHeld,
  step,
  TILE_H,
  TILE_W,
  TILES,
  WORLD_H,
  WORLD_W,
  type ControlsProbe,
  type SimState,
  type Spawn,
} from "./sim";

const BASE = import.meta.env.BASE_URL;
const RUG_URL = `${BASE}city-rug.png`;
const MASK_URL = `${BASE}road-mask.bin`;

/** Put your track at public/assets/night-city.mp3 — it plays while night mode is on. */
const MUSIC_URL = `${BASE}assets/night-city.mp3`;

const DAY_BG = new THREE.Color("#2a241e");
const NIGHT_BG = new THREE.Color("#070912");
const WHITE = new THREE.Color("#ffffff");
const MOON = new THREE.Color("#7787cc");
const DAY_SKY = new THREE.Color("#fff6ea");
const NIGHT_SKY = new THREE.Color("#33417f");
const DAY_GROUND = new THREE.Color("#6d5b48");
const NIGHT_GROUND = new THREE.Color("#10131f");

const DRIVE_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"];

type AudioNodes = { ctx: AudioContext; osc: OscillatorNode; gain: GainNode };

function RedCar({
  wheels,
}: {
  wheels: React.MutableRefObject<Array<THREE.Group | null>>;
}) {
  const setWheel = (index: number) => (node: THREE.Group | null) => {
    wheels.current[index] = node;
  };
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <circleGeometry args={[0.26, 20]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.32} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.09, 0]} castShadow>
        <boxGeometry args={[0.3, 0.1, 0.66]} />
        <meshStandardMaterial color="#e10600" emissive="#6a120f" emissiveIntensity={0.28} roughness={0.4} metalness={0.18} />
      </mesh>
      <mesh position={[0, 0.175, 0.05]}>
        <boxGeometry args={[0.26, 0.09, 0.28]} />
        <meshStandardMaterial color="#c40d0a" roughness={0.45} metalness={0.12} />
      </mesh>
      <mesh position={[0, 0.2, -0.08]}>
        <boxGeometry args={[0.22, 0.07, 0.06]} />
        <meshStandardMaterial color="#163044" metalness={0.55} roughness={0.18} />
      </mesh>
      <mesh position={[0, 0.195, 0.18]}>
        <boxGeometry args={[0.2, 0.06, 0.04]} />
        <meshStandardMaterial color="#163044" metalness={0.45} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.23, 0.05]}>
        <boxGeometry args={[0.08, 0.012, 0.3]} />
        <meshStandardMaterial color="#f3efe6" roughness={0.5} />
      </mesh>
      {[-0.1, 0.1].map((x) => (
        <mesh key={`t${x}`} position={[x, 0.1, 0.33]}>
          <boxGeometry args={[0.07, 0.035, 0.02]} />
          <meshStandardMaterial color="#ff3b30" emissive="#ff2a22" emissiveIntensity={0.7} />
        </mesh>
      ))}
      {[-0.1, 0.1].map((x) => (
        <mesh key={`h${x}`} position={[x, 0.09, -0.33]}>
          <boxGeometry args={[0.06, 0.04, 0.02]} />
          <meshStandardMaterial color="#fff4cc" emissive="#ffe7a3" emissiveIntensity={0.85} />
        </mesh>
      ))}
      {[
        [-0.155, -0.2, 0],
        [0.155, -0.2, 1],
        [-0.155, 0.2, 2],
        [0.155, 0.2, 3],
      ].map(([x, z, index]) => (
        <group key={index} ref={setWheel(index ?? 0)} position={[x ?? 0, 0.05, z ?? 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.05, 0.05, 0.04, 14]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.75} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.026, 0.026, 0.046, 10]} />
            <meshStandardMaterial color="#d9d3c8" metalness={0.65} roughness={0.28} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Rug({
  texture,
  materialRef,
}: {
  texture: THREE.Texture;
  materialRef: React.MutableRefObject<THREE.MeshLambertMaterial | null>;
}) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <planeGeometry args={[WORLD_W, WORLD_H]} />
      {/* Day: the photo is shown flat through the emissive channel (same look as an unlit
          material). Night: the emissive fades out and the real lights, headlights included,
          reveal the rug instead. */}
      <meshLambertMaterial
        ref={materialRef}
        map={texture}
        emissiveMap={texture}
        emissive="#ffffff"
        color="#000000"
        toneMapped={false}
      />
    </mesh>
  );
}

function World({
  texture,
  maskRef,
  simRef,
  keysRef,
  injectedRef,
  mutedRef,
  nightRef,
  audioRef,
  dotRef,
  onHud,
}: {
  texture: THREE.Texture;
  maskRef: React.MutableRefObject<Uint8Array | null>;
  simRef: React.MutableRefObject<SimState>;
  keysRef: React.MutableRefObject<Set<string>>;
  injectedRef: React.MutableRefObject<Set<string>>;
  mutedRef: React.MutableRefObject<boolean>;
  nightRef: React.MutableRefObject<boolean>;
  audioRef: React.MutableRefObject<AudioNodes | null>;
  dotRef: React.MutableRefObject<HTMLDivElement | null>;
  onHud: (speed: number, distance: number) => void;
}) {
  const yawGroup = useRef<THREE.Group>(null);
  const leanGroup = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const wheels = useRef<Array<THREE.Group | null>>([null, null, null, null]);
  const look = useRef(new THREE.Vector3());
  const held = useRef(new Set<string>());
  const hudT = useRef(0);
  const nightLevel = useRef(0);
  const bg = useRef<THREE.Color>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const ambient = useRef<THREE.AmbientLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const headlights = useRef<THREE.SpotLight>(null);
  const headlightTarget = useRef<THREE.Object3D>(null);
  const glow = useRef<THREE.PointLight>(null);
  const rugMat = useRef<THREE.MeshLambertMaterial | null>(null);
  const { camera, gl } = useThree();

  useEffect(() => {
    if (headlights.current && headlightTarget.current) {
      headlights.current.target = headlightTarget.current;
    }
  }, []);

  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();

    const aim = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(plane, hit)) {
        const limitX = WORLD_W / 2 - 0.15;
        const limitZ = WORLD_H / 2 - 0.15;
        simRef.current.pointerX = Math.max(-limitX, Math.min(limitX, hit.x));
        simRef.current.pointerZ = Math.max(-limitZ, Math.min(limitZ, hit.z));
      }
    };

    const down = (event: PointerEvent) => {
      if (!simRef.current.started || event.button !== 0) return;
      el.setPointerCapture(event.pointerId);
      simRef.current.dragging = true;
      aim(event);
      el.closest(".play-root")?.classList.add("is-dragging");
    };
    const move = (event: PointerEvent) => {
      if (!simRef.current.dragging) return;
      aim(event);
    };
    const up = () => {
      simRef.current.dragging = false;
      el.closest(".play-root")?.classList.remove("is-dragging");
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [camera, gl, simRef]);

  useFrame((state, delta) => {
    const sim = simRef.current;
    const mask = maskRef.current;
    const dt = Math.min(delta, 0.1);

    // Fade between day and night.
    const nightTarget = nightRef.current ? 1 : 0;
    nightLevel.current += (nightTarget - nightLevel.current) * (1 - Math.exp(-3 * dt));
    if (Math.abs(nightTarget - nightLevel.current) < 0.002) nightLevel.current = nightTarget;
    const n = nightLevel.current;
    bg.current?.lerpColors(DAY_BG, NIGHT_BG, n);
    if (ambient.current) {
      ambient.current.intensity = 0.55 - 0.25 * n;
      ambient.current.color.lerpColors(WHITE, MOON, n);
    }
    if (hemi.current) {
      hemi.current.intensity = 0.55 - 0.4 * n;
      hemi.current.color.lerpColors(DAY_SKY, NIGHT_SKY, n);
      hemi.current.groundColor.lerpColors(DAY_GROUND, NIGHT_GROUND, n);
    }
    if (sun.current) {
      sun.current.intensity = 1.25 - 0.95 * n;
      sun.current.color.lerpColors(WHITE, MOON, n);
    }
    if (headlights.current) headlights.current.intensity = 18 * n;
    if (glow.current) glow.current.intensity = 0.5 * n;
    const mat = rugMat.current;
    if (mat) {
      mat.color.setScalar(n);
      mat.emissiveIntensity = 1 - 0.94 * n;
      mat.emissive.setRGB(1 - 0.45 * n, 1 - 0.4 * n, 1 - 0.1 * n);
    }

    if (sim.started && mask) {
      held.current.clear();
      for (const code of keysRef.current) held.current.add(code);
      for (const code of injectedRef.current) held.current.add(code);
      const pointer = sim.dragging ? { x: sim.pointerX, z: sim.pointerZ } : null;
      const input = inputFromHeld(held.current, sim.steerOverride, pointer);
      step(sim, mask, input, dt);
    }

    if (yawGroup.current) {
      yawGroup.current.position.set(sim.x, 0, sim.z);
      yawGroup.current.rotation.y = sim.yaw;
    }
    if (leanGroup.current) {
      leanGroup.current.rotation.z = -sim.face * 0.08;
    }
    for (let i = 0; i < wheels.current.length; i++) {
      const wheel = wheels.current[i];
      if (!wheel) continue;
      wheel.rotation.x = sim.wheel;
      wheel.rotation.y = i < 2 ? sim.face * 0.4 : 0;
    }
    if (ring.current) {
      ring.current.visible = sim.started && sim.dragging;
      ring.current.position.set(sim.pointerX, 0.025, sim.pointerZ);
    }

    if (!sim.started) {
      const t = state.clock.elapsedTime;
      camera.position.set(Math.sin(t * 0.12) * 0.4, 9.2, 7.4);
      camera.lookAt(0, 0, 0.15);
    } else {
      const fx = -Math.sin(sim.yaw);
      const fz = -Math.cos(sim.yaw);
      const destX = sim.x - fx * 2.7 + (Math.random() - 0.5) * sim.shake * 0.06;
      const destY = 2.35 + (Math.random() - 0.5) * sim.shake * 0.04;
      const destZ = sim.z - fz * 2.7;
      const k = 1 - Math.exp(-4.4 * dt);
      camera.position.x += (destX - camera.position.x) * k;
      camera.position.y += (destY - camera.position.y) * k;
      camera.position.z += (destZ - camera.position.z) * k;
      look.current.set(sim.x + fx * 0.9, 0.16, sim.z + fz * 0.9);
      camera.lookAt(look.current);
    }

    const audio = audioRef.current;
    if (audio && sim.started) {
      const pace = Math.abs(sim.speed);
      audio.osc.frequency.value = 54 + pace * 40;
      audio.gain.gain.value = mutedRef.current ? 0 : Math.min(0.04, 0.005 + pace * 0.013);
    }

    const dot = dotRef.current;
    if (dot) {
      // Minimap shows the rug tile the car is currently on (mirrored like the world).
      const u = sim.x / TILE_W + 0.5;
      const v = sim.z / TILE_H + 0.5;
      const tu = Math.floor(u);
      const tv = Math.floor(v);
      const flipX = (tu & 1) === 1;
      const flipZ = (tv & 1) === 1;
      const fu = flipX ? 1 - (u - tu) : u - tu;
      const fv = flipZ ? 1 - (v - tv) : v - tv;
      const hx = -Math.sin(sim.yaw) * (flipX ? -1 : 1);
      const hz = -Math.cos(sim.yaw) * (flipZ ? -1 : 1);
      dot.style.left = `${fu * 100}%`;
      dot.style.top = `${fv * 100}%`;
      dot.style.transform = `translate(-50%, -60%) rotate(${Math.atan2(hx, -hz)}rad)`;
    }

    hudT.current += dt;
    if (hudT.current > 0.12) {
      hudT.current = 0;
      onHud(sim.speed, sim.distance);
    }
  });

  return (
    <>
      <color ref={bg} attach="background" args={["#2a241e"]} />
      <hemisphereLight ref={hemi} args={["#fff6ea", "#6d5b48", 0.55]} />
      <ambientLight ref={ambient} intensity={0.55} />
      <directionalLight ref={sun} position={[5, 9, 4]} intensity={1.25} />
      <Rug texture={texture} materialRef={rugMat} />
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.1, 0.16, 24]} />
        <meshBasicMaterial color="#d6453d" transparent opacity={0.85} depthWrite={false} />
      </mesh>
      <group ref={yawGroup}>
        <group ref={leanGroup}>
          <RedCar wheels={wheels} />
        </group>
        <spotLight
          ref={headlights}
          position={[0, 0.45, -0.3]}
          angle={0.75}
          penumbra={0.9}
          intensity={0}
          distance={8}
          decay={2}
          color="#fff1c9"
        />
        <object3D ref={headlightTarget} position={[0, 0, -2.6]} />
        <pointLight ref={glow} position={[0, 0.5, 0]} intensity={0} distance={3} decay={2} color="#ffd9a0" />
      </group>
    </>
  );
}

function holdProps(keys: Set<string>, code: string) {
  return {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      keys.add(code);
    },
    onPointerUp: () => keys.delete(code),
    onPointerCancel: () => keys.delete(code),
  };
}

export function CityDrive() {
  const simRef = useRef<SimState>(createSim());
  const maskRef = useRef<Uint8Array | null>(null);
  const keysRef = useRef(new Set<string>());
  const injectedRef = useRef(new Set<string>());
  const spawnRef = useRef<Spawn | null>(null);
  const mutedRef = useRef(false);
  const nightRef = useRef(false);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const audioRef = useRef<AudioNodes | null>(null);
  const dotRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [night, setNight] = useState(false);
  const [speed, setSpeed] = useState(0);
  const [distance, setDistance] = useState(0);
  const [best, setBest] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const stored = Number(localStorage.getItem("rug-city-best-m") ?? "0");
    if (Number.isFinite(stored) && stored > 0) setBest(stored);
  }, []);

  useEffect(() => {
    let dead = false;
    const loader = new THREE.TextureLoader();
    let tex: THREE.Texture | null = null;
    loader.load(
      RUG_URL,
      (next) => {
        next.colorSpace = THREE.SRGBColorSpace;
        next.anisotropy = 8;
        // The one rug tile repeats across the whole world, mirrored at each edge
        // so roads line up with the mirrored mask in sim.ts.
        next.wrapS = THREE.MirroredRepeatWrapping;
        next.wrapT = THREE.MirroredRepeatWrapping;
        next.repeat.set(TILES, TILES);
        next.needsUpdate = true;
        tex = next;
        if (!dead) setTexture(next);
      },
      undefined,
      () => {
        if (!dead) setLoadError("The rug photo did not load.");
      },
    );
    fetch(MASK_URL)
      .then((res) => {
        if (!res.ok) throw new Error("mask");
        return res.arrayBuffer();
      })
      .then((buf) => {
        if (dead) return;
        const mask = new Uint8Array(buf);
        maskRef.current = mask;
        const spawn = findSpawn(mask);
        spawnRef.current = spawn;
        simRef.current.x = spawn.x;
        simRef.current.z = spawn.z;
        simRef.current.yaw = spawn.yaw;
        setReady(true);
      })
      .catch(() => {
        if (!dead) setLoadError("The street map did not load.");
      });
    return () => {
      dead = true;
      tex?.dispose();
    };
  }, []);

  useEffect(() => {
    const keys = keysRef.current;
    const down = (event: KeyboardEvent) => {
      if (DRIVE_KEYS.includes(event.code)) event.preventDefault();
      keys.add(event.code);
    };
    const up = (event: KeyboardEvent) => {
      keys.delete(event.code);
    };
    const blur = () => keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  useEffect(() => {
    const probe: ControlsProbe = {
      getYaw: () => simRef.current.yaw,
      getSpeed: () => simRef.current.speed,
      setSteer: (v: number) => {
        simRef.current.steerOverride = Math.max(-1, Math.min(1, v));
      },
      setKeys: (codes: string[]) => {
        injectedRef.current = new Set(codes);
      },
    };
    window.__controlsTest = probe;
    return () => {
      if (window.__controlsTest === probe) delete window.__controlsTest;
    };
  }, []);

  useEffect(() => {
    return () => {
      musicRef.current?.pause();
      musicRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!started) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = "triangle";
    osc.frequency.value = 60;
    gain.gain.value = 0.0001;
    filter.type = "lowpass";
    filter.frequency.value = 480;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    void ctx.resume();
    audioRef.current = { ctx, osc, gain };
    const onVis = () => {
      if (document.visibilityState === "visible") void ctx.resume();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      osc.stop();
      void ctx.close();
      audioRef.current = null;
    };
  }, [started]);

  const onHud = (nextSpeed: number, nextDistance: number) => {
    setSpeed(nextSpeed);
    setDistance(nextDistance);
    const meters = Math.round(nextDistance * 8);
    setBest((prev) => {
      if (meters <= prev) return prev;
      localStorage.setItem("rug-city-best-m", String(meters));
      return meters;
    });
  };

  const begin = () => {
    simRef.current.started = true;
    setStarted(true);
  };

  const reset = () => {
    const spawn = spawnRef.current;
    const sim = simRef.current;
    if (!spawn) return;
    sim.x = spawn.x;
    sim.z = spawn.z;
    sim.yaw = spawn.yaw;
    sim.speed = 0;
    sim.face = 0;
    sim.wheel = 0;
    sim.distance = 0;
    sim.shake = 0;
    setSpeed(0);
    setDistance(0);
  };

  const toggleMute = () => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
    if (musicRef.current) musicRef.current.muted = mutedRef.current;
  };

  const toggleNight = () => {
    const next = !nightRef.current;
    nightRef.current = next;
    setNight(next);
    if (next) {
      if (!musicRef.current) {
        const music = new Audio(MUSIC_URL);
        music.loop = true;
        music.volume = 0.5;
        musicRef.current = music;
      }
      musicRef.current.muted = mutedRef.current;
      // Starts from the button press, so browsers allow it. A missing file just stays silent.
      musicRef.current.play().catch(() => {});
    } else {
      musicRef.current?.pause();
    }
  };

  const pace = Math.round(Math.abs(speed) * 32);
  const meters = Math.round(distance * 8);
  const keys = keysRef.current;

  return (
    <main className="play-root" data-night={night}>
      {mounted && texture ? (
        <Canvas
          dpr={[1, 1.6]}
          camera={{ fov: 40, position: [0, 9.2, 7.4], near: 0.05, far: 80 }}
          gl={{ antialias: true }}
        >
          <World
            texture={texture}
            maskRef={maskRef}
            simRef={simRef}
            keysRef={keysRef}
            injectedRef={injectedRef}
            mutedRef={mutedRef}
            nightRef={nightRef}
            audioRef={audioRef}
            dotRef={dotRef}
            onHud={onHud}
          />
        </Canvas>
      ) : mounted ? (
        <Canvas
          dpr={[1, 1.5]}
          camera={{ fov: 40, position: [0, 9.2, 7.4], near: 0.05, far: 80 }}
          gl={{ antialias: true }}
        >
          <color attach="background" args={["#2a241e"]} />
        </Canvas>
      ) : null}

      {started ? (
        <div className="hud">
          <div className="hud-top">
            <div className="stat-row">
              <div className="stat">
                <span>Speed</span>
                <strong>{pace}</strong>
              </div>
              <div className="stat">
                <span>Drive</span>
                <strong>{meters} m</strong>
              </div>
              <div className="stat">
                <span>Best</span>
                <strong>{best} m</strong>
              </div>
            </div>
            <div className="minimap" aria-hidden="true">
              <img src={RUG_URL} alt="" draggable={false} />
              <div className="minimap-dot" ref={dotRef} />
            </div>
          </div>
          <div className="hud-bottom">
            <div className="cluster">
              <p className="hint hint-desktop">Drag on the rug to pull the car. Arrows or WASD drive.</p>
              <div className="stat-row">
                <button type="button" className="icon-btn" onClick={reset} aria-label="Reset car">
                  <RotateCcw size={18} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={toggleMute}
                  aria-label={muted ? "Unmute sound" : "Mute sound"}
                >
                  {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={toggleNight}
                  aria-label={night ? "Switch to day" : "Switch to night"}
                  aria-pressed={night}
                >
                  {night ? <Sun size={18} /> : <Moon size={18} />}
                </button>
              </div>
            </div>
            <div className="dpad" aria-label="Drive controls">
              <button type="button" className="up" aria-label="Accelerate" {...holdProps(keys, "ArrowUp")}>
                <ChevronUp size={22} />
              </button>
              <button type="button" className="left" aria-label="Steer left" {...holdProps(keys, "ArrowLeft")}>
                <ChevronLeft size={22} />
              </button>
              <button type="button" className="down" aria-label="Brake or reverse" {...holdProps(keys, "ArrowDown")}>
                <ChevronDown size={22} />
              </button>
              <button type="button" className="right" aria-label="Steer right" {...holdProps(keys, "ArrowRight")}>
                <ChevronRight size={22} />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {!started ? (
        <div className="start-layer">
          <div className="start-card">
            <p className="eyebrow">Play rug</p>
            <h1>Rug City</h1>
            <p className="lede">
              A little red car on your city rug. Drag along the gray streets, or drive with the arrow keys.
              Grass is slow. Buildings stop you.
            </p>
            <div className="keys" aria-label="Arrow keys">
              <kbd>Up</kbd>
              <kbd>Down</kbd>
              <kbd>Left</kbd>
              <kbd>Right</kbd>
            </div>
            <div className="start-actions">
              <button type="button" className="btn btn-primary" onClick={begin} disabled={!ready || !texture}>
                {loadError ? "Could not load" : ready && texture ? "Start" : "Preparing"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={toggleNight} aria-pressed={night}>
                {night ? <Sun size={16} /> : <Moon size={16} />}
                {night ? "Day" : "Night"}
              </button>
            </div>
            {loadError ? <p className="lede">{loadError}</p> : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
