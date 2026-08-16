import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { parseBoundedJson } from '@/lib/requestBound';
import { evalRateLimit } from '@/lib/rateLimit';
import { callGeminiFlash } from '@/lib/gemini';
import { searchWeb } from '@/lib/search';
import { callUserModel, type CallUserModelParams, type UserModelConfig } from '@/lib/callUserModel';
import { decryptApiKey } from '@/lib/modelConfigCrypto';
import prisma from '@/lib/prisma';

export const maxDuration = 300;

/** Wraps callUserModel's streaming path in the same ReadableStream/controller shape every stream call site already expects. */
function streamUserModel(modelConfig: UserModelConfig, params: CallUserModelParams): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        const chunks = await callUserModel(modelConfig, params, { stream: true });
        for await (const text of chunks) {
          controller.enqueue(encoder.encode(text));
        }
        controller.close();
      } catch (error: any) {
        controller.error(error);
      }
    },
  });
}

/**
 * Map a session user id to a DB user id. The session JWT may carry the id
 * directly; fall back to email lookup to stay compatible with BETA-02.
 * (Mirrors app/api/upload/route.ts's userIdForSession.)
 */
async function userIdForSession(
  sessionUserId: string | null | undefined,
  sessionEmail: string | null | undefined
): Promise<string | null> {
  if (sessionUserId) {
    const byId = await prisma.user.findUnique({ where: { id: sessionUserId } });
    if (byId) return byId.id;
  }
  if (sessionEmail) {
    const byEmail = await prisma.user.findUnique({ where: { email: sessionEmail } });
    if (byEmail) return byEmail.id;
  }
  return null;
}

// BETA-09/DEC-03: per-user daily AI budget, enforced BEFORE any provider call
// so a quota-exhausted or limiter-failing path never spends provider tokens.
// Deny-closed: limiter error / missing config denies the request (503).
const AI_DAILY_LIMIT = 100; // AI requests per user per day
const AI_DAILY_WINDOW_SECONDS = 24 * 60 * 60;

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;

  // BYOK mandatory gate (belt-and-suspenders alongside the middleware-level
  // redirect gate): JWT claims can go stale between a save and token
  // refresh, so re-check the DB directly before spending any provider call.
  const dbUserId = await userIdForSession(user.id, user.email);
  const modelConfigRow = dbUserId
    ? await prisma.modelConfig.findUnique({ where: { userId: dbUserId } })
    : null;
  if (!modelConfigRow) {
    return NextResponse.json(
      { error: 'No model configured. Add your API key in Settings.' },
      { status: 400 }
    );
  }
  const userModelConfig: UserModelConfig = {
    baseUrl: modelConfigRow.baseUrl,
    model: modelConfigRow.model,
    apiKey: await decryptApiKey(modelConfigRow.apiKeyCiphertext, modelConfigRow.apiKeyIv),
  };

  const budgetKey = `rl:chat:user:${user.id ?? user.email ?? 'unknown'}`;
  const budget = await evalRateLimit(budgetKey, AI_DAILY_LIMIT, AI_DAILY_WINDOW_SECONDS);
  if (!budget.allowed) {
    const status = budget.denyClosed ? 503 : 429;
    return NextResponse.json(
      {
        error: budget.denyClosed
          ? 'AI service temporarily unavailable'
          : `Daily AI request limit reached (${AI_DAILY_LIMIT} requests/day). Please try again later.`,
      },
      { status }
    );
  }

  try {
    const parsed = await parseBoundedJson(request);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body: any = parsed.body;

    const { messages, conversationContext, mode, explorationMode, previousQuestions, conversationHistory, nodeDepth, searchQuery: clientSearchQuery, atomize, stream } = body;
    console.log('[chat] user=', user.id ?? user.email ?? 'unknown', 'mode=', mode, 'messages=', messages?.length);

    let userMessage: string;

    if (messages && Array.isArray(messages) && messages.length > 0) {
      const last = messages[messages.length - 1];
      userMessage = typeof last?.content === 'string' ? last.content : '';
    } else {
      console.error('[chat] no valid message found in request');
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    if (!userMessage || userMessage.trim() === '') {
      console.error('[chat] message is empty');
      return NextResponse.json(
        { error: 'Message cannot be empty' },
        { status: 400 }
      );
    }

    if (userMessage.length > 100_000) {
      console.error('[chat] message exceeds size bound');
      return NextResponse.json(
        { error: 'Message too large' },
        { status: 400 }
      );
    }

    // 🌌 SPATIAL MODE: Explicitly triggered by mode parameter
    const isSpatialMode = mode === 'spatial';

    if (isSpatialMode) {
      console.log('🌌 SPATIAL MODE ACTIVATED - Generating universe structure');

      // 🧠 SMART PASTE: Preprocess structured text without ** markers into ** format
      async function preprocessStructuredInput(input: string): Promise<string> {
        // If first line starts with * (manual hierarchy mode), skip preprocessing
        const firstLine = input.split('\n').find(l => l.trim() !== '')?.trim() || '';
        if (/^\*+\S/.test(firstLine)) {
          console.log('[Smart Paste] Input has * manual markers, skipping preprocessing');
          return input;
        }

        // Detect structured content: bullets, numbered lists, lettered lists
        const structurePatterns = [
          /^[-•➢▪○]\s/m,           // Bullet at start of line
          /^\d+\.\s/m,              // Numbered list (1., 2., etc.)
          /^[A-Za-z]\.\s/m,         // Lettered list (A., B., etc.)
          /^\s+[-•➢▪○o]\s/m,        // Indented bullets/sub-bullets
        ];

        const hasStructure = structurePatterns.some(pattern => pattern.test(input));

        if (!hasStructure) {
          console.log('[Smart Paste] No structured content detected, skipping preprocessing');
          return input;
        }

        console.log('[Smart Paste] Detected structured input, preprocessing with Gemini Flash...');

        const preprocessPrompt = `You are a document structure extractor. Given the following text, identify the major sections and convert them into * delimited hierarchical format.

RULES:
1. First line must be exactly: **
2. Second line: *Overall Title (the broad topic)
3. Each major section: *Section Name
4. Sub-sections use more stars: **Sub-topic, ***Deep detail
5. Do NOT add any information — only reorganize what's there
6. Preserve all bullet points, sub-points, and explanations within each section
7. Output ONLY the formatted text, nothing else (no explanations, no markdown code blocks)

EXAMPLE INPUT:
Loving v. Virginia (1967)
• Issue: Can Virginia prohibit interracial marriage?
• Holding: No, this violates Equal Protection

Brown v. Board (1954)
• Issue: Is school segregation constitutional?
• Holding: Separate is inherently unequal

EXAMPLE OUTPUT:
**
*Landmark Civil Rights Cases
*Loving v. Virginia (1967)
**Issue: Can Virginia prohibit interracial marriage?
**Holding: No, this violates Equal Protection
*Brown v. Board (1954)
**Issue: Is school segregation constitutional?
**Holding: Separate is inherently unequal

NOW PROCESS THIS TEXT:
${input}`;

        try {
          const formatted = await callGeminiFlash(preprocessPrompt);
          console.log('[Smart Paste] Gemini Flash returned', formatted.length, 'chars');

          // Validate output has * markers (new hierarchical format or legacy **)
          if (formatted.includes('*')) {
            console.log('[Smart Paste] ✅ Preprocessing successful');
            return formatted.trim();
          } else {
            console.log('[Smart Paste] ⚠️ Output missing * markers, using original input');
            return input;
          }
        } catch (error: any) {
          console.error('[Smart Paste] ❌ Gemini Flash failed:', error.message);
          return input; // Fall back to original input
        }
      }

      // Preprocess the input before parsing (skip for atomize — always use AI mode)
      const userTopic = atomize ? userMessage : await preprocessStructuredInput(userMessage);

      console.log('🎯 Topic for universe:', userTopic.length, 'chars');


      // 🔍 CHECK FOR MANUAL MODE: First non-empty line starts with *Title
      // First * line = nexus title, subsequent * = L1, ** = L2, *** = L3
      // Non-* lines between markers = content for the preceding node
      const lines = userTopic.split('\n');
      const firstNonEmptyLine = lines.find(l => l.trim() !== '')?.trim() || '';
      const isManualMode = !atomize && /^\*+\S/.test(firstNonEmptyLine);

      if (isManualMode) {
        console.log('✋ MANUAL MODE: Parsing * hierarchy');

        // Parse lines: *-prefixed lines start new nodes, other lines append as content
        const parsedLines: { title: string; content: string; starCount: number }[] = [];
        for (const line of lines) {
          const trimmed = line.trim();
          const starMatch = trimmed.match(/^(\*+)(\S.*)/);
          if (starMatch) {
            // New node boundary
            const starCount = starMatch[1].length;
            const title = starMatch[2].trim();
            parsedLines.push({ title, content: title, starCount });
          } else if (parsedLines.length > 0 && trimmed !== '') {
            // Append to current node's content
            parsedLines[parsedLines.length - 1].content += '\n' + trimmed;
          }
        }

        if (parsedLines.length < 2) {
          console.error('❌ Invalid hierarchy: need at least a title (*) and one node');
          return NextResponse.json(
            { error: 'Hierarchical mode requires at least: ** (trigger), *Title, *Node1' },
            { status: 400 }
          );
        }

        // First * line = nexus title
        const nexusTitle = parsedLines[0].title;
        const nexusContent = parsedLines[0].content;
        const nodeLines = parsedLines.slice(1);

        // Build nodes with parentIndex using depthStack
        // depthStack[starCount] = index into parsedNodes of the most recent node at that star depth
        const depthStack: Record<number, number> = {};
        const parsedNodes: { content: string; depth: number; parentIndex: number }[] = [];

        for (const { content, starCount } of nodeLines) {
          const depth = starCount; // * = 1, ** = 2, *** = 3, etc.
          let parentIndex = -1; // default: child of nexus

          if (depth >= 2) {
            // Find closest available parent at depth - 1 (or shallower for graceful degradation)
            for (let d = depth - 1; d >= 1; d--) {
              if (depthStack[d] !== undefined) {
                parentIndex = depthStack[d];
                break;
              }
            }
            // If no parent found at all, attach to nexus
          }

          const nodeIndex = parsedNodes.length;
          parsedNodes.push({ content, depth, parentIndex });

          // Update depthStack: set this depth, clear all deeper levels
          depthStack[depth] = nodeIndex;
          for (const key of Object.keys(depthStack)) {
            if (Number(key) > depth) {
              delete depthStack[Number(key)];
            }
          }
        }

        console.log('🏛️ Nexus title:', nexusTitle.length, 'chars');
        parsedNodes.forEach((n, i) => console.log(`📦 Node ${i}: depth=${n.depth}, parentIndex=${n.parentIndex}`));

        console.log('📦 Manual hierarchy mode — using raw content for all nodes (no enrichment)');

        const enrichedNodes = parsedNodes.map(({ content, depth: perNodeDepth, parentIndex }, idx) => {
          console.log(`   ✅ Node ${idx}: depth=${perNodeDepth}, parentIndex=${parentIndex}, raw content`);
          return { content, depth: perNodeDepth, parentIndex };
        });

        // No enrichment for manual mode — user provided the content directly

        const spatialData = {
          nexusTitle: nexusTitle.substring(0, 50),
          nexusContent: nexusContent,
          nodes: enrichedNodes
        };

        console.log('✅ Parsed and enriched hierarchical structure:');
        console.log(`   - Nodes: ${spatialData.nodes.length} (hierarchical, enriched L2+)`);

        return NextResponse.json({
          response: `Created hierarchical universe with ${spatialData.nodes.length} enriched nodes`,
          spatialData,
          parseMode: 'manual-hierarchy'
        });
      }

      // 🤖 AI MODE: Generate structure automatically (Smart Paste handles bullets → **)
      console.log('🤖 AI MODE: Generating universe structure - no ** patterns detected');

      const spatialPrompt = `User wants to explore: "${userTopic}"

CRITICAL: Ignore any formatting (numbers, bullet points, dashes) in the user's input. Treat the ENTIRE text as ONE TOPIC to explore and break down into your own logical subtopics.

Assess the topic and decide 2-8 core concepts based on:
- How many fundamental principles or concepts does this topic contain?
- Simple topics (e.g., "primary colors"): 2-3 concepts
- Medium complexity (e.g., "photosynthesis"): 3-5 concepts
- Complex topics (e.g., "quantum mechanics"): 6-8 concepts

Format your response as VALID JSON (and ONLY JSON, no other text):
{
  "nexusTitle": "brief title (3-7 words)",
  "nexusContent": "overview paragraph explaining the topic",
  "nodes": [
    {
      "content": "Doctrine 1 Title\\n\\nCore concept explanation (2-3 sentences)",
      "nodeType": "doctrine",
      "children": [
        {"content": "Concrete example to build intuition...", "nodeType": "intuition-example"},
        {"content": "Here's the correct reasoning pattern...", "nodeType": "model-answer"},
        {"content": "Now you try: Apply this pattern to...", "nodeType": "imitate"},
        {"content": "Question: ...", "nodeType": "quiz-mc", "options": ["A", "B", "C", "D"], "correctOption": "B", "explanation": "Why this is correct."},
        {"content": "Real-world application scenario combining all concepts: ...", "nodeType": "synthesis"}
      ]
    }
  ]
}

IMPORTANT:
- Return ONLY valid JSON, no markdown code blocks
- Use \\n for line breaks within strings (NOT literal newlines)
- Create 2-8 doctrine nodes, each with exactly 5 atomized children
- Each child must have explicit "nodeType" field
- DO NOT create one node per line from user input - create your own logical doctrines
- The "synthesis" step is now the final application scenario that synthesizes all learning
- Each quiz-mc MUST use a different question type from the QUIZ DIVERSITY list above`;

      console.log('📤 Sending spatial universe generation prompt...');

      const response = await callUserModel(userModelConfig, {

        max_tokens: 16384, // Large enough for atomized children with quiz diversity
        system: 'You are Astryon AI, a structured learning architect. Generate learning universes organized into core concepts. Always return ONLY valid JSON with properly escaped newlines (\\n).',
        messages: [{ role: 'user', content: spatialPrompt }],
      });

      console.log('✅ Got response from Claude');

      const textContent = response.content.find((block) => block.type === 'text');
      const rawResponse = textContent && 'text' in textContent ? textContent.text : '';

      console.log('📝 Raw AI response:', rawResponse.length, 'chars');

      try {
        // Sanitize JSON: Try parsing as-is first, then with cleanup if needed
        // Updated: Fixed regex pattern for newline handling
        let spatialData;
        try {
          spatialData = JSON.parse(rawResponse);
        } catch (firstError) {
          console.log('🧹 Cleaning response JSON');

          // Extract JSON from markdown code blocks if present
          let cleanedResponse = rawResponse.trim();
          if (cleanedResponse.startsWith('```json')) {
            cleanedResponse = cleanedResponse.replace(/^```json\s*\n/, '').replace(/\n```$/, '');
          } else if (cleanedResponse.startsWith('```')) {
            cleanedResponse = cleanedResponse.replace(/^```\s*\n/, '').replace(/\n```$/, '');
          }

          // 🔥 FIX: Sanitize literal newlines in JSON strings
          // Replace literal newlines inside JSON string values with escaped \n
          console.log('🧹 Sanitizing literal newlines in JSON...');

          // Strategy: Replace newlines inside quoted strings only
          // Use a more robust regex that handles newlines within strings
          cleanedResponse = cleanedResponse.replace(
            /"((?:[^"\\]|\\.)*)"/g,  // Match string values with proper escaping
            (match) => {
              return match
                .replace(/\r\n/g, '\\n')  // Windows line endings
                .replace(/\n/g, '\\n')    // Unix line endings
                .replace(/\r/g, '\\n')    // Old Mac line endings
                .replace(/\t/g, '\\t');   // Tabs
            }
          );

          console.log('🧹 Cleaned response:', cleanedResponse.length, 'chars');

          // Parse the cleaned response
          spatialData = JSON.parse(cleanedResponse);
        }

        console.log('✅ Successfully parsed spatial JSON:', spatialData.nodes.length, 'nodes');

        return NextResponse.json({
          response: `Generated universe for: ${userTopic}`,
          spatialData
        });
      } catch (parseError) {
        console.error('❌ Failed to parse spatial JSON:', parseError);

        // Attempt to salvage truncated JSON by extracting complete nodes
        try {
          console.log('🔧 Attempting to salvage truncated JSON...');
          let salvaged = rawResponse.trim();
          if (salvaged.startsWith('```json')) {
            salvaged = salvaged.replace(/^```json\s*\n/, '').replace(/\n```$/, '');
          } else if (salvaged.startsWith('```')) {
            salvaged = salvaged.replace(/^```\s*\n/, '').replace(/\n```$/, '');
          }

          // Extract nexusTitle and nexusContent
          const titleMatch = salvaged.match(/"nexusTitle"\s*:\s*"([^"]+)"/);
          const contentMatch = salvaged.match(/"nexusContent"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          const nexusTitle = titleMatch ? titleMatch[1] : 'Generated Universe';
          const nexusContent = contentMatch ? contentMatch[1] : nexusTitle;

          // Extract all complete top-level node objects from the "nodes" array
          const nodesStart = salvaged.indexOf('"nodes"');
          if (nodesStart === -1) throw new Error('No nodes array found');

          // Find complete doctrine-level objects: {"content": ..., "nodeType": "doctrine", "children": [...]}
          const completeNodes: any[] = [];
          const nodeRegex = /\{"content"\s*:\s*"(?:[^"\\]|\\.)*"\s*,\s*"nodeType"\s*:\s*"doctrine"\s*,\s*"children"\s*:\s*\[(?:[^\[\]]*|\[(?:[^\[\]]*|\[[^\[\]]*\])*\])*\]\s*\}/g;
          let match;
          while ((match = nodeRegex.exec(salvaged)) !== null) {
            try {
              const parsed = JSON.parse(match[0]);
              completeNodes.push(parsed);
            } catch { /* skip incomplete */ }
          }

          if (completeNodes.length > 0) {
            console.log(`🔧 Salvaged ${completeNodes.length} complete doctrine nodes from truncated response`);
            return NextResponse.json({
              response: `Generated universe for: ${userTopic} (${completeNodes.length} doctrines recovered from truncated response)`,
              spatialData: { nexusTitle, nexusContent, nodes: completeNodes }
            });
          }
        } catch (salvageError) {
          console.error('🔧 Salvage also failed:', salvageError);
        }

        return NextResponse.json(
          { error: 'Failed to parse universe structure from AI' },
          { status: 500 }
        );
      }
    }

    // 🚀 BREAK-OFF MODE: Transform node into new universe
    if (mode === 'break-off') {
      console.log('🚀 BREAK-OFF MODE ACTIVATED - Generating new universe from node');

      const nodeContent = userMessage;

      const breakOffPrompt = `A user is breaking off this node into its own universe. The node contains:
"${nodeContent}"

Create a NEW universe that explores this content in depth. Generate a nexus and 5-12 child nodes that comprehensively explore different aspects, subtopics, or implications of this content.

Format your response as VALID JSON (and ONLY JSON, no other text):
{
  "nexusTitle": "brief title (3-7 words) summarizing the new universe",
  "nexusContent": "overview paragraph that expands on the original node content",
  "nodes": [
    {"content": "Subtopic 1: Title\\n\\nDetailed explanation (2-3 sentences minimum)"},
    {"content": "Subtopic 2: Title\\n\\nDetailed explanation (2-3 sentences minimum)"},
    ...
  ]
}

IMPORTANT:
- Return ONLY valid JSON, no markdown code blocks
- Use \\n for line breaks within strings (NOT literal newlines)
- Each node should be substantive (2-3 sentences minimum)
- Create 5-12 nodes that deeply explore the content`;

      console.log('📤 Sending break-off universe generation prompt...');

      const response = await callUserModel(userModelConfig, {

        max_tokens: 4096,
        system: 'You are Astryon AI, a universe architect. Generate structured spatial knowledge graphs that explore content deeply. Always return ONLY valid JSON with properly escaped newlines (\\n).',
        messages: [{ role: 'user', content: breakOffPrompt }],
      });

      console.log('✅ Got response from Claude for break-off');

      const textContent = response.content.find((block) => block.type === 'text');
      const rawResponse = textContent && 'text' in textContent ? textContent.text : '';

      console.log('[break-off] raw AI response', rawResponse.length, 'chars');

      try {
        let newUniverse;
        try {
          newUniverse = JSON.parse(rawResponse);
        } catch (firstError) {
          console.log('⚠️ Initial parse failed, attempting cleanup...');

          let cleanedResponse = rawResponse.trim();
          if (cleanedResponse.startsWith('```json')) {
            cleanedResponse = cleanedResponse.replace(/^```json\s*\n/, '').replace(/\n```$/, '');
          } else if (cleanedResponse.startsWith('```')) {
            cleanedResponse = cleanedResponse.replace(/^```\s*\n/, '').replace(/\n```$/, '');
          }

          cleanedResponse = cleanedResponse.replace(
            /"((?:[^"\\]|\\.)*)"/g,
            (match) => {
              return match
                .replace(/\r\n/g, '\\n')
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '\\n')
                .replace(/\t/g, '\\t');
            }
          );

          newUniverse = JSON.parse(cleanedResponse);
        }

        console.log('✅ Successfully parsed break-off universe:', newUniverse.nodes?.length, 'nodes');

        return NextResponse.json({
          response: `Generated new universe from node`,
          newUniverse
        });
      } catch (parseError) {
        console.error('❌ Failed to parse break-off JSON:', parseError);
        return NextResponse.json(
          { error: 'Failed to parse break-off universe structure from AI' },
          { status: 500 }
        );
      }
    }

    // 🧠 DEEP THINKING MODE: Generate exploratory question with progressive depth
    if (mode === 'deep-thinking' && !userMessage.includes('Previous question:')) {
      console.log('🧠 DEEP THINKING: Generating exploratory question with history');
      console.log('📚 Previous rounds:', conversationHistory?.length || 0);

      const deepThinkingQuestionPrompt = `You are a Socratic teacher helping explore ideas deeply.

Content to explore:
"${userMessage}"

${conversationHistory && conversationHistory.length > 0 ? `
Previous exploration:
${conversationHistory.map((exchange: any, i: number) =>
        `Round ${i + 1}:\nQ: ${exchange.question}\nA: ${exchange.userAnswer}\nInsight: ${exchange.aiEngagement}`
      ).join('\n\n')}

Based on where we've been, go DEEPER on the most interesting thread.
` : 'This is the first question - start with what seems most thought-provoking.'}

Your task: Ask ONE exploratory question that:
- Builds on previous insights (if any)
- Challenges assumptions
- Makes unexpected connections
- Reveals deeper patterns
- Encourages novel thinking

${conversationHistory && conversationHistory.length > 0 ? 'Avoid repeating questions or going in circles. Each question should advance the exploration to new territory.' : ''}

Question types to use:
- "What assumptions underlie [X]?"
- "How might [concept from discussion] apply to [new context]?"
- "What patterns emerge when we consider [A] and [B] together?"
- "What happens if we reverse [logic they mentioned]?"
- "What does [their insight] reveal about [bigger principle]?"
- "If we push this further, what questions arise?"

CRITICAL: Output ONLY the question, nothing else. No preamble, no explanation.`;

      const response = await callUserModel(userModelConfig, {

        max_tokens: 400,
        system: 'You are a Socratic teacher who guides deep exploration through progressively deeper questions. Each question should build on what came before.',
        messages: [{ role: 'user', content: deepThinkingQuestionPrompt }],
      });

      const textContent = response.content.find((block) => block.type === 'text');
      const question = textContent && 'text' in textContent ? textContent.text.trim() : 'Unable to generate question.';

      console.log('[deep-thinking] generated question', question.length, 'chars');

      return NextResponse.json({
        response: question,
        isDeepThinkingQuestion: true
      });
    }

    // 🧠 DEEP THINKING MODE: Handle conversational Socratic dialogue
    if (mode === 'deep-thinking' && userMessage.includes('Previous question:')) {
      console.log('🧠 DEEP THINKING MODE - Engaging with user\'s thinking');

      const questionMatch = userMessage.match(/Previous question: "(.+?)"/);
      const answerMatch = userMessage.match(/User's answer: "(.+?)"/);

      if (!questionMatch || !answerMatch) {
        console.error('❌ Could not parse deep thinking question/answer');
        return NextResponse.json(
          { error: 'Invalid deep thinking answer format' },
          { status: 400 }
        );
      }

      const question = questionMatch[1];
      const userAnswer = answerMatch[1];

      console.log('[deep-thinking] dialogue', question.length, 'question chars', userAnswer.length, 'answer chars');

      const deepThinkingPrompt = `You are a Socratic teacher guiding a student through deep exploration and discovery.

${conversationHistory && conversationHistory.length > 0 ? `
Previous exploration rounds:
${conversationHistory.map((exchange: any, i: number) =>
        `Round ${i + 1}:\nQ: ${exchange.question}\nA: ${exchange.userAnswer}\nInsight: ${exchange.aiEngagement}`
      ).join('\n\n')}

` : ''}Your most recent question:
"${question}"

Their latest response:
"${userAnswer}"

Your role:
1. ENGAGE with their thinking (2-4 sentences):
   - Acknowledge interesting insights they've shared
   - Build on their ideas and previous rounds
   - Highlight connections they're making across the conversation
   - Challenge assumptions if needed
   - Show how their thinking is progressing

2. ASK the next exploratory question:
   - Build naturally from what they just said
   - Go deeper on the most interesting thread
   - Help them discover something new
   - Advance to new territory (avoid repeating previous ground)
   - Make it feel like a flowing conversation

Format your response exactly like this:

[Your engagement with their answer - validate, build on, or challenge their thinking. 2-4 sentences.]

[Your next exploratory question that naturally follows from their response and builds on the full conversation.]

Keep it conversational and Socratic - you're exploring ideas together, not testing them.`;

      const response = await callUserModel(userModelConfig, {

        max_tokens: 800,
        system: 'You are a Socratic teacher who engages deeply with student thinking. Build on their insights and guide discovery through thoughtful questions.',
        messages: [{ role: 'user', content: deepThinkingPrompt }],
      });

      const textContent = response.content.find((block) => block.type === 'text');
      const fullResponse = textContent && 'text' in textContent ? textContent.text : 'Unable to continue exploration.';

      console.log('[deep-thinking] response', fullResponse.length, 'chars');

      return NextResponse.json({
        response: fullResponse,
        isDeepThinking: true
      });
    }

    // 🎓 QUIZ MODE: Generate diverse question (QUESTION ONLY, NO ANSWER)
    if (mode === 'quiz' && !userMessage.includes('Previous question:')) {
      console.log('📝 QUIZ MODE: Generating diverse question (NO ANSWER)');
      console.log('📋 Questions asked so far:', previousQuestions?.length || 0);

      // Check if we've reached completion threshold (7 questions)
      const maxQuestions = 7;
      const questionCount = previousQuestions?.length || 0;
      const hasCompletedCycle = questionCount >= maxQuestions;

      const quizQuestionPrompt = hasCompletedCycle ? `You are a teacher who has just guided a student through comprehensive quiz on content.

The student has answered ${questionCount} questions covering all major aspects!

Your task: Acknowledge their completion warmly and offer to start fresh.

Output exactly this message (customize based on what they covered):

"🎉 Excellent work! You've completed a comprehensive quiz covering all major aspects of this content through ${questionCount} questions.

You've demonstrated understanding of:
• Core facts and details
• Key concepts and definitions
• Reasoning and analysis
• Applications and implications
• Significance and impact

Ready to test your retention? I can start over with fresh questions on the same topics to reinforce your learning.

Would you like to continue with a new quiz cycle?"

Just output this completion message.` : `You are a teacher creating quiz questions to thoroughly test student knowledge.

Content to quiz on:
"${userMessage}"

${previousQuestions && previousQuestions.length > 0 ? `
Previously asked questions (${questionCount}/${maxQuestions} - ask about a DIFFERENT aspect):
${previousQuestions.map((q: string, i: number) => `${i + 1}. ${q}`).join('\n')}
` : 'This is the first question about this content.'}

Your task: Ask ONE clear question that tests a DIFFERENT aspect than previous questions.

First, infer the subject domain from the content (e.g., law, biology, history, engineering, music, business, etc.), then systematically cover aspects appropriate to that domain:
- Core concepts, definitions, and terminology
- Key components, elements, or actors involved
- How it works (mechanisms, processes, causal chains)
- Why it matters (significance, impact, implications)
- Underlying principles, rules, theories, or frameworks
- Real-world applications or examples
- Historical context or development
- Distinctions from related concepts
- How this would apply to a new scenario

Choose the next uncovered aspect and ask a specific, testable question.

CRITICAL RULES:
- Ask ONLY the question - do NOT provide the answer
- Do NOT explain anything - just ask the question
- Do NOT say "Here's a question:" or any preamble
- Make it testable - the student should be able to give a specific answer
- Focus on an aspect different from what's already been asked
- Tailor your vocabulary and framing to the subject domain

Output format: Just the question, nothing else.

Example BAD output:
"What was the holding? The holding was that judicial review exists because..." ← NO! Don't give the answer!

Now ask your question (QUESTION ONLY, NO ANSWER):`;

      const response = await callUserModel(userModelConfig, {

        max_tokens: hasCompletedCycle ? 500 : 300,  // More tokens for completion message
        system: hasCompletedCycle
          ? 'You are a supportive teacher acknowledging quiz completion. Be warm and encouraging.'
          : 'You are a teacher creating diverse quiz questions. Ask ONLY the question, never provide the answer. Each question should test a different aspect of the content.',
        messages: [{ role: 'user', content: quizQuestionPrompt }],
      });

      const textContent = response.content.find((block) => block.type === 'text');
      const question = textContent && 'text' in textContent ? textContent.text.trim() : 'Unable to generate question.';

      console.log(hasCompletedCycle
        ? '🎉 Generated completion message'
        : `✅ Generated diverse question (${questionCount + 1}/${maxQuestions})`);

      return NextResponse.json({
        response: question,
        isQuizQuestion: true,
        isCompletion: hasCompletedCycle,
        questionCount: questionCount
      });
    }

    // 📝 MULTIPLE CHOICE QUIZ MODE: Generate MC questions with JSON
    if (mode === 'quiz-mc') {
      console.log('📝 QUIZ-MC MODE: Generating multiple choice questions');

      const { numberOfQuestions = 5, questionNumber = 1 } = body;
      const userTopic = userMessage;

      // 🎯 RANDOMIZE DIFFICULTY based on question number (UWorld style)
      // Questions 1-2: Easy
      // Questions 3-4: Medium
      // Questions 5+: Hard
      let difficultyLevel: 'easy' | 'medium' | 'hard';
      if (questionNumber <= 2) {
        difficultyLevel = 'easy';
      } else if (questionNumber <= 4) {
        difficultyLevel = 'medium';
      } else {
        difficultyLevel = 'hard';
      }

      console.log(`📊 Question ${questionNumber}: Difficulty = ${difficultyLevel.toUpperCase()}`);

      // Difficulty-specific instructions following UWorld patterns
      const difficultyInstructions = {
        easy: `**EASY DIFFICULTY** (Question ${questionNumber}/5):
- **STRAIGHTFORWARD FACT PATTERN** (1-2 paragraphs, 100-200 words):
  - Simple, clear scenario with essential facts only
  - Limited number of parties or elements
  - Direct application of core principles

- **DIRECT RECALL & BASIC APPLICATION**:
  - Test fundamental understanding of key concepts
  - "What is the rule?" or "What is the basic outcome?"
  - Should be answerable with solid understanding of core material
  - One clearly correct answer based on fundamental principles

- **ANSWER CHOICES**:
  - One obviously correct answer
  - Three plausible but clearly wrong distractors
  - Distractors should test common misconceptions
  - Clear distinctions between options`,

        medium: `**MEDIUM DIFFICULTY** (Question ${questionNumber}/5):
- **MODERATE FACT PATTERN** (2-3 paragraphs, 200-350 words):
  - Realistic scenario with relevant details
  - Multiple parties or elements to consider
  - Some extraneous information mixed with key facts

- **APPLICATION & ANALYSIS**:
  - Require applying principles to moderately complex facts
  - "What is the most likely outcome?" or "Which argument is strongest?"
  - May involve balancing competing considerations
  - Requires distinguishing between closely related concepts

- **ANSWER CHOICES**:
  - Include some partially correct answers as strong distractors
  - Test ability to distinguish between similar principles
  - Options should require careful analysis
  - Two options may seem plausible at first glance`,

        hard: `**HARD DIFFICULTY** (Question ${questionNumber}/5):
- **COMPLEX FACT PATTERN** (3-4 paragraphs, 350-500 words):
  - Multi-layered scenario with intricate details
  - Multiple parties, transactions, or time periods
  - Significant extraneous information to filter through
  - May involve procedural complexities or exceptions

- **MULTI-STEP REASONING & SYNTHESIS**:
  - Require synthesizing multiple concepts or doctrines
  - "Given these facts, what is the best argument?" or "What is the correct legal analysis?"
  - May involve exceptions to general rules
  - Requires nuanced understanding of how principles interact
  - May test edge cases or less obvious applications

- **ANSWER CHOICES**:
  - Multiple answers may appear correct on initial reading
  - Test subtle distinctions between closely related doctrines
  - Include answers that are correct but for wrong reasons
  - Require careful elimination and deep understanding
  - May involve two-step reasoning to identify correct answer`
      };

      const mcQuizPrompt = `Generate exactly ONE UWorld-style multiple choice question about this content:

"${userTopic}"

${difficultyInstructions[difficultyLevel]}

Create an exam-level question that follows these general principles:

1. **GOOD ANSWER CHOICES** (all difficulties):
   - All 4 options should be grammatically parallel and clear
   - Options should be similar in length
   - Test understanding of key distinctions
   - Avoid "all of the above" or "none of the above"

2. **CLEAR EXPLANATIONS**:
   - Explain why the correct answer is right (1-2 sentences)
   - Briefly explain why each other answer is incorrect
   - Reference key facts from the hypothetical
   - Cite relevant legal principles or rules

CRITICAL: You MUST respond in this EXACT format with NO additional text, NO introductions, NO thank you messages:

**Question:**
[The full question text including fact pattern]

**Options:**
A) [Option A text]
B) [Option B text]
C) [Option C text]
D) [Option D text]

**Correct Answer:** [A, B, C, or D - just the letter]

**Explanation:**
[2-4 sentences explaining why the correct answer is right and why the others are wrong]

IMPORTANT:
- Return ONLY the question in the format shown above
- NO markdown code blocks, NO JSON, NO extra text
- Follow the ${difficultyLevel.toUpperCase()} difficulty requirements
- Make the question appropriately challenging for ${difficultyLevel} level`;

      console.log('📤 Sending MC quiz generation prompt...');

      const response = await callUserModel(userModelConfig, {

        max_tokens: 6144,
        system: `You are an expert exam question writer creating multiple choice questions with varied difficulty levels (easy, medium, hard). Infer the subject domain from the content provided and tailor questions appropriately. Your questions test understanding through application, with appropriately complex scenarios and clear explanations. Always return questions in the EXACT markdown format requested with NO additional text, introductions, or conversational responses.`,
        messages: [{ role: 'user', content: mcQuizPrompt }],
      });

      const textContent = response.content.find((block) => block.type === 'text');
      const rawResponse = textContent && 'text' in textContent ? textContent.text : '';

      console.log('[quiz-mc] generated response', rawResponse.length, 'chars');

      return NextResponse.json({ content: rawResponse });
    }

    // 📝 SHORT ANSWER QUIZ MODE: Generate short answer questions
    if (mode === 'quiz-short-answer') {
      console.log('📝 QUIZ-SHORT-ANSWER MODE: Generating short answer questions');

      const { numberOfQuestions = 2, questionNumber = 1 } = body;
      const userTopic = userMessage;

      console.log(`📊 Generating Short Answer ${questionNumber}/${numberOfQuestions}`);

      const shortAnswerPrompt = `Generate exactly ONE short answer question about this content:

"${userTopic}"

Create a thoughtful short answer question that:
- Tests deep understanding and ability to explain concepts
- Requires a paragraph-length response (3-5 sentences)
- Cannot be answered with simple yes/no or one-word answers
- Focuses on application, analysis, or synthesis of ideas

CRITICAL: You MUST respond in this EXACT format with NO additional text, NO introductions, NO thank you messages:

**Question:**
[The question text - should be clear and specific about what is being asked]

**Sample Answer:**
[A comprehensive sample answer showing the key points that should be covered, written in 3-5 sentences. This serves as a rubric for grading.]

IMPORTANT:
- Return ONLY the question in the format shown above
- NO markdown code blocks, NO JSON, NO extra text
- The sample answer should demonstrate the level of depth expected
- Focus on conceptual understanding, not just facts`;

      console.log('📤 Sending short answer generation prompt...');

      const response = await callUserModel(userModelConfig, {

        max_tokens: 4096,
        system: `You are an expert exam question writer creating thoughtful short answer questions for students. You excel at creating questions that test deep understanding and require explanation rather than simple recall. Always return questions in the EXACT markdown format requested with NO additional text, introductions, or conversational responses.`,
        messages: [{ role: 'user', content: shortAnswerPrompt }],
      });

      const textContent = response.content.find((block) => block.type === 'text');
      const rawResponse = textContent && 'text' in textContent ? textContent.text : '';

      console.log('[quiz-short-answer] generated response', rawResponse.length, 'chars');

      return NextResponse.json({ content: rawResponse });
    }

    // 🔬 ANALYZE UNIVERSE MODE: Extract topics, examples, and principles
    if (mode === 'analyze-universe') {
      console.log('🔬 ANALYZE-UNIVERSE MODE: Analyzing universe content');

      const userContent = userMessage;

      const analyzePrompt = `You are analyzing a student's knowledge universe. First, identify the subject domain from the content (e.g., law, philosophy, history, science, business, etc.). Then extract and categorize the following:

1. **Topics**: Broad subject areas or themes (e.g., "Constitutional Law", "Epistemology", "Industrial Revolution", "Thermodynamics")
2. **Examples**: Specific instances, cases, events, experiments, works, or illustrations that demonstrate concepts (e.g., court cases in law, historical events in history, thought experiments in philosophy, landmark studies in science)
3. **Principles**: Core rules, theories, frameworks, doctrines, or laws that govern the subject (e.g., legal doctrines, philosophical theories, scientific laws, historical theses)

For each item found, provide:
- A unique ID (lowercase-kebab-case)
- The name
- A brief description/summary/explanation
- Empty nodeIds array (we'll fill this later)

Return ONLY valid JSON in this exact format:
{
  "topics": [
    {"id": "topic-id", "name": "Topic Name", "description": "Brief description", "nodeIds": []}
  ],
  "examples": [
    {"id": "example-id", "name": "Example Name", "summary": "Brief summary", "nodeIds": []}
  ],
  "principles": [
    {"id": "principle-id", "name": "Principle Name", "explanation": "Brief explanation", "nodeIds": []}
  ]
}

Content to analyze:
${userContent}`;

      const response = await callUserModel(userModelConfig, {

        max_tokens: 8096,
        system: 'You are an expert educator who analyzes and categorizes academic content across any subject domain. Always return ONLY valid JSON with no additional text.',
        messages: [{ role: 'user', content: analyzePrompt }],
      });

      const rawResponse = response.content[0].type === 'text' ? response.content[0].text : '';
      console.log('🔬 Analysis complete');

      return NextResponse.json({ response: rawResponse });
    }

    // 🎯 APPLICATION LAB: Generate practice scenario
    if (mode === 'application-scenario') {
      console.log('🎯 APPLICATION-SCENARIO MODE: Generating practice scenario');

      const userContent = userMessage;

      const scenarioPrompt = `You are an expert educator creating a practice scenario for a student. Based on the topics, examples, and principles provided, create a NEW hypothetical scenario that requires applying these concepts.

${userContent}

Create a realistic scenario that:
1. Is different from any examples mentioned above
2. Requires applying 2-3 of the principles listed
3. Has enough complexity for meaningful analysis
4. Is 3-5 paragraphs long

Return ONLY valid JSON in this exact format:
{
  "focus": "Brief description of what principle/concept to apply",
  "question": "The full scenario text (3-5 paragraphs)"
}`;

      const response = await callUserModel(userModelConfig, {

        max_tokens: 4096,
        system: 'You are an expert educator creating practice scenarios appropriate to the subject domain. Always return ONLY valid JSON with no additional text.',
        messages: [{ role: 'user', content: scenarioPrompt }],
      });

      const rawResponse = response.content[0].type === 'text' ? response.content[0].text : '';
      console.log('🎯 Scenario generated');

      return NextResponse.json({ response: rawResponse });
    }

    // 🎯 APPLICATION LAB: Grade student answer
    if (mode === 'application-grade') {
      console.log('🎯 APPLICATION-GRADE MODE: Grading student answer');

      const userContent = userMessage;

      const gradingPrompt = `You are an expert educator grading a student's application of concepts and principles to a scenario.

${userContent}

Provide constructive feedback that:
1. Identifies which principles/concepts the student correctly identified
2. Evaluates how well they applied those principles to the scenario
3. Points out what they missed or got wrong
4. Explains the correct analysis
5. Is encouraging but honest

Format your feedback in a clear, structured way (but NOT as JSON - just formatted text with paragraphs and bullet points if needed).`;

      const response = await callUserModel(userModelConfig, {

        max_tokens: 4096,
        system: 'You are a supportive educator providing detailed, constructive feedback on student analysis. Adapt your tone and terminology to the subject domain.',
        messages: [{ role: 'user', content: gradingPrompt }],
      });

      const rawResponse = response.content[0].type === 'text' ? response.content[0].text : '';
      console.log('🎯 Grading complete');

      return NextResponse.json({ response: rawResponse });
    }

    // 📝 COURSE BUILDER: Generate application essay question and rubric
    if (mode === 'application-essay') {
      console.log('📝 APPLICATION-ESSAY MODE: Generating essay question and grading rubric');

      const userContent = userMessage;

      const essayPrompt = `You are an expert educator creating an application essay question for a course. Based on the course content provided, create a comprehensive essay question that requires students to apply the principles and concepts they learned to a new scenario.

${userContent}

Create:
1. A challenging essay question that:
   - Presents a realistic scenario appropriate to the subject domain
   - Requires applying multiple principles/concepts from the course
   - Has sufficient complexity for in-depth analysis
   - Is appropriate for a final assessment

2. A detailed grading rubric that:
   - Lists the key issues students should identify
   - Specifies which principles/concepts should be applied
   - Outlines the expected analysis steps
   - Provides clear criteria for what constitutes a strong answer

CRITICAL: Return ONLY raw JSON with NO markdown formatting, NO code blocks, NO explanation text.
Do NOT wrap the JSON in \`\`\`json or \`\`\` markers.
Return ONLY this exact JSON structure:
{
  "question": "The full essay question including the scenario (4-6 paragraphs)",
  "rubric": "Detailed grading rubric with key issues, relevant principles, and evaluation criteria (structured with clear sections)"
}

Your entire response must be valid, parseable JSON starting with { and ending with }. Nothing else.`;

      const response = await callUserModel(userModelConfig, {

        max_tokens: 6000,
        system: 'You are an experienced educator creating comprehensive assessments appropriate to the subject domain. CRITICAL: Your response must be ONLY valid, parseable JSON with no markdown code blocks, no explanation text, and no additional formatting. Start with { and end with }. Nothing else.',
        messages: [{ role: 'user', content: essayPrompt }],
      });

      const rawResponse = response.content[0].type === 'text' ? response.content[0].text : '';
      console.log('📝 Application essay generated');

      return NextResponse.json({ content: rawResponse });
    }

    // 📊 GRADE APPLICATION ESSAY: Grade student essay using rubric
    if (mode === 'grade-application-essay') {
      console.log('📊 GRADE-APPLICATION-ESSAY MODE: Grading student essay with rubric');

      const userContent = userMessage;

      const gradingPrompt = `You are an expert educator grading a student's application essay. You have the essay question, the grading rubric, and the student's answer.

${userContent}

Provide comprehensive feedback that:
1. Evaluates the student's answer against each criterion in the rubric
2. Identifies which key issues and principles they correctly addressed
3. Points out what they missed or misunderstood
4. Explains the correct analysis for any gaps
5. Provides specific suggestions for improvement
6. Assigns an overall assessment (e.g., Excellent, Good, Needs Improvement)

Format your feedback in clear, structured paragraphs with headers. Be constructive, specific, and encouraging while maintaining academic rigor.`;

      const response = await callUserModel(userModelConfig, {

        max_tokens: 6000,
        system: 'You are an experienced educator providing detailed, constructive feedback on application essays. Adapt your tone and terminology to the subject domain. Your feedback should be thorough, specific, and help students understand both their strengths and areas for improvement.',
        messages: [{ role: 'user', content: gradingPrompt }],
      });

      const rawResponse = response.content[0].type === 'text' ? response.content[0].text : '';
      console.log('📊 Essay graded successfully');

      return NextResponse.json({ response: rawResponse });
    }

    // 📊 GRADE ESSAY (BASIC): Grade student essay without rubric (Application Lab)
    if (mode === 'grade-essay-basic') {
      console.log('📊 GRADE-ESSAY-BASIC MODE: Grading student essay without rubric');

      const userContent = userMessage;

      const gradingPrompt = `You are an expert educator grading a student's application essay. You have the essay question and the student's answer, but no explicit rubric.

${userContent}

Provide comprehensive feedback that:
1. Evaluates whether the student addressed the question thoroughly
2. Identifies key issues, principles, or concepts they correctly applied
3. Points out what they missed or misunderstood
4. Explains what a strong answer should include
5. Provides specific suggestions for improvement
6. Assigns an overall assessment (e.g., Excellent, Good, Needs Improvement)

Format your feedback in clear, structured paragraphs with headers. Be constructive, specific, and encouraging while maintaining academic rigor.`;

      const response = await callUserModel(userModelConfig, {

        max_tokens: 6000,
        system: 'You are an experienced educator providing detailed, constructive feedback on application essays. Adapt your tone and terminology to the subject domain. Your feedback should be thorough, specific, and help students understand both their strengths and areas for improvement.',
        messages: [{ role: 'user', content: gradingPrompt }],
      });

      const rawResponse = response.content[0].type === 'text' ? response.content[0].text : '';
      console.log('📊 Essay graded successfully (basic mode)');

      return NextResponse.json({ response: rawResponse });
    }

    // 📝 APPLICATION LAB: Generate essay question
    if (mode === 'essay-question') {
      console.log('📝 ESSAY-QUESTION MODE: Generating essay question based on analysis');

      const userContent = userMessage;

      const essayPrompt = `Based on this analyzed material, create ONE realistic exam-style essay question:

${userContent}

First, identify the subject domain from the material above, then create a question appropriate to that domain.

CRITICAL: This MUST be a scenario-based question with a detailed fact pattern or situation, NOT an abstract essay asking students to simply explain concepts.

Requirements:
1. **Realistic Scenario**: Create a 2-3 paragraph hypothetical situation with specific details that raise issues related to the analyzed material
2. **Multiple Interrelated Issues**: The scenario should implicate 2-4 different concepts/principles from the material
3. **Analysis Required**: Don't explicitly state what issues are present - the student must identify them
4. **Ambiguity**: Include details that could support different conclusions or require weighing competing considerations
5. **Application Focus**: Students must: (a) identify relevant issues, (b) state applicable principles/rules/frameworks, (c) apply them to the facts, (d) reach conclusions

Format:
- Present the scenario (2-3 paragraphs describing a realistic situation)
- End with a clear call question asking for analysis

EXAMPLES OF WHAT NOT TO DO:
✗ "Discuss the concept of [X] and how it applies to situations involving [Y]."
✗ "Explain the framework for [Z] and provide examples."
✗ "Compare and contrast [A] and [B]."

DO NOT include answer guidance, rubrics, or discussion of issues - ONLY the scenario and question.`;

      const response = await callUserModel(userModelConfig, {

        max_tokens: 2048,
        system: 'You are an experienced educator who writes realistic exam questions. Infer the subject domain from the content and tailor your question style accordingly. Your questions always include detailed scenarios that require students to identify issues, apply relevant principles to facts, and analyze outcomes - NOT abstract essays asking students to explain concepts.',
        messages: [{ role: 'user', content: essayPrompt }],
      });

      const rawResponse = response.content[0].type === 'text' ? response.content[0].text : '';
      console.log('📝 Essay question generated');

      return NextResponse.json({ response: rawResponse });
    }

    // 💡 INTUITION-QUESTION MODE: Generate engaging intuition question for guided practice
    if (mode === 'intuition-question') {
      console.log('💡 INTUITION-QUESTION MODE: Generating engaging intuition question');

      const doctrineContent = userMessage;

      const intuitionPrompt = `Based on this concept/material, create an engaging intuition-building question that helps students connect emotionally and personally with the material:

${doctrineContent}

Create a question that:
1. **Engages feelings** - Taps into moral compass, sense of justice/injustice, fairness, power dynamics
2. **Varies tone** - Mix of provocative, exploratory, and personal approaches
3. **Goes beyond binary** - More interesting than just "right/wrong" or "fair/unfair"
4. **Connects to lived experience** - Helps students find personal relevance

Format your response as JSON:
{
  "question": "The main provocative/thoughtful question (1-2 sentences)",
  "options": [
    "Option 1 - a specific perspective or reaction (10-20 words)",
    "Option 2 - a different angle or viewpoint (10-20 words)",
    "Option 3 - another distinct perspective (10-20 words)",
    "Option 4 - a contrarian or nuanced view (10-20 words)"
  ]
}

Examples of good question styles:
- "Who benefits most when this doctrine is applied strictly? Who loses?"
- "If you were the losing party, what would feel most unjust about this outcome?"
- "What tension is this rule trying to balance, and which side do you instinctively favor?"
- "When might following this rule lead to an outcome that feels deeply wrong?"
- "What kind of person would have written this rule, and what were they afraid of?"

Make the options represent genuinely different perspectives, not just variations of the same idea. Include one option that challenges conventional thinking.

Return ONLY valid JSON, no other text.`;

      const response = await callUserModel(userModelConfig, {

        max_tokens: 1024,
        system: 'You are a thoughtful educator who creates engaging questions that help students connect emotionally and personally with the material they are studying. Infer the subject domain from the content and tailor your questions accordingly. Your questions should provoke genuine reflection. Return only valid JSON.',
        messages: [{ role: 'user', content: intuitionPrompt }],
      });

      const rawResponse = response.content[0].type === 'text' ? response.content[0].text : '';
      console.log('💡 Intuition question generated');

      // Parse JSON from response
      try {
        const parsed = JSON.parse(rawResponse);
        return NextResponse.json({ response: parsed });
      } catch {
        console.error('[intuition-question] failed to parse intuition question JSON');
        return NextResponse.json({
          response: {
            question: "What's your gut reaction to this doctrine? Does it feel fair or problematic?",
            options: [
              "This seems like a reasonable balance of interests",
              "This feels like it protects the powerful at the expense of the vulnerable",
              "This creates necessary but uncomfortable tradeoffs",
              "The real-world effects probably differ from the stated purpose"
            ]
          }
        });
      }
    }

    // 🌱 NEXUS-SUMMARIZE MODE: Generate mastery summary for completed nexus
    if (mode === 'nexus-summarize') {
      console.log('🌱 NEXUS-SUMMARIZE MODE: Generating mastery summary');

      const summaryPrompt = `${userMessage}`;

      const response = await callUserModel(userModelConfig, {

        max_tokens: 4096,
        system: `You are an expert learning scientist creating personalized "What You've Learned" summaries.

Your task is to synthesize a learning conversation into a comprehensive mastery summary that:
- Uses second person ("You now understand...", "You can now...")
- Focuses on LEARNING OUTCOMES and CAPABILITIES gained, not just topics discussed
- Explains the core concepts, frameworks, and mental models the student has developed
- Shows how different pieces connect and build on each other
- Describes what kinds of problems/scenarios the student can now handle
- Highlights 1-2 key pitfalls or common mistakes to watch out for
- Is 3-5 well-structured paragraphs

Write in a warm, encouraging tone that celebrates the student's progress while being substantive and specific.`,
        messages: [{ role: 'user', content: summaryPrompt }],
      });

      const masterySummary = response.content[0].type === 'text' ? response.content[0].text : '';
      console.log('✨ Mastery summary generated:', masterySummary.length, 'chars');

      return NextResponse.json({ message: masterySummary, response: masterySummary });
    }

    // 🎓 NEXUS-APPLICATION-LAB MODE: Generate Application Lab for completed nexus
    if (mode === 'nexus-application-lab') {
      console.log('🎓 NEXUS-APPLICATION-LAB MODE: Generating Application Lab');

      const labPrompt = `${userMessage}`;

      const response = await callUserModel(userModelConfig, {

        max_tokens: 8192,
        system: `You are an expert learning scientist creating personalized Application Labs that help students apply what they've learned.

Your task is to synthesize a learning conversation into a comprehensive Application Lab that:
1. Summarizes the core concepts and capabilities the student has developed
2. Provides 2-5 progressively challenging scenario-based questions
3. Includes a final capstone essay prompt that requires synthesis
4. Optionally includes a grading rubric

You must return ONLY valid JSON with NO additional text before or after. The JSON must match this exact structure:

{
  "doctrineSummary": "A 2-4 paragraph summary using second person ('You now understand...') that explains the core concepts, frameworks, and mental models the student has developed. Focus on learning outcomes and capabilities gained, not just topics discussed.",
  "scenarios": [
    {
      "id": "scenario-1",
      "prompt": "A concrete scenario that tests application of the concepts in a realistic situation. Should be specific and require thoughtful analysis.",
      "guidance": "Optional hints or framework for thinking through this scenario. Help the student know where to start."
    }
  ],
  "finalEssayPrompt": "A capstone application essay prompt that requires synthesizing multiple concepts and applying them to a complex, realistic challenge. Should be open-ended and require deep engagement with the material. Make it intellectually stimulating.",
  "rubric": "Optional grading rubric that explains what excellent, good, and weak responses would demonstrate. Focus on quality of reasoning and application, not just coverage."
}

Guidelines:
- Generate 2-5 scenarios that progressively increase in complexity
- Each scenario should test different aspects or combinations of what was learned
- Make scenarios concrete and realistic, not generic or theoretical
- The final essay prompt should be the most challenging and comprehensive
- Write in a warm, encouraging tone that celebrates the student's progress
- Be specific about what the student now understands and can do

Remember: Return ONLY the JSON object, nothing else.`,
        messages: [{ role: 'user', content: labPrompt }],
      });

      const applicationLab = response.content[0].type === 'text' ? response.content[0].text : '';
      console.log('✨ Application Lab generated:', applicationLab.length, 'chars');

      return NextResponse.json({ message: applicationLab, response: applicationLab });
    }

    // 🎓 QUIZ MODE: Handle quiz grading (PROVIDE ANSWER HERE)
    if (mode === 'quiz' && userMessage.includes('Previous question:')) {
      console.log('📝 QUIZ GRADING MODE - Evaluating student answer');

      // Extract question and answer from the message
      const questionMatch = userMessage.match(/Previous question: "(.+?)"/);
      const answerMatch = userMessage.match(/User's answer: "(.+?)"/);

      if (!questionMatch || !answerMatch) {
        console.error('❌ Could not parse quiz question/answer');
        return NextResponse.json(
          { error: 'Invalid quiz answer format' },
          { status: 400 }
        );
      }

      const question = questionMatch[1];
      const userAnswer = answerMatch[1];

      console.log('[quiz-grading] dialogue', question.length, 'question chars', userAnswer.length, 'answer chars');

      const gradingPrompt = `You are a knowledgeable educator grading a student's answer.

Question: "${question}"
Student's Answer: "${userAnswer}"

Grade their answer and provide the correct answer:

1. FEEDBACK (2-3 sentences):
   - If CORRECT: Start with "✓ Correct!" and affirm what they got right
   - If PARTIALLY CORRECT: Start with "Partially correct." Explain what they got right and what they missed
   - If INCORRECT: Start with "Not quite." Explain what was wrong

2. CORRECT ANSWER (3-5 sentences):
   After your feedback, provide a clear, complete correct answer under a "The Complete Answer:" heading.

3. End by asking: "Would you like another question?"

Format your response exactly like this:
[Grade and Feedback - 2-3 sentences]

The Complete Answer:
[Full correct answer - 3-5 sentences providing the complete explanation the student should learn]

Would you like another question?`;

      const response = await callUserModel(userModelConfig, {

        max_tokens: 1000,
        system: 'You are a supportive educator providing quiz feedback. Be encouraging but honest. Always teach what the correct answer is so students learn from their mistakes.',
        messages: [{ role: 'user', content: gradingPrompt }],
      });

      const textContent = response.content.find((block) => block.type === 'text');
      const feedback = textContent && 'text' in textContent ? textContent.text : 'Unable to grade answer.';

      console.log('✅ Quiz feedback:', feedback.length, 'chars');

      return NextResponse.json({
        response: feedback,
        isQuizFeedback: true
      });
    }

    // ⚖️ DOCTRINE MODE: Generate doctrinal map with JSON structure
    if (mode === 'doctrine') {
      console.log('⚖️ DOCTRINE MODE ACTIVATED - Generating doctrinal map');

      const response = await callUserModel(userModelConfig, {

        max_tokens: 4096,
        system: 'You are a legal research assistant. Generate comprehensive doctrinal analysis in valid JSON format with properly escaped newlines (\\n).',
        messages: [{ role: 'user', content: userMessage }],
      });

      const textContent = response.content.find((block) => block.type === 'text');
      const aiResponse = textContent && 'text' in textContent ? textContent.text : 'No response';

      console.log('[doctrine] response', aiResponse.length, 'chars');

      return NextResponse.json({ response: aiResponse });
    }

    // 🌐 ASK-WITH-SEARCH MODE: In-node AI query with Tavily web search for L2+ nodes
    if (mode === 'ask-with-search') {
      console.log('🌐 ASK-WITH-SEARCH MODE: Running Tavily search before Claude');

      const searchQuery = clientSearchQuery || userMessage.substring(0, 300);
      console.log('🔎 Tavily search query:', searchQuery.length, 'chars');

      let webContext = '';
      try {
        webContext = await searchWeb(searchQuery);
        console.log(`📄 Tavily returned ${webContext.length} chars`);
      } catch (error: any) {
        console.error('❌ Tavily search failed:', error.message);
      }

      const systemPrompt = webContext
        ? `You are Astryon AI, helping users explore ideas in 3D space. You have access to their full conversation universe AND web search results.

When answering, prioritize the universe context first, then supplement with web research for facts, citations, or current information not found in the universe.

WEB RESEARCH RESULTS:
${webContext}`
        : 'You are Astryon AI, helping users explore ideas in 3D space. You have access to the full conversation universe context.';

      if (stream) {
        return new Response(streamUserModel(userModelConfig, {
          max_tokens: 2048,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        }), {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
          },
        });
      }

      const response = await callUserModel(userModelConfig, {
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const textContent = response.content.find((block: any) => block.type === 'text');
      const aiResponse = textContent && 'text' in textContent ? textContent.text : 'No response';

      console.log('[ask-with-search] response', aiResponse.length, 'chars');

      return NextResponse.json({ response: aiResponse });
    }

    // Standard chat mode
    console.log('📤 Sending to Claude API...');

    // 🧠 NEW: Build system message with full context
    const systemMessage = conversationContext
      ? `You are Astryon AI, helping users explore ideas in 3D space. You have access to the full conversation context below:\n\n${conversationContext}\n\nRespond naturally based on this full context.`
      : 'You are Astryon AI, helping users explore ideas in 3D space.';

    if (stream) {
      return new Response(streamUserModel(userModelConfig, {
        max_tokens: 2048,
        system: systemMessage,
        messages: [{ role: 'user', content: userMessage }],
      }), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
        },
      });
    }

    const response = await callUserModel(userModelConfig, {
      max_tokens: 2048,
      system: systemMessage,
      messages: [{ role: 'user', content: userMessage }],
    });

    console.log('✅ Got response from Claude');

    const textContent = response.content.find((block) => block.type === 'text');
    const aiResponse = textContent && 'text' in textContent ? textContent.text : 'No response';

    return NextResponse.json({ response: aiResponse });
  } catch (error: any) {
    console.error('[chat] error:', error?.constructor?.name, error?.message);

    return NextResponse.json(
      { error: error?.message || 'Failed to get response from Claude' },
      { status: 500 }
    );
  }
}
