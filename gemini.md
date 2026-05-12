# Cosmo-Three Project Context

## Overview
Cosmo-Three is an interactive, 3D space-themed node graph and family tree visualization web application. The application allows users to create nodes representing individuals (e.g., 'Origin', 'Ancestor', 'Descendant', 'Sibling'), connect them with animated threads, and navigate through a deep, parallax-scrolling cosmos.

## Technology Stack
- **Frontend Framework**: React 19 with Vite
- **Language**: TypeScript
- **Styling**: Tailwind CSS (v4), augmented with `clsx` and `tailwind-merge` for dynamic class management.
- **Animations & 3D Parallax**: Framer Motion (`motion`, `AnimatePresence`, `useMotionValue`, `useTransform`) combined with a custom HTML5 `<canvas>` implementation.
- **Backend & Authentication**: Firebase (Authentication via Google Provider, Database via Firestore).
- **Icons**: `lucide-react`
- **Other Dependencies**: `date-fns` for date manipulation, `d3` (available for complex data operations).

## Core Architecture
The core logic resides predominantly in `src/App.tsx`. 
- **Rendering Strategy**: The app uses a hybrid rendering approach. A full-screen `<canvas>` handles the high-performance background particle system (starfield) and the drawing of "Cosmic Threads" (connections between nodes). The interactive UI elements (`NodeCard`, modals) are rendered as standard HTML elements overlaid on the canvas, animated using Framer Motion to match the camera's position and zoom, implementing a pseudo-3D parallax effect based on each node's `z` coordinate.
- **State Management**: React state manages `nodes`, `links`, camera offsets, and UI flow (modals, selection modes).
- **Phases**: The app has distinct visual phases: `assembling`, `sphere`, `dispersing`, `loading`, and finally `space` (the main interactive mode).

## Key Files
1. **`src/App.tsx`**: The heart of the application. It contains:
   - The main `<App />` component.
   - The custom rendering loop for the `<canvas>`.
   - Node and link state management.
   - Firebase synchronization logic.
   - Event listeners for dragging, zooming, and panning the "space".
   - Helper components like `NodeCard`, `GhostCard`, and `Navigator` (a mini-map).
2. **`src/firebase.ts`**: Initializes the Firebase app, Auth, and Firestore services using local configuration files (`firebase-applet-config.json`).
3. **`src/types.ts`**: Defines standard data interfaces like `FamilyMember` and `TreeData`. Note that `App.tsx` also defines its own localized `Node` and `Link` interfaces.
4. **`package.json`**: Lists all dependencies and defines scripts like `npm run dev`.

## Data Models
- **Node**: Represents a person or entity. Contains properties like `id`, `label`, `x`, `y`, `z` (for 3D depth), `type` ('user', 'ancestor', 'descendant', 'sibling'), `parentId`, `profession`, `bio`, and `createdAt`.
- **Link**: Represents a connection between two nodes. Contains `id`, `from` (Node ID), and `to` (Node ID).

## Firebase Integration
- **Authentication**: Supports Google Sign-In via `signInWithPopup`.
- **Firestore**: Data is stored in a `trees` collection. Each document corresponds to a user's tree (identified by `ownerId`) and contains arrays of `nodes` and `links`.
- **Auto-save**: The application implements an auto-save mechanism that persists the current state to both `localStorage` (as a fallback) and Firestore (if authenticated) after a brief period of inactivity.

## Running Locally
To run the project:
1. Ensure dependencies are installed (`npm install`).
2. Make sure Firebase configuration is present (`firebase-applet-config.json` and `.env.local` for API keys).
3. Start the Vite development server: `npm run dev`.
