ASTRYON V2 - COMPREHENSIVE FEATURE AND CAPABILITIES LIST
========================================================

## PAGES & ROUTES

### Frontend Routes
1. **/ (Landing Page)**
   - Hero section with brand title and tagline
   - Two main CTA cards: "Chat" and "Create Course"
   - Feature highlights: 3D Visualization, AI-Powered, Connected Learning
   - Animated background with floating orbs and grid effects
   - Starts with blank canvas (no auto-load)

2. **/chat - Chat Interface**
   - Main conversational interface with 3D canvas
   - Creates and manages conversation universes
   - Supports multiple AI modes
   - Real-time message sending and receiving
   - Blank canvas startup - universes load on demand

3. **/create - Create/Explore Mode**
   - Blank canvas for creating new universes
   - Displays CanvasScene for 3D visualization
   - Can be used for free-form exploration

4. **/explore - Academic Paper Explorer**
   - Upload and visualize academic papers as JSON
   - Paper sections appear as 3D nodes
   - Navigate complex arguments in spatial format
   - JSON file parser for academic paper structure
   - Section navigator for paper browsing

5. **/memories - Universe Library & Memory Management**
   - Browse all saved universes
   - Organize universes into custom folders
   - Search and manage conversations
   - Universe deletion and renaming
   - Backup and recovery functionality
   - Folder creation, renaming, deletion
   - "Atomize" feature to break universes into individual nodes
   - Universe sharing metadata tracking

6. **/course-builder - Course Creation Module**
   - Multi-step course creation workflow
   - Upload course content and video URL
   - Parse video timestamps into sections
   - Auto-generate MCQ and short answer questions
   - Create application essays with rubrics
   - Course preview and testing
   - Progress tracking through steps

### API Routes

1. **POST /api/chat - Main AI Chat Endpoint**
   Supports 20+ modes:
   - **spatial**: Generate universe structures from topics
   - **break-off**: Branch conversations with new perspective
   - **deep-thinking**: Multi-round Socratic questioning
   - **quiz**: Generate quiz questions with branching logic
   - **quiz-mc**: Generate multiple choice questions
   - **quiz-short-answer**: Generate short answer questions
   - **analyze-universe**: Analyze current universe content
   - **application-scenario**: Generate application scenarios
   - **application-essay**: Generate essay prompts
   - **grade-application-essay**: Grade submitted essays
   - **grade-essay-basic**: Simple essay grading
   - **essay-question**: Generate essay questions
   - **doctrine**: Generate legal doctrine analysis
   - Manual spatial mode with ** delimiter syntax

2. **POST /api/generate-title - Semantic Title Generation**
   - Generates 5-10 word AI summaries for node content
   - Uses Claude API for semantic understanding
   - Fallback to truncated content if generation fails

3. **POST /api/export-universe - Universe Export Engine**
   - Exports universe as structured document
   - Two export types: 'full' (complete transcript) or 'analysis' (consulting memo)
   - Returns markdown and structured JSON
   - Generates strategic analysis with McKinsey-style formatting
   - Used by Word and PDF export functions

---

## ZUSTAND STATE MANAGEMENT (lib/store.ts)

### Core Store State

**Nexuses** (top-level conversation hubs):
- Array of conversation/paper root nodes
- Each has: id, title, content, position [x,y,z]
- Optional: videoUrl, audioUrl, type ('academic' | 'social')

**Nodes** (child conversation elements):
- Map of id -> Node objects
- Each node has:
  - id, position, title, content, parentId, children[]
  - quotedText, isAI, isConnectionNode, isSynthesis
  - nodeType: 'user-reply' | 'ai-response' | 'socratic-question' | 'socratic-answer' | 'inspiration' | 'synthesis'
  - semanticTitle (AI-generated 5-10 word summary)
  - isAnchored, anchoredAt, isLocked, isCompleted
  - videoUrl, videoStart, videoEnd (for video nodes)
  - quizProgress tracking
  - mcqQuestions[], shortAnswerQuestions[]

**Universe Library**:
- Map of universeId -> UniverseData
- Each universe has: title, createdAt, nexuses[], nodes{}, cameraPosition

**Application Lab**:
- isApplicationLabMode: boolean
- applicationLabAnalysis: detailed analysis object

**Collaboration**:
- activatedConversations: Nexus[]
- activeUniverseIds: string[]

**UI State**:
- selectedId: currently selected node/nexus
- showContentOverlay: boolean
- isAnimatingCamera: boolean
- showReplyModal: boolean
- quotedText: for quote-reply feature
- hoveredNode: highlight on hover
- connectionMode state tracking

---

## STORE ACTIONS (State Management Functions)

### Universe Management
- **createNexus(title, content, videoUrl?, audioUrl?)**: Create conversation root
- **createChatNexus(title, userMessage, aiResponse)**: Create nexus from first chat exchange
- **saveCurrentUniverse(cameraPosition?)**: Save universe to library with camera position
- **loadUniverse(universeId)**: Load saved universe onto canvas
- **clearCanvas()**: Clear all nodes and nexuses
- **normalizeUniverseCoordinates(universeData)**: Fix coordinate system for loaded universes
- **renameUniverse(universeId, newTitle)**: Rename saved universe
- **deleteUniverseById(universeId)**: Delete entire universe from library

### Node Operations
- **addNode(content, parentId, quotedText?, nodeType?, explicitSiblingIndex?)**: Add child node with positioning
- **addUserMessage(content, parentId)**: Create user-reply type node
- **addAIMessage(content, parentId)**: Create ai-response type node
- **addSynthesisNode(content, parentId)**: Create synthesis/insight node
- **updateNodeContent(nodeId, newContent)**: Edit node text
- **updateNexusContent(nexusId, newContent)**: Edit nexus text
- **updateNodeSemanticTitle(nodeId, semanticTitle)**: Set AI-generated summary
- **updateNode(nodeId, updates)**: Bulk update node properties
- **deleteNode(nodeId)**: Remove node and reorganize children
- **reparentNode(nodeId, newParentId, newPosition)**: Move node to new parent
- **getNodesByParent(parentId)**: Query all children of parent
- **getNodeLevel(nodeId)**: Calculate depth in tree
- **getNodeChildrenCount(nodeId)**: Count direct children

### Connection Nodes
- **startConnectionMode(nodeId)**: Begin selecting nodes to connect
- **clearConnectionMode()**: Cancel connection mode
- **createConnection(nodeAId, nodeBId)**: Create golden connection node between two inspiration nodes
- **addNodeToConnection(nodeId)**: Add node to existing connection
- **createMultiConnection(nodeIds[])**: Create connection linking multiple nodes
- **createMetaInspirationNode(nexusId)**: Create special meta-inspiration node for synthesis

### Node Selection & Interaction
- **selectNode(id, showOverlay?)**: Select node and optionally show content
- **setShowContentOverlay(show)**: Toggle content display modal
- **setIsAnimatingCamera(isAnimating)**: Track camera animation state
- **setShowReplyModal(show)**: Toggle reply input modal
- **setQuotedText(text)**: Set text for quote-reply feature
- **setHoveredNode(id)**: Highlight node on hover

### Chat & Conversation
- **getActivatedConversations()**: Get all active conversation nexuses
- **toggleActivateConversation(nexusId)**: Toggle nexus as active for memory
- **deleteConversation(nexusId)**: Remove nexus and all children

### Anchoring (Quick Navigation)
- **toggleAnchor(nodeId)**: Mark/unmark node as anchored with timestamp
- **getAnchoredNodes()**: Get all anchored nodes for quick access

### Course Mode Features
- **markNodeCompleted(nodeId)**: Mark node as completed, unlock next sibling
- **unlockNextNode(currentNodeId)**: Get and unlock next L1 sibling

### Video & Media
- Node can have videoUrl, videoStart, videoEnd for embedded YouTube/Vimeo
- Timestamps tracked for segmented video playback

### University Multi-Load
- **loadMultipleUniverses(universeIds[])**: Load multiple saved universes simultaneously
- **toggleUniverseActive(universeId)**: Activate/deactivate universe
- **calculateUniversePosition(index, total)**: Auto-position multiple universes in 3D space

### Folder Organization
- **createFolder(name, color)**: Create collection folder
- **renameFolder(folderId, newName)**: Update folder name
- **deleteFolder(folderId)**: Remove folder (move contents to default)
- **moveUniverseToFolder(universeId, folderId)**: Organize universe
- **fixOrphanedUniverses()**: Migrate unorganized universes
- **cleanupOrphanedUniverses()**: Find and report orphaned data

### Persistence (LocalStorage)
- **saveToLocalStorage()**: Persist all state to browser storage
- **loadFromLocalStorage()**: Restore state from browser storage
- **backupLibrary()**: Create timestamped backup
- **recoverFromBackup()**: Restore from previous backup

### Snapshots & Reverting
- **createSnapshot(universeId)**: Save current state as snapshot
- **revertToOriginal(universeId)**: Restore to original creation state

### Application Lab
- **enableApplicationLabMode()**: Enter application scenario testing
- **disableApplicationLabMode()**: Exit application lab
- **toggleApplicationLabMode()**: Toggle mode
- **analyzeUniverseContent()**: Analyze universe for application lab

### Academic Paper Loading
- **loadAcademicPaper()**: Load default academic paper
- **loadAcademicPaperFromData(data)**: Load paper from JSON upload

### Misc Utilities
- **getNexusForNode(nodeId)**: Find root nexus of node
- **getL1Nodes(universeId)**: Get first-level children for specific universe
- **atomizeUniverse(...)**: Break universe into individual node universes
- **addNodeFromWebSocket(data)**: Add node from real-time collaboration
- **addNexusFromWebSocket(data)**: Add nexus from collaboration
- **analyzeUniverseContent()**: AI analysis for application lab

---

## 3D VISUALIZATION FEATURES (CanvasScene.tsx)

### 3D Elements

**Nexus Rendering**:
- Central sphere for each conversation/paper
- Position: [x, y, z] in 3D space
- Color: Varies by type (academic vs social)
- Clickable for selection and interaction

**Node Rendering**:
- Smaller spheres arranged around parent nexus
- Golden angle spiral positioning with radius increments
- Node color by type:
  - Purple (#8B5CF6): user-reply, socratic-answer
  - Burnt Orange (#D2691E): ai-response
  - Gold (#FFD700): socratic-question, inspiration
  - Cyan (#00FFFF): synthesis
- Animated sparkle effects around selected nodes
- Size varies based on position in tree

**Connection Nodes**:
- Golden rotating dodecahedrons
- Positioned at midpoint between connected nodes + upward offset
- Visualize cross-cutting insights
- Children distributed in Fibonacci sphere pattern

**Connection Lines**:
- Rainbow-colored pulsing lines from nodes to parents
- Gradient animation cycling through spectrum
- Thickness varies by node type
- Meta-inspiration nodes have special line styling

**Grid & Axes**:
- Configurable grid floor
- Reference axes for spatial orientation
- Background space visualization

### Camera System

**OrbitControls**:
- User-controlled 3D navigation
- Smooth damping for natural movement
- Camera position auto-saved when movement ends
- Controls tracking for multi-universe alignment

**Camera Position Management**:
- Default view: [10, 8, 15]
- Single universe: standard close view
- Multiple universes: dynamic pullback based on count
- Smooth easing animation (0.8s cubic ease-out)
- Auto-reset when universe selection changes

**Camera Persistence**:
- Saves camera position with universe data
- Restores camera angle when loading universe
- Syncable across sessions

### Animations

**Node Sparkles**:
- 20 particles in ring around node
- Scale pulse animation
- Opacity fade effect
- Per-node animation state tracking

**Pulsing Lines**:
- Rainbow color cycling
- HSL color space for smooth gradients
- Pulse progress tracks along connection lines
- Different speeds for different connection types

**Camera Transitions**:
- Smooth position interpolation
- Target lookAt management
- Non-blocking animation (requestAnimationFrame)

### User Interaction

**Node Selection**:
- Click to select node
- Shows content overlay with node data
- Enables reply/reaction options
- Visual highlight on hover

**Nexus Creation Modal**:
- Popup to create new conversation root
- Title and content input
- Optional video/audio URL
- Form submission creates nexus

**Content Display**:
- Unified modal shows full node content
- Video player for embedded media
- Reply/reaction buttons
- Edit mode toggle

**Spatial Navigation**:
- Click on nodes to navigate
- Semantic titles for quick identification
- Parent-child relationship visual

---

## AI CAPABILITIES & MODES

### Core AI Features

**Chat Modes** (20+ distinct conversation types):

1. **Default Mode**: General assistant with portal context
2. **Spatial/Explore**: Auto-generate universe structures from topics
3. **Break-Off**: Branch conversation with new perspective
4. **Deep-Thinking**: Multi-round Socratic questioning with memory
5. **Quiz**: Question generation with adaptive branching

**Question Generation**:
- MCQ (Multiple Choice Questions): 4 options with correct answer & explanation
- Short Answer: Auto-graded against sample answers
- Essay: Prompt generation with rubric

**Application Lab**:
- Scenario-based learning
- Essay submission and grading
- Rubric-based evaluation

**Specialized Modes**:
- **doctrine**: Legal doctrine generation and case law mapping
- **analyze-universe**: Analyze universe content structure
- **application-scenario**: Generate real-world scenarios
- **application-grade**: Grade scenario responses

### Prompt Engineering

**Spatial Mode**:
- Auto-determines 4-20 nodes based on topic complexity
- Guidelines for simple (4-6), medium (7-12), complex (13-20) topics
- Manual mode with ** delimiter for user control

**Consulting Memo Export**:
- McKinsey/BCG-style analysis formatting
- 5-10 sentence paragraphs (no bullet points)
- Executive summary, key insights, patterns, recommendations
- Implementation considerations and conclusion

**Socratic Method**:
- Single thought-provoking question at a time
- Remembers previous questions to avoid repetition
- Branches based on user answers
- Tracks questioning history

**Quiz Engine**:
- Tracks previously asked questions
- Adaptive difficulty
- Explanation for correct answers
- Progress tracking per node

---

## EXPORT & DOCUMENT GENERATION

### Export Types

**Full Conversation Export**:
- Complete transcript of all exchanges
- Hierarchical structure preserved
- Labels: [USER REPLY], [AI RESPONSE], [SOCRATIC QUESTION], etc.
- Indentation shows conversation depth
- Preserves connection nodes and synthesis nodes

**Analysis-Only Export**:
- Strategic consulting memo format
- Focuses on synthesis and connection nodes
- Top 5 AI insights included
- Professional recommendation format

### Document Formats

**Word Document (.docx)**:
- Full-featured export via docx library
- Colored conversation labels
- Proper paragraph styling and indentation
- Header/footer with page numbers
- Font: Calibri with proper sizing
- Preserved markdown structure conversion

**PDF Export**:
- jsPDF-based generation
- Colored labels matching Word output
- Multi-page support with page numbers
- Proper text wrapping and spacing
- Footer with page numbers
- Title and executive summary sections

### Title Generation

**Semantic Title API**:
- 5-10 word AI-generated summaries
- Captures core idea, not generic
- Used for node navigation
- Batch generation support for explore mode

---

## SPECIAL NODE TYPES & INTERACTIONS

### Node Type Classifications

1. **user-reply**: User message (purple)
2. **ai-response**: AI message (burnt orange)
3. **socratic-question**: AI Socratic question (gold)
4. **socratic-answer**: User answer to Socratic (purple)
5. **inspiration**: Idea/inspiration node (gold)
6. **synthesis**: AI-created insight (cyan)

### Special Nodes

**Connection Nodes**:
- isConnectionNode: true flag
- connectionNodes: [id1, id2, ...] linked inspiration nodes
- Children: Meta-inspiration nodes in Fibonacci sphere distribution
- Visual: Golden rotating dodecahedron
- Line color: Rainbow pulsing

**Meta-Inspiration Nodes**:
- Created by createMetaInspirationNode()
- Special line styling
- Represent synthesized insights from multiple nodes
- Children of connection nodes

**Locked/Unlocked Nodes** (Course Mode):
- isLocked: prevents interaction until completed
- isCompleted: marks node as finished
- Unlocking next sibling sequential progression

**Anchored Nodes**:
- isAnchored: true for bookmarked nodes
- anchoredAt: timestamp of anchoring
- Quick access from memories page
- Used for navigation shortcuts

**Nodes with Video**:
- videoUrl: YouTube/Vimeo embed URL
- videoStart: playback start time in seconds
- videoEnd: playback end time (enforced)
- YouTube API integration for playback control

**Nodes with Quotes**:
- quotedText: Optional quoted source text
- Visual distinction in modal
- Enables debate/discussion mode

### Quiz Progress Tracking

Each node can have quizProgress object:
- questionsAsked: [string] previous question IDs
- answersGiven: [{question, answer, wasCorrect}] history
- lastQuizDate: timestamp
- completedCycles: How many full question sets answered

---

## REAL-TIME COLLABORATION (Socket.IO)

### WebSocket Events

**Connection Management**:
- socket.emit('join_portal', portalId): Join collaboration room
- socket.on('connect'): Establish connection
- socket.on('connect_error'): Handle errors
- socket.on('user_joined', {userId}): User presence

**Data Synchronization**:
- socket.on('node_created', data): Receive nodes from other users
- socket.emit('create_node', nodeData): Broadcast node creation
- Automatic state update via addNodeFromWebSocket()

**Features**:
- Ephemeral in-memory storage (no persistence)
- All connected clients in same portal receive updates
- Broadcast-based (no explicit acks required)

---

## MEMORY & CONVERSATION MANAGEMENT

### Universe Library

**Storage**:
- localStorage key: 'aurora-portal-data'
- UniverseData structure: { title, createdAt, nexuses[], nodes{}, cameraPosition }
- Automatic save after: create, update, delete operations

**Organization**:
- Folder system with custom colors
- Default "Uncategorized" folder
- Universe metadata tracking
- Archive vs active state

### Backup & Recovery

**Backup System**:
- Timestamped snapshots stored separately
- listBackups(): Get available backups
- restoreBackup(id): Restore from backup
- Automatic recovery on universe load failure

**Snapshot System**:
- createSnapshot(universeId): Save point
- revertToOriginal(universeId): Go back to creation state
- Version history for undo/redo

---

## COURSE BUILDER FEATURES

### Multi-Step Workflow

**Step 1**: Course Information
- Title, description, full text content

**Step 2**: Video Setup
- Video URL (YouTube/Vimeo)
- Timestamp parsing (MM:SS or HH:MM:SS format)
- Section breakpoints at timestamps

**Step 3**: Question Configuration
- MCQ count per section (default 5)
- Short answer count per section (default 2)
- Question generation via AI

**Step 4**: Question Review & Editing
- Generated questions preview
- Edit questions before saving
- View all questions across sections

**Step 5**: Application Essay
- Essay prompt generation
- Rubric auto-generation
- Student submission interface

**Step 6**: Course Publishing
- Save course as universe in library
- Memory activation toggle
- Deploy to learning environment

### Question Generation

**MCQ Generation**:
- Mode: 'quiz-mc'
- Generates question, 4 options (A/B/C/D)
- Correct answer label
- Explanation for learning

**Short Answer**:
- Mode: 'quiz-short-answer'
- Question and sample answer
- Auto-graded against sample

**Application Essay**:
- Mode: 'application-essay'
- Question prompt
- Rubric for grading
- Student submission handler

**Progress Tracking**:
- Section-by-section generation progress
- Error handling with continue-on-error
- Real-time progress updates

---

## UTILITY FUNCTIONS

### Video Utilities (lib/videoUtils.ts)
- parseVideoUrl(): Extract video provider and embed URL
- Support for YouTube and Vimeo
- Start/end time enforcement

### Camera Utilities (lib/cameraUtils.ts)
- Camera animation functions
- Smooth position interpolation
- Target calculation for multi-universe views

### Camera Animation Hook (lib/useCameraAnimation.ts)
- Easing functions for natural motion
- Non-blocking animation framework
- Coordinate system helpers

### Title Generation (lib/titleGenerator.ts)
- generateSemanticTitle(content): Single title
- generateSemanticTitles(contents[]): Batch generation
- getDisplayTitle(): Safe title with fallback
- Node type icons and colors

### Database Functions (lib/db.ts)
- listBackups(): Get all backup metadata
- restoreBackup(id): Restore backup data
- Persistent browser storage abstraction

---

## COMPONENTS STRUCTURE

### Core 3D Rendering
- **CanvasScene.tsx** (1765 lines): Main 3D visualization engine
  - Nexus and node rendering
  - Connection lines and sparkles
  - Camera management
  - OrbitControls integration
  - All 3D visual logic

### User Interaction
- **UnifiedNodeModal.tsx** (2377 lines): Content display and editing
  - Node/nexus editing interface
  - Video player with YouTube API
  - Quote functionality
  - Application essay section
  - Multi-action mode (user-reply, ask-ai, explore-together)

- **ReplyModal.tsx** (797 lines): Response composition
  - Text input for new messages
  - Quote-reply feature
  - Sentiment tracking
  - Submission with validation

- **ExportModal.tsx** (692 lines): Document generation
  - Export type selection (full/analysis)
  - Format selection (Word/PDF)
  - Progress tracking
  - Revert to original option

### Special Modes
- **ApplicationLabScene.tsx** (929 lines): Learning scenario mode
  - Scenario analysis
  - Essay generation and grading
  - MCQ and short answer handling
  - Feedback display

- **SectionNavigator.tsx** (664 lines): Paper/course section browsing
  - Academic paper navigation
  - Section list with timestamps
  - Content preview
  - Quick jump to sections

### Input & Configuration
- **CreateNexusModal.tsx** (264 lines): New conversation creation
  - Title and content input
  - Media URL (video/audio)
  - Form validation

- **DoctrinalGenerationModal.tsx** (200 lines): Legal doctrine mode
  - Doctrine analysis UI
  - Case law tracking
  - Generation progress

- **ChatInterface.tsx** (1301 lines): Main chat UI
  - Message input and sending
  - Doctrinal generation
  - Spatial navigation
  - Conversation history

### Navigation & Utils
- **Navigation.tsx** (147 lines): Header navigation
  - Page links and buttons
  - Mode toggles
  - User menu

- **SpatialNavigator.tsx** (151 lines): 3D space navigation
  - Semantic title display
  - Quick node selection
  - Position-based navigation

- **ContentOverlay.tsx** (235 lines): Node content display
  - Full content viewing
  - Quote selection
  - Action buttons

- **PaperUploader.tsx** (68 lines): File upload handler
  - JSON file input
  - Paper loading

---

## SPECIAL FEATURES & ADVANCED MODES

### Doctrinal Generation (Legal Analysis)

**Mode**: 'doctrine'

**Process**:
1. Analyzes universe content for legal concepts
2. Finds relevant cases and doctrine
3. Builds connection map
4. Generates legal analysis document

**Use Cases**:
- Law school course material
- Legal research
- Case law analysis

### Course Builder Workflow

**Complete end-to-end course creation**:
1. Input content, videos, timestamps
2. AI-generates questions per section
3. User reviews and edits
4. Optional essay component
5. Publish as learning universe
6. Students can take course with progress tracking

### Exploration Modes

**Spatial Exploration**:
- "Explore: [topic]" triggers automatic structure generation
- Manual mode with ** delimiters for custom structures
- Adaptive node count based on topic complexity

**Deep Thinking**:
- Multi-round questioning
- Memory of previous questions
- Branching follow-ups based on answers

---

## DATA PERSISTENCE & SYNC

### LocalStorage Schema
```
{
  "aurora-portal-data": {
    "nexuses": [...],
    "nodes": {...},
    "universeLibrary": {...},
    "folders": {...},
    "activatedConversations": [...],
    "activeUniverseId": null,
    "maxActivatedUniverses": 5,
    // ...additional state fields
  }
}
```

### Backup Storage
- Separate backup keys with timestamps
- Available backups tracked with metadata
- Restore function pulls data back into main store

### Camera Position Saving
- Saved with each universe
- Persists viewing angle and zoom
- Restored on universe load

---

## FILE EXPORT CAPABILITIES

**Formats**:
- Word (.docx) - Full featured
- PDF (.pdf) - Print-ready
- Markdown (intermediate format)
- JSON (data structure format)

**Content Types**:
- Full conversation transcript
- Strategic consulting analysis
- Academic paper summaries
- Course materials

---

END OF COMPREHENSIVE FEATURE LIST
