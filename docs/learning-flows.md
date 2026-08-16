# Learning Flows: Universe Runs & Study Guides

This document describes the Universe Run lifecycle, Study Guide generation, and reset functionality for repeat practice.

## Overview

Astryon tracks user progress through learning content using **Universe Runs**. Each run captures all learning artifacts (intuition responses, quiz results, etc.) and can generate a **Study Guide Write-Up** upon completion. Users can reset and practice again while preserving previous runs and their study guides.

## Key Concepts

### UniverseRun

A `UniverseRun` represents a single practice session through a universe's content.

```typescript
interface UniverseRun {
  id: string;                          // Unique run identifier
  universeId: string;                  // Parent universe
  startedAt: number;                   // Timestamp
  completedAt?: number;                // Set when finished
  status: 'in_progress' | 'completed';

  // Learning artifacts captured during the run
  intuitionResponses: IntuitionResponse[];
  imitationAttempts: ImitationAttempt[];
  quizResults: QuizResult[];
  synthesisAnalyses: SynthesisAnalysis[];

  // Calculated on completion
  metrics?: {
    totalQuestions: number;
    correctAnswers: number;
    totalTimeSeconds?: number;
    doctrinesCompleted: number;
    totalDoctrines: number;
  };
}
```

**Location:** `lib/types.ts` (lines 132-153)

### StudyGuideWriteUp

Generated from a completed run, containing 6 sections:

1. **Doctrine Map** - Summary of each doctrine with strengths/weaknesses
2. **Model Patterns** - IRAC and other reasoning frameworks identified
3. **Mistake Profile** - Error patterns with correction suggestions
4. **Practice Scenarios** - User's imitation attempts with feedback
5. **Quiz Snapshot** - Score, accuracy, strong/weak topics
6. **Master Outline** - Exam-ready outline of all content

**Location:** `lib/types.ts` (lines 198-219)

## Lifecycle Flow

### 1. Creating a Run

A run is created when the user starts practicing a universe:

```typescript
// In lib/store.ts
const runId = startUniverseRun(universeId);
```

This:
- Creates a new `UniverseRun` with `status: 'in_progress'`
- Generates a unique ID: `run-{timestamp}-{random}`
- Sets `currentRunId` on the universe

### 2. Tracking Artifacts

As the user progresses through practice steps:

```typescript
// Track intuition response
addIntuitionResponse(runId, {
  nodeId: 'doctrine-1',
  doctrineTitle: 'Standing Doctrine',
  question: 'What is your gut reaction?',
  selectedOption: 'Option A',
  elaboration: 'I think...',
  aiFeedback: 'Good insight!',
  timestamp: Date.now(),
});

// Track quiz result
addQuizResult(runId, {
  nodeId: 'doctrine-1',
  doctrineTitle: 'Standing Doctrine',
  questionType: 'mcq',
  question: 'Which is NOT required for standing?',
  userAnswer: 'C',
  correctAnswer: 'C',
  wasCorrect: true,
  explanation: 'Correct! Mootness is separate.',
  timestamp: Date.now(),
});
```

### 3. Completing a Run

When the user finishes all sections:

```typescript
// In handleEndMcQuiz() when no more siblings
completeUniverseRun(runId);
```

This:
- Sets `status: 'completed'`
- Calculates metrics (total questions, correct answers, time spent, doctrines completed)
- Clears `currentRunId`

### 4. Generating Study Guide

Immediately after completion:

```typescript
import { generateUniverseStudyGuide } from '@/lib/studyGuideGenerator';

const universeDefinition: UniverseDefinition = {
  id: universeId,
  title: universe.nexuses[0]?.title || 'Universe',
  nexuses: universe.nexuses.map(n => ({
    id: n.id,
    title: n.title,
    content: n.content,
  })),
  nodes: universe.nodes,
};

const studyGuide = generateUniverseStudyGuide(completedRun, universeDefinition);
saveStudyGuideWriteUp(studyGuide);
```

**Location:** `components/UnifiedNodeModal.tsx` (lines 1841-1889)

### 5. Resetting for New Practice

User clicks "Start New Practice Run":

```typescript
const newRunId = resetUniverseForPractice(universeId);
```

This:
- Removes practice child nodes (user responses)
- Resets `isCompleted: false` on doctrine nodes
- Clears `quizProgress` on all nodes
- Re-locks L1 nodes (first unlocked, rest locked)
- **Preserves all previous runs and write-ups**
- Creates a new `UniverseRun` with `status: 'in_progress'`

**Location:** `lib/store.ts` (lines 3515-3594)

## Store Functions Reference

| Function | Purpose | Returns |
|----------|---------|---------|
| `startUniverseRun(universeId?)` | Create new run | Run ID |
| `getCurrentRun(universeId?)` | Get active run | UniverseRun or null |
| `addIntuitionResponse(runId, response)` | Track intuition | void |
| `addImitationAttempt(runId, attempt)` | Track imitation | void |
| `addQuizResult(runId, result)` | Track quiz answer | void |
| `addSynthesisAnalysis(runId, analysis)` | Track synthesis | void |
| `completeUniverseRun(runId)` | Finalize with metrics | void |
| `saveStudyGuideWriteUp(writeUp)` | Store guide | void |
| `getUniverseWriteUps(universeId?)` | Get all guides | StudyGuideWriteUp[] |
| `resetUniverseForPractice(universeId?)` | Reset for new run | New run ID |

## Content Generation

### Fresh Content Per Run

Since content is dynamically generated via AI, each run naturally gets fresh material:

- **Intuition Questions**: Generated via `/api/chat` with `mode: 'intuition-question'`
- **Quiz Questions**: Generated via `/api/chat` with `mode: 'quiz-mc'`
- **Imitation Scenarios**: Stored in `node.practiceSteps` (same structure, same prompt)

The reset clears `quizProgress`, so the AI generates new quiz questions when the user practices again.

### API Endpoints

| Mode | Purpose |
|------|---------|
| `intuition-question` | Generate intuition question with 4 options |
| `quiz-mc` | Generate UWorld-style MCQ with progressive difficulty |
| `standard` | Grade imitation/synthesis answers |

## Extending the Write-Up Structure

### Adding a New Section

1. **Add type definition** in `lib/types.ts`:

```typescript
export interface NewSection {
  title: string;
  content: string;
  // ... fields
}

export interface StudyGuideWriteUp {
  // ... existing
  newSection?: NewSection;
}
```

2. **Add generator function** in `lib/studyGuideGenerator.ts`:

```typescript
function generateNewSection(
  run: UniverseRun,
  definition: UniverseDefinition
): NewSection {
  // Extract data from run artifacts
  // Return structured section
}
```

3. **Call in main generator**:

```typescript
export function generateUniverseStudyGuide(...): StudyGuideWriteUp {
  // ... existing sections

  const newSection = generateNewSection(run, definition);

  // Add to markdown content
  content += `\n## 7. New Section\n${newSection.content}\n`;

  return {
    // ... existing
    newSection,
    content,
  };
}
```

4. **Add test** in `lib/__tests__/studyGuideGenerator.test.ts`:

```typescript
function testNewSection(): void {
  // Verify new section is generated correctly
}
```

### Modifying Existing Sections

Each section has its own generator function:
- `generateDoctrineMap()`
- `generateModelPatterns()`
- `generateMistakeProfile()`
- `generatePracticeScenarios()`
- `generateQuizSnapshot()`
- `generateSynthesisSummary()`

Modify these to change section content.

## UI Integration

### Completion Modal

When a run completes, the UI shows:
1. **Completion Modal** with quiz score summary
2. **"View Study Guide" button** to open full content
3. **Study Guide Viewer** with scrollable markdown

**Location:** `components/UnifiedNodeModal.tsx` (lines 3542-3720)

### Practice Run Controls (on Nexus)

Shows on the nexus panel:
- Current run indicator (if in progress)
- Completed runs summary
- "Start New Practice Run" button
- "View Study Guides" button (if any exist)

**Location:** `components/UnifiedNodeModal.tsx` (lines 2787-2867)

## Testing

### Run Tests

```bash
# Run all learning flow tests
npx tsx lib/__tests__/universeRunLifecycle.test.ts
npx tsx lib/__tests__/studyGuideGenerator.test.ts
```

### Test Coverage

- **Run lifecycle**: create → track → complete → metrics
- **Study guide generation**: all 6 sections from realistic run
- **Multiple runs**: independence, preservation
- **Reset**: preserves doctrines, clears progress
- **Edge cases**: empty runs, partial completion

## Data Persistence

All runs and write-ups are persisted to localStorage via:
```typescript
get().saveToLocalStorage();
```

Structure in `aurora-portal-data`:
```json
{
  "universeLibrary": {
    "universe-123": {
      "runs": [...],
      "currentRunId": "run-456",
      "writeUps": [...]
    }
  }
}
```

## Future Enhancements

1. **Variant Storage**: Store multiple imitation scenarios per doctrine, rotate on reset
2. **Spaced Repetition**: Track which doctrines need more practice
3. **Cross-Run Analytics**: Show progress trends across multiple runs
4. **Export Options**: PDF/Word export of study guides
