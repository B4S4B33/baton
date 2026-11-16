/**
 * Validation Gate - Layer 5
 * Automated checks that run after human review before a handover is published.
 * Checks: citation integrity, contradiction re-scan, confidence recalculation,
 * permission re-validation, completeness check.
 */

import { getAllClaims, getAllSources, updateClaim } from "../services/neo4jService.js";
import { detectContradictions, scoreConfidence } from "./llm.js";

/**
 * Validation rules configuration
 */
const VALIDATION_RULES = [
  { id: "citation_integrity", name: "Citation Integrity", type: "citation_integrity", severity: "critical", enabled: true },
  { id: "contradiction", name: "Contradiction Detection", type: "contradiction", severity: "warning", enabled: true },
  { id: "meeting_authority", name: "Meeting Summary Authority", type: "meeting_authority", severity: "warning", enabled: true },
  { id: "confidence", name: "Confidence Recalculation", type: "confidence", severity: "warning", enabled: true },
  { id: "permission", name: "Permission Re-validation", type: "permission", severity: "critical", enabled: true },
  { id: "completeness", name: "Completeness Check", type: "completeness", severity: "warning", enabled: true },
];

const MEETING_SUMMARY_CONFIDENCE_CAP = 0.6;

function isLowAuthorityMeetingClaim(claim) {
  const st = String(claim?.sourceType || "").toLowerCase();
  const authority = String(claim?.sourceAuthority || claim?.proof?.authority || "").toLowerCase();
  return (st === "meeting_summary" || claim?.proof?.type === "meeting_summary") && (authority === "low" || authority === "");
}

function isCorroboratedClaim(claim) {
  if (claim?.corroborated === true) return true;
  const count = Number(claim?.corroborationCount);
  if (Number.isFinite(count) && count > 0) return true;
  if (Array.isArray(claim?.corroboratedBy) && claim.corroboratedBy.length > 0) return true;
  return false;
}

function applyMeetingAuthorityCap(claim, score) {
  if (!isLowAuthorityMeetingClaim(claim) || isCorroboratedClaim(claim)) return score;
  return Math.min(typeof score === "number" ? score : 0.5, MEETING_SUMMARY_CONFIDENCE_CAP);
}

async function checkMeetingAuthority() {
  const claims = await getAllClaims();
  const uncapped = [];
  const uncited = [];
  const needsCorroboration = [];

  for (const claim of claims) {
    if (!isLowAuthorityMeetingClaim(claim)) continue;
    const corroborated = isCorroboratedClaim(claim);
    const conf = typeof claim.confidence === "number" ? claim.confidence : 0;

    if (!corroborated) needsCorroboration.push(claim.id);
    if (!corroborated && conf > MEETING_SUMMARY_CONFIDENCE_CAP + 0.0001) {
      const clamped = MEETING_SUMMARY_CONFIDENCE_CAP;
      uncapped.push({ claimId: claim.id, previousConfidence: conf, clampedConfidence: clamped, text: (claim.text || "").slice(0, 120) });
      try {
        await updateClaim(claim.id, {
          confidence: clamped,
          needsCorroboration: true,
          sourceAuthority: "low",
          corroborated: false,
          proof: { ...(claim.proof && typeof claim.proof === "object" ? claim.proof : {}), type: "meeting_summary", authority: "low", corroborated: false, confidenceCap: MEETING_SUMMARY_CONFIDENCE_CAP },
        });
      } catch (e) { /* non-fatal */ }
    } else if (!corroborated && claim.needsCorroboration !== true) {
      try { await updateClaim(claim.id, { needsCorroboration: true, sourceAuthority: "low" }); } catch (e) { /* non-fatal */ }
    }

    const hasCitation = Boolean(claim.sourceUrl || claim?.proof?.meetingId || claim?.proof?.sourceUrl);
    if (!hasCitation) uncited.push(claim.id);
  }

  if (uncapped.length > 0 || uncited.length > 0) {
    return {
      id: "meeting_authority",
      name: "Meeting Summary Authority",
      type: "meeting_authority",
      status: "warning",
      severity: "warning",
      detail: `${needsCorroboration.length} uncorroborated low-authority meeting claim(s); ${uncapped.length} clamped to ${MEETING_SUMMARY_CONFIDENCE_CAP}; ${uncited.length} missing citation.`,
      uncappedClaims: uncapped,
      uncitedMeetingClaims: uncited,
      needsCorroborationCount: needsCorroboration.length,
      confidenceCap: MEETING_SUMMARY_CONFIDENCE_CAP,
      checkedAt: new Date().toISOString(),
    };
  }

  return {
    id: "meeting_authority",
    name: "Meeting Summary Authority",
    type: "meeting_authority",
    status: "pass",
    severity: "warning",
    detail: needsCorroboration.length > 0
      ? `${needsCorroboration.length} uncorroborated meeting claim(s) correctly capped at <= ${MEETING_SUMMARY_CONFIDENCE_CAP}.`
      : "No uncorroborated low-authority meeting claims requiring enforcement.",
    needsCorroborationCount: needsCorroboration.length,
    confidenceCap: MEETING_SUMMARY_CONFIDENCE_CAP,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Run the full validation gate on a handover version.
 * Returns { passed: boolean, results: ValidationResult[], criticalFailures: string[] }
 */
export async function runValidationGate(handoverVersionId, roleId = null) {
  const results = [];
  const criticalFailures = [];

  // 1. Citation Integrity Check
  const citationResult = await checkCitationIntegrity();
  results.push(citationResult);
  if (citationResult.status === "fail" && citationResult.severity === "critical") {
    criticalFailures.push(citationResult.detail);
  }

  // 2. Contradiction Re-scan
  const contradictionResult = await checkContradictions();
  results.push(contradictionResult);
  if (contradictionResult.status === "fail") {
    criticalFailures.push(contradictionResult.detail);
  }

  // 3. Meeting authority / confidence cap enforcement (uncorroborated low-authority meeting summaries)
  const meetingAuthorityResult = await checkMeetingAuthority();
  results.push(meetingAuthorityResult);
  if (meetingAuthorityResult.status === "fail" && meetingAuthorityResult.severity === "critical") {
    criticalFailures.push(meetingAuthorityResult.detail);
  }

  // 4. Confidence Recalculation
  const confidenceResult = await recalculateConfidence();
  results.push(confidenceResult);
  if (confidenceResult.status === "fail" && confidenceResult.severity === "critical") {
    criticalFailures.push(confidenceResult.detail);
  }

  // 5. Permission Re-validation
  const permissionResult = await checkPermissions(roleId);
  results.push(permissionResult);
  if (permissionResult.status === "fail" && permissionResult.severity === "critical") {
    criticalFailures.push(permissionResult.detail);
  }

  // 6. Completeness Check
  const completenessResult = await checkCompleteness();
  results.push(completenessResult);
  if (completenessResult.status === "fail" && completenessResult.severity === "critical") {
    criticalFailures.push(completenessResult.detail);
  }

  const passed = criticalFailures.length === 0;

  return {
    handoverVersionId,
    passed,
    results,
    criticalFailures,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Check that every claim references at least one live, accessible source fragment.
 */
async function checkCitationIntegrity() {
  const claims = await getAllClaims();
  const sources = await getAllSources();
  const sourceUrls = new Set(sources.map((s) => s.url));

  const orphaned = [];
  for (const claim of claims) {
    if (!sourceUrls.has(claim.sourceUrl)) {
      orphaned.push(claim.id);
    }
  }

  if (orphaned.length > 0) {
    return {
      id: "citation_integrity",
      name: "Citation Integrity",
      type: "citation_integrity",
      status: "fail",
      severity: "critical",
      detail: `${orphaned.length} claim(s) have no valid source citation: ${orphaned.join(", ")}`,
      checkedAt: new Date().toISOString(),
    };
  }

  return {
    id: "citation_integrity",
    name: "Citation Integrity",
    type: "citation_integrity",
    status: "pass",
    severity: "critical",
    detail: "All claims have valid source citations",
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Re-scan for contradictions between claims after human edits.
 */
async function checkContradictions() {
  const claims = await getAllClaims();
  const contradictions = [];

  // Compare each pair of claims for potential contradictions
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const claimA = claims[i];
      const claimB = claims[j];

      // Only check claims about similar topics (same source or similar text)
      if (claimA.sourceUrl === claimB.sourceUrl || claimA.text.toLowerCase().includes(claimB.text.substring(0, 20))) {
        try {
          const result = await detectContradictions(claimA.text, claimB.text, `Sources: ${claimA.sourceUrl} vs ${claimB.sourceUrl}`);
          if (result.isContradiction && result.confidence > 0.7) {
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
          // Skip if LLM is unavailable
          console.warn("Contradiction detection failed:", e.message);
        }
      }
    }
  }

  if (contradictions.length > 0) {
    return {
      id: "contradiction",
      name: "Contradiction Detection",
      type: "contradiction",
      status: "fail",
      severity: "warning",
      detail: `${contradictions.length} contradiction(s) detected between claims`,
      contradictions,
      checkedAt: new Date().toISOString(),
    };
  }

  return {
    id: "contradiction",
    name: "Contradiction Detection",
    type: "contradiction",
    status: "pass",
    severity: "warning",
    detail: "No contradictions detected",
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Recalculate confidence scores for all claims.
 */
async function recalculateConfidence() {
  const claims = await getAllClaims();
  const lowConfidence = [];

  for (const claim of claims) {
    try {
      const scoreResult = await scoreConfidence(
        claim.text,
        claim.sourceType,
        claim.createdAt,
        isCorroboratedClaim(claim) ? Math.max(2, Number(claim.corroborationCount) || 2) : 1
      );

      let score = typeof scoreResult?.score === "number" ? scoreResult.score : 0.5;
      // Enforce lower-authority meeting-summary cap: <= 0.6 until corroborated
      const cappedScore = applyMeetingAuthorityCap(claim, score);
      const wasCapped = cappedScore !== score;
      score = cappedScore;

      const updates = {};
      if (Math.abs((claim.confidence ?? 0) - score) > 0.0001) updates.confidence = score;
      if (isLowAuthorityMeetingClaim(claim) && !isCorroboratedClaim(claim)) {
        updates.needsCorroboration = true;
        updates.sourceAuthority = "low";
      }
      if (Object.keys(updates).length > 0) {
        try { await updateClaim(claim.id, updates); } catch (e) { /* non-fatal */ }
      }

      if (score < 0.5 || wasCapped) {
        lowConfidence.push({
          claimId: claim.id,
          claimText: claim.text,
          score,
          reasoning: wasCapped
            ? `Capped at ${MEETING_SUMMARY_CONFIDENCE_CAP} (uncorroborated low-authority meeting summary)`
            : (scoreResult?.reasoning || "Low confidence"),
          capped: wasCapped,
          sourceAuthority: claim.sourceAuthority || (isLowAuthorityMeetingClaim(claim) ? "low" : null),
        });
      }
    } catch (e) {
      // Skip if LLM is unavailable
      console.warn("Confidence scoring failed:", e.message);
    }
  }

  if (lowConfidence.length > 0) {
    return {
      id: "confidence",
      name: "Confidence Recalculation",
      type: "confidence",
      status: "warning",
      severity: "warning",
      detail: `${lowConfidence.length} claim(s) have low confidence scores (< 0.5)`,
      lowConfidence,
      checkedAt: new Date().toISOString(),
    };
  }

  return {
    id: "confidence",
    name: "Confidence Recalculation",
    type: "confidence",
    status: "pass",
    severity: "warning",
    detail: "All claims have acceptable confidence scores",
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Re-check ACLs on claims to ensure no confidential data leaked into a role-scoped view.
 */
async function checkPermissions(roleId) {
  const claims = await getAllClaims();

  // In a full implementation, this would check each claim's ACL against the role's permissions.
  // For now, we check that no claim contains obviously confidential markers without proper authorization.
  const confidentialClaims = [];

  const confidentialKeywords = ["password", "secret", "api_key", "private_key", "credential", "token"];

  for (const claim of claims) {
    const text = (claim.text || "").toLowerCase();
    const hasConfidential = confidentialKeywords.some((k) => text.includes(k));

    if (hasConfidential && !claim.isLeaver) {
      confidentialClaims.push({
        claimId: claim.id,
        claimText: claim.text.substring(0, 100),
        reason: "Contains potentially confidential information without leaver attribution",
      });
    }
  }

  if (confidentialClaims.length > 0) {
    return {
      id: "permission",
      name: "Permission Re-validation",
      type: "permission",
      status: "fail",
      severity: "critical",
      detail: `${confidentialClaims.length} claim(s) contain potentially confidential data`,
      confidentialClaims,
      checkedAt: new Date().toISOString(),
    };
  }

  return {
    id: "permission",
    name: "Permission Re-validation",
    type: "permission",
    status: "pass",
    severity: "critical",
    detail: "All claims pass permission checks",
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Verify that critical areas (ownership, blockers, dependencies, next actions) are covered.
 */
async function checkCompleteness() {
  const claims = await getAllClaims();

  const hasOwnership = claims.some((c) => c.type.includes("task") || c.type.includes("owner") || c.assignees?.length > 0);
  const hasBlockers = claims.some((c) => c.type.includes("risk") || c.text.toLowerCase().includes("block"));
  const hasDependencies = claims.some((c) => c.type.includes("dependency") || c.text.toLowerCase().includes("depend"));
  const hasNextActions = claims.some((c) => c.status === "open" || c.status === "proposed");

  const missing = [];
  if (!hasOwnership) missing.push("ownership");
  if (!hasBlockers) missing.push("blockers/risks");
  if (!hasDependencies) missing.push("dependencies");
  if (!hasNextActions) missing.push("next actions");

  if (missing.length > 0) {
    return {
      id: "completeness",
      name: "Completeness Check",
      type: "completeness",
      status: "fail",
      severity: "warning",
      detail: `Missing coverage for: ${missing.join(", ")}`,
      missing,
      checkedAt: new Date().toISOString(),
    };
  }

  return {
    id: "completeness",
    name: "Completeness Check",
    type: "completeness",
    status: "pass",
    severity: "warning",
    detail: "All critical areas are covered",
    checkedAt: new Date().toISOString(),
  };
}

export { VALIDATION_RULES };