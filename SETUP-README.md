# RateSecure Branch Portal — Setup

Five files make up the whole site:

- `index.html` — branch password gate
- `home.html` — dashboard / tool launcher
- `preapproval.html` — the pre-approval letter generator
- `config.js` — shared Supabase connection + auth + data helpers (all three
  pages load this)
- `SETUP-README.md` — this file

## 0. Put the files in a GitHub repo (inside the RATESECURE org)

1. Go to `github.com/RATESECURE` → **Repositories** → **New repository**.
2. Name it something like `branch-portal`. Keep it **Private**. Don't
   initialize with a README (you already have one).
3. On your computer, in a folder containing these 5 files, run:
   ```
   git init
   git add .
   git commit -m "Initial branch portal"
   git branch -M main
   git remote add origin https://github.com/RATESECURE/branch-portal.git
   git push -u origin main
   ```
   (GitHub will show you this exact command block on the empty repo's page
   right after you create it — you can copy it from there instead of
   retyping.)
4. Confirm the 5 files show up at `github.com/RATESECURE/branch-portal`.

Because the repo lives under the **RATESECURE organization** rather than
your personal account, it stays with the company automatically — no
transfer needed if you ever leave, as long as at least one other person is
an Owner of the org (see the note on that at the bottom of this file).

## 1. Create the Supabase project

1. Go to supabase.com → New Project. Name it whatever you like (e.g.
   "ratesecure-branch-portal").
2. Once it's created, go to **Project Settings → API**. You'll need two
   values from that page:
   - **Project URL** (looks like `https://xxxxxxxxxxxx.supabase.co`)
   - **anon public** key (a long string under "Project API keys")

## 2. Create the shared branch login

This is the *one* account everyone signs in with — there are no individual
logins, just a single shared password.

1. In Supabase, go to **Authentication → Users → Add user → Create new user**.
2. Email: `branch@ratesecure.com` (or whatever you prefer — just make sure
   it matches `BRANCH_LOGIN_EMAIL` in `config.js`).
3. Password: pick the branch-wide password everyone will use to sign in.
4. Check "Auto Confirm User" so it's active immediately.

## 3. Create the shared `signers` table

Go to **SQL Editor** in Supabase, paste this in, and run it:

```sql
create table signers (
  key text primary key,
  name text not null,
  title_line_1 text,
  title_line_2 text,
  nmls text,
  company text,
  email text,
  phone text,
  updated_at timestamptz default now()
);

alter table signers enable row level security;

-- Anyone signed in with the shared branch login can read and write
-- the team roster. There's only one login, so this is effectively
-- "the whole branch."
create policy "branch can read signers"
  on signers for select
  to authenticated
  using (true);

create policy "branch can insert signers"
  on signers for insert
  to authenticated
  with check (true);

create policy "branch can update signers"
  on signers for update
  to authenticated
  using (true);
```

The very first time anyone opens the letter tool, it'll notice the table is
empty and seed it with the three example team members (Trevor, Robin,
Briana) so there's something to start from. After that it never re-seeds —
your real data takes over.

## 4. Fill in `config.js`

Open `config.js` and set:

```js
var SUPA_URL = 'https://xxxxxxxxxxxx.supabase.co';   // from step 1
var SUPA_ANON_KEY = 'your-anon-public-key-here';       // from step 1
var BRANCH_LOGIN_EMAIL = 'branch@ratesecure.com';      // from step 2
```

## 5. Deploy to Netlify via GitHub

1. Create a Netlify account (or team — see the note on shared ownership
   below) and go to **Add new site → Import an existing project**.
2. Choose **GitHub**, authorize Netlify to access your GitHub account (or
   just the RATESECURE org, if it gives you that option — the more
   restrictive choice is fine), and select the `RATESECURE/branch-portal`
   repo.
3. Build settings: leave the build command **blank** and the publish
   directory as `.` (a period) — there's no build step, these are static
   files Netlify just serves as-is.
4. Click **Deploy**. Netlify gives you a URL like `yourname.netlify.app`
   immediately — that's your live site.

From now on, any time you push a change to the `main` branch on GitHub,
Netlify automatically redeploys the updated site within a minute or two.
No manual re-uploading, ever again.

## 6. Add a co-owner on Netlify and Supabase too

Same reasoning as the GitHub org: create the Netlify site under a **Team**
(not just your personal Netlify account) and the Supabase project under an
**Organization**, and invite a second person as Owner/Admin on each. That
way access to the live site and the database doesn't depend on any one
person.

## Adding more tools later

Open `home.html` and find the `TOOLS` array near the bottom — add a new
entry with a name, description, and link, and a card appears on the
dashboard automatically. Any new tool page just needs to include
`config.js` and call `requireAuth()` at the top the same way
`preapproval.html` does, and it'll be protected by the same branch login.

To ship the change: edit the file, then from the repo folder run
`git add . && git commit -m "describe the change" && git push` — Netlify
picks it up and redeploys automatically.
