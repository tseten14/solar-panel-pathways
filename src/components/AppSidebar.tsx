import { LayoutDashboard, Map, ArrowRightLeft, Brain, Database, Sun } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Landfill Map", url: "/map", icon: Map },
  { title: "Trade Flows", url: "/trade-flows", icon: ArrowRightLeft },
  { title: "ML Predictions", url: "/predictions", icon: Brain },
  { title: "Data Table", url: "/data", icon: Database },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className={`flex items-center gap-2 px-4 py-5 border-b border-border/50 ${collapsed ? "justify-center" : ""}`}>
          <Sun className="h-6 w-6 text-primary shrink-0" />
          {!collapsed && (
            <span className="text-lg font-bold tracking-tight text-foreground">
              Solar<span className="text-primary">Trace</span>
            </span>
          )}
        </div>

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className="hover:bg-sidebar-accent/50"
                      activeClassName="bg-sidebar-accent text-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {!collapsed && (
          <div className="mt-auto px-4 py-4 border-t border-border/50">
            <p className="text-xs text-muted-foreground">NREL Research Tool</p>
            <p className="text-xs text-muted-foreground">v1.0.0 — Mock Data</p>
          </div>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
