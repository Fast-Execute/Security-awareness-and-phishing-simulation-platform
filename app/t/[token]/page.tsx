import { headers } from "next/headers";
import { notFound } from "next/navigation";

// Teachable-moment page. Recording the click happens here, server-side, so the service-role key
// never leaves the edge function. Nothing typed by the visitor is ever read or stored.
export const dynamic = "force-dynamic";
export const metadata = { title: "Security awareness", robots: { index: false, follow: false } };

const TOKEN_RE = /^[0-9a-f]{48}$/;

type TrackResult = { recorded: boolean; template_name: string | null; red_flags: string[] };

async function recordClick(token: string): Promise<TrackResult | null> {
  const h = await headers();
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/track`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
      },
      body: JSON.stringify({ token, event: "clicked", user_agent: h.get("user-agent") ?? "" }),
    });
    if (!res.ok) return null;
    return (await res.json()) as TrackResult;
  } catch {
    return null;
  }
}

export default async function TeachableMoment({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) notFound();

  const result = await recordClick(token);
  const flags = result?.red_flags ?? [];

  return (
    <main style={{ maxWidth: 640, margin: "3rem auto", padding: "0 1rem", lineHeight: 1.5 }}>
      <h1>This was a phishing simulation</h1>
      <p>
        No harm done, and nothing you typed was collected. Your organisation sent this message to help
        everyone practise spotting suspicious emails.
      </p>
      {flags.length > 0 ? (
        <>
          <h2>Warning signs in that email</h2>
          <ul>
            {flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </>
      ) : (
        <p>Check the sender, be wary of urgency, and report anything unexpected to your security team.</p>
      )}
      <p>
        <strong>Next time:</strong> do not click, and use your report button instead. Reporting is always the
        right call.
      </p>
    </main>
  );
}
