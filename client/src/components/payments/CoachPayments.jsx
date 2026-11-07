import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useToast } from '../Toast.jsx';
import Modal, { ModalOption } from '../Modal.jsx';
import { fmtDate, fmtPrice, fmtTimeRange } from '../../lib/format.js';

export const METHOD_LABEL = { cash: 'Cash', venmo: 'Venmo', card: 'Card' };

export function coachPaymentsKey(scope) {
  return ['coach-payments', scope];
}

export function useCoachPayments(ownerTeacher, enabled = true) {
  const scope = ownerTeacher ? ownerTeacher.id : 'self';
  return useQuery({
    queryKey: coachPaymentsKey(scope),
    queryFn: () =>
      api(ownerTeacher ? `/payments/coach?teacherId=${ownerTeacher.id}` : '/payments/coach'),
    enabled,
    refetchInterval: 30000,
  });
}

function lessonName(item) {
  return item.childName || item.studentName;
}

function lessonDetail(item) {
  const bits = [];
  if (item.childName) bits.push(`Parent: ${item.studentName}`);
  if (item.paymentPartnerName) bits.push(`Split with ${item.paymentPartnerName}`);
  return bits.join(' · ');
}

function WhenCell({ item }) {
  return (
    <div className="when">
      <div className="d">{fmtDate(item.lessonDate, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
      <div>{fmtTimeRange(item.startTime, item.durationMin)}</div>
    </div>
  );
}

function ChargeStatus({ charge }) {
  if (charge.status === 'paid') {
    return (
      <span className="pill pill-paid">
        Paid · {METHOD_LABEL[charge.method] || 'Recorded'}
        {charge.settled
          ? charge.collectedBy === 'studio'
            ? ' · Payout sent'
            : ' · Floor fee received'
          : ''}
      </span>
    );
  }
  if (charge.status === 'reported') {
    return (
      <span className="pill pill-warn">
        Awaiting confirmation · {METHOD_LABEL[charge.method] || ''}
      </span>
    );
  }
  return <span className="pill pill-due">Due</span>;
}

export default function CoachPayments({ ownerTeacher = null }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const scope = ownerTeacher ? ownerTeacher.id : 'self';
  const [filter, setFilter] = useState('open');
  const [payTarget, setPayTarget] = useState(null);
  const paymentsQuery = useCoachPayments(ownerTeacher);
  const withTeacher = (path) => (ownerTeacher ? `${path}?teacherId=${ownerTeacher.id}` : path);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: coachPaymentsKey(scope) });
    queryClient.invalidateQueries({ queryKey: ['owner-balances'] });
    queryClient.invalidateQueries({ queryKey: ['owner-settlement-requests'] });
    for (const key of [
      'owner-dashboard',
      'owner-floor-fees',
      'owner-coaches',
      'owner-coach-lessons',
      'owner-recent-students',
      'owner-studio-students',
    ]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
  const useAction = (fn, message) =>
    useMutation({
      mutationFn: fn,
      onSuccess: (data, vars) => {
        toast(typeof message === 'function' ? message(vars) : message);
        refresh();
      },
      onError: (err) => toast(err.message),
    });

  const lessonRef = (item) =>
    item.bookingId
      ? { bookingId: item.bookingId }
      : { recurringAssignmentId: item.recurringAssignmentId, date: item.lessonDate };

  const complete = useAction(
    (item) => api(withTeacher('/payments/coach/complete'), { method: 'POST', body: lessonRef(item) }),
    (item) => `Lesson complete. ${lessonName(item)} was charged ${fmtPrice(item.priceCents)}.`,
  );
  const skip = useAction(
    (item) => api(withTeacher('/payments/coach/skip'), { method: 'POST', body: lessonRef(item) }),
    'Marked as no charge.',
  );
  const undoCompletion = useAction(
    (id) => api(withTeacher(`/payments/coach/completions/${id}`), { method: 'DELETE' }),
    'Moved back to To complete.',
  );
  const markPaid = useAction(
    ({ id, method }) =>
      api(withTeacher(`/payments/coach/charges/${id}/paid`), {
        method: 'POST',
        body: method ? { method } : {},
      }),
    ({ method }) => (method ? `Payment recorded (${METHOD_LABEL[method]}).` : 'Payment confirmed.'),
  );
  const markUnpaid = useAction(
    (id) => api(withTeacher(`/payments/coach/charges/${id}/unpaid`), { method: 'POST' }),
    'Marked unpaid.',
  );
  const notFound = useAction(
    (id) => api(withTeacher(`/payments/coach/charges/${id}/not-found`), { method: 'POST' }),
    'Moved back to Due. The student was notified.',
  );

  const busy =
    complete.isPending ||
    skip.isPending ||
    undoCompletion.isPending ||
    markPaid.isPending ||
    markUnpaid.isPending ||
    notFound.isPending;

  if (paymentsQuery.isLoading) return <div className="loading">Loading payments…</div>;
  if (paymentsQuery.isError) return <p className="error-text">{paymentsQuery.error.message}</p>;
  const data = paymentsQuery.data;
  const { summary } = data;
  const studioCollects = data.collectedBy === 'studio';
  const completed = data.completed.filter(
    (c) => filter === 'all' || c.charges.some((ch) => ch.status !== 'paid' || !ch.settled),
  );

  return (
    <>
      <div className="pay-summary">
        <div className="pay-stat">
          <div className="pay-stat-label">Outstanding</div>
          <div className="pay-stat-value">{fmtPrice(summary.outstandingCents)}</div>
          {summary.awaitingCents > 0 && (
            <div className="pay-stat-note">{fmtPrice(summary.awaitingCents)} awaiting confirmation</div>
          )}
        </div>
        <div className="pay-stat">
          <div className="pay-stat-label">Collected this month</div>
          <div className="pay-stat-value">{fmtPrice(summary.collectedThisMonthCents)}</div>
        </div>
        {(!studioCollects || summary.floorFeesOwedCents > 0) && (
          <div className="pay-stat">
            <div className="pay-stat-label">Floor fees owed</div>
            <div className="pay-stat-value">{fmtPrice(summary.floorFeesOwedCents)}</div>
            <div className="pay-stat-note">Owed to the studio</div>
          </div>
        )}
        {(studioCollects || summary.payoutOwedCents > 0) && (
          <div className="pay-stat">
            <div className="pay-stat-label">Payout owed</div>
            <div className="pay-stat-value">{fmtPrice(summary.payoutOwedCents)}</div>
            <div className="pay-stat-note">Studio owes this coach</div>
          </div>
        )}
      </div>

      <div className="owner-grid align-start">
        <div className="card">
          <div className="section-title">To complete</div>
          <p className="muted" style={{ fontSize: '13px', marginTop: '-4px' }}>
            Past lessons since {fmtDate(data.trackingSince, { month: 'short', day: 'numeric', year: 'numeric' })}.
            Mark each one complete to charge the student.
          </p>
          {data.toComplete.length === 0 ? (
            <p className="muted" style={{ fontSize: '14px' }}>You’re all caught up.</p>
          ) : (
            data.toComplete.map((item) => (
              <div className="list-row pay-row" key={item.key}>
                <WhenCell item={item} />
                <div className="grow">
                  {lessonName(item)}
                  <div className="contact">
                    {[item.kind === 'weekly' ? 'Weekly' : 'One-time', lessonDetail(item)]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <div className="pay-actions">
                  <span className="pay-amount">{fmtPrice(item.priceCents)}</span>
                  <button
                    type="button"
                    className="btn btn-green btn-sm"
                    disabled={busy}
                    onClick={() => complete.mutate(item)}
                  >
                    Lesson complete
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => skip.mutate(item)}
                  >
                    No charge
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <div className="coach-toolbar">
            <div className="section-title" style={{ marginBottom: 0 }}>Charges</div>
            <div className="quiet-presets" role="group" aria-label="Charge filter">
              {[
                { id: 'open', label: 'Open' },
                { id: 'all', label: 'All' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={filter === f.id ? 'on' : ''}
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {completed.length === 0 ? (
            <p className="muted" style={{ fontSize: '14px' }}>
              {filter === 'open' ? 'Nothing open. Every lesson is paid and settled.' : 'No completed lessons yet.'}
            </p>
          ) : (
            completed.map((c) => (
              <div className="list-row pay-row" key={c.id}>
                <WhenCell item={c} />
                <div className="grow">
                  {lessonName(c)}
                  <div className="contact">
                    {[`${fmtPrice(c.priceCents)} lesson`, lessonDetail(c)].filter(Boolean).join(' · ')}
                  </div>
                  {c.canUndo && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ marginTop: '0.35rem' }}
                      disabled={busy}
                      onClick={() => undoCompletion.mutate(c.id)}
                    >
                      {c.status === 'skipped' ? 'Undo no charge' : 'Undo complete'}
                    </button>
                  )}
                </div>
                <div>
                  {c.status === 'skipped' && <span className="pill pill-muted">No charge</span>}
                  {c.charges.map((ch) => (
                    <div className="pay-charge-line" key={ch.id}>
                      {c.charges.length > 1 && <span className="muted">{ch.studentName}</span>}
                      <span className="pay-amount">{fmtPrice(ch.amountCents)}</span>
                      <ChargeStatus charge={ch} />
                      {ch.status === 'paid' && !ch.settled && (
                        <span className="pill pill-muted">
                          {ch.collectedBy === 'studio'
                            ? `Payout due ${fmtPrice(ch.amountCents - ch.floorFeeCents)}`
                            : `Floor fee due ${fmtPrice(ch.floorFeeCents)}`}
                        </span>
                      )}
                      {ch.status === 'due' && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={busy}
                          onClick={() => setPayTarget({ charge: ch, lesson: c })}
                        >
                          Mark paid
                        </button>
                      )}
                      {ch.status === 'reported' && (
                        <>
                          <button
                            type="button"
                            className="btn btn-green btn-sm"
                            disabled={busy}
                            onClick={() => markPaid.mutate({ id: ch.id })}
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy}
                            onClick={() => notFound.mutate(ch.id)}
                          >
                            Can’t find it
                          </button>
                        </>
                      )}
                      {ch.status === 'paid' && !ch.settled && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => markUnpaid.mutate(ch.id)}
                        >
                          Mark unpaid
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {payTarget && (
        <Modal
          title={`Mark ${fmtPrice(payTarget.charge.amountCents)} paid`}
          subtitle={`${payTarget.charge.studentName} · ${fmtDate(payTarget.lesson.lessonDate)}`}
          onClose={() => setPayTarget(null)}
        >
          {['cash', 'venmo'].map((method) => (
            <ModalOption
              key={method}
              label={METHOD_LABEL[method]}
              description={
                studioCollects
                  ? 'The studio received this payment.'
                  : `You received this by ${method === 'cash' ? 'cash' : 'Venmo'}.`
              }
              disabled={busy}
              onClick={() => {
                markPaid.mutate({ id: payTarget.charge.id, method });
                setPayTarget(null);
              }}
            />
          ))}
        </Modal>
      )}
    </>
  );
}
