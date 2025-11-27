import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// 1. Define the shape of your profile data
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

// 2. The Hook
export function useProfile(userId: string | null) {
  return useQuery({
    // Unique key for caching: ['profile', 'user-123']
    queryKey: ["profile", userId],
    
    // Only run this query if we have a userId
    enabled: !!userId,

    // The fetch function
    queryFn: async (): Promise<ProfileData> => {
      if (!userId) throw new Error("No user ID");

      // Run fetches in parallel
      const [prof, created, joined] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", userId).single(),
        supabase.from("group_members").select("group_id", { count: "exact", head: true }).eq("user_id", userId).in("role", ["owner", "host"]).eq("status", "active"),
        supabase.from("group_members").select("group_id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "active"),
      ]);

      if (prof.error) throw prof.error;

      return {
        id: userId,
        name: prof.data.name || "",
        avatar_url: prof.data.avatar_url,
        city: prof.data.city,
        rating_avg: prof.data.rating_avg || 0,
        rating_count: prof.data.rating_count || 0,
        groups_created: created.count || 0,
        groups_joined: joined.count || 0,
      };
    },
  });
}

// 3. Mutation (Example: Update Profile)
export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, updates }: { userId: string; updates: any }) => {
      const { error } = await supabase.from("profiles").update(updates).eq("user_id", userId);
      if (error) throw error;
    },
    // When successful, tell React Query to refresh the data automatically
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["profile", variables.userId] });
    },
  });
}