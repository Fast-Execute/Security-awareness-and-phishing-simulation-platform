"use client";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "../../lib/supabase/client";

type Org={id:string;name:string};
type Group={id:string;name:string};
type Target={id:string;email:string;full_name:string|null;department:string|null};

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
 const [selectedGroupId,setSelectedGroupId]=useState("");
 const [savedMemberIds,setSavedMemberIds]=useState<string[]>([]);
 const [memberIds,setMemberIds]=useState<string[]>([]);
 const [loadingMembers,setLoadingMembers]=useState(false);
 const supabase=createClient();

 async function load(){
  const {data:{user}}=await supabase.auth.getUser(); if(!user)return;
  const {data:m}=await supabase.from("org_members").select("org_id,organizations(id,name)").eq("user_id",user.id).limit(1).maybeSingle();
  if(!m)return; const o=(m as any).organizations as Org; setOrg(o);
  const [{data:g},{data:t}]=await Promise.all([
   supabase.from("groups").select("id,name").eq("org_id",o.id).order("name"),
   supabase.from("targets").select("id,email,full_name,department").eq("org_id",o.id).order("email")
  ]);
  setGroups(g||[]);setTargets(t||[]);
  if(!selectedGroupId && g?.length)setSelectedGroupId(g[0].id);
 }
 useEffect(()=>{load()},[]);

 useEffect(()=>{
  let active=true;
  async function loadMembers(){
   if(!selectedGroupId){setSavedMemberIds([]);setMemberIds([]);return}
   setLoadingMembers(true);
   const {data,error}=await supabase.from("group_targets").select("target_id").eq("group_id",selectedGroupId);
   if(!active)return;
   if(error){setStatus("Could not load group membership: "+error.message);setLoadingMembers(false);return}
   const ids=(data||[]).map(x=>x.target_id);
   setSavedMemberIds(ids);setMemberIds(ids);setLoadingMembers(false);
  }
  loadMembers();
  return ()=>{active=false};
 },[selectedGroupId]);

 const selectedGroup=groups.find(g=>g.id===selectedGroupId)||null;
 const changed=useMemo(()=>{
  const saved=new Set(savedMemberIds),current=new Set(memberIds);
  return {add:memberIds.filter(id=>!saved.has(id)),remove:savedMemberIds.filter(id=>!current.has(id))};
 },[savedMemberIds,memberIds]);

 async function addGroup(e:FormEvent){
  e.preventDefault();if(!org||!groupName.trim())return;setBusy(true);setStatus("");
  const {data,error}=await supabase.from("groups").insert({org_id:org.id,name:groupName.trim()}).select("id,name").single();
  setBusy(false);if(error){setStatus(error.message);return}
  setGroups(prev=>[...prev,data].sort((a,b)=>a.name.localeCompare(b.name)));
  setGroupName("");setSelectedGroupId(data.id);setStatus("Group created. Add people to it below.");
 }

 async function importCsv(e:ChangeEvent<HTMLInputElement>){
  const file=e.target.files?.[0];if(!file||!org)return;setBusy(true);setStatus("");
  const rows=parseCsv(await file.text()); if(rows.length<2){setStatus("CSV must contain a header and at least one row.");setBusy(false);return}
  const header=rows[0].map(x=>x.toLowerCase()); const ei=header.indexOf("email"); const ni=header.indexOf("full_name"); const di=header.indexOf("department");
  if(ei<0){setStatus("CSV needs an email column.");setBusy(false);return}
  const payload=rows.slice(1).map(r=>({org_id:org.id,email:(r[ei]||"").toLowerCase(),full_name:ni>=0?(r[ni]||null):null,department:di>=0?(r[di]||null):null})).filter(x=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x.email));
  if(!payload.length){setStatus("No valid email rows found.");setBusy(false);return}
  const {error}=await supabase.from("targets").upsert(payload,{onConflict:"org_id,email"});setBusy(false);
  setStatus(error?error.message:"Imported "+payload.length+" people. Select a group and assign them below.");if(!error)load();
  e.target.value="";
 }

 async function saveMembership(){
  if(!selectedGroupId)return;
  setBusy(true);setStatus("");
  let message="";
  if(changed.add.length){
   const {error}=await supabase.from("group_targets").insert(changed.add.map(target_id=>({group_id:selectedGroupId,target_id})));
   if(error){setBusy(false);setStatus("Could not add members: "+error.message);return}
  }
  if(changed.remove.length){
   const {error}=await supabase.from("group_targets").delete().eq("group_id",selectedGroupId).in("target_id",changed.remove);
   if(error){setBusy(false);setStatus("Some additions were saved, but removals failed: "+error.message+" Reload the group before retrying.");return}
  }
  setSavedMemberIds(memberIds);setBusy(false);
  message="Group membership saved: "+memberIds.length+" member(s).";
  setStatus(message);
 }

 function toggleMember(id:string,checked:boolean){
  setMemberIds(prev=>checked?[...prev,id]:prev.filter(x=>x!==id));
 }

 return <main style={{maxWidth:1200,margin:"3rem auto",padding:"0 1rem"}}>
  <header style={{display:"flex",justifyContent:"space-between",gap:16,flexWrap:"wrap",alignItems:"center"}}>
   <div><h1>People & Groups</h1><p>Import staff, create audiences and manage group membership.</p></div>
   <nav style={{display:"flex",gap:14}}><a href="/dashboard">Dashboard</a><a href="/campaigns">Campaign builder</a><a href="/campaigns/results">Campaign results</a></nav>
  </header>
  {status&&<p role="status" style={{padding:12,border:"1px solid #ddd",borderRadius:8}}>{status}</p>}
  <section style={{display:"grid",gridTemplateColumns:"minmax(260px,0.8fr) minmax(360px,1.2fr)",gap:24,alignItems:"start"}}>
   <div>
    <section style={{border:"1px solid #ddd",borderRadius:10,padding:16}}>
     <h2 style={{marginTop:0}}>Create group</h2>
     <form onSubmit={addGroup} style={{display:"flex",gap:8}}>
      <input value={groupName} onChange={e=>setGroupName(e.target.value)} placeholder="e.g. Finance" maxLength={200} style={{minWidth:0,flex:1}}/>
      <button disabled={busy||!groupName.trim()}>Add</button>
     </form>
     <h3>Groups ({groups.length})</h3>
     {groups.length?groups.map(g=><button key={g.id} onClick={()=>setSelectedGroupId(g.id)} style={{display:"block",width:"100%",textAlign:"left",padding:10,marginBottom:6,border:"1px solid "+(selectedGroupId===g.id?"#555":"#ddd"),borderRadius:7,background:selectedGroupId===g.id?"#f3f3f3":"white",color:"#111"}}>{g.name}{selectedGroupId===g.id?" · selected":""}</button>):<p>No groups yet.</p>}
    </section>
    <section style={{border:"1px solid #ddd",borderRadius:10,padding:16,marginTop:16}}>
     <h2 style={{marginTop:0}}>Import people</h2>
     <p style={{fontSize:14}}>CSV headers: <code>email,full_name,department</code></p>
     <input type="file" accept=".csv,text/csv" onChange={importCsv} disabled={busy}/>
     <h3>People ({targets.length})</h3>
     <div style={{maxHeight:360,overflow:"auto"}}>{targets.map(t=><div key={t.id} style={{padding:8,borderBottom:"1px solid #eee"}}><strong>{t.full_name||t.email}</strong><div style={{fontSize:13,color:"#666"}}>{t.email}{t.department?" · "+t.department:""}</div></div>)}</div>
    </section>
   </div>
   <section style={{border:"1px solid #ddd",borderRadius:10,padding:16}}>
    <h2 style={{marginTop:0}}>Group membership</h2>
    {!selectedGroup?<p>Create a group first, then assign people to it.</p>:<>
     <p><strong>{selectedGroup.name}</strong> · {memberIds.length} selected of {targets.length} people</p>
     <p style={{fontSize:14,color:"#666"}}>Tick the people who belong in this group, then save. A person can belong to more than one group.</p>
     <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
      <button type="button" onClick={()=>setMemberIds(targets.map(t=>t.id))} disabled={busy||loadingMembers||!targets.length}>Select all</button>
      <button type="button" onClick={()=>setMemberIds([])} disabled={busy||loadingMembers||!memberIds.length}>Clear selection</button>
     </div>
     <div style={{maxHeight:520,overflow:"auto",border:"1px solid #eee",borderRadius:8}}>
      {loadingMembers?<p style={{padding:16}}>Loading membership…</p>:targets.length?targets.map(t=><label key={t.id} style={{display:"flex",gap:10,alignItems:"flex-start",padding:11,borderBottom:"1px solid #eee",cursor:"pointer"}}>
       <input type="checkbox" checked={memberIds.includes(t.id)} onChange={e=>toggleMember(t.id,e.target.checked)} disabled={busy}/>
       <span><strong>{t.full_name||t.email}</strong><span style={{display:"block",fontSize:13,color:"#666"}}>{t.email}{t.department?" · "+t.department:""}</span></span>
      </label>):<p style={{padding:16}}>Import people to start building this group.</p>}
     </div>
     <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap",marginTop:14}}>
      <span style={{fontSize:13,color:"#666"}}>{changed.add.length} to add · {changed.remove.length} to remove</span>
      <button onClick={saveMembership} disabled={busy||loadingMembers||(!changed.add.length&&!changed.remove.length)}>Save membership</button>
     </div>
    </>}
   </section>
  </section>
 </main>;
}
