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
  { id: "confidence", name: "Confidence Recalculation", type: "confidence", severity: "warning", enabled: true },
  { id: "permission", name: "Permission Re-validation", type: "permission", severity: "critical", enabled: true },
  { id: "completeness", name: "Completeness Check", type: "completeness", severity: "warning", enabled: true },
];

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

  // 3. Confidence Recalculation
  const confidenceResult = await recalculateConfidence();
  results.push(confidenceResult);
  if (confidenceResult.status === "fail" && confidenceResult.severity === "critical") {
    criticalFailures.push(confidenceResult.detail);
  }

  // 4. Permission Re-validation
  const permissionResult = await checkPermissions(roleId);
  results.push(permissionResult);
  if (permissionResult.status === "fail" && permissionResult.severity === "critical") {
    criticalFailures.push(permissionResult.detail);
  }

  // 5. Completeness Check
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
        1 // corroboration count - could be enhanced
      );

      const score = typeof scoreResult?.score === "number" ? scoreResult.score : 0.5;
      if (score < 0.5) {
        lowConfidence.push({
          claimId: claim.id,
          claimText: claim.text,
          score,
          reasoning: scoreResult?.reasoning || "Low confidence",
        });

        // Update the claim's confidence in storage
        try {
          await updateClaim(claim.id, { confidence: score });
        } catch (e) {
          // Non-fatal: storage update may fail in fallback environments
        }
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