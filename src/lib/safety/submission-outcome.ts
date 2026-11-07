export const SUBMIT_OUTCOME_UNKNOWN = 'submit_outcome_unknown';
export const SUBMIT_NOT_SENT = 'submit_not_sent';

export function isAmbiguousRejection(category: string): boolean {
  return category === 'kis_5xx' || category === 'network_error' || category === SUBMIT_OUTCOME_UNKNOWN;
}

// The legacy wrapper recorded failed without a category both before and after
// submission. Only its explicit safety_check audit proves a legacy row was not sent.
export const AMBIGUOUS_ORDER_PREDICATE =
  `((o.status IN ('rejected', 'failed') AND o.blocked_by IN ('kis_5xx', 'network_error', '${SUBMIT_OUTCOME_UNKNOWN}'))
    OR (o.status = 'failed' AND o.blocked_by IS NULL AND NOT EXISTS (
      SELECT 1 FROM trade_logs tl
      WHERE tl.order_id = o.id AND tl.event = 'error'
        AND JSON_UNQUOTE(JSON_EXTRACT(tl.payload, '$.phase')) = 'safety_check'
    )))`;
