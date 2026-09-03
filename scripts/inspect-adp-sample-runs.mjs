import mysql from "mysql2/promise";

const operationIds = process.argv.slice(2);
if (!operationIds.length) throw new Error("operation_ids_required");

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD
});

try {
  const [rows] = await connection.query(
    `SELECT generation.id, generation.task_id, generation.status, generation.correlation_id,
       generation.hard_rule_result, generation.article_quality_result, generation.production_contract_id,
       generation.failure_code, generation.failure_message, generation.started_at, generation.completed_at,
       contract.contract_json, draft.id AS draft_version_id, draft.title AS draft_title,
       draft.markdown AS draft_markdown, draft.fact_traces
     FROM generation_run generation
     LEFT JOIN production_contract_snapshot contract ON contract.id = generation.production_contract_id
     LEFT JOIN draft_version draft ON draft.generation_run_id = generation.id
     WHERE generation.correlation_id IN (?) ORDER BY generation.started_at`,
    [operationIds]
  );
  const result = rows.map((row) => {
    const hard = typeof row.hard_rule_result === "string" ? JSON.parse(row.hard_rule_result) : row.hard_rule_result || {};
    const quality = typeof row.article_quality_result === "string" ? JSON.parse(row.article_quality_result) : row.article_quality_result || hard.articleQuality;
    const contract = typeof row.contract_json === "string" ? JSON.parse(row.contract_json) : row.contract_json || {};
    const requiredClaimIds = contract.validatorPolicy?.requiredCoreClaimIds || [];
    const markdown = String(row.draft_markdown || "");
    const cta = contract.ctaPlan?.selectedVariants?.[0];
    const identity = contract.fixedExpressions?.[0]?.text;
    const requiredEvidence = (contract.evidencePack?.evidenceItems || []).filter((item) =>
      item.claimIds?.some((claimId) => requiredClaimIds.includes(claimId))
    );
    return {
      generationRunId: row.id,
      operationId: row.correlation_id,
      taskId: row.task_id,
      status: row.status,
      failureCode: row.failure_code,
      failureMessage: row.failure_message,
      blockers: hard.blockers || [],
      ...(row.draft_version_id ? {
        draft: {
          draftVersionId: row.draft_version_id,
          title: row.draft_title,
          headingCount: markdown.split(/\r?\n/).filter((line) => /^##\s+/.test(line.trim())).length,
          identityCount: identity ? markdown.split(identity).length - 1 : 0,
          ctaLabelCount: cta?.label ? markdown.split(cta.label).length - 1 : 0,
          ctaUrlCount: cta?.publicUrl ? markdown.split(cta.publicUrl).length - 1 : 0,
          openingPreview: markdown.slice(0, 700),
          endingPreview: markdown.slice(-350)
        }
      } : {}),
      ...(process.env.SHOW_RULE_DETAILS === "1" ? { prohibitedTerms: contract.validatorPolicy?.prohibitedTerms || [] } : {}),
      ...(process.env.SHOW_RULE_DETAILS === "1" ? {
        openingAlignmentContext: {
          primaryEntityId: contract.geoMission?.primaryEntityId,
          primaryQuestion: contract.geoMission?.primaryQuestion,
          titlePromiseDimensions: contract.geoMission?.titlePromiseDimensions,
          expectedAnswerSummary: contract.geoMission?.expectedAnswerSummary,
          entityIdentity: contract.validatorPolicy?.entityIdentity,
          primaryEntityNode: contract.geoMission?.entityGraph?.nodes?.find((item) => item.entityId === contract.geoMission?.primaryEntityId)
        }
      } : {}),
      requiredEvidence: requiredEvidence.map((item) => ({
        claimIds: item.claimIds?.filter((claimId) => requiredClaimIds.includes(claimId)),
        summary: item.summary,
        evidenceUsage: item.evidenceUsage,
        subjectEntityIds: item.subjectEntityIds
      })),
      requiredStructure: {
        sections: contract.validatorPolicy?.requiredSections || [],
        artifacts: contract.validatorPolicy?.requiredArtifacts || [],
        faqRequired: contract.faqPlan?.required || false
      },
      ...(process.env.SHOW_RULE_DETAILS === "1" ? { evidenceCandidates: (contract.evidencePack?.evidenceItems || []).slice(0, 20).map((item) => ({
        primaryClaimId: item.primaryClaimId,
        summary: item.summary,
        evidenceUsage: item.evidenceUsage,
        subjectEntityIds: item.subjectEntityIds
      })) } : {}),
      quality: quality ? {
        rubricVersion: quality.rubricVersion,
        verdict: quality.verdict,
        score: quality.score,
        dimensions: quality.dimensions?.map((item) => ({ key: item.key, score: item.score }))
      } : undefined,
      startedAt: row.started_at,
      completedAt: row.completed_at
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await connection.end();
}
