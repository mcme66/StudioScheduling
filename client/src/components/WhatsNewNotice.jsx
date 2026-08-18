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
          <strong>Partner codes.</strong> Regular student accounts still share one code. Parent
          accounts now have a partner code per child — sharing Alina’s code only shares Alina’s
          lessons, not a sibling’s. On{' '}
          <Link to="/profile" onClick={dismiss}>
            your profile
          </Link>
          , copy the code and send it to them. They enter it on their profile to link. When you
          book, you can choose which of that child’s partners splits payment, or keep it as Just
          me.
        </p>
        <p>
          <strong>Also.</strong> Weekly spots now start from the week you’re viewing, they no
          longer fill earlier weeks. Plus a handful of other small fixes.
          Fixed additional bugs - Weekly spots now end when the slot itself ends. 
        </p>
      </div>
      <button type="button" className="btn btn-primary btn-block" onClick={dismiss}>
        Got it
      </button>
    </Modal>
  );
}
