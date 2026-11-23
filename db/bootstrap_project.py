#!/usr/bin/env python3
"""Bootstrap a fresh Supabase project for WorkOS in one go.

Usage: SUPABASE_DB_URL='postgresql://...' python3 db/bootstrap_project.py --email alex@example.com [--password '...']

Steps: apply all migrations (append-only ledger), seed_initial, seed_v1, create the one auth user
(email confirmed) if missing, then print the checks. Never prints the password or the URL.
"""
import argparse, os, secrets, string, subprocess, sys, uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", help="omit to generate one; it is written to .tmp/first-password.txt")
    a = ap.parse_args()
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        sys.exit("SUPABASE_DB_URL is not set")
    py = sys.executable
    for step in (["db/apply.py", "--dry-run"], ["db/apply.py", "--apply"], ["db/seed_initial.py"], ["db/seed_v1.py"]):
        print("==", " ".join(step))
        r = subprocess.run([py, *step], cwd=ROOT, env=os.environ)
        if r.returncode:
            sys.exit(f"step failed: {step}")
    import psycopg
    pw = a.password or "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(16))
    with psycopg.connect(url) as c:
        n = c.execute("select count(*) from auth.users where email=%s", (a.email,)).fetchone()[0]
        if n:
            print("auth user exists, password unchanged")
        else:
            uid = str(uuid.uuid4())
            c.execute("""insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
                raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change,
                email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token,is_sso_user,is_anonymous)
                values ('00000000-0000-0000-0000-000000000000',%s::uuid,'authenticated','authenticated',%s::text,
                extensions.crypt(%s::text, extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,
                now(),now(),'','','','','','','','',false,false)""", (uid, a.email, pw))
            c.execute("""insert into auth.identities (id,user_id,provider_id,provider,identity_data,created_at,updated_at,last_sign_in_at)
                values (gen_random_uuid(),%s::uuid,%s::text,'email',jsonb_build_object('sub',%s::text,'email',%s::text,'email_verified',true),now(),now(),now())""",
                (uid, uid, uid, a.email))
            c.commit()
            out = ROOT / ".tmp" / "first-password.txt"; out.parent.mkdir(exist_ok=True); out.write_text(pw)
            print(f"auth user created; password written to {out} (delete after first sign-in)")
        tables = [r[0] for r in c.execute("select tablename from pg_tables where schemaname='public' and tablename like 'os\\_%' order by 1")]
        rt = [r[0] for r in c.execute("select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'")]
        tasks = c.execute("select count(*) from public.os_tasks").fetchone()[0]
        anon = c.execute("select bool_or(has_table_privilege('anon', 'public.'||tablename, 'select')) from pg_tables where schemaname='public' and tablename like 'os\\_%'").fetchone()[0]
    print(f"tables: {len(tables)} | realtime: {rt} | tasks seeded: {tasks} | anon can read anything: {anon}")

if __name__ == "__main__":
    main()
