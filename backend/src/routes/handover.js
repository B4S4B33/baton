import express from "express";
import {
  getRoleScopedHandoverView,
  getAcknowledgements,
  acknowledgeHandover,
  getRoleConfig,
} from "../services/handoverService.js";

const router = express.Router();

router.get("/handover/roles", async (req, res) => {
  const view = await getRoleScopedHandoverView(req.query.role || "developer", req.query.handoverVersionId || "default");
  res.json({ availableRoles: view.availableRoles, defaultRole: "developer" });
});

router.get("/handover/view", async (req, res) => {
  try {
    const role = req.query.role || "developer";
    const handoverVersionId = req.query.handoverVersionId || "default";
    const view = await getRoleScopedHandoverView(role, handoverVersionId);
    res.json(view);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Failed to load handover view" });
  }
});

router.get("/handover/acknowledgements", async (req, res) => {
  try {
    const handoverVersionId = req.query.handoverVersionId || "default";
    const acknowledgements = await getAcknowledgements(handoverVersionId);
    res.json({ handoverVersionId, acknowledgements });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Failed to load acknowledgements" });
  }
});

router.post("/handover/acknowledge", async (req, res) => {
  try {
    const { handoverVersionId = "default", role, acknowledgedBy, notes } = req.body || {};
    if (!role) return res.status(400).json({ error: "role is required" });
    const roleConfig = getRoleConfig(role);
    const acknowledgement = await acknowledgeHandover({
      handoverVersionId,
      role: roleConfig.role,
      acknowledgedBy,
      notes,
    });
    const acknowledgements = await getAcknowledgements(handoverVersionId);
    res.json({ ok: true, acknowledgement, acknowledgements });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Failed to acknowledge handover" });
  }
});

export default router;
