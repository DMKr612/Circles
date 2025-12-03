import { Link, Outlet, useLocation } from "react-router-dom";
import { Compass, MessageSquare, Users, Bell, User } from "lucide-react";

export default function Layout() {
  const location = useLocation();
  const active = location.pathname;

  // Helper for styling:
  // - 'transition-transform duration-150': Smooth movement
  // - 'active:scale-90': The click animation (shrinks icon when pressed)
  const isActive = (path: string) =>
    active === path || active.startsWith(`${path}/`);

  const getLinkClass = (path: string) => 
    `flex flex-col items-center p-2 transition-transform duration-150 ease-in-out active:scale-90 ${
      isActive(path) ? 'text-black scale-105 font-semibold' : 'text-gray-400 hover:text-gray-600'
    }`;

  return (
    <>
      {/* Main content wrapper */}
      <div className="pb-32"> 
        <Outlet />
      </div>

      {/* Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-[100] border-t border-gray-200 bg-white/95 backdrop-blur-lg pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex h-16 max-w-md items-center justify-around px-2">
          
          {/* 1. Chats (Left) */}
          <Link to="/chats" className={getLinkClass('/chats')}>
             <MessageSquare className="h-6 w-6" />
             <span className="text-[10px] font-medium">Chats</span>
          </Link>

          {/* 2. My Groups */}
          <Link to="/groups" className={getLinkClass('/groups')}>
            <Users className="h-6 w-6" />
            <span className="text-[10px] font-medium">Groups</span>
          </Link>

          {/* 3. Browse (Center - Featured) */}
          <Link to="/browse" className={getLinkClass('/browse')}>
            <div className={`rounded-full p-1 -mt-1 transition-colors ${isActive('/browse') ? 'bg-gray-100' : ''}`}>
                <Compass className="h-7 w-7" /> 
            </div>
            <span className="text-[10px] font-medium">Browse</span>
          </Link>

          {/* 4. Activity */}
          <Link to="/notifications" className={getLinkClass('/notifications')}>
            <Bell className="h-6 w-6" />
            <span className="text-[10px] font-medium">Activity</span>
          </Link>

          {/* 5. Profile */}
          <Link to="/profile" className={getLinkClass('/profile')}>
            <User className="h-6 w-6" />
            <span className="text-[10px] font-medium">Profile</span>
          </Link>

        </div>
      </nav>
    </>
  );
}
