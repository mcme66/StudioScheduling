import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import RequireAuth from './components/RequireAuth.jsx';
import StudioList from './pages/StudioList.jsx';
import StudioDetail from './pages/StudioDetail.jsx';
import InstructorSchedule from './pages/InstructorSchedule.jsx';
import MyLessons from './pages/MyLessons.jsx';
import TeacherDashboard from './pages/TeacherDashboard.jsx';
import TeacherLogin from './pages/TeacherLogin.jsx';
import StudentLogin from './pages/StudentLogin.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import TeacherRegister from './pages/TeacherRegister.jsx';
import StudentRegister from './pages/StudentRegister.jsx';
import Profile from './pages/Profile.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<StudioList />} />
        <Route path="/studios/:slug" element={<StudioDetail />} />
        <Route path="/studios/:slug/book/:teacherId" element={<InstructorSchedule />} />

        <Route path="/teacher/login" element={<TeacherLogin />} />
        <Route path="/teacher/register" element={<TeacherRegister />} />
        <Route path="/teacher/forgot-password" element={<ForgotPassword />} />
        <Route path="/teacher/reset-password" element={<ResetPassword />} />
        <Route path="/student/login" element={<StudentLogin />} />
        <Route path="/student/register" element={<StudentRegister />} />
        <Route path="/student/forgot-password" element={<ForgotPassword />} />
        <Route path="/student/reset-password" element={<ResetPassword />} />

        <Route
          path="/my-lessons"
          element={
            <RequireAuth role="student">
              <MyLessons />
            </RequireAuth>
          }
        />

        <Route
          path="/teacher"
          element={
            <RequireAuth role="teacher">
              <TeacherDashboard />
            </RequireAuth>
          }
        />

        <Route
          path="/profile"
          element={
            <RequireAuth>
              <Profile />
            </RequireAuth>
          }
        />

        {/* Legacy redirects */}
        <Route path="/login" element={<Navigate to="/student/login" replace />} />
        <Route path="/register" element={<Navigate to="/student/register" replace />} />
        <Route path="/book/:teacherId" element={<Navigate to="/" replace />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
