// src/App.js
import React, { useState, useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree, extend } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { shaderMaterial } from '@react-three/drei';

// Create a custom shader material for the atmosphere volume.
// This version uses ray marching with a robust ray–box intersection.
const AtmosphereMaterial = shaderMaterial(
  {
    effectiveHeat: 0,
    baseTemp: 300,
    plasmaThreshold: 3000,
    hDecayScale: 3.0,   // horizontal decay (in meters)
    vDecayScale: 5.0,   // vertical decay (in meters); bottom is at y = -5
    rayOrigin: new THREE.Vector3(), // camera position in volume-local space
    boxHalfSize: new THREE.Vector3(50, 5, 50), // half dimensions of the box volume
  },
  // Vertex shader: pass the vertex position to the fragment shader.
  `
    varying vec3 vPosition;
    void main() {
      vPosition = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  // Fragment shader: perform ray marching using a robust ray-box intersection.
  `
    uniform float effectiveHeat;
    uniform float baseTemp;
    uniform float plasmaThreshold;
    uniform float hDecayScale;
    uniform float vDecayScale;
    uniform vec3 rayOrigin;
    uniform vec3 boxHalfSize;
    varying vec3 vPosition;

    // Computes ray-box intersection in object space.
    void main() {
      // Compute the ray direction (in local/object space) from rayOrigin to current fragment position.
      vec3 rayDir = normalize(vPosition - rayOrigin);

      // Compute intersection distances along each axis using the slabs method.
      vec3 invDir = 1.0 / rayDir;
      vec3 t0s = (-boxHalfSize - rayOrigin) * invDir;
      vec3 t1s = ( boxHalfSize - rayOrigin) * invDir;
      vec3 tsmaller = min(t0s, t1s);
      vec3 tbigger  = max(t0s, t1s);
      float tmin = max(max(tsmaller.x, tsmaller.y), tsmaller.z);
      float tmax = min(min(tbigger.x, tbigger.y), tbigger.z);

      // If no intersection, discard fragment.
      if(tmax < 0.0 || tmin > tmax){
        discard;
      }
      
      // We'll march from t = tmin to t = tmax.
      int steps = 200;
      float dt = (tmax - tmin) / float(steps);
      
      vec3 maxColor = vec3(0.0);

      // Ray-march through the volume.
      for (int i = 0; i < 200; i++) {
        float t = tmin + dt * float(i);
        vec3 samplePos = rayOrigin + rayDir * t;
        // Compute horizontal decay factor based on xz distance.
        float horizontalFactor = exp(-length(samplePos.xz) / hDecayScale);
        // Compute vertical decay factor (assume volume bottom at y = -5).
        float verticalFactor = exp(-((samplePos.y + 5.0) / vDecayScale));
        float localHeat = effectiveHeat * horizontalFactor * verticalFactor;
        float temperature = baseTemp + localHeat * 1e6;
        
        vec3 sampleColor;
        if (temperature >= plasmaThreshold) {
          sampleColor = vec3(128.0/255.0, 0.0, 128.0/255.0);
        } else {
          float tVal = (temperature - baseTemp) / (plasmaThreshold - baseTemp);
          sampleColor = vec3(tVal, 0.0, 1.0 - tVal);
        }
        maxColor = max(maxColor, sampleColor);
      }
      
      gl_FragColor = vec4(maxColor, 0.4);
    }
  `
);

// Register the custom material with Three.js.
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
 * AtmosphereVolume renders a 3D box representing a 100 m × 10 m × 100 m volume of atmosphere.
 * The shader performs robust ray marching so that internal heat variations (plasma) are visible
 * from any viewing angle.
 */
function AtmosphereVolume({ simulationState, shipBottomY }) {
  const materialRef = useRef();
  const { camera } = useThree();

  // Update shader uniforms every frame.
  useFrame(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.effectiveHeat.value = simulationState.effectiveHeat;
      // Compute the camera position in volume-local space.
      // The mesh is positioned at [0, shipBottomY, 0] in world space, and the geometry is centered at (0,0,0).
      const localCamPos = camera.position.clone();
      localCamPos.y -= shipBottomY; 
      materialRef.current.uniforms.rayOrigin.value.copy(localCamPos);
    }
  });
  
  return (
    <mesh position={[0, shipBottomY, 0]}>
      {/* BoxGeometry: width 100 m, height 10 m, depth 100 m. */}
      <boxGeometry args={[100, 100, 100]} />
      <atmosphereMaterial ref={materialRef} transparent side={THREE.DoubleSide} />
    </mesh>
  );
}

/**
 * Starship simulates the reentry physics and displays the starship.
 * The simulation updates only if isRunning is true.
 */
function Starship({ magnetPower, simulationState, setSimulationState, isRunning }) {
  const shipRef = useRef();
  // Updated ship geometry.
  const width = 50, height = 10, depth = 10;
  const rho0 = 1.225;
  const scaleHeight = 8400;
  const scalingFactor = 0.000000000012;
  // Define terminal velocity (m/s); starship speed won't drop below this value while airborne.
  const terminalVelocity = 200;
  
  useFrame((state, delta) => {
    if (!isRunning) return;
    
    let { altitude, speed } = simulationState;
    if (altitude <= 0) return;
    
    const density = rho0 * Math.exp(-altitude / scaleHeight);
    const heatFlux = density * Math.pow(speed, 3);
    const reductionFactor = 1 - magnetPower / 5;
    const effectiveHeat = heatFlux * reductionFactor * scalingFactor;

    const g = 9.81;
    const dragDeceleration = density * 0.81 * speed;
    const computedSpeed = speed - (g + dragDeceleration) * delta;
    // Ensure speed doesn't drop below terminal velocity while airborne.
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
        <meshStandardMaterial color="gray" transparent opacity={0.5} />
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
        {/* Position the atmospheric volume just below the ship.
            The ship’s bottom is at (simulationState.altitude/1000) - 25.
            Since the volume is 10 m tall, we place it so that its bottom aligns with the ship bottom. */}
        <AtmosphereVolume
          simulationState={simulationState}
          shipBottomY={(simulationState.altitude / 1000) - 20 + 5}
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
