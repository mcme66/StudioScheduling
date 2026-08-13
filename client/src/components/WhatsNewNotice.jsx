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
          <strong>Partner codes.</strong> You can share your schedule with another student
          account. On{' '}
          <Link to="/profile" onClick={dismiss}>
            your profile
          </Link>
          , copy your Partner Code and send it to them. They enter that code on their profile to
          link. You’ll each see the other’s lessons. When you book, you can choose which partner
          splits payment, or keep it as Just me.
        </p>
        <p>
          <strong>Also.</strong> Weekly spots now start from the week you’re viewing, they no
          longer fill earlier weeks. Plus a handful of other small fixes.
        </p>
      </div>
      <button type="button" className="btn btn-primary btn-block" onClick={dismiss}>
        Got it
      </button>
    </Modal>
  );
}
