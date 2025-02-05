// src/App.js
import React, { useState, useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

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
 * AtmosphereVolume renders a 3D box representing a 100 m × 10 m × 100 m volume of atmosphere.
 * (This code remains unchanged.)
 */
function AtmosphereVolume({ simulationState, shipBottomY }) {
  // ... (Assume this remains as in your previous version)
  const materialRef = useRef();
  useFrame(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.effectiveHeat.value = simulationState.effectiveHeat;
    }
  });
  return (
    <mesh position={[0, shipBottomY, 0]}>
      <boxGeometry args={[100, 10, 100]} />
      {/* For simplicity, using a basic material here; your custom shader may be inserted as needed */}
      <meshBasicMaterial color="orange" transparent opacity={0.4} side={THREE.DoubleSide} />
    </mesh>
  );
}

/**
 * Starship simulates the reentry physics and displays the starship.
 * Now, it also computes plasmaFluxDensity = density * v^3 (the raw heat flux) in addition to effectiveHeat.
 */
function Starship({ magnetPower, simulationState, setSimulationState, isRunning }) {
  const shipRef = useRef();
  // Updated ship geometry: 50 m wide x 10 m high x 10 m deep.
  const width = 50, height = 10, depth = 10;
  const rho0 = 1.225;
  const scaleHeight = 8400;
  const scalingFactor = 0.000000000012;
  const terminalVelocity = 200;
  
  useFrame((state, delta) => {
    if (!isRunning) return;
    
    let { altitude, speed } = simulationState;
    if (altitude <= 0) return;
    
    // Compute the density using an exponential atmosphere model.
    const density = rho0 * Math.exp(-altitude / scaleHeight);
    // Compute the raw heat flux (plasma flux density) as density * v^3.
    const plasmaFluxDensity = density * Math.pow(speed, 3);
    // Compute drag force and acceleration.
    const F_drag = 0.5 * density * speed**2 * 0.81 * (50 * 10);
    const a = -9.81 - (F_drag / 2e5);
    // Update velocity and altitude (Euler integration).
    const newSpeed = altitude > 0 ? Math.max(speed + a * delta, terminalVelocity) : 0;
    const newAltitude = Math.max(altitude - newSpeed * delta, 0);
    // Compute effective heat taking magnetic cooling into account.
    // Here, reductionFactor depends on magnetPower.
    const reductionFactor = 1 - magnetPower / 5;
    const effectiveHeat = plasmaFluxDensity * reductionFactor * scalingFactor;
    
    setSimulationState({
      altitude: newAltitude,
      speed: newSpeed,
      effectiveHeat: effectiveHeat,
      plasmaFluxDensity: plasmaFluxDensity,
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
 * GraphOverlay renders a graph in the upper right-hand corner.
 * It now plots three curves:
 *  - Blue: Magnetic Cooling effective heat flux (which is 40% of the raw flux, scaled by scalingFactor)
 *  - Red: Normal effective heat flux (as computed in simulation)
 *  - Green: Plasma Flux Density (raw heat flux: density * v^3)
 *
 * We use scaling factors to bring these numbers into a similar range for visualization.
 */
function GraphOverlay({ simulationState }) {
  const canvasRef = useRef(null);
  // historyRef will store objects with time, speed, effectiveHeat, and plasmaFluxDensity.
  const historyRef = useRef([]);
  const historyDuration = 60000;
  // Use the same effectiveHeatScale from before (e.g., 1e9) for effectiveHeat.
  const effectiveHeatScale = 1e9;
  // Choose a scaling factor for plasmaFluxDensity for visualization.
  const plasmaFluxScale = 1e-9;
  
  useEffect(() => {
    const now = performance.now();
    historyRef.current.push({
      time: now,
      speed: simulationState.speed,
      effectiveHeat: simulationState.effectiveHeat,
      plasmaFluxDensity: simulationState.plasmaFluxDensity,
    });
    historyRef.current = historyRef.current.filter(d => now - d.time <= historyDuration);
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    
    ctx.clearRect(0, 0, width, height);
    
    // Determine time range for the x-axis (in seconds)
    const times = historyRef.current.map(d => d.time);
    if (times.length === 0) return;
    const t0 = Math.min(...times);
    const tEnd = Math.max(...times);
    const timeRange = (tEnd - t0) / 1000 || 1;
    
    // For speed, we use a fixed range.
    const speedMin = 0;
    const speedMax = 8000;
    // For effectiveHeat, use dynamic range based on history and effectiveHeatScale.
    const effectiveHeatValues = historyRef.current.map(d => d.effectiveHeat * effectiveHeatScale);
    const effectiveHeatMin = 0;
    const effectiveHeatMax = Math.max(...effectiveHeatValues, 1);
    
    // For plasmaFluxDensity, apply plasmaFluxScale.
    const plasmaFluxValues = historyRef.current.map(d => d.plasmaFluxDensity * plasmaFluxScale);
    const plasmaFluxMin = 0;
    const plasmaFluxMax = Math.max(...plasmaFluxValues, 1);
    
    // Functions to convert time to x, and values to y.
    const timeToX = (time) => ((time - t0) / 1000) / timeRange * width;
    const speedToY = (speed) => height - ((speed - speedMin) / (speedMax - speedMin)) * height;
    const effectiveHeatToY = (val) => height - ((val - effectiveHeatMin) / (effectiveHeatMax - effectiveHeatMin)) * height;
    const plasmaFluxToY = (val) => height - ((val - plasmaFluxMin) / (plasmaFluxMax - plasmaFluxMin)) * height;
    
    // Draw axes
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(width, height);
    ctx.moveTo(0, 0);
    ctx.lineTo(0, height);
    ctx.stroke();
    
    // Plot speed (blue line) on a separate axis (optional, here we already have speed in the UI)
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
    
    // Plot effectiveHeat (red line), scaled by effectiveHeatScale.
    ctx.strokeStyle = 'red';
    ctx.beginPath();
    historyRef.current.forEach((d, i) => {
      const x = timeToX(d.time);
      const y = effectiveHeatToY(d.effectiveHeat * effectiveHeatScale);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    
    // Plot plasmaFluxDensity (green line), scaled by plasmaFluxScale.
    ctx.strokeStyle = 'green';
    ctx.beginPath();
    historyRef.current.forEach((d, i) => {
      const x = timeToX(d.time);
      const y = plasmaFluxToY(d.plasmaFluxDensity * plasmaFluxScale);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    
    // Add labels for each curve.
    ctx.fillStyle = 'blue';
    ctx.font = '10px sans-serif';
    ctx.fillText('Speed (m/s)', 5, 12);
    ctx.fillStyle = 'red';
    ctx.fillText('Effective Heat (scaled)', 5, 24);
    ctx.fillStyle = 'green';
    ctx.fillText('Plasma Flux Density (scaled)', 5, 36);
  }, [simulationState, effectiveHeatScale, plasmaFluxScale]);
  
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
  const [simulationState, setSimulationState] = useState({
    altitude: 120000,
    speed: 7222,
    effectiveHeat: 0,
    plasmaFluxDensity: 0,
  });
  const [magnetPower, setMagnetPower] = useState(0);
  const [isRunning, setIsRunning] = useState(true);

  const handleRestart = () => {
    setSimulationState({
      altitude: 120000,
      speed: 7222,
      effectiveHeat: 0,
      plasmaFluxDensity: 0,
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
        {/* Place the atmospheric volume just below the ship.
            The ship’s bottom is at (simulationState.altitude/1000) - 25.
            The volume is 10 m tall, so its center is offset by +5 m. */}
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
        <div>
          <strong>Plasma Flux Density:</strong> {simulationState.plasmaFluxDensity.toExponential(2)} W/m²
        </div>
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
