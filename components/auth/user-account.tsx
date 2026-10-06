"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, UserRound } from "lucide-react";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { getSupabaseBrowser } from "@/lib/persistence/supabase-browser";

export function UserAccount() {
  const router = useRouter();
  const [email, setEmail] = useState("Signed in");
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setEmail(data.user.email);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.email) setEmail(session.user.email);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    setSigningOut(true);
    await getSupabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton tooltip={email} className="cursor-default">
          <UserRound />
          <span className="truncate">{email}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip="Sign out"
          onClick={signOut}
          disabled={signingOut}
        >
          <LogOut />
          <span>{signingOut ? "Signing out…" : "Sign out"}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
