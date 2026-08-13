-- Retire unfinished tasks for platforms outside the approved GEO frontend scope.
UPDATE capture_tasks
SET status = 'cancelled', lease_expires_at = NULL
WHERE platform NOT IN ('doubao', 'deepseek', 'qwen')
  AND status IN ('pending', 'leased');

