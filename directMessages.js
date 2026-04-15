import { supabase } from "./supabaseClient.js";

export async function sendDirectMessage(sender_id, receiver_id, message) {
  const { data, error } = await supabase
    .from("direct_messages")
    .insert([{ sender_id, receiver_id, message }])
    .select()
    .single();

  if (error) {
    console.error("sendDirectMessage error:", error);
    throw error;
  }

  return data;
}

export async function getDirectMessages(userA, userB) {
  const { data, error } = await supabase
    .from("direct_messages")
    .select("*")
    .or(
      `and(sender_id.eq.${userA},receiver_id.eq.${userB}),and(sender_id.eq.${userB},receiver_id.eq.${userA})`,
    )
    .order("created_at", { ascending: true });

  if (error) {
    console.error("getDirectMessages error:", error);
    throw error;
  }

  return data;
}
