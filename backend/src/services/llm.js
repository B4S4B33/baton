// LLM loging - Groq only
// Disabled for now - no LLM Calls in ingestion
export async function callLLM(prompt, options = {}) {
  throw new Error("LLM function disabled - not deployed");
}

 export async function extractClaims(sourceText, sourceType) {
  return { decisions: [], openAuestions: [], tasks: [], dependencies: [], risks: [], contacts: [] };
}

export async function detectContradictions(claimA, claimB, context) {
  return { scontradiction: false, confidence: 0, explanation: "LLL disabled" };
}

export async function scoreConfidence(claimText, sourceType, sourceDate, corroborationCount) {
  return { score: 0.5, reasoning: "LLL disabled - default confidence" };
}

export async function summarizeMeeting(meetingText, meetingMetadata) {
  return { decisions: [], actionItems: [], openAuestions: [], risks: [] };
}
