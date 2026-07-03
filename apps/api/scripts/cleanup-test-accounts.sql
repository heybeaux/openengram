-- HEY-19: Clean test accounts from production
-- Run against Railway DB manually
-- REVIEW the SELECT first before running DELETE

-- Step 1: List test accounts (review first!)
SELECT id, email, name, plan, created_at 
FROM accounts 
WHERE email LIKE '%test%' 
   OR email LIKE '%@test.openengram.ai'
ORDER BY created_at DESC;

-- Step 2: Delete related data (agents, memories, etc.) for test accounts
-- Run in a transaction:
BEGIN;

-- Delete agents belonging to test accounts
DELETE FROM agents WHERE account_id IN (
  SELECT id FROM accounts 
  WHERE email LIKE '%test%' OR email LIKE '%@test.openengram.ai'
);

-- Delete the test accounts themselves
DELETE FROM accounts 
WHERE email LIKE '%test%' OR email LIKE '%@test.openengram.ai';

-- Verify
-- SELECT COUNT(*) FROM accounts WHERE email LIKE '%test%' OR email LIKE '%@test.openengram.ai';

COMMIT;
