import { supabase } from "@/lib/supabase";

// ---- Groups
export async function fetchGroups() {
  const { data, error } = await supabase
    .from("groups")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function fetchGroup(id: string) {
  const { data, error } = await supabase
    .from("groups")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function createGroup(payload: Record<string, unknown>) {
  const { data, error } = await supabase.from("groups").insert(payload).select("*").single();
  if (error) throw error;
  return data;
}

// ---- Messages
export async function fetchMessages(groupId: string) {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function sendMessage(payload: Record<string, unknown>) {
  const { data, error } = await supabase.from("messages").insert(payload).select("*").single();
  if (error) throw error;
  return data;
}