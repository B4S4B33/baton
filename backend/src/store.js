// Shared in-memory store (fallback when Neo4j is unavailable)
export let claims = [];
export let sources = [];
export let stats = {
  totalPrs: 0,
  mergedPrs: 0,
  openPrs: 0,
  closedPrs: 0,
  totalIssues: 0,
  openIssues: 0,
  closedIssues: 0,
  totalComments: 0,
  leaverActivities: 0,
};

// Flag to track if Neo4j is available
export let neo4jAvailable = false;