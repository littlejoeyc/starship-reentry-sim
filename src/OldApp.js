// src/App.js
import React, { useState, useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';

/**
 * CameraFollow updates the camera to look at the starship's current center.
 * This component is rendered inside Canvas, so using useThree and useFrame is allowed.
 */
function CameraFollow({ simulationState }) {
  const { camera } = useThree();
  useFrame(() => {
    camera.lookAt(0, simulationState.altitude / 10000, 0);
  });
  return null;
}

/**
 * AtmosphereLayer renders a horizontal slice representing the 10 m of air
 * immediately below the ship. Its texture is updated each frame from an offscreen canvas.
 * For performance the resolution is configurable.
 */
function AtmosphereLayer({ simulationState, shipBottomY, resolution = 200 }) {
  const areaSize = 20;
  const canvasRef = useRef(document.createElement('canvas'));
  const textureRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = resolution;
    canvas.height = resolution;
  }, [resolution]);

  useEffect(() => {
    textureRef.current = new THREE.CanvasTexture(canvasRef.current);
    textureRef.current.minFilter = THREE.LinearFilter;
  }, []);

  useFrame(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    const data = imgData.data;

    const baseTemp = 300;
    const plasmaThreshold = 3000;
    for (let j = 0; j < canvas.height; j++) {
      for (let i = 0; i < canvas.width; i++) {
        const x = (i / canvas.width) * areaSize - areaSize / 2;
        const z = (j / canvas.height) * areaSize - areaSize / 2;
        const d = Math.sqrt(x * x + z * z);
        const localHeat = simulationState.effectiveHeat * Math.exp(-d / 3);
        const temperature = baseTemp + localHeat * 1e6;
        
        let r, g, b;
        if (temperature >= plasmaThreshold) {
          r = 128; g = 0; b = 128;
        } else {
          const t = (temperature - baseTemp) / (plasmaThreshold - baseTemp);
          r = Math.floor(255 * t);
          g = 0;
          b = Math.floor(255 * (1 - t));
        }
        
        const index = (j * canvas.width + i) * 4;
        data[index] = r;
        data[index + 1] = g;
        data[index + 2] = b;
        data[index + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    if (textureRef.current) textureRef.current.needsUpdate = true;
  });

  return textureRef.current ? (
    <mesh position={[0, shipBottomY - areaSize / 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[areaSize, areaSize]} />
      <meshBasicMaterial map={textureRef.current} side={THREE.DoubleSide} />
    </mesh>
  ) : null;
}

/**
 * Starship simulates the reentry physics and displays the starship.
 * It is modeled as a box (with a semi-transparent material) that descends.
 */
function Starship({ magnetPower, simulationState, setSimulationState }) {
  const shipRef = useRef();
  const width = 9, height = 50, depth = 9;
  const baseTemperature = 300;
  const rho0 = 1.225;
  const scaleHeight = 8400;
  const scalingFactor = .000000000012;
  const reentryDir = new THREE.Vector3(0, -1, 0);

  useFrame((state, delta) => {
    let { altitude, speed } = simulationState;
    if (altitude <= 0) return;
    const density = rho0 * Math.exp(-altitude / scaleHeight);
    const heatFlux = density * Math.pow(speed, 3);
    const reductionFactor = 1 - magnetPower / 5;
    const effectiveHeat = heatFlux * reductionFactor * scalingFactor;

    const g = 9.81;
    const dragDeceleration = density * 0.81 * speed;
    const newSpeed = Math.max(speed - (g + dragDeceleration) * delta, 0);
    const newAltitude = Math.max(altitude - newSpeed * delta, 0);

    setSimulationState({
      altitude: newAltitude,
      speed: newSpeed,
      effectiveHeat: effectiveHeat,
    });

    if (shipRef.current) {
      shipRef.current.position.y = newAltitude / 1000;
    }
  });

  return (
    <group ref={shipRef}>
      <mesh>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color="gray" transparent opacity={0.2} />
      </mesh>
    </group>
  );
}

export default function App() {
  const [simulationState, setSimulationState] = useState({
    altitude: 120000,
    speed: 7800,
    effectiveHeat: 0,
  });
  const [magnetPower, setMagnetPower] = useState(0);

  const handleRestart = () => {
    setSimulationState({
      altitude: 120000,
      speed: 7800,
      effectiveHeat: 0,
    });
  };

  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      <Canvas camera={{ position: [0, 100, 100], fov: 60 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 20, 10]} intensity={1} />
        <Starship
          magnetPower={magnetPower}
          simulationState={simulationState}
          setSimulationState={setSimulationState}
        />
        {/* The bottom of the ship is at (simulationState.altitude/1000) - 25 (half the ship height) */}
        <AtmosphereLayer
          simulationState={simulationState}
          shipBottomY={(simulationState.altitude / 1000) - 25}
          resolution={200}
        />
        <OrbitControls target={[0, simulationState.altitude / 1000, 0]} />
        <CameraFollow simulationState={simulationState} />
      </Canvas>
      <div style={{
        position: 'absolute',
        top: 20,
        left: 20,
        background: 'rgba(255,255,255,0.8)',
        padding: '10px',
        borderRadius: '8px'
      }}>
        <div><strong>Altitude:</strong> {simulationState.altitude.toFixed(0)} m</div>
        <div><strong>Speed:</strong> {simulationState.speed.toFixed(0)} m/s</div>
        <div style={{ marginTop: '10px' }}>
          <button onClick={handleRestart}>Restart Simulation</button>
        </div>
        <div style={{ marginTop: '10px' }}>
          <label>
            Magnet Power (Tesla): {magnetPower}
            <br />
            <input
              type="range"
              min="0"
              max="4"
              step="0.1"
              value={magnetPower}
              onChange={(e) => setMagnetPower(Number(e.target.value))}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
