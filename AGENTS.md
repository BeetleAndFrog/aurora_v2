# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Astryon is a 3D spatial conversation and knowledge visualization platform built with Next.js 15, React Three Fiber, and Socket.IO. It enables users to create and explore interconnected ideas in a 3D space, with AI-powered conversational threads and academic paper visualization.

## Development Commands

### Frontend (Next.js)
```bash
npm run dev        # Start Next.js dev server on http://localhost:3000
npm run build      # Build for production
npm start          # Start production server
npm run lint       # Run ESLint
```

### Backend Server
```bash
cd server
npm run dev        # Start WebSocket/API server on port 3001
npm start          # Same as dev (no separate prod mode)
```

**Important**: Both frontend and backend servers must be running for full functionality. The frontend requires the backend for:
- Real-time collaboration via WebSocket
- AI chat (Codex API integration)
- Conversation persistence

## Environment Variables

### Frontend (.env.local)
```
ANTHROPIC_API_KEY=your_key_here
```

### Backend (server/.env)
```
ANTHROPIC_API_KEY=your_key_here
PORT=3001  # Optional, defaults to 3001
```

## Architecture Overview

### State Management (Zustand)
Central state is managed in `lib/store.ts` using Zustand. The store handles:
- **Nexuses**: Top-level conversation/paper hubs positioned in 3D space
- **Nodes**: Child nodes representing messages, sections, or ideas
- **Connection Nodes**: Special golden rotating nodes that link two inspiration nodes
- **Socratic Mode**: AI-guided questioning flows
- **LocalStorage Persistence**: All data auto-saves to browser localStorage

**Key Store Methods**:
- `createNexus()` - Creates new conversation hub
- `addNode()` - Adds child node (handles positioning logic)
- `createConnection()` - Creates connection node between two nodes
- `saveToLocalStorage()` / `loadFromLocalStorage()` - Persistence layer
- `startSocraticMode()` / `endSocraticMode()` - Socratic dialogue mode

### 3D Visualization (React Three Fiber)
`components/CanvasScene.tsx` renders the 3D scene:
- **Nexuses**: Central spheres for conversations/papers
- **Nodes**: Smaller spheres arranged in golden-angle spirals around parents
- **Connection Lines**: Rainbow-colored pulsing lines connecting nodes to parents
- **Connection Nodes**: Golden rotating dodecahedrons linking two nodes
- **Camera Animation**: Smooth transitions using `lib/useCameraAnimation.ts`

**Node Positioning Algorithm**:
- Regular nodes: Golden angle spiral with radius increments
- Connection nodes: Positioned at midpoint between two nodes + upward offset
- Connection node children: Fibonacci sphere distribution for even spread
- Academic paper sections: Expanding rings with alternating Y-offsets

### Real-Time Collaboration (Socket.IO)
`server/server.js` provides:
- WebSocket events: `create_nexus`, `create_node`, `joinPortal`
- Broadcast to all connected clients in same portal
- In-memory storage (ephemeral, for demonstration)

Frontend WebSocket client: `lib/useWebSocket.ts`

### AI Integration (Anthropic Codex)
Server endpoint: `POST /api/chat`

**Modes**:
- **Default**: General assistant with portal context
- **Socratic** (`mode: 'socratic'`): Asks ONE thought-provoking question at a time
- **Synthesize** (`mode: 'synthesize'`): Analyzes thread and extracts insights
- **Connection** (`mode: 'connection'`): Finds non-obvious connections between two nodes

Request body:
```json
{
  "messages": [...],
  "portalNodes": [...],  // Current nexuses/nodes for context
  "activeMemories": [...], // Previously activated conversations
  "mode": "socratic" | "synthesize" | "connection"
}
```

### Page Structure
- `/` - Landing page with Create/Explore/Chat buttons
- `/create` - Create new conversations with optional video/audio
- `/explore` - Load academic papers from JSON (spatial visualization)
- `/chat` - AI chat with conversation memory system
- `/memories` - View and manage saved conversations

### Data Persistence
**LocalStorage Schema**:
```json
{
  "aurora-portal-data": {
    "nexuses": [...],
    "nodes": {...},
    "activatedConversations": [...]
  }
}
```

Auto-saves after:
- Creating nexus/node
- Updating content
- Creating connections
- Deleting conversations
- Toggling active conversations

### Academic Paper Format
Expected JSON structure for `/explore` page uploads:
```json
{
  "nexus": {
    "id": "paper-nexus",
    "title": "Paper Title",
    "content": "Abstract...",
    "position": [0, 0, 0]
  },
  "sections": [
    {
      "title": "Section Title",
      "content": "Section content..."
    }
  ]
}
```

## Key Type Definitions

From `lib/types.ts` and `lib/store.ts`:

```typescript
interface Node {
  id: string;
  position: [number, number, number];
  title: string;
  content: string;
  parentId: string;
  children: string[];
  quotedText?: string;
  isAI?: boolean;
  isConnectionNode?: boolean;
  connectionNodes?: [string, string]; // IDs of two inspiration nodes
}

interface Nexus {
  id: string;
  position: [number, number, number];
  content: string;
  title: string;
  videoUrl?: string;
  audioUrl?: string;
  type?: 'academic' | 'social';
}
```

## Important Patterns

### Adding New Features to Store
1. Add state and actions to `CanvasStore` interface
2. Implement in `create()` callback
3. Call `get().saveToLocalStorage()` after mutations
4. Broadcast via WebSocket if collaborative: `socket.emit('create_node', {...})`

### Creating New 3D Elements
1. Add to `CanvasScene.tsx` within `<Canvas>`
2. Use `useCanvasStore()` to access state
3. Use `useFrame()` for animations
4. Use `onClick` handlers to trigger store actions

### AI Mode Development
When adding new AI modes:
1. Add mode to `mode` type in server
2. Create system prompt in `server/server.js` `/api/chat` endpoint
3. Pass `mode` parameter from frontend chat components

### Connection Node Behavior
Connection nodes are special:
- Visual: Golden rotating dodecahedrons
- Purpose: Synthesize insights between two nodes
- Children: Distributed in Fibonacci sphere pattern
- Lines: Connect to BOTH parent inspiration nodes

## Troubleshooting

### Changes Not Persisting
- Check browser console for localStorage errors
- Verify `saveToLocalStorage()` is called after mutations
- Clear localStorage: `localStorage.removeItem('aurora-portal-data')`

### 3D Scene Not Rendering
- Verify WebGL support in browser
- Check React Three Fiber console errors
- Ensure `'use client'` directive at top of component files

### WebSocket Not Connecting
- Confirm backend server is running on port 3001
- Check CORS configuration in `server/server.js`
- Verify socket initialization in browser console

### AI Chat Failing
- Verify `ANTHROPIC_API_KEY` in server environment
- Check server logs for API errors
- Ensure server is running and accessible at `http://localhost:3001`

## Code Style Notes

- React components use TypeScript with explicit types
- 3D components use `useRef<THREE.Mesh>(null)` for direct access
- State updates are immutable (spread operators)
- Console logs use emoji prefixes (🚀, 💾, 🔗, etc.) for readability
- React Strict Mode is disabled (`next.config.ts`) for Three.js compatibility
