require('dotenv').config({ override: true });

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
// --- BEGIN DEAD CODE: superseded AI/chat integration (commented out, not deleted) ---
// Superseded by app/api/chat/route.ts's mandatory per-user bring-your-own-model
// support (see docs/superpowers/specs/2026-08-13-byok-model-connect-design.md).
// Kept commented rather than deleted in case Mike wants it reinstated.
// Verified: every chat fetch() call in the Next.js app targets same-origin
// /api/chat (app/api/chat/route.ts) — the frontend has never called this
// Express server's /api/chat endpoint. Only Socket.IO traffic (joinPortal,
// createNexus, createNode, etc.) still hits this server, on port 3001.
// const Anthropic = require('@anthropic-ai/sdk');
// const OpenAI = require('openai');

const app = express();
const server = http.createServer(app);
// Support multiple origins for development and production
const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',')
  : ['http://localhost:3000'];

const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// const anthropic = new Anthropic({
//   apiKey: process.env.ANTHROPIC_API_KEY || 'missing',
// });

// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY || '',
// });
// --- END DEAD CODE (imports/clients) ---

// In-memory storage
const portals = {};
const conversations = {}; // Store conversations by ID

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('joinPortal', (portalId) => {
    socket.join(portalId);
    console.log(`Client ${socket.id} joined portal ${portalId}`);
  });

  socket.on('createNexus', (data) => {
    io.to(data.portalId).emit('nexusCreated', data);
  });

  socket.on('createNode', (data) => {
    io.to(data.portalId).emit('nodeCreated', data);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// API Routes
app.post('/api/portals', (req, res) => {
  const { name, participants } = req.body;
  const portalId = Date.now().toString();

  portals[portalId] = {
    id: portalId,
    name,
    participants,
    nexuses: [],
    nodes: []
  };

  res.json({ portalId, portal: portals[portalId] });
});

app.get('/api/portals/:id', (req, res) => {
  const portal = portals[req.params.id];
  if (portal) {
    res.json(portal);
  } else {
    res.status(404).json({ error: 'Portal not found' });
  }
});

// Save conversation
app.post('/api/conversations', (req, res) => {
  const { messages, portalNodes } = req.body;
  const conversationId = Date.now().toString();

  conversations[conversationId] = {
    id: conversationId,
    messages,
    portalNodes,
    timestamp: new Date().toISOString()
  };

  res.json({
    conversationId,
    conversation: conversations[conversationId]
  });
});

// Get all conversations
app.get('/api/conversations', (req, res) => {
  const conversationList = Object.values(conversations).map(conv => ({
    id: conv.id,
    timestamp: conv.timestamp,
    preview: conv.messages[0]?.content.substring(0, 100) + '...' || 'Empty conversation'
  }));

  res.json(conversationList);
});

// Get specific conversation
app.get('/api/conversations/:id', (req, res) => {
  const conversation = conversations[req.params.id];
  if (conversation) {
    res.json(conversation);
  } else {
    res.status(404).json({ error: 'Conversation not found' });
  }
});

// DELETE conversation - NEW ENDPOINT
app.delete('/api/conversations/:id', (req, res) => {
  const conversationId = req.params.id;

  if (conversations[conversationId]) {
    delete conversations[conversationId];
    console.log(`Deleted conversation ${conversationId}`);
    res.json({ success: true, message: 'Conversation deleted' });
  } else {
    res.status(404).json({ error: 'Conversation not found' });
  }
});

// --- BEGIN DEAD CODE: superseded AI/chat integration (commented out, not deleted) ---
// Superseded by app/api/chat/route.ts's mandatory per-user bring-your-own-model
// support (see docs/superpowers/specs/2026-08-13-byok-model-connect-design.md).
// Kept commented rather than deleted in case Mike wants it reinstated.
// Verified: every chat fetch() call in the Next.js app targets same-origin
// /api/chat (app/api/chat/route.ts) — the frontend has never called this
// Express server's /api/chat endpoint. Only Socket.IO traffic (joinPortal,
// createNexus, createNode, etc.) still hits this server, on port 3001.
//
// AI Chat endpoint
// app.post('/api/chat', async (req, res) => {
//   try {
//     const { messages, portalNodes, activeMemories } = req.body;
//
//     let systemPrompt = "You are a helpful assistant in Astryon Portal, a 3D collaborative decision-making space. ";
//
//     if (portalNodes && portalNodes.length > 0) {
//       systemPrompt += "\n\nCurrent nodes and nexuses in the portal:\n";
//       portalNodes.forEach(node => {
//         systemPrompt += `- ${node.label} (${node.type})\n`;
//       });
//     }
//
//     if (activeMemories && activeMemories.length > 0) {
//       systemPrompt += "\n\nActive memories from previous conversations:\n";
//       activeMemories.forEach(memory => {
//         systemPrompt += `\nMemory from ${memory.timestamp}:\n`;
//         memory.messages.forEach(msg => {
//           systemPrompt += `${msg.role}: ${msg.content}\n`;
//         });
//         if (memory.portalNodes && memory.portalNodes.length > 0) {
//           systemPrompt += "Nodes from that conversation:\n";
//           memory.portalNodes.forEach(node => {
//             systemPrompt += `- ${node.label}\n`;
//           });
//         }
//       });
//     }
//
//     let response;
//     try {
//       if (process.env.OPENAI_API_KEY) {
//         console.log('🤖 Attempting OpenAI call (gpt-4o)...');
//         try {
//           const completion = await openai.chat.completions.create({
//             model: "gpt-4o",
//             messages: [
//               { role: "system", content: systemPrompt },
//               ...messages
//             ],
//             max_tokens: 1024,
//           });
//
//           res.json({
//             response: completion.choices[0].message.content
//           });
//           return;
//         } catch (openaiError) {
//           console.error('❌ OpenAI failed:', openaiError.message);
//           // Fall through to Anthropic
//         }
//       }
//
//       console.log('🔄 Trying Anthropic (claude-opus-4-7)...');
//       try {
//         response = await anthropic.messages.create({
//           model: 'claude-opus-4-7',
//           max_tokens: 1024,
//           system: systemPrompt,
//           messages: messages
//         });
//
//         res.json({
//           response: response.content[0].text
//         });
//       } catch (anthropicError) {
//         console.error('❌ Anthropic also failed:', anthropicError.message);
//         res.status(500).json({
//           error: 'All AI providers failed',
//           details: anthropicError.message
//         });
//       }
//     } catch (globalError) {
//       console.error('❌ Global chat error:', globalError.message);
//       res.status(500).json({ error: 'Internal server error', details: globalError.message });
//     }
//   } catch (globalError) {
//     console.error('❌ Global chat error:', globalError.message);
//     res.status(500).json({ error: 'Internal server error', details: globalError.message });
//   }
// });
// --- END DEAD CODE: superseded AI/chat integration ---

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API Key present: ${!!process.env.ANTHROPIC_API_KEY}`);
});