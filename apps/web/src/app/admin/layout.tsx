import { NavLink } from "@/components/nav-link";
import { AppMark, Avatar, Wordmark } from "@/components/ui";
import type { IconName } from "@/components/icons";
import { requireStaff } from "@/lib/auth";
import { titleCase } from "@/lib/format";

type Item = { href: string; label: string; icon: IconName; exact?: boolean; admin?: boolean };

const sections: { title: string; items: Item[] }[] = [
  {
    title: "Coaching",
    items: [
      { href: "/admin", label: "Dashboard", icon: "dashboard", exact: true },
      { href: "/admin/programming", label: "Programming", icon: "columns" },
      { href: "/admin/exercises", label: "Exercise Library", icon: "dumbbell" },
      { href: "/admin/schedule", label: "Classes", icon: "calendar" },
      { href: "/admin/members", label: "Athletes", icon: "people" },
      { href: "/admin/programs", label: "Online Programs", icon: "run" },
    ],
  },
  {
    title: "Business",
    items: [
      { href: "/admin/memberships", label: "Memberships", icon: "card", admin: true },
      { href: "/admin/reports", label: "Revenue", icon: "cash", admin: true },
      { href: "/admin/plans", label: "Plans & Settings", icon: "settings", admin: true },
      { href: "/admin/activity", label: "Activity", icon: "clock", admin: true },
    ],
  },
  {
    title: "Facility",
    items: [
      { href: "/admin/display", label: "Displays", icon: "display" },
      { href: "/admin/checkin", label: "Check-in", icon: "qr" },
    ],
  },
];

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const viewer = await requireStaff();
  const name = viewer.profile?.full_name || viewer.user.email || "";
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-line bg-chrome md:sticky md:top-0 md:h-screen md:w-[248px] md:border-b-0 md:border-r">
        <div className="flex items-center gap-3 px-5 pb-4 pt-6">
          <AppMark size={32} />
          <div className="min-w-0">
            <Wordmark size={15} />
            <p className="truncate text-[13px] text-muted">{viewer.gym.name}</p>
          </div>
        </div>
        <nav className="flex gap-4 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:gap-5 md:overflow-y-auto md:overflow-x-visible">
          {sections.map((section) => {
            const items = section.items.filter((item) => !item.admin || viewer.isAdmin);
            if (!items.length) return null;
            return (
              <div key={section.title} className="flex gap-1 md:flex-col">
                <p className="hidden px-3 pb-1 text-xs font-semibold uppercase tracking-[0.6px] text-muted md:block">{section.title}</p>
                {items.map((item) => <NavLink key={item.href} {...item} />)}
              </div>
            );
          })}
        </nav>
        <div className="hidden p-3 md:block">
          <div className="flex items-center gap-3 rounded-2xl bg-surface p-2.5">
            <Avatar name={name} size={34} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold leading-tight">{name}</p>
              <p className="text-xs text-muted">{viewer.role ? titleCase(viewer.role) : ""}</p>
            </div>
            <form action="/auth/signout" method="post">
              <button className="rounded-full px-2 py-1 text-xs text-muted hover:bg-fill hover:text-ink">Sign out</button>
            </form>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-5 py-6 md:px-8">{children}</main>
    </div>
  );
}
