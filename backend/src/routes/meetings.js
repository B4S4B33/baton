import express from "express";
import { ingestMeetingSummary } from "../services/meetingIngestService.js";

const router = express.Router();

// POST /api/meetings/ingest
// Accepts normalized or pasted/exported meeting summary payloads.
// Body: { provider?, meetingId?, title?, occurredAt?, participants?, summaryText?, transcriptText?, actionItems?, sourceUrl?, metadata? }
router.post("/meetings/ingest", async (req, res) => {
  try {
    const result = await ingestMeetingSummary(req.body || {});
    res.status(result.idempotent ? 200 : 201).json(result);
  } catch (e) {
    console.error("Meeting ingestion failed:", e);
    res.status(e.status || 500).json({ error: e.message || "Meeting ingestion failed" });
  }
});

export default router;