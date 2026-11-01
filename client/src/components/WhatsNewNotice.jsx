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
    <Modal title="What’s new" subtitle="Lesson updates now come to you." onClose={dismiss}>
      <div className="whats-new-body">
        <ul className="whats-new-list">
          <li>
            <strong>A new notification bell.</strong> Look for the bell at the top right, next to
            Log out. A red number shows how many updates you haven’t read yet.
          </li>
          <li>
            <strong>Weekly spot answers.</strong> Find out when your instructor accepts or declines
            a weekly spot, or books a single lesson instead.
          </li>
          <li>
            <strong>Cancellations and changes.</strong> Hear right away if your instructor or studio
            cancels a lesson, or if a different instructor will teach it.
          </li>
          <li>
            <strong>Lessons held for you.</strong> When an instructor holds a time for you, the bell
            lets you know so you can accept or decline it on{' '}
            <Link to="/my-lessons" onClick={dismiss}>
              My lessons
            </Link>
            .
          </li>
          <li>
            <strong>Back on the schedule.</strong> If a cancellation is undone, the old notice
            disappears and you’ll see that your lesson is back on.
          </li>
          <li>
            <strong>Tidy by itself.</strong> Tap a notification to open it, or use{' '}
            <em>Mark all read</em>. Read notifications clear after 15 days, unread ones after 45.
          </li>
        </ul>
      </div>
      <button type="button" className="btn btn-primary btn-block" onClick={dismiss}>
        Got it
      </button>
    </Modal>
  );
}
