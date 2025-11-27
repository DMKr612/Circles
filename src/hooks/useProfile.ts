import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

export type ProfileData = {
  id: string;
  name: string;
  avatar_url: string | null;
  city: string | null;
  rating_avg: number;
  rating_count: number;
  groups_created: number;
  groups_joined: number;
};

export function useProfile(userId: string | null) {
  return useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId,
    queryFn: async (): Promise<ProfileData> => {
      if (!userId) throw new Error("No user ID");

      const [prof, created, joined] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", userId).single(),
        supabase
          .from("group_members")
          .select("group_id", { count: "exact", head: true })
          .eq("user_id", userId)
          .in("role", ["owner", "host"])
          .eq("status", "active"),
        supabase
          .from("group_members")
          .select("group_id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("status", "active"),
      ]);

      if (prof.error) throw prof.error;
      const pData = prof.data;
      if (!pData) throw new Error("Profile not found");

      return {
        id: userId,
        name: pData.name || "",
        avatar_url: pData.avatar_url,
        city: pData.city,
        rating_avg: pData.rating_avg || 0,
        rating_count: pData.rating_count || 0,
        groups_created: created.count || 0,
        groups_joined: joined.count || 0,
      };
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, updates }: { userId: string; updates: any }) => {
      const { error } = await supabase.from("profiles").update(updates).eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["profile", variables.userId] });
    },
  });
}