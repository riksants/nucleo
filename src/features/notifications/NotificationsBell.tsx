import { Bell } from 'lucide-react'
import { navigate } from '../../app/router'
import { IconButton } from '../../ui/Button'
import { unreadCount, useFeedVersion } from './feed'

/** Bell with the number of unread notifications (opens the center). */
export function NotificationsBell({ className = '' }: { className?: string }) {
  useFeedVersion()
  const n = unreadCount()
  return (
    <IconButton label={n ? `Notificações: ${n} não ${n === 1 ? 'lida' : 'lidas'}` : 'Notificações'} className={`relative ${className}`} onClick={() => navigate('/notifications')}>
      <Bell size={24} />
      {n > 0 && (
        <span className="num absolute top-1 right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-coal px-1 text-[11px] leading-none font-semibold text-paper">{n > 99 ? '99+' : n}</span>
      )}
    </IconButton>
  )
}

/** For lists (side menu): just the count. */
export function useUnreadNotifications(): number {
  useFeedVersion()
  return unreadCount()
}
