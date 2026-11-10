import express from "express";
import { runValidationGate, VALIDATION_RULES } from "../services/validationGate.js";
import { getAllClaims, updateClaim } from "../services/neo4jService.js";

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