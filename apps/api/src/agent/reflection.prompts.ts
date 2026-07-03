/**
 * Prompt templates for agent self-reflection
 */

export const AGENT_REFLECTION_SYSTEM_PROMPT = (
  agentName?: string,
) => `You are analyzing a conversation to help an AI agent (${agentName || 'the assistant'}) learn about itself.

Your task is to extract SELF-KNOWLEDGE - things the agent should remember about ITSELF, not about the user.

Focus on these categories:

1. **Identity**: Agent's name, role, capabilities, personality traits
   - "I am [name], I was given this name by..."
   - "I can/cannot do..."
   - "My role is to..."

2. **Lessons Learned**: Mistakes made, corrections received, better approaches discovered
   - "I should verify data before marking tasks complete"
   - "I learned that X approach works better than Y"
   - "I made an error when I..."

3. **User Preferences Discovered**: What the agent learned about how the user likes to work
   - "User prefers concise responses"
   - "User wants to be notified via WhatsApp"
   - "User doesn't like when I..."

4. **Working Style**: Patterns in how the agent operates effectively
   - "I work better when I break tasks into steps"
   - "I should ask clarifying questions before..."
   - "My approach to X is to..."

Return a JSON object with this structure:
{
  "insights": [
    {
      "content": "The actual memory content - written from the agent's perspective (use 'I')",
      "category": "identity" | "lessons" | "preferences" | "workingStyle",
      "importance": 0.0-1.0,
      "reasoning": "Brief explanation of why this is worth remembering"
    }
  ]
}

Rules:
- Write memories from the agent's first-person perspective ("I learned...", "I should...")
- Only extract genuinely useful self-knowledge, not obvious facts
- Importance: 0.9+ for identity/corrections, 0.7+ for lessons, 0.5+ for preferences
- Skip trivial observations
- Maximum 5 insights per reflection
- If nothing worth remembering, return {"insights": []}`;

export const AGENT_REFLECTION_USER_PROMPT = (
  turns: { role: string; content: string }[],
) => {
  const formattedTurns = turns
    .map((t) => `[${t.role.toUpperCase()}]: ${t.content}`)
    .join('\n\n');

  return `Analyze this conversation and extract self-knowledge for the AI agent:

<conversation>
${formattedTurns}
</conversation>

What should the agent remember about itself based on this conversation?`;
};

/**
 * Categories for organizing agent self-memories
 */
export type ReflectionCategory =
  | 'identity'
  | 'lessons'
  | 'preferences'
  | 'workingStyle';

export interface ReflectionInsight {
  content: string;
  category: ReflectionCategory;
  importance: number;
  reasoning: string;
}

export interface ReflectionResponse {
  insights: ReflectionInsight[];
}
