import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
export default async function DashboardPage(){
  const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser(); if(!user)redirect("/login");
  const {data:memberships}=await supabase.from("org_members").select("org_id,role,organizations(id,name,aup_accepted_at)").eq("user_id",user.id);
  const orgs=(memberships||[]).map((m:any)=>m.organizations).filter(Boolean);
  if(!orgs.length)return <main style={{maxWidth:620,margin:"5rem auto",padding:"0 1rem"}}><h1>Create your organisation</h1><p>Signed in as {user.email}</p><Link href="/onboarding">Start onboarding →</Link></main>;
  const org=orgs[0];
  const [{count:targets},{count:groups},{count:campaigns},{data:domains}]=await Promise.all([
    supabase.from("targets").select("id",{count:"exact",head:true}).eq("org_id",org.id),
    supabase.from("groups").select("id",{count:"exact",head:true}).eq("org_id",org.id),
    supabase.from("campaigns").select("id",{count:"exact",head:true}).eq("org_id",org.id),
    supabase.from("domains").select("domain,verified_at").eq("org_id",org.id).order("domain")
  ]);
  return <main style={{maxWidth:1000,margin:"3rem auto",padding:"0 1rem"}}>
    <header style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><h1>{org.name}</h1><p>Security awareness administration</p></div><form action="/auth/signout" method="post"><button>Sign out</button></form></header>
    {!org.aup_accepted_at&&<section style={{border:"1px solid #e0a800",padding:16,margin:"24px 0"}}><strong>Acceptable-use terms required.</strong><p>Sending is disabled until setup is complete.</p><Link href="/onboarding">Complete setup →</Link></section>}
    <section style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16,marginTop:28}}><Card label="People" value={targets||0}/><Card label="Groups" value={groups||0}/><Card label="Campaigns" value={campaigns||0}/></section>
    <nav style={{display:"flex",gap:16,flexWrap:"wrap",marginTop:28}}><Link href="/people">Manage people & groups →</Link><Link href="/campaigns">Campaign builder →</Link><Link href="/campaigns/results">Campaign results →</Link></nav>
    <section style={{marginTop:32}}><h2>Sending domains</h2>{domains?.length?domains.map(d=><div key={d.domain} style={{padding:12,borderBottom:"1px solid #ddd"}}><strong>{d.domain}</strong>{" "}{d.verified_at?"✓ verified":"○ verification required"}</div>):<p>No sending domain has been added.</p>}</section>
    <section style={{marginTop:32}}><h2>Next steps</h2><ol><li>Add and verify your sending domain.</li><li>Import staff into groups.</li><li>Build a fictional simulation campaign.</li><li>Review outcomes and assign awareness training.</li></ol><p><strong>Safety gate:</strong> campaign sending requires domain verification and acceptable-use checks.</p></section>
  </main>;
}
function Card({label,value}:{label:string,value:number}){return <div style={{border:"1px solid #ddd",borderRadius:8,padding:20}}><div style={{color:"#666"}}>{label}</div><div style={{fontSize:32,fontWeight:700}}>{value}</div></div>}