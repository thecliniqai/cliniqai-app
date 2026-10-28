-- Migration: 000016_comm_queue_delivery_status.sql
-- Description: Expand communication_queue status check constraint to support delivery receipts (delivered, read)
-- and create index on external_message_id for high-performance DLR webhooks (Peer Review Finding 6).

ALTER TABLE public.communication_queue 
  DROP CONSTRAINT IF EXISTS communication_queue_status_check;

ALTER TABLE public.communication_queue 
  ADD CONSTRAINT communication_queue_status_check 
  CHECK (status IN ('pending', 'processing', 'sent', 'delivered', 'read', 'failed', 'cancelled', 'dead_letter'));

CREATE INDEX IF NOT EXISTS idx_communication_queue_external_msg_id 
  ON public.communication_queue (external_message_id);

-- Down / Rollback:
-- DROP INDEX IF EXISTS idx_communication_queue_external_msg_id;
-- ALTER TABLE public.communication_queue DROP CONSTRAINT IF EXISTS communication_queue_status_check;
-- ALTER TABLE public.communication_queue ADD CONSTRAINT communication_queue_status_check CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled', 'dead_letter'));
