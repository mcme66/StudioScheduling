import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import DashboardTab from '../components/owner/DashboardTab.jsx';
import StudentsTab from '../components/owner/StudentsTab.jsx';
import CoachesTab from '../components/owner/CoachesTab.jsx';
import ScheduleTab from '../components/owner/ScheduleTab.jsx';
import FeesTab from '../components/owner/FeesTab.jsx';
import StudioTab from '../components/owner/StudioTab.jsx';

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'students', label: 'Students' },
  { id: 'coaches', label: 'Coaches' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'fees', label: 'Floor fees' },
  { id: 'studio', label: 'Studio' },
];

const SUBTITLES = {
  dashboard: 'Lessons, floor fees, and who is training here.',
  students: 'Mark lesson takers as studio students, and deactivate people who no longer train here.',
  coaches: 'Lessons and floor fees for each coach, through today.',
  schedule: 'Rooms and the weekly class timetable on the public studio page.',
  fees: 'Guest and studio-student rates, and the fees you expect to collect.',
  studio: 'The name and description students see when they browse studios.',
};

export default function OwnerDashboard() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab = TABS.some((t) => t.id === requested) ? requested : 'dashboard';

  const studioQuery = useQuery({
    queryKey: ['owner-studio'],
    queryFn: () => api('/owner/studio'),
  });
  const data = studioQuery.data;

  return (
    <div className="container owner-page">
      <h1 className="page-title">{data?.studio?.name || 'Your studio'}</h1>
      <p className="page-sub">{SUBTITLES[tab]}</p>

      <div className="owner-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`owner-tab${tab === t.id ? ' on' : ''}`}
            onClick={() => setParams(t.id === 'dashboard' ? {} : { tab: t.id }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>

      {studioQuery.isLoading && <div className="loading">Loading studio…</div>}
      {studioQuery.isError && <p className="error-text">{studioQuery.error.message}</p>}

      {data && tab === 'dashboard' && <DashboardTab />}
      {data && tab === 'students' && <StudentsTab />}
      {data && tab === 'coaches' && <CoachesTab />}
      {data && tab === 'schedule' && <ScheduleTab data={data} />}
      {data && tab === 'fees' && <FeesTab studio={data.studio} teachers={data.teachers} />}
      {data && tab === 'studio' && <StudioTab data={data} />}
    </div>
  );
}
