import Modal, { ModalOption } from './Modal.jsx';
import {
  buildLessonEvent,
  downloadIcs,
  openGoogleCalendar,
} from '../lib/calendar.js';

/**
 * Modal offering Google Calendar or .ics download for one lesson occurrence.
 * Pass `event` built via buildLessonEvent, or raw lesson fields + onClose.
 */
export default function AddToCalendar({
  onClose,
  teacherName,
  childName,
  lessonDate,
  startTime,
  durationMin,
  manageUrl = `${window.location.origin}/my-lessons`,
  subtitle,
  title,
}) {
  const event = buildLessonEvent({
    teacherName,
    childName,
    lessonDate,
    startTime,
    durationMin,
    manageUrl,
    title,
  });

  return (
    <Modal
      title="Add to calendar"
      subtitle={subtitle || event.title}
      onClose={onClose}
    >
      <ModalOption
        label="Google Calendar"
        description="Open a prefilled event in Google Calendar."
        onClick={() => {
          openGoogleCalendar(event);
          onClose();
        }}
      />
      <ModalOption
        label="Download .ics"
        description="Works with Apple Calendar, Outlook, and most other apps."
        onClick={() => {
          downloadIcs(event, `lesson-${lessonDate}.ics`);
          onClose();
        }}
      />
      <ModalOption
        label="Cancel"
        description="Close without adding anything."
        onClick={onClose}
      />
    </Modal>
  );
}
