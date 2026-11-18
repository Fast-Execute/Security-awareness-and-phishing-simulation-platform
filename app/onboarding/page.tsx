"use client";
import { FormEvent,useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabase/client";
export default function OnboardingPage(){
 const [name,setName]=useState("");const [accepted,setAccepted]=useState(false);const [message,setMessage]=useState("");const router=useRouter();
 async function submit(e:FormEvent){e.preventDefault();if(!accepted){setMessage("You must accept the acceptable-use terms.");return;}
  const {error}=await createClient().rpc("create_organization",{p_name:name.trim()}); if(error){setMessage(error.message);return;} router.push("/dashboard");router.refresh();
 }
 return <main style={{maxWidth:620,margin:"5rem auto",padding:"0 1rem"}}><h1>Organisation onboarding</h1><p>Simulations are limited to your own staff/contractors and require a verified sending domain.</p>
 <form onSubmit={submit} style={{display:"grid",gap:14}}><label>Organisation name<input required maxLength={200} value={name} onChange={e=>setName(e.target.value)} style={{display:"block",width:"100%",padding:10,marginTop:6}}/></label>
 <label><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/> I accept the acceptable-use terms and confirm this will only be used for authorised security-awareness simulations.</label><button>Create organisation</button></form>{message&&<p role="alert">{message}</p>}</main>;
}