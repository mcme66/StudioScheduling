import { useMemo } from 'react';
import { useToast } from './Toast.jsx';
import { WEEKDAYS, fmtTimeRange } from '../lib/format.js';

const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export default function SharePanel({ teacherId, studios = [], openSlots, weekLabel }) {
  const toast = useToast();
  const studio = studios[0];

  const bookingUrl = useMemo(() => {
    if (!studio?.slug) return '';
    return new URL(`/studios/${studio.slug}/book/${teacherId}`, window.location.origin).href;
  }, [teacherId, studio?.slug]);

  const qrUrl = bookingUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(bookingUrl)}`
    : '';

  const sorted = useMemo(
    () =>
      [...openSlots].sort(
        (a, b) =>
          DISPLAY_ORDER.indexOf(a.weekday) - DISPLAY_ORDER.indexOf(b.weekday) ||
          a.startTime.localeCompare(b.startTime),
      ),
    [openSlots],
  );

  const copyLink = () => {
    if (!bookingUrl) return;
    navigator.clipboard.writeText(bookingUrl).then(() => toast('Link copied!'));
  };

  const copyAnnouncement = () => {
    if (!bookingUrl) return;
    let message;
    if (!sorted.length) {
      message = `Lessons — week of ${weekLabel}\n\nNo open times this week. Check back soon!\n\nBook here: ${bookingUrl}`;
    } else {
      const lines = sorted.map(
        (s) => `• ${WEEKDAYS[s.weekday]} · ${fmtTimeRange(s.startTime, s.durationMin)}`,
      );
      const header = studio?.name ? `Lessons at ${studio.name}` : 'Lessons';
      message = `${header} — week of ${weekLabel}\n\nOpen times:\n${lines.join('\n')}\n\nBook here: ${bookingUrl}`;
    }
    navigator.clipboard.writeText(message).then(() => toast('Announcement copied!'));
  };

  if (!studio) {
    return (
      <div className="card">
        <div className="section-title">Share with students</div>
        <p className="muted" style={{ fontSize: '14px' }}>
          Select a studio below to get a shareable booking link.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="section-title">Share with students</div>
      <div className="share-grid">
        <div className="share-qr center">
          <img src={qrUrl} alt="QR code to book lessons" width="150" height="150" />
        </div>
        <div>
          <div className="field" style={{ marginBottom: '0.6rem' }}>
            <label>Your booking link</label>
            <div className="row" style={{ gap: '0.4rem' }}>
              <input readOnly value={bookingUrl} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn btn-dark btn-sm" onClick={copyLink}>
                Copy
              </button>
            </div>
          </div>

          <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '4px' }}>
            {sorted.length} open time{sorted.length === 1 ? '' : 's'} · week of {weekLabel}
          </div>
          <div className="open-list">
            {sorted.length === 0 ? (
              <span className="muted">No open times this week.</span>
            ) : (
              sorted.map((s) => (
                <div key={s.id}>
                  {WEEKDAYS[s.weekday]} · {fmtTimeRange(s.startTime, s.durationMin)}
                </div>
              ))
            )}
          </div>

          <button type="button" className="btn btn-primary btn-block" onClick={copyAnnouncement}>
            Copy announcement message
          </button>
        </div>
      </div>
    </div>
  );
}
