# Crazy Office: Night Shift — Reborn 1.1

This is the current clean-slate Crazy Office build. Run the folder from an HTTPS static host, open `index.html` in a compatible WebXR headset browser and press **ENTER VR**.

## Controls
- Trigger in the elevator: choose Shift / Survival / Riot.
- Right hand: bat while intact.
- Grip with the free hand: grab office props.
- Release grip: throw the held prop.
- Hold a prop close to your body to block; an active last-second shield motion can Perfect Block.

## Desktop preview
Run `python3 -m http.server 3000`, open `http://localhost:3000`, then use 1/2/3 to start modes and R to return to the elevator. Desktop preview is for logic/visual checks, not VR feel.

## Current scope
The single-player/WebXR gameplay core is implemented. A production multiplayer service is intentionally not bundled into this clean-slate release: real co-op needs host-authoritative networking, signaling and multi-headset latency testing rather than an untested fake layer.
