# Online account setup

The app supports Google login through Supabase Auth. Without the two public environment variables it keeps working locally and shows a disabled Google-login control.

## Create the Supabase project

1. Create a project at https://database.new.
2. In **Connect**, copy the Project URL and publishable key.
3. Copy `.env.example` to `.env.local` and replace both placeholders.

The publishable key is intended for browser use. Never put the service-role key in a `NEXT_PUBLIC_` variable.

## Enable Google

1. In Google Cloud Console, create an OAuth 2.0 Web application.
2. Add the callback URL shown under **Supabase → Authentication → Providers → Google** to Google's authorized redirect URIs. It normally looks like `https://PROJECT_REF.supabase.co/auth/v1/callback`.
3. Paste the Google client ID and secret into the Supabase Google provider and enable it.
4. Under **Supabase → Authentication → URL Configuration**, set the production Site URL. Add `http://localhost:3000/**` for development and the Vercel preview pattern if previews need login.

Restart `pnpm run dev` after creating `.env.local`. The top navigation will show **Sign in**. A successful login returns to the app and persists across reloads.

For Vercel, add both public variables to the Production and Preview environments and add the final Vercel address to Supabase's allowed redirect URLs.

Google login establishes account identity. Database tables, row-level-security policies, outbox synchronization, and first-device migration are the next layer required for cross-device data synchronization.
