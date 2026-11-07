import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useToast } from '../Toast.jsx';
import { fmtDate, fmtPrice, fmtTimeRange } from '../../lib/format.js';
import { METHOD_LABEL } from '../payments/CoachPayments.jsx';

export const settlementRequestsKey = ['owner-settlement-requests'];

export function useSettlementRequests() {
  return useQuery({
    queryKey: settlementRequestsKey,
    queryFn: () => api('/owner/settlement-requests'),
    refetchInterval: 30000,
  });
}

function LessonRow({ item, amountCents, amountNote, actionLabel, onSettle, busy }) {
  const who = item.childName || item.studentName;
  const detail = [item.teacherName];
  if (item.childName) detail.push(`Parent: ${item.studentName}`);
  if (item.paymentPartnerName) detail.push(`Split with ${item.paymentPartnerName}`);
  const methods = item.methods.map((m) => METHOD_LABEL[m] || m).join(' + ');
  return (
    <div className="list-row pay-row">
      <div className="when">
        <div className="d">{fmtDate(item.lessonDate, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
        <div>{fmtTimeRange(item.startTime, item.durationMin)}</div>
      </div>
      <div className="grow">
        <strong>{who}</strong>
        <div className="contact">{detail.join(' · ')}</div>
        <div className="contact">
          Student paid {fmtPrice(item.paidCents)}
          {methods ? ` by ${methods}` : ''}
          {item.paidAt ? ` · ${fmtDate(String(item.paidAt).slice(0, 10), { month: 'short', day: 'numeric' })}` : ''}
        </div>
      </div>
      <div className="pay-actions">
        <div style={{ textAlign: 'right' }}>
          <div className="pay-amount">{fmtPrice(amountCents)}</div>
          <div className="contact">{amountNote}</div>
        </div>
        <button type="button" className="btn btn-green btn-sm" disabled={busy} onClick={onSettle}>
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

export default function SettlementRequests() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const requestsQuery = useSettlementRequests();

  const settle = useMutation({
    mutationFn: ({ completionId, direction }) =>
      api(`/owner/lesson-completions/${completionId}/settle`, { method: 'POST', body: { direction } }),
    onSuccess: (data) => {
      const amount = fmtPrice(data.settlement.amountCents);
      toast(
        data.settlement.direction === 'coach_to_studio'
          ? `Floor fee received (${amount}). This lesson is settled.`
          : `Payout sent (${amount}). This lesson is settled.`,
      );
      queryClient.invalidateQueries({ queryKey: settlementRequestsKey });
      queryClient.invalidateQueries({ queryKey: ['owner-balances'] });
      queryClient.invalidateQueries({ queryKey: ['coach-payments'] });
    },
    onError: (err) => toast(err.message),
  });

  if (requestsQuery.isLoading) return <div className="loading">Loading…</div>;
  if (requestsQuery.isError) return <p className="error-text">{requestsQuery.error.message}</p>;
  const { floorFees, payouts } = requestsQuery.data;
  const total = (list, key) => list.reduce((n, item) => n + item[key], 0);

  return (
    <>
      <div className="card">
        <div className="section-title">
          Floor fees · {floorFees.length} lesson{floorFees.length === 1 ? '' : 's'} ·{' '}
          {fmtPrice(total(floorFees, 'floorFeeCents'))}
        </div>
        <p className="request-note">
          The coach collected payment for these lessons. Mark each one once the coach has paid you
          the floor fee.
        </p>
        {floorFees.length === 0 ? (
          <p className="muted" style={{ fontSize: '14px', margin: 0 }}>No floor fees waiting.</p>
        ) : (
          floorFees.map((item) => (
            <LessonRow
              key={`fee-${item.completionId}`}
              item={item}
              amountCents={item.floorFeeCents}
              amountNote="Floor fee"
              actionLabel="Floor Fee Received"
              busy={settle.isPending}
              onSettle={() => settle.mutate({ completionId: item.completionId, direction: item.direction })}
            />
          ))
        )}
      </div>

      {payouts.length > 0 && (
        <div className="card">
          <div className="section-title">
            Payouts · {payouts.length} lesson{payouts.length === 1 ? '' : 's'} ·{' '}
            {fmtPrice(total(payouts, 'payoutCents'))}
          </div>
          <p className="request-note">
            The studio collected payment for these managed-coach lessons. Mark each one once you’ve
            paid the coach their share (lesson price minus the floor fee).
          </p>
          {payouts.map((item) => (
            <LessonRow
              key={`payout-${item.completionId}`}
              item={item}
              amountCents={item.payoutCents}
              amountNote={`Coach share · ${fmtPrice(item.floorFeeCents)} fee kept`}
              actionLabel="Payout Sent"
              busy={settle.isPending}
              onSettle={() => settle.mutate({ completionId: item.completionId, direction: item.direction })}
            />
          ))}
        </div>
      )}
    </>
  );
}
