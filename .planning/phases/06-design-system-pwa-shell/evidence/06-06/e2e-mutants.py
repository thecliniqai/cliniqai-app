#!/usr/bin/env python3
"""06-06 e2e mutant builds. `apply <set>` backs up and edits the files of a mutant set; `restore <set>` copies them back.
Sets: A = poll off (E1) + proxy lock redirect for every signed-in page incl. PWA assets (E2) + locked-page sign-out as a
plain form (E3) + iPad touch rule removed (E6); B = dirty guard off (E4) + skew guard off (E5)."""
import os, shutil, sys

ROOT = sys.argv[3] if len(sys.argv) > 3 else os.getcwd()

SETS = {
    "A": [
        ("lib/pwa/session-status.ts",
         "export function startSessionStatusWatch(deps: WatchDeps): SessionStatusWatch {\n",
         "export function startSessionStatusWatch(deps: WatchDeps): SessionStatusWatch {\n  void deps;\n  if (Date.now() > 0) return { check: async () => \"skipped\", stop: () => undefined };\n"),
        ("proxy.ts",
         "  // V2-06 06-05 (PWA_STRATEGY §4 D-4, ruling R-20): a signed-in page or RSC response",
         "  // MUTANT E2: the access redirect in the proxy (forbidden by SUB §7.2 item 5), applied to every signed-in GET\n"
         "  // outside the destinations and /api, PWA assets included.\n"
         "  if (signedIn && request.method === \"GET\" && !isApiPath(normaliseRequestPath(pathname) ?? pathname) &&\n"
         "      ![\"/billing/locked\", \"/billing/locked/staff\", \"/onboarding/billing\", \"/login\", \"/auth/signout\"].includes(pathname)) {\n"
         "    const { data: mutantMembership } = await supabase.from(\"memberships\").select(\"tenant_id, role\").eq(\"status\", \"active\").limit(1).maybeSingle();\n"
         "    if (mutantMembership) {\n"
         "      const { data: mutantLevel } = await supabase.rpc(\"my_tenant_access\", { p_tenant: mutantMembership.tenant_id });\n"
         "      if (mutantLevel === \"locked\") {\n"
         "        const target = request.nextUrl.clone();\n"
         "        target.pathname = [\"owner\", \"admin\"].includes(mutantMembership.role) ? \"/billing/locked\" : \"/billing/locked/staff\";\n"
         "        target.search = \"\";\n"
         "        return NextResponse.redirect(target, 307);\n"
         "      }\n"
         "    }\n"
         "  }\n\n"
         "  // V2-06 06-05 (PWA_STRATEGY §4 D-4, ruling R-20): a signed-in page or RSC response"),
        ("components/subscription/access-sign-out.tsx",
         "      onSubmit={(event) => {\n        event.preventDefault();\n        if (pending) return;\n        setPending(true);\n        void hardSignOut(\"user\");\n      }}\n",
         "      data-mutant={[String(pending), typeof setPending, typeof hardSignOut].join(\" \")}\n"),
        ("lib/pwa/platform.ts",
         "return /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);",
         "return /iPad/.test(ua) || (maxTouchPoints < 0);"),
    ],
    "B": [
        ("components/subscription/access-sign-out.tsx",
         "      onSubmit={(event) => {\n        event.preventDefault();\n        if (pending) return;\n        setPending(true);\n        void hardSignOut(\"user\");\n      }}\n",
         "      data-mutant={[String(pending), typeof setPending, typeof hardSignOut].join(\" \")}\n"),
        ("components/shell/pwa-runtime.tsx",
         "const stops = [startDirtyGuard(document), startSkewGuard(window), startInstallCapture(window)];",
         "const stops = [startInstallCapture(window)];\n    void startDirtyGuard;\n    void startSkewGuard;"),
        ("components/shell/route-error.tsx",
         "  useEffect(() => {\n    noteAppError(error);\n  }, [error]);\n",
         "  void noteAppError;\n"),
    ],
}

def main():
    action, name = sys.argv[1], sys.argv[2]
    for rel, old, new in SETS[name]:
        path = os.path.join(ROOT, rel)
        backup = path + ".e2e-mutant-backup"
        if action == "apply":
            src = open(path).read()
            assert src.count(old) == 1, (rel, src.count(old))
            shutil.copyfile(path, backup)
            open(path, "w").write(src.replace(old, new))
            print("mutated", rel)
        else:
            shutil.copyfile(backup, path)
            os.remove(backup)
            print("restored", rel)

main()
