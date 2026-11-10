import fetch from "node-fetch";

/**
 * LLM Service - Supports Hugging Face Inference API and Ollama (local)
 * Used for: decision extraction, contradiction detection, confidence scoring, meeting summarization
 *
 * Env vars:
 *   LLM_PROVIDER=huggingface | ollama
 *   HF_TOKEN=your_huggingface_token
 *   HF_MODEL=meta-llama/Llama-3.1-8B-Instruct
 *   OLLAMA_BASE_URL=http://localhost:11434/v1
 *   OLLAMA_MODEL=llama3.1:8b
 */

const PROVIDER = process.env.LLM_PROVIDER || "ollama";
const HF_TOKEN = process.env.HF_TOKEN;
const HF_MODEL = process.env.HF_MODEL || "meta-llama/Llama-3.1-8B-Instruct";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b";

/**
 * Call Hugging Face Inference API
 */
async function callHuggingFace(prompt, options = {}) {
  if (!HF_TOKEN) {
    throw new Error(
      "HF_TOKEN not set. Get a free token at https://huggingface.co/settings/tokens"
    );
  }

  const maxTokens = options.maxTokens || 500;
  const temperature = options.temperature ?? 0.1;

  const response = await fetch(
    `https://api-inference.huggingface.co/models/${HF_MODEL}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          max_new_tokens: maxTokens,
          temperature: temperature,
          return_full_text: false,
        },
      }),
    }
  );

  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after") || "30";
    throw new Error(
      `Hugging Face rate limit reached. Retry after ${retryAfter} seconds.`
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Hugging Face API error: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  return result[0]?.generated_text || "";
}

/**
 * Call Ollama (local, 100% free, no rate limits)
 */
async function callOllama(prompt, options = {}) {
  const maxTokens = options.maxTokens || 500;
  const temperature = options.temperature ?? 0.1;

  const response = await fetch(`${OLLAMA_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: "system", content: "You are a helpful assistant that extracts structured information from text. Return valid JSON only unless asked otherwise." },
        { role: "user", content: prompt },
      ],
      temperature: temperature,
      max_tokens: maxTokens,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama error: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  return result.choices?.[0]?.message?.content || "";
}

/**
 * Unified LLM call
 */
export async function callLLM(prompt, options = {}) {
  if (PROVIDER === "ollama") {
    return callOllama(prompt, options);
  }
  return callHuggingFace(prompt, options);
}

/**
 * Extract project claims (decisions, tasks, risks, dependencies) from source text.
 * Returns parsed JSON.
 */
export async function extractClaims(sourceText, sourceType = "general") {
  const prompt = `
You are a project knowledge extraction assistant. Analyze the following ${sourceType} content and extract:

1. DECISIONS — decisions that were made (what, when, who, why)
2. OPEN QUESTIONS — unresolved questions or debates
3. TASKS — unfinished work or action items with owners
4. DEPENDENCIES — services, libraries, or teams this work depends on
5. RISKS — potential problems or blockers
6. CONTACTS — important people and their roles

Return valid JSON only. Do not include markdown code blocks.

Source text:
${sourceText}
`;

  const raw = await callLLM(prompt, { maxTokens: 800, temperature: 0.1 });

  try {
    return JSON.parse(raw);
  } catch (e) {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error(`Failed to parse LLM response as JSON: ${raw.substring(0, 200)}`);
  }
}

/**
 * Detect contradictions between two claims about the same fact.
 * Returns { isContradiction: boolean, confidence: number, explanation: string }
 */
export async function detectContradictions(claimA, claimB, context = "") {
  const prompt = `
You are a fact-checking assistant. Compare the following two claims and determine if they contradict each other.

Claim A: ${claimA}
Claim B: ${claimB}
Context: ${context}

Return valid JSON only:
{
  "isContradiction": true/false,
  "confidence": 0.0-1.0,
  "explanation": "brief reason"
}

Do not include markdown code blocks.
`;

  const raw = await callLLM(prompt, { maxTokens: 300, temperature: 0.1 });

  try {
    return JSON.parse(raw);
  } catch (e) {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return {
      isContradiction: false,
      confidence: 0,
      explanation: "Could not determine contradiction (parse error)",
    };
  }
}

/**
 * Calculate confidence score for a claim based on source authority and recency.
 * Returns { score: number, reasoning: string }
 */
export async function scoreConfidence(claimText, sourceType, sourceDate, corroborationCount = 0) {
  const prompt = `
You are a confidence scoring assistant. Score how reliable this claim is based on the source.

Claim: ${claimText}
Source type: ${sourceType} (code > ticket > doc > chat > email > meeting summary)
Source date: ${sourceDate}
Corroboration count: ${corroborationCount} (how many independent sources agree)

Return valid JSON only:
{
  "score": 0.0-1.0,
  "reasoning": "brief explanation"
}

Do not include markdown code blocks.
`;

  const raw = await callLLM(prompt, { maxTokens: 200, temperature: 0.1 });

  try {
    return JSON.parse(raw);
  } catch (e) {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { score: 0.5, reasoning: "Default medium confidence (parse error)" };
  }
}

/**
 * Summarize a meeting transcript or meeting summary into key decisions and action items.
 */
export async function summarizeMeeting(meetingText, meetingMetadata = {}) {
  const prompt = `
You are a meeting summarization assistant. Extract the following from this meeting content:

1. Key decisions made
2. Action items with owners and due dates
3. Open questions
4. Risks or blockers mentioned

Meeting metadata: ${JSON.stringify(meetingMetadata)}

Meeting content:
${meetingText}

Return valid JSON only. Do not include markdown code blocks.
`;

  const raw = await callLLM(prompt, { maxTokens: 600, temperature: 0.1 });

  try {
    return JSON.parse(raw);
  } catch (e) {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error(`Failed to parse meeting summary: ${raw.substring(0, 200)}`);
  }
}