BEGIN;

UPDATE part_requests
SET status='Open'
WHERE lower(status)='close'
  AND coalesce(arrived_quantity,0)<coalesce(requested_quantity,0)
  AND NOT (coalesce(legacy_data,'{}'::jsonb) ? 'reorderedTo');

UPDATE part_request_transactions transactions
SET status=CASE WHEN EXISTS(
  SELECT 1
  FROM part_requests requests
  WHERE requests.transaction_id=transactions.id
    AND lower(requests.status)<>'close'
) THEN 'Open' ELSE 'Close' END;

COMMIT;
