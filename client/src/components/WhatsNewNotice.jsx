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
        <ul className="whats-new-list">
          <li>
            <strong>A calendar of your week.</strong>{' '}
            <Link to="/my-lessons" onClick={dismiss}>
              My lessons
            </Link>{' '}
            now shows your lessons on a calendar, with a color for each child.
          </li>
          <li>
            <strong>Pick your colors.</strong> Choose lesson colors on your{' '}
            <Link to="/profile" onClick={dismiss}>
              Profile
            </Link>
            .
          </li>
          <li>
            <strong>Weekly spots need a yes.</strong> When you ask for a weekly time, it stays
            pending until your instructor says yes.
          </li>
          <li>
            <strong>Search by time range.</strong> Find lessons that fit between a start and end
            time.
          </li>
          <li>
            <strong>One place to log in</strong> for everyone, plus a fresh new logo.
          </li>
        </ul>
      </div>
      <button type="button" className="btn btn-primary btn-block" onClick={dismiss}>
        Got it
      </button>
    </Modal>
  );
}
