import Link from "next/link";
import { useRouter } from "next/router";
import { BarChart3, CalendarRange, Home, LineChart } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/stock/us", label: "US Stocks", icon: LineChart },
  { href: "/stock/tr", label: "TR Stocks", icon: LineChart },
  { href: "/cumulative-yields", label: "Cumulative Yields", icon: BarChart3 },
  { href: "/yoy-yields", label: "YoY Yields", icon: CalendarRange },
] as const;

export function AppSidebar() {
  const router = useRouter();

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="px-2 py-1 text-sm font-semibold">EOT</div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigate</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                const isActive =
                  router.asPath === href ||
                  (href !== "/" && router.asPath.startsWith(`${href}/`));
                return (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={href}>
                        <Icon />
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
