import Home from './Home'
import Users from './Users'
import UserDetail from './UserDetail'
import Roles from './Roles'
import Branches from './Branches'
import Delegations from './Delegations'
import ResetRequests from './ResetRequests'
import Activity from './Activity'

// System admin dashboard: pages, sidebar entries and the permission each one needs.
export default {
  role: 'admin',
  pages: [
    { path: '', icon: 'home', label: { ar: 'نظرة عامة', en: 'Overview' }, element: <Home />, permission: 'users.view' },
    { path: 'users', icon: 'users', label: { ar: 'الموظفون', en: 'Staff' }, element: <Users />, permission: 'users.view' },
    { path: 'users/:id', nav: false, element: <UserDetail />, permission: 'users.view' },
    { path: 'roles', icon: 'shield', label: { ar: 'الأدوار والصلاحيات', en: 'Roles & permissions' }, element: <Roles />, permission: 'users.view' },
    { path: 'cover', icon: 'swap', label: { ar: 'التغطية المؤقتة', en: 'Temporary cover' }, element: <Delegations />, permission: 'users.view' },
    { path: 'resets', icon: 'inbox', label: { ar: 'طلبات الاستعادة', en: 'Reset requests' }, element: <ResetRequests />, permission: 'password_resets.manage' },
    { path: 'branches', icon: 'building', label: { ar: 'الفروع', en: 'Branches' }, element: <Branches />, permission: 'users.view' },
    { path: 'activity', icon: 'activity', label: { ar: 'سجل النشاط', en: 'Activity log' }, element: <Activity />, permission: 'audit.view' },
  ],
}
