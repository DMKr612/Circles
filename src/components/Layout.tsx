// src/components/Layout.tsx
import { Link, Outlet, useLocation } from "react-router-dom";
import { Compass, MessageSquare, Users, Bell, User } from "lucide-react";

export default function Layout() {
  const location = useLocation();
  const active = location.pathname;

  // Helper to determine active state color
  const getLinkClass = (path: string) => 
    `flex flex-col items-center p-2 transition-colors ${
      active === path ? 'text-black' : 'text-gray-400 hover:text-gray-600'
    }`;

  return (
    <>
      {/* Main content wrapper */}
      <div className="pb-24"> {/* Increased padding so content is never hidden */}
        <Outlet />
      </div>

      {/* Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-[100] border-t border-gray-200 bg-white/90 backdrop-blur-lg safe-area-pb">
        <div className="mx-auto flex h-16 max-w-md items-center justify-around px-2">
          
          <Link to="/" className={getLinkClass('/')}>
            <Compass className="h-6 w-6" />
            <span className="text-[10px] font-medium">Browse</span>
          </Link>

          <Link to="/groups" className={getLinkClass('/groups')}>
            <Users className="h-6 w-6" />
            <span className="text-[10px] font-medium">My Groups</span>
          </Link>

          {/* Placeholder for future feature */}
          <div className="flex flex-col items-center p-2 text-gray-300">
             <MessageSquare className="h-6 w-6" />
             <span className="text-[10px] font-medium">Chats</span>
          </div>

          <Link to="/notifications" className={getLinkClass('/notifications')}>
            <Bell className="h-6 w-6" />
            <span className="text-[10px] font-medium">Activity</span>
          </Link>

          <Link to="/profile" className={getLinkClass('/profile')}>
            <User className="h-6 w-6" />
            <span className="text-[10px] font-medium">Profile</span>
          </Link>

        </div>
      </nav>
    </>
  );
}