import numpy as np
import matplotlib.pyplot as plt
import numba

@numba.njit
def simulate_reentry(h0, v0, dt, max_steps, rho0, H, g, Cd, A, m):
    altitudes = np.empty(max_steps)
    velocities = np.empty(max_steps)
    heat_fluxes = np.empty(max_steps)
    
    h = h0
    v = v0
    altitudes[0] = h0
    velocities[0] = v0
    heat_fluxes[0] = 0.0  # initial heat flux not used
    
    step = 1
    while h > 0 and step < max_steps:
        rho = rho0 * np.exp(-h / H)
        F_drag = 0.5 * rho * v**2 * Cd * A
        a = -g - (F_drag / m)
        v = v + a * dt
        h = h - v * dt
        if h < 0:
            h = 0.0
        altitudes[step] = h
        velocities[step] = v
        heat_fluxes[step] = rho * v**3
        step += 1
        
    return altitudes[:step], velocities[:step], heat_fluxes[:step]

# Constants for the simulation
rho0 = 1.225             # Sea-level density (kg/m^3)
H = 8400.0               # Scale height (m)
g = 9.81                 # Gravitational acceleration (m/s^2)
v0 = 7222.0              # Initial velocity (m/s) ~26000 km/hr
h0 = 200000.0            # Initial altitude (200 km)
Cd = 0.81                # Drag coefficient (assumed)
A = 50 * 10.0            # Frontal area (m^2) for a 50 m x 10 m face
m = 2e5                  # Mass (kg); reduced for faster deceleration

dt = 0.1                 # Time step (s)
max_steps = 100000       # Maximum number of simulation steps

# Run the simulation with the compiled function
altitudes, velocities, heat_fluxes = simulate_reentry(h0, v0, dt, max_steps, rho0, H, g, Cd, A, m)

# Define plasma threshold for heat flux (W/m^2)
plasma_threshold = 1e5

# Filter the simulation data for plasma-producing heat flux.
# (We use heat_fluxes[1:] corresponding to simulation points after the initial condition.)
valid_idx = heat_fluxes[1:] >= plasma_threshold
altitudes_plasma = altitudes[1:][valid_idx]
heat_fluxes_plasma = heat_fluxes[1:][valid_idx]

# Compute the Magnetic Cooling heat flux.
# If the magnetic cooling reduces the plasma density by 60%, then only 40% of the original density remains.
# Since q ∝ ρ, the magnetic cooling heat flux is 0.4 * q_normal.
magnetic_cooling_flux = 0.6 * heat_fluxes_plasma

plt.figure(figsize=(8, 6))
if heat_fluxes_plasma.size > 0:
    plt.semilogx(heat_fluxes_plasma, altitudes_plasma, linewidth=2, color='red', label='Normal Plasma Heat Flux')
    plt.semilogx(magnetic_cooling_flux, altitudes_plasma, linewidth=2, color='blue', label='Magnetic Cooling (Plasma density reduced by 60%)')
    plt.legend()
else:
    plt.semilogx([], [], linewidth=2, label='No Plasma Formation')
    plt.legend()

plt.xlabel('Heat Flux (W/m²)', fontsize=12)
plt.ylabel('Altitude (m)', fontsize=12)
plt.title('Plasma Heat Flux vs. Altitude during Reentry', fontsize=14)
plt.gca().invert_yaxis()  # so that 200 km is at the top
plt.grid(True, which="both", ls="--", lw=0.5)
plt.tight_layout()
plt.show()
