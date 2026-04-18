import { useState, useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { LayoutDashboard, Library, Clapperboard, Tv, Tag, Users, ShieldCheck, KeyRound } from 'lucide-react'
import './AdminLayout.css'

const NAV = [
  { to: '/admin',          label: 'Dashboard',  icon: LayoutDashboard, end: true },
  { to: '/admin/library',  label: 'Library',    icon: Library },
  { to: '/admin/movies',   label: 'Movies',     icon: Clapperboard },
  { to: '/admin/tvshows',  label: 'TV Shows',   icon: Tv },
  { to: '/admin/genres',   label: 'Genres',     icon: Tag },
  { to: '/admin/users',    label: 'Users',      icon: Users },
  { to: '/admin/sessions', label: 'Sessions',   icon: KeyRound },
]

export default function AdminLayout() {
  const location = useLocation()
  const currentPage = NAV.find(n => n.end ? location.pathname === n.to : location.pathname.startsWith(n.to))

  return (
    <div className="admin-layout page-layout">
      {/* Mobile Header — shows current section title */}
      <div className="admin-mobile-header">
        <span className="admin-mobile-title">
          {currentPage && <currentPage.icon size={20} />} {currentPage?.label || 'Admin'}
        </span>
        <span className="admin-badge"><ShieldCheck size={14} /> Admin</span>
      </div>

      {/* Desktop sidebar */}
      <aside className="admin-sidebar glass">
        <div className="admin-sidebar-header">
          <span className="admin-badge"><ShieldCheck size={14} /> Admin Panel</span>
        </div>
        <nav className="admin-nav">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `admin-nav-link ${isActive ? 'active' : ''}`
              }
            >
              <Icon className="admin-nav-icon" size={20} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <div className="admin-main page-content">
        <Outlet />
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="admin-bottom-nav">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `admin-bottom-tab ${isActive ? 'active' : ''}`
            }
          >
            <Icon size={20} className="admin-bottom-icon" />
            <span className="admin-bottom-label">{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
