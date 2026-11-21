import {
  Building2,
  Calendar,
  ClipboardList,
  CreditCard,
  KeyRound,
  LayoutDashboard,
  Receipt,
  Share2,
  UserCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { NavIconKey } from "@/lib/nav/nav-for-role";

/** The lucide icon per destination (06-UI-SPEC: stroke 1.75, `currentColor`; v1 glyphs kept where v1 had one). */
const ICONS: Record<NavIconKey, LucideIcon> = {
  today: LayoutDashboard,
  calendar: Calendar,
  patients: Users,
  billing: CreditCard,
  visits: ClipboardList,
  referrals: Share2,
  staff: UserCheck,
  clinic: Building2,
  subscription: Receipt,
  developer: KeyRound,
};

export function NavIcon({ icon, className, strokeWidth = 1.75 }: { icon: NavIconKey; className?: string; strokeWidth?: number }) {
  const Icon = ICONS[icon];
  return <Icon aria-hidden="true" className={className} strokeWidth={strokeWidth} />;
}
