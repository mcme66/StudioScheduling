import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import ScheduleInfoPanel from '../components/ScheduleInfoPanel.jsx';
import TeacherDashboard from './TeacherDashboard.jsx';

function BioCard({ teacherId, bio, onSaved }) {
  const toast = useToast();
  const [draft, setDraft] = useState(bio || '');

  useEffect(() => {
    setDraft(bio || '');
  }, [bio]);

  const save = useMutation({
    mutationFn: () =>
      api(`/owner/teachers/${teacherId}/profile`, { method: 'PATCH', body: { bio: draft.trim() } }),
    onSuccess: () => {
      toast('Saved.');
      onSaved();
    },
    onError: (err) => toast(err.message),
  });

  return (
    <div className="card">
      <div className="section-title">Bio</div>
      <textarea
        className="coach-bio-input"
        rows={6}
        maxLength={1000}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="A short introduction students see on the studio page."
      />
      <button
        type="button"
        className="btn btn-primary btn-sm"
        style={{ marginTop: '0.75rem' }}
        disabled={draft.trim() === (bio || '') || save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

function CoachProfileCards({ teacherId }) {
  const queryClient = useQueryClient();
  const profileKey = ['owner-coach-profile', teacherId];
  const profileQuery = useQuery({
    queryKey: profileKey,
    queryFn: () => api(`/owner/teachers/${teacherId}/profile`),
  });
  const profile = profileQuery.data?.profile;
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: profileKey });
    queryClient.invalidateQueries({ queryKey: ['owner-studio'] });
  };
  const saveUrl = `/owner/teachers/${teacherId}/profile`;

  if (profileQuery.isLoading) return <div className="loading">Loading profile…</div>;
  if (profileQuery.isError) return <p className="error-text">{profileQuery.error.message}</p>;

  return (
    <div className="owner-coach-profile">
      <BioCard teacherId={teacherId} bio={profile?.bio} onSaved={refresh} />
      <ScheduleInfoPanel
        title="Additional Information"
        field="additionalInfo"
        html={profile?.additionalInfo}
        editable
        saveUrl={saveUrl}
        className="card"
        onSaved={refresh}
      />
      <ScheduleInfoPanel
        title="Teaching Policies"
        field="teachingPolicies"
        html={profile?.teachingPolicies}
        editable
        saveUrl={saveUrl}
        className="card"
        onSaved={refresh}
      />
    </div>
  );
}

export default function OwnerCoachSchedule() {
  const { teacherId } = useParams();
  const id = Number(teacherId);
  const studioQuery = useQuery({
    queryKey: ['owner-studio'],
    queryFn: () => api('/owner/studio'),
  });
  const teacher = (studioQuery.data?.teachers || []).find((t) => t.id === id);

  if (studioQuery.isLoading) {
    return (
      <div className="container">
        <div className="loading">Loading…</div>
      </div>
    );
  }
  if (!teacher) {
    return (
      <div className="container">
        <h1 className="page-title">Coach not found</h1>
        <Link to="/owner">← Studio</Link>
      </div>
    );
  }
  if (!teacher.ownerManaged) {
    return (
      <div className="container">
        <p style={{ marginTop: 0 }}>
          <Link to="/owner">← Studio</Link>
        </p>
        <h1 className="page-title">{teacher.fullName}</h1>
        <p className="page-sub">Turn on Manage for this coach before editing their schedule.</p>
      </div>
    );
  }
  return (
    <>
      <TeacherDashboard ownerTeacher={teacher} />
      <div className="container">
        <CoachProfileCards teacherId={teacher.id} />
      </div>
    </>
  );
}
