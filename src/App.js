// src/App.js
import React, { useState, useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree, extend } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { shaderMaterial } from '@react-three/drei';

// Create a custom shader material using drei's shaderMaterial helper.
// It accepts uniforms and vertex/fragment shaders.
const AtmosphereMaterial = shaderMaterial(
  // Uniforms:
  {
    effectiveHeat: 0,
    baseTemp: 300,
    plasmaThreshold: 3000,
  },
  // Vertex Shader:
  `
    varying vec3 vPosition;
    void main() {
      vPosition = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  // Fragment Shader:
  `
    uniform float effectiveHeat;
    uniform float baseTemp;
    uniform float plasmaThreshold;
    varying vec3 vPosition;
    void main() {
      // Compute horizontal distance from the center of the volume (x-z plane).
      float d = length(vPosition.xz);
      // Compute local heat with an exponential decay (the divisor 3.0 controls the decay rate).
      float localHeat = effectiveHeat * exp(-d / 3.0);
      // Compute the temperature. The multiplication by 1e6 scales the local heat.
      float temperature = baseTemp + localHeat * 1e6;
      
      vec3 color;
      if (temperature >= plasmaThreshold) {
        // If above plasma threshold, use a purple-like color.
        color = vec3(128.0/255.0, 0.0, 128.0/255.0);
      } else {
        // Otherwise, interpolate between blue and red.
        float t = (temperature - baseTemp) / (plasmaThreshold - baseTemp);
        color = vec3(t, 0.0, 1.0 - t);
      }
      // Set an alpha value so that the volume is slightly transparent.
      gl_FragColor = vec4(color, 0.8);
    }
  `
);

// Register the material so we can use it as a JSX element.
extend({ AtmosphereMaterial });

/**
 * CameraFollow updates the camera to look at the starship's current center.
 */
function CameraFollow({ simulationState }) {
  const { camera } = useThree();
  useFrame(() => {
    camera.lookAt(0, simulationState.altitude / 10000, 0);
  });
  return null;
}

/**
 * AtmosphereVolume renders a 3D box representing a volume of atmosphere.
 * The box has a width and depth of 100 m, and a height (thickness) of 10 m.
 * Its custom shader displays a heat distribution computed from effectiveHeat.
 */
function AtmosphereVolume({ simulationState, shipBottomY }) {
  // Create a ref for the mesh to update the shader uniforms.
  const materialRef = useRef();
  
  // Update the shader uniform for effectiveHeat every frame.
  useFrame(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.effectiveHeat.value = simulationState.effectiveHeat;
    }
  });
  
  return (
    <mesh position={[0, shipBottomY, 0]}>
      {/* The box is 100 m x 10 m x 100 m (width x height x depth).
          Since BoxGeometry is centered, the box extends 5 m above and below the given position.
          So by placing it at shipBottomY, its bottom is at shipBottomY - 5 m. */}
      <boxGeometry args={[100, 10, 100]} />
      <atmosphereMaterial ref={materialRef} transparent />
    </mesh>
  );
}

/**
 * Starship simulates the reentry physics and displays the starship.
 * The simulation updates only if isRunning is true.
 */
function Starship({ magnetPower, simulationState, setSimulationState, isRunning }) {
  const shipRef = useRef();
  const width = 50, height = 10, depth = 10;
  const rho0 = 1.225;
  const scaleHeight = 8400;
  const scalingFactor = 0.000000000012;
  // Define terminal velocity (m/s); starship speed won't drop below this value while airborne.
  const terminalVelocity = 200;
  
  useFrame((state, delta) => {
    // Only update if the simulation is running
    if (!isRunning) return;
    
    let { altitude, speed } = simulationState;
    if (altitude <= 0) return;
    
    const density = rho0 * Math.exp(-altitude / scaleHeight);
    const heatFlux = density * Math.pow(speed, 3);
    const reductionFactor = 1 - magnetPower / 5;
    const effectiveHeat = heatFlux * reductionFactor * scalingFactor;

    const g = 9.81;
    const dragDeceleration = density * 0.81 * speed;
    // Compute the new speed based on gravitational and drag deceleration.
    const computedSpeed = speed - (g + dragDeceleration) * delta;
    // Ensure speed doesn't drop below terminal velocity while in the air.
    const newSpeed = altitude > 0 ? Math.max(computedSpeed, terminalVelocity) : 0;
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

/**
 * GraphOverlay renders a small graph in the upper right-hand corner that plots
 * the starship's speed and effective heat over time.
 */
function GraphOverlay({ simulationState }) {
  const canvasRef = useRef(null);
  const historyRef = useRef([]);
  const historyDuration = 60000;
  const effectiveHeatScale = 1e9;
  
  useEffect(() => {
    const now = performance.now();
    historyRef.current.push({
      time: now,
      speed: simulationState.speed,
      effectiveHeat: simulationState.effectiveHeat,
    });
    historyRef.current = historyRef.current.filter(d => now - d.time <= historyDuration);
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    
    ctx.clearRect(0, 0, width, height);
    
    const times = historyRef.current.map(d => d.time);
    if (times.length === 0) return;
    const t0 = Math.min(...times);
    const tEnd = Math.max(...times);
    const timeRange = (tEnd - t0) / 1000 || 1;

    const speedMin = 0;
    const speedMax = 8000;
    const effectiveHeatValues = historyRef.current.map(d => d.effectiveHeat * effectiveHeatScale);
    const effectiveHeatMin = 0;
    const effectiveHeatMax = Math.max(...effectiveHeatValues, 1);

    const timeToX = (time) => ((time - t0) / 1000) / timeRange * width;
    const speedToY = (speed) => height - ((speed - speedMin) / (speedMax - speedMin)) * height;
    const heatToY = (heat) => height - ((heat - effectiveHeatMin) / (effectiveHeatMax - effectiveHeatMin)) * height;
    
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(width, height);
    ctx.moveTo(0, 0);
    ctx.lineTo(0, height);
    ctx.stroke();
    
    ctx.strokeStyle = 'blue';
    ctx.beginPath();
    historyRef.current.forEach((d, i) => {
      const x = timeToX(d.time);
      const y = speedToY(d.speed);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    
    ctx.strokeStyle = 'red';
    ctx.beginPath();
    historyRef.current.forEach((d, i) => {
      const x = timeToX(d.time);
      const y = heatToY(d.effectiveHeat * effectiveHeatScale);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    
    ctx.fillStyle = 'blue';
    ctx.font = '10px sans-serif';
    ctx.fillText('Speed (m/s)', 5, 12);
    ctx.fillStyle = 'red';
    ctx.fillText('Heat (scaled)', 5, 24);
  }, [simulationState, effectiveHeatScale]);
  
  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={150}
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        background: 'rgba(255, 255, 255, 0.8)',
        border: '1px solid #ccc',
        borderRadius: '4px',
        pointerEvents: 'none'
      }}
    />
  );
}

export default function App() {
  // Set initial speed to 26000 km/hr converted to m/s (26000 / 3.6 ≈ 7222.22 m/s)
  const [simulationState, setSimulationState] = useState({
    altitude: 120000,
    speed: 7222.22,
    effectiveHeat: 0,
  });
  const [magnetPower, setMagnetPower] = useState(0);
  const [isRunning, setIsRunning] = useState(true);

  const handleRestart = () => {
    setSimulationState({
      altitude: 120000,
      speed: 7222.22,
      effectiveHeat: 0,
    });
    setIsRunning(true);
  };

  return (
    <div style={{ height: '100vh', width: '100vw', position: 'relative' }}>
      <Canvas camera={{ position: [0, 100, 100], fov: 60 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 20, 10]} intensity={1} />
        <Starship
          magnetPower={magnetPower}
          simulationState={simulationState}
          setSimulationState={setSimulationState}
          isRunning={isRunning}
        />
        {/* Place the atmospheric volume below the ship.
            The ship's bottom (in world space) is at (simulationState.altitude/1000) - 25.
            We position the volume so that its bottom aligns with the ship's bottom.
            Since the volume is 10 m tall and centered on its origin, we set its y-position to (shipBottomY + 5). */}
        <AtmosphereVolume
          simulationState={simulationState}
          shipBottomY={(simulationState.altitude / 1000) - 25 + 5}
        />
        <OrbitControls target={[0, simulationState.altitude / 1000, 0]} />
        <CameraFollow simulationState={simulationState} />
      </Canvas>
      {/* Overlay UI */}
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
        <div style={{ marginTop: '10px' }}>
          <button onClick={() => setIsRunning(false)}>Stop Simulation</button>
        </div>
      </div>
      {/* Graph overlay in upper right corner */}
      <GraphOverlay simulationState={simulationState} />
    </div>
  );
}
