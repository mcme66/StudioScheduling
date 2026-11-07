import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useToast } from '../Toast.jsx';
import Modal, { ModalOption } from '../Modal.jsx';
import { fmtDate, fmtPrice, fmtTimeRange } from '../../lib/format.js';
import { METHOD_LABEL } from './CoachPayments.jsx';

function ChargeRow({ charge, onPay, onUndo, busy }) {
  const detail = [charge.teacher.name];
  if (charge.childName) detail.push(`For ${charge.childName}`);
  if (charge.splitWith) detail.push(`Split with ${charge.splitWith}`);
  return (
    <div className="list-row pay-row">
      <div className="when">
        <div className="d">{fmtDate(charge.lessonDate, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
        <div>{fmtTimeRange(charge.startTime, charge.durationMin)}</div>
      </div>
      <div className="grow">
        Lesson
        <div className="contact">{detail.join(' · ')}</div>
      </div>
      <div className="pay-actions">
        <span className="pay-amount">{fmtPrice(charge.amountCents)}</span>
        {charge.status === 'due' && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onPay}>
            I paid
          </button>
        )}
        {charge.status === 'reported' && (
          <>
            <span className="pill pill-warn">
              Awaiting confirmation · {METHOD_LABEL[charge.method] || ''}
            </span>
            {onUndo && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onUndo}>
                Undo
              </button>
            )}
          </>
        )}
        {charge.status === 'paid' && (
          <span className="pill pill-paid">Paid · {METHOD_LABEL[charge.method] || 'Recorded'}</span>
        )}
      </div>
    </div>
  );
}

export default function StudentPayments({ query, charges }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [payTarget, setPayTarget] = useState(null);

  const report = useMutation({
    mutationFn: ({ id, method }) =>
      api(`/payments/student/charges/${id}/report`, { method: 'POST', body: { method } }),
    onSuccess: (data) => {
      const who = data?.managed ? 'The studio' : data?.teacherName || 'Your coach';
      toast(`Payment recorded. ${who} will confirm it and reach out if they can’t find it.`);
      queryClient.invalidateQueries({ queryKey: ['my-payments'] });
    },
    onError: (err) => toast(err.message),
  });

  const undoReport = useMutation({
    mutationFn: (id) => api(`/payments/student/charges/${id}/undo-report`, { method: 'POST' }),
    onSuccess: () => {
      toast('Undone. This charge is due again.');
      queryClient.invalidateQueries({ queryKey: ['my-payments'] });
    },
    onError: (err) => {
      toast(err.message);
      queryClient.invalidateQueries({ queryKey: ['my-payments'] });
    },
  });

  if (query.isLoading) return <div className="loading">Loading payments…</div>;
  if (query.isError) return <p className="error-text">{query.error.message}</p>;

  const open = charges.filter((c) => c.status !== 'paid');
  const paid = charges.filter((c) => c.status === 'paid');
  const sum = (status) =>
    charges.filter((c) => c.status === status).reduce((n, c) => n + c.amountCents, 0);

  return (
    <>
      <div className="pay-summary">
        <div className="pay-stat">
          <div className="pay-stat-label">Balance due</div>
          <div className="pay-stat-value">{fmtPrice(sum('due'))}</div>
        </div>
        <div className="pay-stat">
          <div className="pay-stat-label">Awaiting confirmation</div>
          <div className="pay-stat-value">{fmtPrice(sum('reported'))}</div>
          <div className="pay-stat-note">Your coach is checking for these</div>
        </div>
      </div>

      <div className="owner-grid cols-2 align-start">
        <div className="card">
          <div className="section-title">Open charges</div>
          {open.length === 0 ? (
            <p className="muted" style={{ fontSize: '14px' }}>Nothing owed. You’re all paid up.</p>
          ) : (
            open.map((c) => (
              <ChargeRow
                key={c.id}
                charge={c}
                busy={report.isPending || undoReport.isPending}
                onPay={() => setPayTarget(c)}
                onUndo={() => undoReport.mutate(c.id)}
              />
            ))
          )}
        </div>
        <div className="card">
          <div className="section-title">Payment history</div>
          {paid.length === 0 ? (
            <p className="muted" style={{ fontSize: '14px' }}>No payments yet.</p>
          ) : (
            paid.map((c) => <ChargeRow key={c.id} charge={c} />)
          )}
        </div>
      </div>

      {payTarget && (
        <Modal
          title={`How did you pay ${fmtPrice(payTarget.amountCents)}?`}
          subtitle={`${payTarget.teacher.name} · ${fmtDate(payTarget.lessonDate)}`}
          onClose={() => setPayTarget(null)}
        >
          <ModalOption
            label="Cash"
            description="You paid in person."
            disabled={report.isPending}
            onClick={() => {
              report.mutate({ id: payTarget.id, method: 'cash' });
              setPayTarget(null);
            }}
          />
          <ModalOption
            label="Venmo"
            description="You sent it on Venmo."
            disabled={report.isPending}
            onClick={() => {
              report.mutate({ id: payTarget.id, method: 'venmo' });
              setPayTarget(null);
            }}
          />
        </Modal>
      )}
    </>
  );
}
