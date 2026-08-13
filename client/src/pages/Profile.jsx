import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import Modal, { ModalOption } from '../components/Modal.jsx';

export default function Profile() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const isTeacher = user?.role === 'teacher';

  const teacherQuery = useQuery({
    queryKey: ['teacher-profile'],
    queryFn: () => api('/teachers/me'),
    enabled: isTeacher,
  });
  const studentQuery = useQuery({
    queryKey: ['student-profile'],
    queryFn: () => api('/students/me'),
    enabled: !isTeacher,
  });
  const studiosQuery = useQuery({
    queryKey: ['studios'],
    queryFn: () => api('/studios'),
    enabled: isTeacher,
  });
  const myStudiosQuery = useQuery({
    queryKey: ['my-studios'],
    queryFn: () => api('/teachers/me/studios'),
    enabled: isTeacher,
  });

  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    receiveEmails: true,
    isParent: false,
    childrenNames: [''],
    trackPayments: false,
    isActive: true,
    canBookAsStudent: false,
    bio: '',
    defaultPrice: '74',
    defaultDurationMin: '45',
    studioId: '',
  });
  const [error, setError] = useState('');

  useEffect(() => {
    if (isTeacher && teacherQuery.data?.teacher) {
      const t = teacherQuery.data.teacher;
      const studio = myStudiosQuery.data?.studios?.[0];
      setForm({
        fullName: t.fullName || '',
        phone: t.phone || '',
        receiveEmails: t.receiveEmails !== false,
        isParent: false,
        childrenNames: [''],
        isActive: t.isActive !== false,
        canBookAsStudent: t.canBookAsStudent === true,
        bio: t.bio || '',
        trackPayments: t.trackPayments === true,
        defaultPrice: String((t.defaultPriceCents || 7400) / 100),
        defaultDurationMin: String(t.defaultDurationMin || 45),
        studioId: studio ? String(studio.id) : '',
      });
    } else if (!isTeacher && studentQuery.data?.student) {
      const s = studentQuery.data.student;
      const names = Array.isArray(s.childrenNames) ? s.childrenNames.filter(Boolean) : [];
      setForm((f) => ({
        ...f,
        fullName: s.fullName || '',
        phone: s.phone || '',
        receiveEmails: s.receiveEmails !== false,
        isParent: s.isParent === true,
        childrenNames: names.length ? [...names, ''] : [''],
      }));
    }
  }, [isTeacher, teacherQuery.data, studentQuery.data, myStudiosQuery.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (isTeacher) {
        const currentStudio = myStudiosQuery.data?.studios?.[0];
        const studioId = Number(form.studioId);
        if (!studioId) throw new Error('Select a studio.');

        if (currentStudio && currentStudio.id !== studioId) {
          const nextStudio = studiosQuery.data?.studios?.find((s) => s.id === studioId);
          const message = `You will be removed from ${currentStudio.name} and listed at ${nextStudio?.name || 'the selected studio'} instead. Continue?`;
          if (!window.confirm(message)) throw new Error('__cancelled__');
        }

        await api('/teachers/me', {
          method: 'PATCH',
          body: {
            fullName: form.fullName,
            phone: form.phone || '',
            bio: form.bio || '',
            defaultPriceCents: Math.round(Number(form.defaultPrice || 0) * 100),
            defaultDurationMin: Number(form.defaultDurationMin || 45),
            trackPayments: form.trackPayments,
            receiveEmails: form.receiveEmails,
            isActive: form.isActive,
            canBookAsStudent: form.canBookAsStudent,
          },
        });

        if (!currentStudio || currentStudio.id !== studioId) {
          await api('/teachers/me/studios', { method: 'PUT', body: { studioId } });
        }
      } else {
        await api('/students/me', {
          method: 'PATCH',
          body: {
            fullName: form.fullName,
            phone: form.phone || '',
            receiveEmails: form.receiveEmails,
            isParent: form.isParent,
            childrenNames: form.isParent
              ? form.childrenNames.map((n) => n.trim()).filter(Boolean)
              : [],
          },
        });
      }
    },
    onSuccess: async () => {
      toast('Profile saved.');
      setError('');
      await refresh();
      if (isTeacher) {
        await teacherQuery.refetch();
        await myStudiosQuery.refetch();
      } else {
        await studentQuery.refetch();
      }
      navigate(isTeacher ? '/teacher' : '/');
    },
    onError: (err) => {
      if (err.message === '__cancelled__') return;
      setError(err.message);
    },
  });

  const loading = isTeacher
    ? teacherQuery.isLoading || myStudiosQuery.isLoading
    : studentQuery.isLoading;

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  if (!user) {
    return null;
  }

  return (
    <div className="container narrow">
      <h1 className="page-title">Your profile</h1>
      <p className="page-sub">Update your account information.</p>

      {loading && <div className="loading">Loading profile…</div>}

      {!loading && (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            save.mutate();
          }}
        >
          <div className="field">
            <label>Email</label>
            <input value={user.email} readOnly disabled />
          </div>
          <div className="field">
            <label>Full name</label>
            <input value={form.fullName} onChange={update('fullName')} required />
          </div>
          <div className="field">
            <label>Phone (optional)</label>
            <input value={form.phone} onChange={update('phone')} autoComplete="tel" />
          </div>

          {!isTeacher && (
            <>
              <div className={`recurring-toggle${form.receiveEmails ? ' active' : ''}`}>
                <div
                  className="recurring-toggle-row"
                  onClick={() => setForm((f) => ({ ...f, receiveEmails: !f.receiveEmails }))}
                >
                  <div className="recurring-toggle-label">
                    <strong>Receive emails?</strong>
                    <span>Booking confirmations and lesson reminders</span>
                  </div>
                  <button
                    type="button"
                    className={`switch${form.receiveEmails ? ' on' : ''}`}
                    aria-pressed={form.receiveEmails}
                    aria-label="Toggle email notifications"
                  />
                </div>
              </div>

              <div className={`recurring-toggle${form.isParent ? ' active' : ''}`}>
                <div
                  className="recurring-toggle-row"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      isParent: !f.isParent,
                      childrenNames: !f.isParent
                        ? f.childrenNames?.length
                          ? f.childrenNames
                          : ['']
                        : f.childrenNames,
                    }))
                  }
                >
                  <div className="recurring-toggle-label">
                    <strong>Parent account</strong>
                    <span>Book lessons for your children instead of yourself</span>
                  </div>
                  <button
                    type="button"
                    className={`switch${form.isParent ? ' on' : ''}`}
                    aria-pressed={form.isParent}
                    aria-label="Toggle parent account"
                  />
                </div>
              </div>

              {form.isParent && (
                <div className="parent-children">
                  <label>Children&apos;s names</label>
                  <p className="muted" style={{ fontSize: '12px', marginBottom: '0.6rem' }}>
                    Enter each child you want to register for lessons. A new box appears when you
                    fill the previous one.
                  </p>
                  {form.childrenNames.map((name, index) => (
                    <div className="field" key={`child-${index}`} style={{ marginBottom: '0.5rem' }}>
                      <input
                        value={name}
                        placeholder={`Child ${index + 1} full name`}
                        aria-label={`Child ${index + 1} full name`}
                        onChange={(e) => {
                          const value = e.target.value;
                          setForm((f) => {
                            const next = [...f.childrenNames];
                            next[index] = value;
                            // Keep one empty box after the last filled name.
                            const trimmed = next.map((n) => n.trim());
                            const lastFilled = trimmed.reduce(
                              (acc, n, i) => (n ? i : acc),
                              -1,
                            );
                            const kept = next.slice(0, Math.max(lastFilled + 1, 0));
                            if (!kept.length || kept[kept.length - 1].trim()) kept.push('');
                            return { ...f, childrenNames: kept };
                          });
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {isTeacher && (
            <>
              <div className={`recurring-toggle${form.isActive ? ' active' : ''}`}>
                <div
                  className="recurring-toggle-row"
                  onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
                >
                  <div className="recurring-toggle-label">
                    <strong>Active</strong>
                    <span>
                      {form.isActive
                        ? 'Your schedule is listed on the studio page.'
                        : 'You are hidden from the studio page. Your profile and dashboard still work.'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`switch${form.isActive ? ' on' : ''}`}
                    aria-pressed={form.isActive}
                    aria-label="Toggle studio listing"
                  />
                </div>
              </div>
              <div className={`recurring-toggle${form.canBookAsStudent ? ' active' : ''}`}>
                <div
                  className="recurring-toggle-row"
                  onClick={() =>
                    setForm((f) => ({ ...f, canBookAsStudent: !f.canBookAsStudent }))
                  }
                >
                  <div className="recurring-toggle-label">
                    <strong>Student as well?</strong>
                    <span>
                      {form.canBookAsStudent
                        ? "You can book lessons on other teachers' schedules."
                        : 'Turn on to book lessons with other instructors.'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`switch${form.canBookAsStudent ? ' on' : ''}`}
                    aria-pressed={form.canBookAsStudent}
                    aria-label="Toggle student booking access"
                  />
                </div>
              </div>
              <div className={`recurring-toggle${form.receiveEmails ? ' active' : ''}`}>
                <div
                  className="recurring-toggle-row"
                  onClick={() => setForm((f) => ({ ...f, receiveEmails: !f.receiveEmails }))}
                >
                  <div className="recurring-toggle-label">
                    <strong>Receive emails?</strong>
                    <span>Daily morning schedule emails</span>
                  </div>
                  <button
                    type="button"
                    className={`switch${form.receiveEmails ? ' on' : ''}`}
                    aria-pressed={form.receiveEmails}
                    aria-label="Toggle email notifications"
                  />
                </div>
              </div>
              <div className="field">
                <label>Studio</label>
                <p className="muted" style={{ fontSize: '12px', marginBottom: '6px' }}>
                  You can only be listed at one studio at a time.
                </p>
                <select value={form.studioId} onChange={update('studioId')} required>
                  <option value="">Select a studio…</option>
                  {(studiosQuery.data?.studios || []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Short bio (optional)</label>
                <textarea rows={3} value={form.bio} onChange={update('bio')} />
              </div>
              <div className="row" style={{ gap: '0.75rem' }}>
                <div className="field" style={{ flex: 1 }}>
                  <label>Default price ($)</label>
                  <input type="number" min="0" value={form.defaultPrice} onChange={update('defaultPrice')} />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Lesson length (min)</label>
                  <input
                    type="number"
                    min="5"
                    value={form.defaultDurationMin}
                    onChange={update('defaultDurationMin')}
                  />
                </div>
              </div>
              <div className={`recurring-toggle${form.trackPayments ? ' active' : ''}`}>
                <div
                  className="recurring-toggle-row"
                  onClick={() => setForm((f) => ({ ...f, trackPayments: !f.trackPayments }))}
                >
                  <div className="recurring-toggle-label">
                    <strong>Track payments</strong>
                    <span>Let you and your students mark lessons as paid</span>
                  </div>
                  <button
                    type="button"
                    className={`switch${form.trackPayments ? ' on' : ''}`}
                    aria-pressed={form.trackPayments}
                    aria-label="Toggle payment tracking"
                  />
                </div>
              </div>
            </>
          )}

          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      )}

      {!loading && (!isTeacher || user.canBookAsStudent) && <PartnersPanel />}
    </div>
  );
}

function PartnersPanel() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [codeInput, setCodeInput] = useState('');
  const [removeTarget, setRemoveTarget] = useState(null);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const partnersQuery = useQuery({
    queryKey: ['my-partners'],
    queryFn: () => api('/students/me/partners'),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['my-partners'] });
    queryClient.invalidateQueries({ queryKey: ['my-lessons'] });
  };

  const addPartner = useMutation({
    mutationFn: (code) => api('/students/me/partners', { method: 'POST', body: { code } }),
    onSuccess: () => {
      toast('Partner added. You can each see the other’s lessons.');
      setCodeInput('');
      invalidate();
    },
    onError: (err) => toast(err.message),
  });

  const removePartner = useMutation({
    mutationFn: (id) => api(`/students/me/partners/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Partner removed.');
      setRemoveTarget(null);
      invalidate();
    },
    onError: (err) => toast(err.message),
  });

  const regenerate = useMutation({
    mutationFn: () => api('/students/me/partner-code/regenerate', { method: 'POST' }),
    onSuccess: () => {
      toast('New partner code created. The old code no longer works.');
      setConfirmRegen(false);
      invalidate();
    },
    onError: (err) => toast(err.message),
  });

  const copyCode = () => {
    const code = partnersQuery.data?.partnerCode;
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => toast('Partner code copied!'));
  };

  const data = partnersQuery.data;

  return (
    <div className="card" style={{ marginTop: '1.25rem' }}>
      <div className="section-title">Lesson partners</div>
      <p className="muted" style={{ fontSize: '13px', marginBottom: '0.9rem' }}>
        Share your code with another student so you can see each other’s lessons. When you book,
        you can choose which partner splits payment with you.
      </p>

      {partnersQuery.isLoading && <div className="loading">Loading…</div>}
      {partnersQuery.isError && <p className="error-text">{partnersQuery.error.message}</p>}

      {data && (
        <>
          <div className="field" style={{ marginBottom: '0.75rem' }}>
            <label>Your partner code</label>
            <div className="partner-code-row">
              <div className="partner-code">{data.partnerCode}</div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={copyCode}>
                Copy
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirmRegen(true)}
              >
                New code
              </button>
            </div>
          </div>

          <form
            className="partner-add"
            onSubmit={(e) => {
              e.preventDefault();
              const code = codeInput.trim();
              if (!code) return;
              addPartner.mutate(code);
            }}
          >
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <label htmlFor="partner-code-input">Add a partner</label>
              <input
                id="partner-code-input"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                placeholder="Enter their code"
                autoComplete="off"
                maxLength={16}
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={addPartner.isPending || !codeInput.trim()}
            >
              {addPartner.isPending ? 'Adding…' : 'Add'}
            </button>
          </form>

          <div className="section-title" style={{ marginTop: '1.1rem' }}>
            Linked partners
          </div>
          {data.partners.length === 0 ? (
            <p className="muted" style={{ fontSize: '14px' }}>
              No partners yet. Ask someone for their code, or share yours.
            </p>
          ) : (
            data.partners.map((p) => (
              <div className="list-row" key={p.id}>
                <div className="grow">{p.fullName}</div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setRemoveTarget(p)}
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </>
      )}

      {removeTarget && (
        <Modal
          title={`Remove ${removeTarget.fullName}?`}
          subtitle="You will no longer see each other’s lessons. Existing bookings are not cancelled."
          onClose={() => !removePartner.isPending && setRemoveTarget(null)}
        >
          <ModalOption
            label="Remove partner"
            description="Stops sharing lessons with this account."
            danger
            disabled={removePartner.isPending}
            onClick={() => removePartner.mutate(removeTarget.id)}
          />
          <ModalOption
            label="Keep partner"
            description="Close without changing anything."
            disabled={removePartner.isPending}
            onClick={() => setRemoveTarget(null)}
          />
        </Modal>
      )}

      {confirmRegen && (
        <Modal
          title="Create a new partner code?"
          subtitle="Your current code will stop working. Anyone who has not added you yet will need the new code."
          onClose={() => !regenerate.isPending && setConfirmRegen(false)}
        >
          <ModalOption
            label="Create new code"
            description="The old code can no longer be used to add you."
            danger
            disabled={regenerate.isPending}
            onClick={() => regenerate.mutate()}
          />
          <ModalOption
            label="Keep current code"
            description="Close without changing anything."
            disabled={regenerate.isPending}
            onClick={() => setConfirmRegen(false)}
          />
        </Modal>
      )}
    </div>
  );
}
