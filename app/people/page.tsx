"use client";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";

type Org={id:string;name:string}; type Group={id:string;name:string}; type Target={id:string;email:string;full_name:string|null;department:string|null};

function parseCsv(text:string){
 const rows:string[][]=[]; let row:string[]=[]; let cell=""; let quote=false;
 for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];
  if(c==='"'&&quote&&n==='"'){cell+='"';i++;continue}
  if(c==='"'){quote=!quote;continue}
  if(c===','&&!quote){row.push(cell.trim());cell="";continue}
  if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&n==='\n')i++;row.push(cell.trim());cell="";if(row.some(Boolean))rows.push(row);row=[];continue}
  cell+=c;
 }
 if(cell||row.length){row.push(cell.trim());rows.push(row)}
 return rows;
}
export default function PeoplePage(){
 const [org,setOrg]=useState<Org|null>(null),[groups,setGroups]=useState<Group[]>([]),[targets,setTargets]=useState<Target[]>([]);
 const [groupName,setGroupName]=useState(""),[status,setStatus]=useState(""),[busy,setBusy]=useState(false);
 const supabase=createClient();
 async function load(){
  const {data:{user}}=await supabase.auth.getUser(); if(!user)return;
  const {data:m}=await supabase.from("org_members").select("org_id,organizations(id,name)").eq("user_id",user.id).limit(1).maybeSingle();
  if(!m)return; const o=(m as any).organizations as Org; setOrg(o);
  const [{data:g},{data:t}]=await Promise.all([
   supabase.from("groups").select("id,name").eq("org_id",o.id).order("name"),
   supabase.from("targets").select("id,email,full_name,department").eq("org_id",o.id).order("email")
  ]); setGroups(g||[]);setTargets(t||[]);
 }
 useEffect(()=>{load()},[]);
 async function addGroup(e:FormEvent){e.preventDefault();if(!org||!groupName.trim())return;setBusy(true);setStatus("");
  const {error}=await supabase.from("groups").insert({org_id:org.id,name:groupName.trim()});setBusy(false);
  setStatus(error?error.message:"Group created.");if(!error){setGroupName("");load()}
 }
 async function importCsv(e:ChangeEvent<HTMLInputElement>){
  const file=e.target.files?.[0];if(!file||!org)return;setBusy(true);setStatus("");
  const rows=parseCsv(await file.text()); if(rows.length<2){setStatus("CSV must contain a header and at least one row.");setBusy(false);return}
  const header=rows[0].map(x=>x.toLowerCase()); const ei=header.indexOf("email"); const ni=header.indexOf("full_name"); const di=header.indexOf("department");
  if(ei<0){setStatus("CSV needs an email column.");setBusy(false);return}
  const payload=rows.slice(1).map(r=>({org_id:org.id,email:(r[ei]||"").toLowerCase(),full_name:ni>=0?(r[ni]||null):null,department:di>=0?(r[di]||null):null})).filter(x=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x.email));
  if(!payload.length){setStatus("No valid email rows found.");setBusy(false);return}
  const {error}=await supabase.from("targets").upsert(payload,{onConflict:"org_id,email"});setBusy(false);
  setStatus(error?error.message:"Imported "+payload.length+" people.");if(!error)load();
 }
 return <main style={{maxWidth:1100,margin:"3rem auto",padding:"0 1rem"}}>
  <h1>People & Groups</h1><p>Manage simulation recipients. Only people in your organisation can be imported.</p>
  {status&&<p role="status">{status}</p>}
  <section style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24}}>
   <div><h2>Create group</h2><form onSubmit={addGroup} style={{display:"flex",gap:8}}><input value={groupName} onChange={e=>setGroupName(e.target.value)} placeholder="e.g. Finance" maxLength={200}/><button disabled={busy}>Add</button></form>
   <h3>Groups ({groups.length})</h3>{groups.map(g=><div key={g.id} style={{padding:8,borderBottom:"1px solid #ddd"}}>{g.name}</div>)}</div>
   <div><h2>Import people</h2><p style={{fontSize:14}}>CSV headers: <code>email,full_name,department</code></p><input type="file" accept=".csv,text/csv" onChange={importCsv} disabled={busy}/><h3>People ({targets.length})</h3>
   <div style={{maxHeight:420,overflow:"auto"}}>{targets.map(t=><div key={t.id} style={{padding:8,borderBottom:"1px solid #ddd"}}><strong>{t.full_name||t.email}</strong><div style={{fontSize:13,color:"#666"}}>{t.email}{t.department?" · "+t.department:""}</div></div>)}</div></div>
  </section>
 </main>
}