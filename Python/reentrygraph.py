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
v0 = 7222.0              # Initial velocity (m/s) (~26000 km/hr)
h0 = 200000.0            # Initial altitude (m); note: 200 km
Cd = 0.81                # Drag coefficient (assumed)
A = 50 * 10.0            # Frontal area (m^2) for a 50 m x 10 m face
m = 1e5                  # Mass (kg); reduced for faster deceleration

dt = 0.1                 # Time step (s)
max_steps = 200000       # Maximum number of simulation steps

# Run the simulation
altitudes, velocities, heat_fluxes = simulate_reentry(h0, v0, dt, max_steps, rho0, H, g, Cd, A, m)

# Define plasma threshold for heat flux (W/m²)
plasma_threshold = 1e5

# Filter simulation data for plasma-producing heat flux.
# (we exclude the initial point; hence heat_fluxes[1:])
valid_idx = heat_fluxes[1:] >= plasma_threshold
altitudes_plasma = altitudes[1:][valid_idx]
heat_fluxes_plasma = heat_fluxes[1:][valid_idx]

# For a 2 T electromagnet effect we assume it reduces the plasma density 
# (and thus the flux) to 60% of the normal value.
flux_2T = 0.6 * heat_fluxes_plasma

# --- Compute cumulative energy deposition and percent capacity used for both cases ---
# Assume a tile energy capacity (J/m²). This is the energy per unit area that the tile can absorb.
tile_capacity = 1e6  # J/m² (example value; adjust as needed)

# Integration: Each heat flux value (W/m²) multiplied by dt gives energy per unit area (J/m²).
cumulative_energy_normal = np.cumsum(heat_fluxes_plasma * dt)
cumulative_energy_2T = np.cumsum(flux_2T * dt)

# Convert cumulative energy to a percentage of the tile's capacity.
percent_usage_normal = cumulative_energy_normal / tile_capacity * 100  # Normal plasma case
percent_usage_2T = cumulative_energy_2T / tile_capacity * 100            # 2 T magnetic cooling case

# --- Plotting ---
# We'll plot altitude (x-axis) vs. both the plasma heat flux (left y-axis, log scale)
# and the cumulative percent energy used (right y-axis).
fig, ax1 = plt.subplots(figsize=(8, 6))

# Plot plasma heat flux on the left y-axis.
color_flux = 'red'
ax1.semilogy(altitudes_plasma, heat_fluxes_plasma, linewidth=2, color=color_flux, label='Normal Plasma Heat Flux')
ax1.semilogy(altitudes_plasma, flux_2T, linewidth=2, color='purple', label='2 T Magnetic Cooling (60% of normal)')
ax1.set_xlabel('Altitude (m)', fontsize=12)
ax1.set_ylabel('Plasma Heat Flux (W/m²)', fontsize=12, color=color_flux)
ax1.tick_params(axis='y', labelcolor=color_flux)
ax1.invert_xaxis()  # Altitude decreases during reentry
ax1.grid(True, which="both", ls="--", lw=0.5)

# Create a secondary y-axis for the tile energy capacity used.
ax2 = ax1.twinx()
color_capacity = 'blue'
ax2.plot(altitudes_plasma, percent_usage_normal, linewidth=2, color=color_capacity, label='Tile Capacity Used (Normal)')
ax2.plot(altitudes_plasma, percent_usage_2T, linewidth=2, color='green', label='Tile Capacity Used (2 T Cooling)')
ax2.set_ylabel('Tile Energy Capacity Used (%)', fontsize=12, color=color_capacity)
ax2.tick_params(axis='y', labelcolor=color_capacity)

plt.title('Plasma Heat Flux and Tile Energy Capacity Usage vs. Altitude', fontsize=14)

# Combine legends from both axes.
lines1, labels1 = ax1.get_legend_handles_labels()
lines2, labels2 = ax2.get_legend_handles_labels()
ax1.legend(lines1 + lines2, labels1 + labels2, loc='upper right')

plt.tight_layout()
plt.show()
