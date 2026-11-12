import express from "express";
import { runValidationGate, VALIDATION_RULES } from "../services/validationGate.js";
import { detectContradictions } from "../services/llm.js";
import { getAllClaims } from "../services/neo4jService.js";

const router = express.Router();

// POST /api/validate - Run validation gate on a handover version
// Body: { handoverVersionId: "string", roleId: "string" }
router.post("/validate", async (req, res) => {
  const { handoverVersionId, roleId } = req.body;

  try {
    const result = await runValidationGate(handoverVersionId || "default", roleId || null);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/validate/contradictions - Run contradiction detection on all claims
router.post("/validate/contradictions", async (req, res) => {
  try {
    const claims = await getAllClaims();
    const contradictions = [];

    for (let i = 0; i < claims.length; i++) {
      for (let j = i + 1; j < claims.length; j++) {
        const claimA = claims[i];
        const claimB = claims[j];

        if (claimA.sourceUrl === claimB.sourceUrl || claimA.text.toLowerCase().includes(claimB.text.substring(0, 20))) {
          try {
            const result = await detectContradictions(claimA.text, claimB.text, `Sources: ${claimA.sourceUrl} vs ${claimB.sourceUrl}`);
            if (result.isContradiction && result.confidence > 0.6) {
              contradictions.push({
                claimAId: claimA.id,
                claimBId: claimB.id,
                claimAText: claimA.text,
                claimBText: claimB.text,
                confidence: result.confidence,
                explanation: result.explanation,
              });
            }
          } catch (e) {
            console.warn("Contradiction detection failed:", e.message);
          }
        }
      }
    }

    res.json({
      contradictions,
      count: contradictions.length,
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/validate/rules - List available validation rules
router.get("/validate/rules", async (req, res) => {
  res.json({ rules: VALIDATION_RULES });
});

// POST /api/validate/approve - Manually approve a handover despite warnings
// Body: { handoverVersionId: "string", approverId: "string", overrideReasons: string[] }
router.post("/validate/approve", async (req, res) => {
  const { handoverVersionId, approverId, overrideReasons } = req.body;

  // In a full implementation, this would record the approval in Neo4j
  // with an audit trail of who approved and why
  res.json({
    handoverVersionId,
    approverId,
    overrideReasons: overrideReasons || [],
    approvedAt: new Date().toISOString(),
    status: "approved_with_overrides",
  });
});

// GET /api/validate/results/:handoverVersionId - Get validation results for a version
router.get("/validate/results/:handoverVersionId", async (req, res) => {
  const { handoverVersionId } = req.params;

  // In a full implementation, this would query stored validation results
  // For now, run a fresh validation
  const result = await runValidationGate(handoverVersionId);
  res.json(result);
});

export default router;