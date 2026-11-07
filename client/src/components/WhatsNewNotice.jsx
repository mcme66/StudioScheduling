import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import Modal from './Modal.jsx';
import { hasSeenWhatsNew, markWhatsNewSeen } from '../lib/whatsNew.js';

export default function WhatsNewNotice() {
  const { user, loading, freshSignIn } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (loading || !freshSignIn || user?.role !== 'student') return;
    if (hasSeenWhatsNew()) return;
    setOpen(true);
  }, [loading, user, freshSignIn]);

  const dismiss = () => {
    markWhatsNewSeen();
    setOpen(false);
  };

  if (!open) return null;

  return (
    <Modal title="What’s new" subtitle="Track and pay for your lessons in one place." onClose={dismiss}>
      <div className="whats-new-body">
        <ul className="whats-new-list">
          <li>
            <strong>A new Payments tab.</strong> After your coach marks a lesson complete, the
            charge shows up under{' '}
            <Link to="/my-lessons?tab=payments" onClick={dismiss}>
              My lessons → Payments
            </Link>
            , along with your balance due.
          </li>
          <li>
            <strong>Tell us how you paid.</strong> Tap <em>I paid</em> and choose cash or Venmo. Your
            coach will confirm it and reach out if they can’t find it.
          </li>
          <li>
            <strong>Split lessons.</strong> If you share a lesson with a partner, you’re each charged
            half.
          </li>
          <li>
            <strong>Updates in the bell.</strong> You’ll get a notification for new charges and when
            your payment is confirmed.
          </li>
        </ul>
      </div>
      <button type="button" className="btn btn-primary btn-block" onClick={dismiss}>
        Got it
      </button>
    </Modal>
  );
}
