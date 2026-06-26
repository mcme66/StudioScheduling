import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useToast } from './Toast.jsx';
import RichTextEditor from './RichTextEditor.jsx';
import RichTextDisplay from './RichTextDisplay.jsx';

export default function ScheduleInfoPanel({ title, field, html, editable, onSaved }) {
  const toast = useToast();
  const [draft, setDraft] = useState(html || '');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(html || '');
    setDirty(false);
  }, [html]);

  const save = useMutation({
    mutationFn: (body) => api('/teachers/me', { method: 'PATCH', body }),
    onSuccess: () => {
      toast('Saved.');
      setDirty(false);
      onSaved?.();
    },
    onError: (err) => toast(err.message),
  });

  const handleChange = (next) => {
    setDraft(next);
    setDirty(next !== (html || ''));
  };

  return (
    <div className="card schedule-info-panel">
      <div className="section-title">{title}</div>
      {editable ? (
        <>
          <RichTextEditor value={draft} onChange={handleChange} placeholder={`Add ${title.toLowerCase()}…`} />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ marginTop: '0.75rem' }}
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate({ [field]: draft })}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      ) : (
        <RichTextDisplay html={html} />
      )}
    </div>
  );
}
