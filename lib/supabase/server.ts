import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Uses the anon key plus the user's session cookie, so Row-Level Security applies.
// Never import the service-role key into app code; it belongs in edge functions only.
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (items) => {
          try {
            items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component; session refresh is handled in middleware.
          }
        },
      },
    },
  );
}
