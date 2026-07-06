"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useMemo, useRef } from "react";

// Your soil sensor is resistive: higher raw value = drier soil.
// This converts that raw reading into a 0..1 "moisture" value (1 = wet, 0 = dry)
// used to drive leaf droop and color. Adjust min/max to match your sensor's
// actual dry/wet calibration readings if they differ.
function soilToMoisture(soil, min = 300, max = 1023) {
  if (soil == null) return 0.5;
  const clamped = Math.min(max, Math.max(min, soil));
  return 1 - (clamped - min) / (max - min);
}

function Leaf({ position, rotation, droop, color }) {
  return (
    <mesh position={position} rotation={[rotation[0] + droop, rotation[1], rotation[2]]}>
      <coneGeometry args={[0.12, 0.5, 4]} />
      <meshStandardMaterial color={color} flatShading />
    </mesh>
  );
}

function Chilli({ position, color, scale = 1 }) {
  return (
    <mesh position={position} rotation={[0, 0, Math.PI]} scale={scale}>
      <coneGeometry args={[0.05, 0.35, 8]} />
      <meshStandardMaterial color={color} roughness={0.4} />
    </mesh>
  );
}

function RainDrops({ active }) {
  const groupRef = useRef();
  const drops = useMemo(
    () =>
      Array.from({ length: 30 }, () => ({
        x: (Math.random() - 0.5) * 1.6,
        z: (Math.random() - 0.5) * 1.6,
        y: Math.random() * 2,
        speed: 0.015 + Math.random() * 0.02,
      })),
    []
  );

  useFrame(() => {
    if (!active || !groupRef.current) return;
    groupRef.current.children.forEach((mesh, i) => {
      mesh.position.y -= drops[i].speed;
      if (mesh.position.y < -0.8) mesh.position.y = 1.8;
    });
  });

  if (!active) return null;

  return (
    <group ref={groupRef}>
      {drops.map((d, i) => (
        <mesh key={i} position={[d.x, d.y, d.z]}>
          <sphereGeometry args={[0.012, 4, 4]} />
          <meshBasicMaterial color="#9fd3ff" transparent opacity={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function Plant({ moisture, diseaseRisk = 0, heatRisk = 0, isRaining }) {
  // Dry plant droops; well-watered plant stands upright.
  const droop = useMemo(() => (1 - moisture) * 0.6, [moisture]);

  // Leaf color shifts from healthy green toward yellow/brown as disease risk climbs.
  const leafColor = useMemo(() => {
    const health = 1 - Math.min(1, diseaseRisk / 100);
    const r = Math.round(60 + (1 - health) * 120);
    const g = Math.round(120 * health + 60);
    return `rgb(${r},${g},40)`;
  }, [diseaseRisk]);

  // Chillies look duller/paler under high heat stress.
  const chilliColor = useMemo(() => {
    const stress = Math.min(1, heatRisk / 100);
    const g = Math.round(20 + stress * 90);
    const b = Math.round(20 + stress * 60);
    return `rgb(190,${g},${b})`;
  }, [heatRisk]);

  const leaves = [
    { position: [0.15, 0.1, 0], rotation: [0, 0, -0.6] },
    { position: [-0.15, 0.25, 0], rotation: [0, 0, 0.6] },
    { position: [0.1, 0.45, 0.1], rotation: [0.3, 0, -0.4] },
    { position: [-0.1, 0.6, -0.1], rotation: [-0.3, 0, 0.4] },
  ];

  const chillies = [
    [0.2, 0.3, 0.1],
    [-0.18, 0.5, 0.05],
    [0.12, 0.65, -0.1],
  ];

  return (
    <group>
      {/* pot */}
      <mesh position={[0, -0.75, 0]}>
        <cylinderGeometry args={[0.35, 0.28, 0.4, 16]} />
        <meshStandardMaterial color="#8a5a3c" />
      </mesh>
      {/* soil surface — darkens visibly when wet */}
      <mesh position={[0, -0.55, 0]}>
        <cylinderGeometry args={[0.33, 0.33, 0.06, 16]} />
        <meshStandardMaterial color={moisture > 0.4 ? "#3b2b1f" : "#6b4a30"} />
      </mesh>
      {/* stem */}
      <mesh position={[0, -0.2, 0]}>
        <cylinderGeometry args={[0.035, 0.05, 1, 8]} />
        <meshStandardMaterial color="#4C7A3D" />
      </mesh>
      {leaves.map((leaf, i) => (
        <Leaf key={i} {...leaf} droop={droop} color={leafColor} />
      ))}
      {chillies.map((pos, i) => (
        <Chilli key={i} position={pos} color={chilliColor} scale={0.9 + i * 0.05} />
      ))}
      <RainDrops active={isRaining} />
    </group>
  );
}

// Props map directly onto your existing Supabase rows:
//   soil, rain            -> from `readings` (latest row)
//   diseaseRisk, heatRisk -> from `ai_scores` (latest row)
export default function ChilliPlant3D({ soil, diseaseRisk, heatRisk, rain, height = 260 }) {
  const moisture = soilToMoisture(soil);

  return (
    <div style={{ height, width: "100%" }}>
      <Canvas camera={{ position: [1.4, 0.8, 1.8], fov: 40 }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[2, 3, 2]} intensity={0.8} />
        <Plant
          moisture={moisture}
          diseaseRisk={diseaseRisk}
          heatRisk={heatRisk}
          isRaining={!!rain}
        />
        <OrbitControls enablePan={false} minDistance={1.2} maxDistance={4} />
      </Canvas>
    </div>
  );
}
