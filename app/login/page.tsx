"use client";
import { FormEvent, useState } from "react";
import { createClient } from "../../lib/supabase/client";
export default function LoginPage() {
  const [email,setEmail]=useState(""); const [message,setMessage]=useState(""); const [busy,setBusy]=useState(false);
  async function submit(e:FormEvent){e.preventDefault();setBusy(true);const supabase=createClient();
    const {error}=await supabase.auth.signInWithOtp({email:email.trim(),options:{emailRedirectTo:window.location.origin+"/auth/callback"}});
    setBusy(false);setMessage(error?error.message:"Check your email for the secure sign-in link.");
  }
  return <main style={{maxWidth:460,margin:"7rem auto",padding:"0 1rem"}}>
    <h1>Security Awareness Platform</h1><p>Admin sign-in. Only authorised organisations can run simulations.</p>
    <form onSubmit={submit} style={{display:"grid",gap:12}}>
      <label>Work email<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} style={{display:"block",width:"100%",padding:10,marginTop:6}}/></label>
      <button disabled={busy}>{busy?"Sending…":"Send secure sign-in link"}</button>
    </form>{message&&<p role="status">{message}</p>}
    <p style={{color:"#666",fontSize:13}}>Safeguards: verified sending domain, fictional templates, no credential capture.</p>
  </main>;
}