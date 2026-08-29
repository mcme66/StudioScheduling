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
    <Modal title="What’s new" subtitle="A few updates since you last visited." onClose={dismiss}>
      <div className="whats-new-body">
        <p>
          Your instructor can now schedule a lesson for you. It shows up at the top of{' '}
          <Link to="/my-lessons" onClick={dismiss}>
            My lessons
          </Link>
          {' '}
          accept or decline it there. Parent accounts will already see which child it is for.
        </p>
      </div>
      <button type="button" className="btn btn-primary btn-block" onClick={dismiss}>
        Got it
      </button>
    </Modal>
  );
}
