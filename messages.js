import { supabase } from "./supabaseClient.js";

export async function sendMessage(username, message) {
  const { data, error } = await supabase
    .from("messages")
    .insert([{ username, message }])
    .select()
    .single();

  if (error) {
    console.error("sendMessage error:", error);
    throw error;
  }

  return data;
}

export async function getMessages() {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("getMessages error:", error);
    throw error;
  }

  return data;
}
